import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Text,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import {
  presentationKernel,
  type PresentationThemeSnapshot,
  type SemanticCallPresentation,
  type SemanticPresentation,
} from "../presentation-kernel/index";
import {
  CHROME_STYLE_DEFAULTS,
  DEFAULT_TOOL_BRANCH_GRAY,
  type PresentationToolFamily,
  type RtkRewriteRecord,
  type ToolPresentationPolicy,
} from "../tool-presentation/index";

import {
  BORDER_COLOR,
  CLICK_CONTROL_BREAK_MARK,
  CLIP_MARK,
  COMPONENT_PARENT,
  HEADER_WRAP_MARK,
  LEGACY_WRAP_MARK,
  OUTLINE_CHROME_BRIGHTEN,
  RESULT_SUMMARY_WRAP_MARK,
  TOOL_CLICK_DETAIL_LEVEL,
  TOOL_CLICK_LOCAL_EXPANDED,
  TOOL_CLICK_OWNER,
  TRAILING_MARK,
  TRANSPARENT_RESET,
  UI_NOTIFY_PATCH_FLAG,
  WRAP_MARK,
  applyToolBackgroundMode,
  bustSpinnerSettingsCache,
  clampLineWidth,
  getGlobalPiTheme,
  presentationThemeAdapter,
  readPiOutputPad,
  readSettings,
  setChromeColors,
  settingsCacheState,
  stripAnsi,
  syncToolBackgroundMode,
} from "./chrome.ts";
import type { ToolClickAction, ToolViewportAnchor } from "./click-routing.ts";

import type { ToolClickDetailLevel } from "./grouping.ts";
import type { ToolExecutionHostPorts } from "./ports.ts";

let toolExecutionHostPorts: ToolExecutionHostPorts;

export function connectToolExecutionHost(ports: ToolExecutionHostPorts): void {
  toolExecutionHostPorts = ports;
}

export function shortPath(cwd: string, filePath: string): string {
  if (!filePath) return "";
  const rel = relative(cwd, filePath);
  if (!rel.startsWith("..") && !rel.startsWith("/")) return rel || ".";
  const home = process.env.HOME ?? "";
  return home ? filePath.replace(home, "~") : filePath;
}

// ---------------------------------------------------------------------------
// Status dot — flickers green/gray while pending
// ---------------------------------------------------------------------------

export function toolHeader(
  tool: string,
  summary: string,
  theme: Theme,
  prefix = "",
  trailing = "",
): string {
  applyThemePaletteIfNeeded(theme);
  const label = theme.fg("toolTitle", theme.bold(tool));
  const body = summary
    ? `${label} ${HEADER_WRAP_MARK}${theme.fg("accent", summary)}`
    : label;
  return trailing ? `${prefix}${body}${trailing}` : `${prefix}${body}`;
}

export function liveLineCountTrailing(ctx: any, theme: Theme): string {
  if (ctx?.isPartial !== true) return "";
  const count = ctx?.state?._liveLineCount;
  if (typeof count !== "number" || !Number.isFinite(count) || count <= 0)
    return "";
  return ` ${theme.fg("muted", `(${toolExecutionHostPorts.toolFamily.lineCountLabel(count)})`)}`;
}

const BASH_STARTED_AT_KEY = "_bashStartedAtMs";
const BASH_ENDED_AT_KEY = "_bashEndedAtMs";

type BashDurationEntry = { invalidate: () => void };

const BASH_DURATION_CONTEXTS = new Map<any, BashDurationEntry>();
let bashDurationTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleBashDurationTick(): void {
  if (bashDurationTimer || BASH_DURATION_CONTEXTS.size === 0) return;
  bashDurationTimer = setTimeout(() => {
    bashDurationTimer = null;
    for (const entry of BASH_DURATION_CONTEXTS.values()) {
      try {
        entry.invalidate();
      } catch {
        /* noop */
      }
    }
    scheduleBashDurationTick();
  }, 1_000);
  toolExecutionHostPorts.clickRouting.unrefTimer(bashDurationTimer);
}

function registerBashDurationContext(ctx: any): void {
  const key = ctx?.state ?? ctx;
  if (!key) return;
  const invalidate =
    typeof ctx?.invalidate === "function"
      ? () => toolExecutionHostPorts.clickRouting.safeInvalidate(ctx)
      : () => {};
  BASH_DURATION_CONTEXTS.set(key, { invalidate });
  scheduleBashDurationTick();
}

function clearBashDurationContext(ctx: any): void {
  const key = ctx?.state ?? ctx;
  if (key) BASH_DURATION_CONTEXTS.delete(key);
  if (bashDurationTimer && BASH_DURATION_CONTEXTS.size === 0) {
    clearTimeout(bashDurationTimer);
    bashDurationTimer = null;
  }
}

export function clearAllBashDurationContexts(): void {
  BASH_DURATION_CONTEXTS.clear();
  if (bashDurationTimer) {
    clearTimeout(bashDurationTimer);
    bashDurationTimer = null;
  }
}

export function syncBashDuration(ctx: any, isPartial = true): void {
  const state = ctx?.state;
  if (!state) return;
  if (
    state._toolStatus === "pending" &&
    typeof state[BASH_STARTED_AT_KEY] !== "number"
  ) {
    state[BASH_STARTED_AT_KEY] = Date.now();
    delete state[BASH_ENDED_AT_KEY];
  }
  const startedAt = state[BASH_STARTED_AT_KEY];
  if (typeof startedAt !== "number") return;
  if (!isPartial || ctx?.isError) {
    if (typeof state[BASH_ENDED_AT_KEY] !== "number")
      state[BASH_ENDED_AT_KEY] = Date.now();
    clearBashDurationContext(ctx);
    return;
  }
  registerBashDurationContext(ctx);
}

export function bashElapsedMs(ctx: any): number | undefined {
  const startedAt = ctx?.state?.[BASH_STARTED_AT_KEY];
  if (typeof startedAt !== "number") return undefined;
  const endedAt = ctx?.state?.[BASH_ENDED_AT_KEY];
  return (typeof endedAt === "number" ? endedAt : Date.now()) - startedAt;
}

const BASH_ORIGINAL_COMMANDS = new Map<string, string>();
const BASH_REWRITES = new Map<string, RtkRewriteRecord>();
const BASH_PENDING_REWRITES: RtkRewriteRecord[] = [];
export const BASH_PREVIEW_INVALIDATORS = new Map<string, () => void>();

function normalizedBashCommand(command: string): string {
  return command.replace(/\s+/g, " ").trim();
}

function bashCommandsMatch(command: string, preview: string): boolean {
  const normalized = normalizedBashCommand(command);
  const candidate = normalizedBashCommand(preview);
  if (!normalized || !candidate) return false;
  if (normalized === candidate) return true;
  if (candidate.endsWith("…"))
    return normalized.startsWith(candidate.slice(0, -1));
  return normalized.startsWith(candidate) || candidate.startsWith(normalized);
}

export function trackBashOriginal(toolCallId: unknown, args: unknown): void {
  const command =
    typeof (args as any)?.command === "string" ? (args as any).command : "";
  if (typeof toolCallId === "string" && command.trim())
    BASH_ORIGINAL_COMMANDS.set(toolCallId, command);
}

function captureBashRewriteNotice(message: string): boolean {
  const match = message.match(/^RTK rewrite:\s*(.*?)\s*->\s*(.+)$/s);
  const rewrite =
    match?.[1]?.trim() && match?.[2]?.trim()
      ? {
          original: match[1].trim(),
          rewritten: match[2].trim(),
          notice: message,
        }
      : undefined;
  if (!rewrite) return false;
  const toolCallId = [...BASH_ORIGINAL_COMMANDS]
    .reverse()
    .find(([, command]) => bashCommandsMatch(command, rewrite.original))?.[0];
  if (toolCallId) BASH_REWRITES.set(toolCallId, rewrite);
  else {
    BASH_PENDING_REWRITES.push(rewrite);
    if (BASH_PENDING_REWRITES.length > 20) BASH_PENDING_REWRITES.shift();
  }
  return true;
}

export function bashRewriteFor(
  toolCallId: unknown,
  args: unknown,
): RtkRewriteRecord | undefined {
  if (typeof toolCallId !== "string") return undefined;
  const current =
    typeof (args as any)?.command === "string"
      ? (args as any).command
      : undefined;
  const original = BASH_ORIGINAL_COMMANDS.get(toolCallId);
  let rewrite = BASH_REWRITES.get(toolCallId);
  if (!rewrite) {
    const index = BASH_PENDING_REWRITES.findIndex(
      (candidate) =>
        (!!original && bashCommandsMatch(original, candidate.original)) ||
        (!!current &&
          (bashCommandsMatch(current, candidate.rewritten) ||
            bashCommandsMatch(current, candidate.original))),
    );
    if (index >= 0) {
      [rewrite] = BASH_PENDING_REWRITES.splice(index, 1);
      BASH_REWRITES.set(toolCallId, rewrite);
    }
  }
  if (
    !rewrite &&
    original &&
    current &&
    normalizedBashCommand(original) !== normalizedBashCommand(current)
  ) {
    rewrite = {
      original,
      rewritten: current,
      notice: `RTK rewrite: ${original} -> ${current}`,
    };
    BASH_REWRITES.set(toolCallId, rewrite);
  }
  return rewrite;
}

export function preserveBashPreview(
  toolCallId: unknown,
  invalidate: () => void,
): void {
  if (typeof toolCallId === "string")
    BASH_PREVIEW_INVALIDATORS.set(toolCallId, invalidate);
}

export function clearPreservedBashPreviews(): void {
  const invalidators = [...BASH_PREVIEW_INVALIDATORS.values()];
  BASH_PREVIEW_INVALIDATORS.clear();
  for (const invalidate of invalidators) {
    try {
      invalidate();
    } catch {
      /* noop */
    }
  }
}

export function clearBashHostState(): void {
  BASH_ORIGINAL_COMMANDS.clear();
  BASH_REWRITES.clear();
  BASH_PENDING_REWRITES.length = 0;
  clearPreservedBashPreviews();
}

export function setToolStatus(
  ctx: any,
  status: "pending" | "success" | "error" | "idle",
): void {
  if (ctx?.state) ctx.state._toolStatus = status;
}

export function syncToolCallStatus(ctx: any): void {
  if (ctx?.isPartial) {
    // Blink only for tools that actually started in the current agent run.
    // History rebuilds (resume, compaction, /tree) leave unmatched tool calls
    // with isPartial=true forever and never set executionStarted — those must
    // render settled, not keep a pending blink alive across sessions.
    const agentLive =
      toolExecutionHostPorts.transcript.transcriptTiming
        .currentAgentWorkStartMs !== undefined;
    const started = ctx?.executionStarted === true;
    if (agentLive && started) {
      setToolStatus(ctx, "pending");
      return;
    }
    if (agentLive && !started) {
      // Args still streaming before tool_execution_start — static, no blink.
      setToolStatus(ctx, "idle");
      clearBlinkTimer(ctx);
      return;
    }
    setToolStatus(ctx, "success");
    clearBlinkTimer(ctx);
    return;
  }
  setToolStatus(ctx, ctx.isError ? "error" : "success");
  clearBlinkTimer(ctx);
}

export function shouldRevealCallArgs(ctx: any): boolean {
  if (ctx?.argsComplete === true || ctx?.executionStarted === true) return true;
  const args = ctx?.args;
  if (!args || typeof args !== "object") return false;
  return Object.keys(args).some(
    (key) => args[key] !== undefined && args[key] !== null && args[key] !== "",
  );
}

export function stableCallSummary(
  ctx: any,
  key: string,
  build: () => string,
  reveal = shouldRevealCallArgs(ctx),
): string {
  const state = ctx?.state;
  const cached = state?.[key];
  const completeKey = `${key}Complete`;
  if (!reveal) return typeof cached === "string" ? cached : "";
  if (
    ctx?.argsComplete === true &&
    state?.[completeKey] === true &&
    typeof cached === "string"
  )
    return cached;
  if (!shouldRevealCallArgs(ctx) && typeof cached === "string" && cached)
    return cached;
  const summary = build();
  if (state) {
    state[key] = summary;
    if (ctx?.argsComplete === true) state[completeKey] = true;
    else delete state[completeKey];
  }
  return summary;
}

export function hasOwnArg(args: any, key: string): boolean {
  return !!args && Object.prototype.hasOwnProperty.call(args, key);
}

export function fileExistsForTool(cwd: string, filePath: string): boolean {
  if (!filePath) return false;
  try {
    return existsSync(resolve(cwd, filePath));
  } catch {
    return false;
  }
}

export const WRITE_EXISTED_BEFORE = new Map<string, boolean>();

export function patchUiNotifications(ui: any): void {
  if (!ui || ui[UI_NOTIFY_PATCH_FLAG]) return;
  const originalNotify = ui.notify;
  if (typeof originalNotify !== "function") return;
  ui.notify = function patchedUiNotify(
    message: string,
    type?: "info" | "warning" | "error",
  ) {
    if (typeof message === "string") {
      if (captureBashRewriteNotice(message)) return;
      if (message === "💾 Memory auto-reviewed and updated") {
        applyThemePaletteIfNeeded(ui.theme);
        message = `${BORDER_COLOR}✻ Memory auto-reviewed and updated${TRANSPARENT_RESET}`;
      }
    }
    return originalNotify.call(this, message, type);
  };
  ui[UI_NOTIFY_PATCH_FLAG] = true;
}

export function getWriteWasNewFile(
  ctx: any,
  cwd: string,
  filePath: string,
  reveal = shouldRevealCallArgs(ctx),
): boolean | undefined {
  if (typeof ctx?.state?._writeWasNewFile === "boolean")
    return ctx.state._writeWasNewFile;
  if (!filePath || !reveal) return undefined;
  const existedBefore =
    typeof ctx?.toolCallId === "string"
      ? WRITE_EXISTED_BEFORE.get(ctx.toolCallId)
      : undefined;
  const wasNew =
    existedBefore === undefined
      ? !fileExistsForTool(cwd, filePath)
      : !existedBefore;
  if (ctx?.state) ctx.state._writeWasNewFile = wasNew;
  return wasNew;
}

export function toolStatusDot(ctx: any, theme: Theme): string {
  const status = ctx.state?._toolStatus as
    "pending" | "success" | "error" | "idle" | undefined;
  if (status === "success")
    return `${toolExecutionHostPorts.grouping.themeStatusDot(theme, "success")} `;
  if (status === "error")
    return `${toolExecutionHostPorts.grouping.themeStatusDot(theme, "error")} `;
  if (status === "idle")
    return `${toolExecutionHostPorts.grouping.themeStatusDot(theme, "dim")} `;
  return `${blinkDot(ctx, theme)} `;
}

function semanticToolCallStatus(
  ctx: any,
): Pick<SemanticCallPresentation, "status" | "activity"> {
  const status = ctx.state?._toolStatus as
    SemanticCallPresentation["status"] | undefined;
  if (status !== "pending") return { status: status ?? "idle" };
  setupBlinkTimer(ctx);
  const active = getBlinkKey(ctx)?._blinkActive === true;
  if (ctx.state?._agentBreathe === true) {
    return {
      status,
      activity: { kind: "breathe", frame: _globalBlinkPhaseIndex, active },
    };
  }
  return {
    status,
    activity: { kind: "blink", visible: active && _globalBlinkPhase },
  };
}

// ---------------------------------------------------------------------------
// Branch connector — visual tree from header to output
// ---------------------------------------------------------------------------

function branchIndent(text: string, continued = false, theme?: Theme): string {
  const rule = currentToolBranchAnsi(theme);
  // Align under bare `├ `/`└ ` (│ + one space, or two spaces when closed).
  const prefix = continued ? `${rule}│${TRANSPARENT_RESET} ` : "  ";
  return `${prefix}${WRAP_MARK}${text}`;
}

function branchLead(text: string, continued = false, theme?: Theme): string {
  const rule = currentToolBranchAnsi(theme);
  // Bare tee/corner only — no horizontal ─ arm.
  return `${rule}${continued ? "├" : "└"}${TRANSPARENT_RESET} ${WRAP_MARK}${text}`;
}

export function withBranch(
  content: string,
  theme: Theme,
  _isError = false,
  continued = false,
): string {
  if (!content || !content.trim()) return "";
  const lines = content.split("\n");
  const first = lines[0] ?? "";
  if (lines.length === 1) return branchLead(first, continued, theme);
  const rest = lines
    .slice(1)
    .map((line) => branchIndent(line, continued, theme));
  return `${branchLead(first, continued, theme)}\n${rest.join("\n")}`;
}

export function withToolErrorIndent(content: string): string {
  if (!content || !content.trim()) return "";
  return content
    .split("\n")
    .map((line) => `  ${WRAP_MARK}${line}`)
    .join("\n");
}

function withClippedBranch(
  content: string,
  theme: Theme,
  continued = false,
): string {
  return withBranch(content, theme, false, continued).replaceAll(
    WRAP_MARK,
    CLIP_MARK,
  );
}

export function withFinalBranchBlock(content: string, theme: Theme): string {
  if (!content || !content.trim()) return "";
  const lines = content.split("\n");
  const first = lines[0] ?? "";
  if (lines.length === 1) return branchLead(first, false, theme);
  const middle = lines
    .slice(1, -1)
    .map((line) => branchIndent(line, true, theme));
  const last = lines[lines.length - 1] ?? "";
  return [
    branchLead(first, true, theme),
    ...middle,
    branchLead(last, false, theme),
  ].join("\n");
}

interface DiffOutputTreeBlock {
  heading?: string;
  content: string;
}

export function renderDiffOutputTree(
  summary: string,
  blocks: DiffOutputTreeBlock[],
  terminalAction: string | undefined,
  theme: Theme,
): string {
  const rows: Array<{ text: string; sibling: boolean }> = [
    { text: summary, sibling: true },
  ];
  if (blocks[0]?.heading) rows.push({ text: "", sibling: false });
  blocks.forEach((block, blockIndex) => {
    if (block.heading) rows.push({ text: block.heading, sibling: true });
    if (block.content) {
      for (const line of block.content.split("\n"))
        rows.push({ text: line, sibling: false });
    }
    if (blockIndex < blocks.length - 1) rows.push({ text: "", sibling: false });
  });
  if (terminalAction) rows.push({ text: terminalAction, sibling: true });
  return rows
    .map((row, index) => {
      if (index === rows.length - 1) return branchLead(row.text, false, theme);
      return row.sibling
        ? branchLead(row.text, true, theme)
        : branchIndent(row.text, true, theme);
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// Blink timer for partial (running) states
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Global blink timer — single timer invalidates all active contexts
// ---------------------------------------------------------------------------

const MAX_BLINKING_TOOLS = 5;
const BLINK_INTERVAL_MS = 500;
// Safety net ONLY for leaked entries after the agent has stopped. Quiet
// long-running tools (sleep, sparse builds, waiting on network) legitimately
// emit no tool_execution_update for minutes — treating that silence as "stale"
// is what made their ● freeze mid-run.
const BLINK_STALE_TIMEOUT_MS = 15000;
let _lastBlinkActivity = 0;

export function markBlinkActivity(): void {
  _lastBlinkActivity = Date.now();
}

type BlinkEntry = { key: any; order: number; invalidate: () => void };

const _blinkContexts = new Map<any, BlinkEntry>();
let _globalBlinkTimer: ReturnType<typeof setTimeout> | null = null;
let _blinkOrder = 0;
// Shared phase for all blinkers. Ordinary tools use even/odd (on/off ●).
// Agent-family tools map the index onto a 6-step size breath cycle.
export let _globalBlinkPhaseIndex = 0;
export let _globalBlinkPhase = true;

function getBlinkIntervalMs(): number {
  return BLINK_INTERVAL_MS;
}

function getBlinkKey(ctx: any): any {
  return ctx?.state ?? ctx;
}

function getBlinkingEntries(): BlinkEntry[] {
  return [..._blinkContexts.values()]
    .sort((a, b) => b.order - a.order)
    .slice(0, MAX_BLINKING_TOOLS);
}

function updateBlinkActiveStates(skipInvalidateKey?: any): void {
  const activeSet = new Set(getBlinkingEntries().map((entry) => entry.key));
  for (const entry of _blinkContexts.values()) {
    const active = activeSet.has(entry.key);
    if (entry.key?._blinkActive !== active) {
      entry.key._blinkActive = active;
      if (entry.key === skipInvalidateKey) continue;
      try {
        entry.invalidate();
      } catch {
        /* noop */
      }
    }
  }
}

export function _clearAllBlinkContexts(): void {
  for (const entry of _blinkContexts.values()) {
    try {
      entry.key._blinkActive = false;
    } catch {
      /* noop */
    }
  }
  _blinkContexts.clear();
  if (_globalBlinkTimer) {
    clearTimeout(_globalBlinkTimer);
    _globalBlinkTimer = null;
  }
  updateBlinkActiveStates();
}

function _scheduleGlobalBlinkTimer(): void {
  if (_globalBlinkTimer) return;
  const intervalMs = getBlinkIntervalMs();
  if (_blinkContexts.size === 0) return;
  _globalBlinkTimer = setTimeout(() => {
    _globalBlinkTimer = null;
    if (_blinkContexts.size === 0) {
      updateBlinkActiveStates();
      return;
    }
    // While an agent run is live, quiet tools are still in flight — keep blinking.
    // Heartbeat here so sparse/no-output commands never look "stale".
    if (
      toolExecutionHostPorts.transcript.transcriptTiming
        .currentAgentWorkStartMs !== undefined
    ) {
      markBlinkActivity();
    } else if (
      _lastBlinkActivity &&
      Date.now() - _lastBlinkActivity > BLINK_STALE_TIMEOUT_MS
    ) {
      // Agent already finished; leftover entries are leaks. Stop the re-render storm.
      _clearAllBlinkContexts();
      return;
    }
    _globalBlinkPhaseIndex =
      (_globalBlinkPhaseIndex + 1) %
      toolExecutionHostPorts.grouping.AGENT_BREATHE_LEN;
    _globalBlinkPhase = _globalBlinkPhaseIndex % 2 === 0;
    for (const entry of getBlinkingEntries()) {
      try {
        entry.invalidate();
      } catch {
        /* noop */
      }
    }
    _scheduleGlobalBlinkTimer();
  }, intervalMs);
  toolExecutionHostPorts.clickRouting.unrefTimer(_globalBlinkTimer);
}

function _stopGlobalBlinkTimerIfEmpty(): void {
  if (_globalBlinkTimer && _blinkContexts.size === 0) {
    clearTimeout(_globalBlinkTimer);
    _globalBlinkTimer = null;
  }
}

export function setupBlinkTimer(ctx: any): void {
  const key = getBlinkKey(ctx);
  if (!key) return;
  const invalidate =
    typeof ctx?.invalidate === "function"
      ? () => toolExecutionHostPorts.clickRouting.safeInvalidate(ctx)
      : () => {};
  const existing = _blinkContexts.get(key);
  if (existing) {
    // Already tracked — refresh invalidate + ensure the global timer is alive.
    // If a prior watchdog/pass stopped the timer without removing this entry
    // (or the timer simply died), a quiet long-running tool would otherwise
    // stay registered forever with a frozen ●.
    existing.invalidate = invalidate;
    markBlinkActivity();
    _scheduleGlobalBlinkTimer();
    return;
  }
  _blinkContexts.set(key, { key, order: ++_blinkOrder, invalidate });
  key._blinkActive = false;
  markBlinkActivity();
  // Registration runs inside the call renderer. Invalidating this same tool
  // synchronously re-enters updateDisplay() and inserts its reused component
  // twice. Update its active flag now; the current render already paints it.
  updateBlinkActiveStates(key);
  _stopGlobalBlinkTimerIfEmpty();
  _scheduleGlobalBlinkTimer();
}

export function clearBlinkTimer(ctx: any): void {
  const key = getBlinkKey(ctx);
  if (!key) return;
  _blinkContexts.delete(key);
  key._blinkActive = false;
  updateBlinkActiveStates();
  _stopGlobalBlinkTimerIfEmpty();
  _scheduleGlobalBlinkTimer();
}

function blinkDot(ctx: any, theme: Theme): string {
  // Only true in-flight tools arm the blink timer. Idle partials (args still
  // streaming, or history rows left isPartial without a result) stay static.
  if (ctx?.state?._toolStatus !== "pending") {
    return toolExecutionHostPorts.grouping.themeStatusDot(theme, "dim");
  }
  setupBlinkTimer(ctx);
  const key = getBlinkKey(ctx);
  if (key?._blinkActive !== true) return " ";
  // Agent-family tools breathe through sizes; ordinary tools still on/off ●.
  if (ctx?.state?._agentBreathe === true) {
    return toolExecutionHostPorts.grouping.agentBreatheDot(theme);
  }
  // Claude Code: solid filled circle that either shows or fully disappears —
  // never a hollow outlined ○ in the off phase.
  return _globalBlinkPhase
    ? toolExecutionHostPorts.grouping.themeStatusDot(theme, "success")
    : " ";
}

export function lineCount(text: string): number {
  if (!text) return 0;
  return text.split("\n").length;
}

function padToWidth(line: string, width: number): string {
  const safeWidth = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
  const clipped = clampLineWidth(line, safeWidth);
  const padding = Math.max(0, safeWidth - visibleWidth(clipped));
  return `${clipped}${" ".repeat(padding)}`;
}

function markedContinuationPrefix(prefix: string): string {
  const plain = stripAnsi(prefix);
  // Match bare leads (`├ `/`└ `/`│ `) and legacy armed forms (`├─ `/`└─ `/`│  `).
  const branchMatch = /^(\s*)(│  |│ |├─ |└─ |├ |└ )/.exec(plain);
  if (branchMatch) {
    const indent = branchMatch[1];
    const lead = branchMatch[2];
    // A closed branch must not grow a guide only because its text wraps.
    if (lead.startsWith("└")) return " ".repeat(visibleWidth(prefix));
    // Keep the same structure width as the lead glyph so wraps stay aligned.
    const pad = Math.max(0, visibleWidth(lead) - 1);
    return `${indent}${currentToolBranchAnsi()}│${TRANSPARENT_RESET}${" ".repeat(pad)}`;
  }
  return " ".repeat(visibleWidth(prefix));
}

export function markResultSummary(text: string): string {
  return `${RESULT_SUMMARY_WRAP_MARK}${text}`;
}

export function stripWrapMarks(text: string): string {
  return text
    .replaceAll(WRAP_MARK, "")
    .replaceAll(HEADER_WRAP_MARK, "")
    .replaceAll(RESULT_SUMMARY_WRAP_MARK, "")
    .replaceAll(LEGACY_WRAP_MARK, "");
}

function findWrapMark(
  line: string,
): { index: number; mark: string } | undefined {
  return [
    WRAP_MARK,
    HEADER_WRAP_MARK,
    RESULT_SUMMARY_WRAP_MARK,
    LEGACY_WRAP_MARK,
  ]
    .map((mark) => ({ index: line.indexOf(mark), mark }))
    .filter((candidate) => candidate.index >= 0)
    .sort((left, right) => left.index - right.index)[0];
}

const TOOL_OUTPUT_TAB_WIDTH = 4;

function expandTabStops(
  text: string,
  tabWidth = TOOL_OUTPUT_TAB_WIDTH,
): string {
  return text
    .split("\n")
    .map((line) => {
      const segments = line.split("\t");
      if (segments.length === 1) return line;
      let expanded = segments[0];
      for (const segment of segments.slice(1)) {
        const column = visibleWidth(expanded);
        const spaces = tabWidth - (column % tabWidth);
        expanded += `${" ".repeat(spaces)}${segment}`;
      }
      return expanded;
    })
    .join("\n");
}

function expandToolLineTabs(line: string): string {
  const marker = findWrapMark(line);
  if (!marker) return expandTabStops(line);
  const prefix = line.slice(0, marker.index);
  const body = line.slice(marker.index + marker.mark.length);
  return `${expandTabStops(prefix)}${marker.mark}${expandTabStops(body)}`;
}

function wrapMarkedLine(line: string, width: number): string[] {
  if (line.includes(TRAILING_MARK))
    return [
      toolExecutionHostPorts.grouping.alignTrailingMarkedLine(line, width),
    ];
  const clipIndex = line.indexOf(CLIP_MARK);
  if (clipIndex !== -1) {
    const prefix = stripWrapMarks(line.slice(0, clipIndex));
    const body = stripWrapMarks(line.slice(clipIndex + CLIP_MARK.length));
    const bodyWidth = Math.max(1, width - visibleWidth(prefix));
    if (visibleWidth(body) <= bodyWidth) return [`${prefix}${body}`];
    const hint = "…";
    return [
      `${prefix}${truncateToWidth(body, Math.max(0, bodyWidth - visibleWidth(hint)), "", false)}${hint}`,
    ];
  }
  const marker = findWrapMark(line);
  if (!marker) return wrapTextWithAnsi(stripWrapMarks(line), width);
  const prefix = stripWrapMarks(line.slice(0, marker.index));
  const body = stripWrapMarks(line.slice(marker.index + marker.mark.length));
  const prefixWidth = visibleWidth(prefix);
  const bodyWidth = Math.max(1, width - prefixWidth);
  // wrapTextWithAnsi keeps leading whitespace only on its first row. Separate
  // payload indentation from leading SGR codes, then add it back to every row.
  // Reduce the wrap width by the same amount so continuation rows never clip.
  const leading = /^((?:\x1b\[[0-9;]*m)*)([ \t]+)/.exec(body);
  const bodyIndent = leading?.[2] ?? "";
  const indentWidth = visibleWidth(bodyIndent);
  const unindentedBody = leading
    ? `${leading[1]}${body.slice(leading[0].length)}`
    : body;
  const wrapped = wrapTextWithAnsi(
    unindentedBody,
    Math.max(1, bodyWidth - indentWidth),
  );
  const continuation = markedContinuationPrefix(prefix);
  return wrapped.map((part, index) => {
    const leadingAnsi = /^(?:\x1b\[[0-9;]*m)*/.exec(part)?.[0] ?? "";
    const indentedPart = bodyIndent
      ? `${leadingAnsi}${bodyIndent}${part.slice(leadingAnsi.length)}`
      : part;
    return `${index === 0 ? prefix : continuation}${indentedPart}`;
  });
}

export type ToolTextSemanticRow = {
  line: number;
  text: string;
  action: ToolClickAction;
  viewportAnchor: ToolViewportAnchor;
  anchorText?: string;
};

type KernelPresentationInput = Readonly<{
  presentation: SemanticPresentation;
  expansion: "collapsed" | "expanded";
  detail?: ToolClickDetailLevel;
  preview?: Readonly<{
    normal?: unknown;
    expanded?: unknown;
    extra?: unknown;
  }>;
  theme: PresentationThemeSnapshot;
}>;

export function findToolExecutionAncestor(value: any): any | undefined {
  if (
    toolExecutionHostPorts.grouping.isToolExecutionComponent(
      value?.[TOOL_CLICK_OWNER],
    )
  )
    return value[TOOL_CLICK_OWNER];
  let current = value;
  for (let depth = 0; current && depth < 8; depth++) {
    if (toolExecutionHostPorts.grouping.isToolExecutionComponent(current))
      return current;
    current = current[COMPONENT_PARENT];
  }
  return undefined;
}

class ToolText extends Text {
  private value = "";
  private kernelPresentation?: KernelPresentationInput;
  private followPiOutputPad = false;
  private toolCachedValue?: string;
  private toolCachedWidth?: number;
  private toolCachedPaddingX?: number;
  private toolCachedClickKey?: string;
  private toolCachedLines?: string[];
  private observedWidth?: number;
  private pendingObservedWidth?: number;
  private widthObserver?: (width: number) => void;
  private widthObserverScheduled = false;
  private semanticRows: ToolTextSemanticRow[] = [];

  constructor(text = "") {
    super("", 0, 0);
    this.value = text;
  }

  setText(text: string): void {
    if (!this.kernelPresentation && this.value === text) return;
    this.kernelPresentation = undefined;
    this.value = text;
    this.invalidate();
  }

  setPresentation(input: KernelPresentationInput): void {
    this.kernelPresentation = input;
    this.value = "";
    this.invalidate();
  }

  setWidthObserver(observer?: (width: number) => void): void {
    this.widthObserver = observer;
    if (!observer) this.pendingObservedWidth = undefined;
  }

  setFollowPiOutputPad(follow: boolean): void {
    if (this.followPiOutputPad === follow) return;
    this.followPiOutputPad = follow;
    this.invalidate();
  }

  private observeWidth(width: number): void {
    if (this.observedWidth === width) return;
    this.observedWidth = width;
    if (!this.widthObserver) return;
    this.pendingObservedWidth = width;
    if (this.widthObserverScheduled) return;
    this.widthObserverScheduled = true;
    queueMicrotask(() => {
      this.widthObserverScheduled = false;
      const observed = this.pendingObservedWidth;
      this.pendingObservedWidth = undefined;
      if (observed !== undefined) this.widthObserver?.(observed);
    });
  }

  getSemanticRows(): ToolTextSemanticRow[] {
    return this.semanticRows;
  }

  getPresentationSurface(): SemanticPresentation["surface"] | undefined {
    return this.kernelPresentation?.presentation.surface;
  }

  hasClickAction(tool: any): boolean {
    if (this.kernelPresentation) {
      const { presentation } = this.kernelPresentation;
      const expandable =
        presentation.surface === "result"
          ? presentation.summary.expandable
          : presentation.surface === "stream" &&
            this.kernelPresentation.expansion === "collapsed" &&
            presentation.detail.totalRows > liveToolPreviewLimit();
      return (
        expandable &&
        toolExecutionHostPorts.clickRouting.toolClickExpansionActive(tool)
      );
    }
    return this.value
      .split("\n")
      .some(
        (line) =>
          toolExecutionHostPorts.clickRouting.resolveClickHints(line, tool)
            .anchors.length > 0,
      );
  }

  invalidate(): void {
    this.toolCachedValue = undefined;
    this.toolCachedWidth = undefined;
    this.toolCachedPaddingX = undefined;
    this.toolCachedClickKey = undefined;
    this.toolCachedLines = undefined;
    this.semanticRows = [];
  }

  render(width: number): string[] {
    this.observeWidth(width);
    const branchKey = toolBranchRenderCacheKey();
    const tool = findToolExecutionAncestor(this);
    const clickKey = tool
      ? toolExecutionHostPorts.clickRouting.toolClickStateKey(tool)
      : "none";
    const requestedPaddingX = this.followPiOutputPad ? readPiOutputPad() : 0;
    const paddingX = width > requestedPaddingX * 2 ? requestedPaddingX : 0;
    if (
      this.toolCachedLines &&
      this.toolCachedValue === this.value &&
      this.toolCachedWidth === width &&
      this.toolCachedPaddingX === paddingX &&
      this.toolCachedClickKey === clickKey &&
      (this as any)._toolBranchCacheKey === branchKey &&
      (this as any)._toolBranchCacheEpoch === _toolBranchVisualEpoch
    )
      return this.toolCachedLines;
    if (this.kernelPresentation) {
      const frame = presentationKernel.present(
        this.kernelPresentation.presentation,
        {
          width,
          padding: paddingX === 1 ? 1 : 0,
          expansion: this.kernelPresentation.expansion,
          detail:
            this.kernelPresentation.presentation.surface === "result" &&
            this.kernelPresentation.presentation.detail?.action === "max"
              ? tool &&
                toolExecutionHostPorts.clickRouting.toolLocalDetailLevel(
                  tool,
                ) >= 2
                ? 2
                : 1
              : this.kernelPresentation.detail,
          preview: this.kernelPresentation.preview,
          clickActions: tool
            ? toolExecutionHostPorts.clickRouting.toolClickExpansionActive(tool)
            : false,
          theme: this.kernelPresentation.theme,
        },
      );
      const rendered = frame.rows.map((row) => row.text);
      this.semanticRows = frame.rows.flatMap((row, line) =>
        row.actions.map((action) => {
          const plain = stripAnsi(row.text);
          const start =
            toolExecutionHostPorts.transcript.rawIndexAtVisibleColumn(
              plain,
              action.span.start,
            );
          const end = toolExecutionHostPorts.transcript.rawIndexAtVisibleColumn(
            plain,
            action.span.end,
          );
          return {
            line,
            text: row.text,
            action:
              action.origin === "execution-header"
                ? ("header" as const)
                : action.behavior === "toggle"
                  ? ("expand" as const)
                  : action.behavior === "max-detail"
                    ? ("detail-extra" as const)
                    : ("detail" as const),
            viewportAnchor: action.viewport,
            anchorText: plain.slice(start, end),
          };
        }),
      );
      this.toolCachedValue = this.value;
      this.toolCachedWidth = width;
      this.toolCachedPaddingX = paddingX;
      this.toolCachedClickKey = clickKey;
      this.toolCachedLines = rendered;
      (this as any)._toolBranchCacheKey = branchKey;
      (this as any)._toolBranchCacheEpoch = _toolBranchVisualEpoch;
      return rendered;
    }
    if (!this.value || this.value.trim() === "") {
      this.toolCachedValue = this.value;
      this.toolCachedWidth = width;
      this.toolCachedPaddingX = paddingX;
      this.toolCachedClickKey = clickKey;
      this.toolCachedLines = [];
      this.semanticRows = [];
      return this.toolCachedLines;
    }
    const contentWidth = Math.max(1, width - paddingX * 2);
    const horizontalPad = " ".repeat(paddingX);
    const logicalLines = this.value.split("\n").map(expandToolLineTabs);
    const rendered: string[] = [];
    const semanticRows: ToolTextSemanticRow[] = [];
    for (const logicalLine of logicalLines) {
      const header = logicalLine.includes(HEADER_WRAP_MARK);
      const resultSummary = logicalLine.includes(RESULT_SUMMARY_WRAP_MARK);
      const resolved = toolExecutionHostPorts.clickRouting.resolveClickHints(
        logicalLine,
        tool,
      );
      const breakIndex = resolved.text.indexOf(CLICK_CONTROL_BREAK_MARK);
      let resolvedText = resolved.text.replace(CLICK_CONTROL_BREAK_MARK, "");
      if (breakIndex >= 0) {
        const before = resolved.text.slice(0, breakIndex);
        const after = resolved.text.slice(
          breakIndex + CLICK_CONTROL_BREAK_MARK.length,
        );
        const usedWidth = visibleWidth(stripWrapMarks(before)) % contentWidth;
        if (usedWidth + visibleWidth(after) > contentWidth)
          resolvedText = `${before}\n  ${after}`;
      }
      for (const resolvedLine of resolvedText.split("\n")) {
        const wrapped = wrapMarkedLine(resolvedLine, contentWidth);
        for (const part of wrapped) {
          const line = `${horizontalPad}${padToWidth(part, contentWidth)}${horizontalPad}`;
          const lineIndex = rendered.length;
          rendered.push(line);
          if (header)
            semanticRows.push({
              line: lineIndex,
              text: line,
              action: "header",
              viewportAnchor: "top",
            });
          if (resultSummary)
            semanticRows.push({
              line: lineIndex,
              text: line,
              action: "expand",
              viewportAnchor: "top",
            });
          const partText = stripAnsi(part);
          for (const anchor of resolved.anchors) {
            if (resolved.anchors.length === 1) {
              semanticRows.push({
                line: lineIndex,
                text: line,
                action: anchor.action,
                viewportAnchor: anchor.viewportAnchor,
                ...(anchor.exactTextSpan ? { anchorText: anchor.text } : {}),
              });
              continue;
            }
            const target =
              toolExecutionHostPorts.clickRouting.toolSupportsProgressiveLocalDetail(
                tool,
              )
                ? anchor.action === "expand"
                  ? "click to collapse"
                  : "click for more detail"
                : anchor.action === "expand"
                  ? "collapse"
                  : "detail";
            if (partText.includes(target)) {
              semanticRows.push({
                line: lineIndex,
                text: line,
                action: anchor.action,
                viewportAnchor: anchor.viewportAnchor,
                anchorText: target,
              });
            }
          }
        }
      }
    }
    this.toolCachedValue = this.value;
    this.toolCachedWidth = width;
    this.toolCachedPaddingX = paddingX;
    this.toolCachedClickKey = clickKey;
    this.toolCachedLines = rendered;
    this.semanticRows = semanticRows;
    (this as any)._toolBranchCacheKey = branchKey;
    (this as any)._toolBranchCacheEpoch = _toolBranchVisualEpoch;
    return rendered;
  }
}

export function isToolTextComponent(value: unknown): value is ToolText {
  // ToolExecution's host-level render patch survives /reload, but ToolText does
  // not keep the same class identity. Match its narrow renderer interface.
  const candidate = value as Partial<ToolText> | undefined;
  return (
    value instanceof ToolText ||
    (Boolean(candidate) &&
      typeof candidate?.setText === "function" &&
      typeof candidate?.setFollowPiOutputPad === "function" &&
      typeof candidate?.getSemanticRows === "function" &&
      typeof candidate?.hasClickAction === "function")
  );
}

export function makeText(
  last: unknown,
  text: string,
  followPiOutputPad = false,
): Text {
  const component = isToolTextComponent(last) ? last : new ToolText();
  component.setWidthObserver();
  component.setFollowPiOutputPad(followPiOutputPad);
  component.setText(text);
  return component;
}

export function makePresentationText(
  last: unknown,
  presentation: SemanticPresentation,
  view: Pick<KernelPresentationInput, "expansion" | "detail" | "preview">,
  theme: Theme,
  followPiOutputPad = false,
): Text {
  const component =
    isToolTextComponent(last) &&
    typeof (last as ToolText).setPresentation === "function"
      ? last
      : new ToolText();
  component.setWidthObserver();
  component.setFollowPiOutputPad(followPiOutputPad);
  component.setPresentation({
    presentation,
    ...view,
    theme: presentationThemeSnapshot(theme),
  });
  return component;
}

export function makeToolFamilyCallText(
  family: PresentationToolFamily,
  name: string,
  label: string,
  args: unknown,
  theme: Theme,
  ctx: any,
  followPiOutputPad = false,
  policy?: ToolPresentationPolicy,
  elapsedMs?: number,
): Text {
  const decision =
    toolExecutionHostPorts.presentation.toolPresentationModule.present({
      surface: "call",
      tool: { family, name, label },
      cwd: ctx.cwd ?? process.cwd(),
      args,
      lifecycle: {
        ...semanticToolCallStatus(ctx),
        partial: ctx.isPartial === true,
        argsComplete: ctx.argsComplete === true,
        liveLineCount: ctx.state?._liveLineCount,
        ...(typeof elapsedMs === "number" ? { elapsedMs } : {}),
      },
      ...(policy ? { policy } : {}),
    });
  if (decision.kind === "suppress")
    return makeText(ctx.lastComponent, "", followPiOutputPad);
  return makePresentationText(
    ctx.lastComponent,
    decision.presentation,
    {
      expansion: ctx.expanded === true ? "expanded" : "collapsed",
      ...(name === "bash"
        ? {
            preview: {
              normal: Math.max(
                0,
                Math.floor(readSettings().bashCommandPreviewLines ?? 8),
              ),
            },
          }
        : {}),
    },
    theme,
    followPiOutputPad,
  );
}

export function decideToolFamilyResult(
  family: PresentationToolFamily,
  name: string,
  label: string,
  args: unknown,
  result: any,
  isPartial: boolean,
  ctx: any,
  policy?: ToolPresentationPolicy,
) {
  return toolExecutionHostPorts.presentation.toolPresentationModule.present({
    surface: "result",
    tool: { family, name, label },
    cwd: ctx.cwd ?? process.cwd(),
    args,
    lifecycle: {
      status:
        ctx.state?._toolStatus ??
        (ctx.isError ? "error" : isPartial ? "pending" : "success"),
      partial: isPartial,
      argsComplete: ctx.argsComplete === true,
    },
    ...(policy ? { policy } : {}),
    result: Object.freeze({
      content: Object.freeze(
        Array.isArray(result?.content) ? [...result.content] : [],
      ),
      details: result?.details,
      error: ctx.isError === true,
      partial: isPartial,
    }),
  });
}

function makeToolFamilyResultText(
  family: PresentationToolFamily,
  name: string,
  label: string,
  args: unknown,
  result: any,
  isPartial: boolean,
  view: Pick<KernelPresentationInput, "expansion" | "detail" | "preview">,
  theme: Theme,
  ctx: any,
  followPiOutputPad = false,
  policy?: ToolPresentationPolicy,
): Text {
  const decision = decideToolFamilyResult(
    family,
    name,
    label,
    args,
    result,
    isPartial,
    ctx,
    policy,
  );
  if (decision.kind === "suppress")
    return makeText(ctx.lastComponent, "", followPiOutputPad);
  return makePresentationText(
    ctx.lastComponent,
    decision.presentation,
    view,
    theme,
    followPiOutputPad,
  );
}

export function makeSettledToolFamilyResultText(
  family: PresentationToolFamily,
  name: string,
  label: string,
  result: any,
  expanded: boolean,
  theme: Theme,
  ctx: any,
  options: {
    detail?: ToolClickDetailLevel;
    normalPreview?: number;
    followPiOutputPad?: boolean;
    policy?: ToolPresentationPolicy;
  } = {},
): Text {
  clearBlinkTimer(ctx);
  setToolStatus(ctx, ctx.isError ? "error" : "success");
  const settings = readSettings();
  return makeToolFamilyResultText(
    family,
    name,
    label,
    ctx.args,
    result,
    false,
    {
      expansion: expanded ? "expanded" : "collapsed",
      detail:
        options.detail ??
        (expanded ? progressiveLocalDetailLevelForRender(ctx.state) : 0),
      preview: {
        normal: options.normalPreview ?? settings.previewLines,
        expanded: settings.expandedPreviewMaxLines,
        extra: settings.extraExpandedPreviewMaxLines,
      },
    },
    theme,
    ctx,
    options.followPiOutputPad,
    options.policy,
  );
}

export function makeResponsiveDiffText(
  ctx: any,
  last: unknown,
  text: string,
): Text {
  const component = makeText(last, text) as ToolText;
  component.setWidthObserver((width) => {
    if (ctx.state?._diffComponentWidth === width) return;
    if (ctx.state) ctx.state._diffComponentWidth = width;
    toolExecutionHostPorts.clickRouting.safeInvalidate(ctx);
  });
  return component;
}

function makeMcpText(last: unknown, text: string): Text {
  return makeText(last, text, true);
}

export function previewLimit(): number {
  const value = readSettings().previewLines;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 8;
}

function renderedToolLocalDetailLevel(
  state?: Record<PropertyKey, unknown>,
): ToolClickDetailLevel {
  const explicit =
    toolExecutionHostPorts.clickRouting.normalizeToolClickDetailLevel(
      state?.[TOOL_CLICK_DETAIL_LEVEL],
    );
  return explicit > 0
    ? explicit
    : toolExecutionHostPorts.clickRouting.toolLocalDetailLevel(
        toolExecutionHostPorts.clickRouting.toolRenderBridge.localDetailTool,
      );
}

export function progressiveLocalDetailLevelForRender(
  state?: Record<PropertyKey, unknown>,
): ToolClickDetailLevel {
  const rendererTool =
    toolExecutionHostPorts.clickRouting.toolRenderBridge.localDetailTool;
  return toolExecutionHostPorts.clickRouting.toolSupportsProgressiveLocalDetail(
    rendererTool,
  ) && rendererTool?.[TOOL_CLICK_LOCAL_EXPANDED] === true
    ? renderedToolLocalDetailLevel(state)
    : 0;
}

export function progressiveLocalControlsEnabled(): boolean {
  const rendererTool =
    toolExecutionHostPorts.clickRouting.toolRenderBridge.localDetailTool;
  return (
    toolExecutionHostPorts.clickRouting.toolSupportsProgressiveLocalDetail(
      rendererTool,
    ) &&
    toolExecutionHostPorts.clickRouting.toolClickExpansionActive(rendererTool)
  );
}

export function bashCollapsedLimit(): number {
  const value = readSettings().bashCollapsedLines;
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 10;
}

export function liveToolPreviewEnabled(): boolean {
  return readSettings().liveToolPreview !== false;
}

export function liveToolPreviewLimit(): number {
  const value = readSettings().liveToolPreviewLines;
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 5;
}

export const safeFgAnsi = (theme: unknown, key: string) =>
  presentationThemeAdapter.safeForeground(theme, key);
export const isLightThemeBackground = (theme: unknown) =>
  presentationThemeAdapter.isLightBackground(theme);

function presentationBranchPolicy() {
  return {
    mode: toolBranchColorModeFixed() ? ("fixed" as const) : ("theme" as const),
    gray: getConfiguredToolBranchGray(),
    outlineBrighten: OUTLINE_CHROME_BRIGHTEN,
  };
}

export function invalidateThemePaletteCache(): void {
  presentationKernel.resetPalette();
}

export function themeAdaptiveEnabled(): boolean {
  const settings = readSettings();
  return settings.themeAdaptive !== false;
}

export function resetThemePalette(): void {
  const configured =
    toolExecutionHostPorts.presentation.diffPresentationModule.compatibility.configuredForegrounds();
  invalidateThemePaletteCache();
  setChromeColors({
    border: CHROME_STYLE_DEFAULTS.border,
    codeBlockLanguage: CHROME_STYLE_DEFAULTS.codeBlockLanguage,
  });
  toolExecutionHostPorts.transcript.setWorkedLineForeground(
    CHROME_STYLE_DEFAULTS.workedLine,
  );
  toolExecutionHostPorts.grouping.setToolStatusColors({
    success: CHROME_STYLE_DEFAULTS.statusSuccess,
    error: CHROME_STYLE_DEFAULTS.statusError,
    pending: CHROME_STYLE_DEFAULTS.statusPending,
  });
  FG_DIM = configured.dim ?? CHROME_STYLE_DEFAULTS.dim;
  FG_RULE = configured.rule ?? CHROME_STYLE_DEFAULTS.rule;
  applyToolBranchColor();
}

function presentationPaletteRequest(theme: Theme) {
  return presentationThemeAdapter.paletteRequest({
    theme,
    adaptive: themeAdaptiveEnabled(),
    branch: presentationBranchPolicy(),
    adaptiveRule: presentationThemeAdapter.outlineAnsi(
      { ...presentationBranchPolicy(), mode: "theme" },
      theme,
    ),
    overrides:
      toolExecutionHostPorts.presentation.diffPresentationModule.compatibility.configuredForegrounds(),
  });
}

function presentationThemeSnapshot(theme: Theme): PresentationThemeSnapshot {
  applyThemePaletteIfNeeded(theme);
  return {
    palette: presentationPaletteRequest(theme),
    control: {
      foregroundReset: "\x1b[39m",
      branchReset: TRANSPARENT_RESET,
      bold: "\x1b[1m",
      boldReset: "\x1b[22m",
    },
    expandHint: toolExecutionHostPorts.clickRouting.configuredKeyHint(
      "app.tools.expand",
      "ctrl+o",
      "to expand",
    ),
    collapseHint: toolExecutionHostPorts.clickRouting.configuredKeyHint(
      "app.tools.expand",
      "ctrl+o",
      "to collapse",
    ),
    extraDetailHint: toolExecutionHostPorts.clickRouting.themedRawKeyHint(
      theme,
      "ctrl+shift+o",
      toolExecutionHostPorts.clickRouting.extraToolOutputExpanded
        ? "less detail"
        : "more detail",
    ),
  };
}

export function applyThemePaletteIfNeeded(theme: any): void {
  if (!theme) return;
  applyToolBranchColor(theme);
  const resolution = presentationKernel.resolvePalette(
    presentationPaletteRequest(theme),
  );
  if (resolution.changed) bumpToolBranchVisualEpoch();
  FG_DIM = resolution.colors.dim;
  FG_RULE = resolution.colors.rule;
  toolExecutionHostPorts.grouping.setToolStatusColors({
    success: resolution.colors.statusSuccess,
    error: resolution.colors.statusError,
    pending: resolution.colors.statusPending,
  });
}

const D_RST = "\x1b[0m";
export let FG_DIM = "\x1b[38;2;80;80;80m";
let FG_RULE = "\x1b[38;2;50;50;50m";
function outlineChromeAnsiFromBranch(theme?: unknown): string {
  return presentationThemeAdapter.outlineAnsi(
    presentationBranchPolicy(),
    theme,
  );
}

export function getConfiguredToolBranchGray(): number {
  const raw = readSettings().toolBranchRgbGray;
  return typeof raw === "number" && Number.isFinite(raw)
    ? Math.max(0, Math.min(255, Math.round(raw)))
    : DEFAULT_TOOL_BRANCH_GRAY;
}

export function toolBranchColorModeFixed(): boolean {
  return readSettings().toolBranchColorMode !== "theme";
}

export function toolBranchRenderCacheKey(): string {
  if (toolBranchColorModeFixed())
    return `fixed:${getConfiguredToolBranchGray()}`;
  return `theme:${stripAnsi(TOOL_RULE)}`;
}

export let _toolBranchVisualEpoch = 0;

export function bumpToolBranchVisualEpoch(): void {
  _toolBranchVisualEpoch++;
}

/** Shared outline chrome: user box, tool rules, code fences, branch connectors. */
export function resolveThemeChromeFg(theme: unknown): string | null {
  return presentationThemeAdapter.chromeForeground(
    theme,
    themeAdaptiveEnabled(),
  );
}

export function currentToolBranchAnsi(
  theme: unknown = getGlobalPiTheme(),
): string {
  return presentationThemeAdapter.branchAnsi(presentationBranchPolicy(), theme);
}

/** User box, code fences, thinking/thought: branch + OUTLINE_CHROME_BRIGHTEN (never same as branch). */
function syncOutlineChromeFromBranch(theme?: any): void {
  const outline = outlineChromeAnsiFromBranch(theme);
  const prevBorder = BORDER_COLOR;
  setChromeColors({ border: outline, codeBlockLanguage: outline });
  toolExecutionHostPorts.transcript.setWorkedLineForeground(outline);
  if (outline !== prevBorder) bumpToolBranchVisualEpoch();
}

function applyToolBranchColor(theme?: any): void {
  const prev = TOOL_RULE;
  TOOL_RULE = currentToolBranchAnsi(theme);
  if (TOOL_RULE !== prev) bumpToolBranchVisualEpoch();
  syncOutlineChromeFromBranch(theme);
}

export function initializeToolBranchColor(): void {
  applyToolBranchColor();
}

export function refreshAllToolBranchVisuals(ctx: any): void {
  settingsCacheState.entry = null;
  syncToolBackgroundMode();
  invalidateThemePaletteCache();
  applyToolBackgroundMode(ctx?.ui?.theme);
  applyToolBranchColor(ctx?.ui?.theme);
  bumpToolBranchVisualEpoch(); // always bust ToolText + container caches after /cc-tools branch
  // Tool rows recompute branch markup on next render (liveBranchDisplay + cache bust).
  if (ctx?.hasUI) {
    try {
      ctx.ui.setToolsExpanded(ctx.ui.getToolsExpanded());
      ctx.ui.invalidate?.();
      ctx.ui.requestRender?.();
    } catch {
      /* noop */
    }
  }
}

/** Re-derive borders, branches, diffs, and spinner keys from the active pi theme (no cross-extension deps). */
export function rebindUiChromeToTheme(ctx: any): void {
  if (!ctx?.hasUI) return;
  settingsCacheState.entry = null;
  syncToolBackgroundMode();
  bustSpinnerSettingsCache();
  applyToolBackgroundMode(ctx.ui?.theme);
  applyThemePaletteIfNeeded(ctx.ui?.theme);
  toolExecutionHostPorts.presentation.diffPresentationModule.reset();
  bumpToolBranchVisualEpoch();
  refreshAllToolBranchVisuals(ctx);
}

export function scheduleDeferredChromeRebind(ctx: any, delayMs = 0): void {
  const timer = setTimeout(() => {
    try {
      rebindUiChromeToTheme(ctx);
    } catch {
      /* noop */
    }
  }, delayMs);
  toolExecutionHostPorts.clickRouting.unrefTimer(timer);
}

let TOOL_RULE = "\x1b[38;2;72;72;72m";
