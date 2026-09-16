import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  AssistantMessageComponent,
  BashExecutionComponent,
  BranchSummaryMessageComponent,
  CompactionSummaryMessageComponent,
  CustomMessageComponent,
  ToolExecutionComponent,
  keyText,
} from "@earendil-works/pi-coding-agent";
import {
  Container,
  Markdown,
  Spacer,
  Text,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import {
  registerMouseHostAdapter,
  type MouseTarget,
} from "../click-expansion/mouse";
import {
  beginToolCollapseViewportTransaction,
  captureToolCollapseViewportRollback,
  findToolGroupLayoutBox,
  toolGroupBoxContains,
  type RequestedToolCollapseViewportAnchor,
  type ToolGroupFullscreenRenderer,
  type ToolGroupInteractiveMode,
  type ToolGroupLayoutBox,
} from "../click-expansion/viewport";

import {
  ACTIVE_TOOL_GROUPS_KEY,
  BUILTIN_EXPANSION_PATCH_FLAG,
  BUILTIN_EXPANSION_RENDER_PATCH_FLAG,
  BUILTIN_EXPANSION_RENDER_TRANSFORM,
  BUILTIN_EXPANSION_STATE,
  CLICK_EXPANSION_ACTIVATE_TARGET,
  CLICK_EXPANSION_ACTIVATION_HOST,
  CLICK_EXPANSION_ROLLBACK_HOST,
  CLICK_RUNTIME_KEY,
  CLIP_MARK,
  COMPONENT_PARENT,
  ITERM2_IMAGE_PREFIX,
  KITTY_IMAGE_PREFIX,
  PARENT_TRACKING_PATCH_FLAG,
  PATCH_FLAG,
  TOOL_CLICK_LOCAL_EXPANDED,
  TOOL_RENDER_CACHE,
  TRAILING_MARK,
  TRANSPARENT_RESET,
  borderLine,
  clampLineWidth,
  getGlobalPiTheme,
  isBlankLine,
  readPiOutputPad,
  readSettings,
  stripAnsi,
  syncToolOutputPad,
  toolBackgroundMode,
  writeSettingsKey,
} from "./chrome.ts";
import type {
  InternalClickExpansionDeclaration,
  ToolClickAction,
  ToolClickAnchor,
  ToolViewportAnchor,
} from "./click-routing.ts";

import type { ToolTextSemanticRow } from "./tool-execution.ts";
import type { GroupingHostPorts } from "./ports.ts";

let groupingHostPorts: GroupingHostPorts;

export function connectGroupingHost(ports: GroupingHostPorts): void {
  groupingHostPorts = ports;
}

function isToolExecutionLike(
  value: unknown,
): value is { toolName: string; toolCallId: string } {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.toolName === "string" &&
    typeof candidate.toolCallId === "string"
  );
}

const AGENT_FAMILY_TOOL_NAMES = new Set([
  "Agent",
  "Agents",
  "get_subagent_result",
  "steer_subagent",
]);

export function isAgentFamilyToolName(name: unknown): boolean {
  return typeof name === "string" && AGENT_FAMILY_TOOL_NAMES.has(name);
}

function isTerminalImageLine(line: string): boolean {
  return (
    line.includes(KITTY_IMAGE_PREFIX) || line.includes(ITERM2_IMAGE_PREFIX)
  );
}

export function normalizeLeadingCheckGlyph(line: string): string {
  return line.replace(
    /^((?:\x1b\[[0-9;]*m|[ \t]|[├└│─])*)[✓✔]((?:\x1b\[[0-9;]*m)*)(?=\s)/,
    "$1●$2",
  );
}

export function stripOuterBackgroundAnsi(line: string): string {
  return line
    .replace(/^\x1b\[(?:49|4[0-7]|10[0-7]|48;5;\d+|48;2;\d+;\d+;\d+)m/, "")
    .replace(/\x1b\[49m$/, "");
}

function firstImageBlockStart(lines: string[]): number {
  const imageLineIndex = lines.findIndex(isTerminalImageLine);
  if (imageLineIndex === -1) return -1;
  let start = imageLineIndex;
  while (start > 0 && isBlankLine(lines[start - 1])) start--;
  return start;
}

export function splitRenderedImageBlock(lines: string[]): {
  textLines: string[];
  imageLines: string[];
} {
  const imageStart = firstImageBlockStart(lines);
  if (imageStart === -1) return { textLines: lines, imageLines: [] };
  const textLines = lines.slice(0, imageStart);
  while (textLines.length > 0 && isBlankLine(textLines[textLines.length - 1]))
    textLines.pop();
  return { textLines, imageLines: lines.slice(imageStart) };
}

export function toolGroupingEnabled(): boolean {
  return readSettings().groupToolCalls !== false;
}

export function setToolGroupingEnabled(enabled: boolean): void {
  writeSettingsKey("groupToolCalls", enabled);
}

type ThinkingMode = "live" | "full";

export function getThinkingMode(): ThinkingMode {
  return groupingHostPorts.toolFamily.getMode(
    readSettings().thinkingMode,
    ["live", "full"] as const,
    "live",
  );
}

export function isAssistantThinkingComplete(comp: any, message: any): boolean {
  if (!message || message.role !== "assistant") return false;
  if (
    typeof message[groupingHostPorts.transcript.THINKING_DURATION_KEY] ===
    "number"
  )
    return true;
  if (message[groupingHostPorts.transcript.THINKING_ACTIVE_KEY]) return false;
  // Providers keep stopReason "pending" for the whole stream ("deferred" while
  // a deferred call is unresolved); both are in-flight sentinels, never
  // completion signals. Without this, live-thinking detection would depend on
  // THINKING_ACTIVE_KEY being stamped before the UI renders the same event.
  if (message.stopReason === "pending" || message.stopReason === "deferred")
    return false;
  if (typeof message.stopReason === "string" && message.stopReason.length > 0)
    return true;
  if (Array.isArray(message.content)) {
    let sawThinking = false;
    for (const block of message.content) {
      if (
        block?.type === "thinking" &&
        typeof block.thinking === "string" &&
        block.thinking.trim()
      ) {
        sawThinking = true;
      } else if (
        sawThinking &&
        ((block?.type === "text" &&
          typeof block.text === "string" &&
          block.text.trim()) ||
          block?.type === "toolCall")
      ) {
        return true;
      }
    }
    if (sawThinking) return false;
  }
  return true;
}

export function isLiveThinkingMessage(comp: any, message: any): boolean {
  if (!message || message.role !== "assistant") return false;
  if (isAssistantThinkingComplete(comp, message)) return false;
  if ((message as any)[groupingHostPorts.transcript.THINKING_ACTIVE_KEY])
    return true;
  if (Array.isArray(message.content)) {
    return message.content.some(
      (b: any) =>
        b?.type === "thinking" &&
        typeof b?.thinking === "string" &&
        b.thinking.trim(),
    );
  }
  return false;
}

type ToolStatus = "pending" | "success" | "error";

function getToolStatusForGroup(tool: any): ToolStatus {
  if (tool?.result?.isError) return "error";
  if (tool?.result && tool?.isPartial !== true) return "success";
  // Only in-flight tools that actually started this agent run count as pending.
  // History rows reconstructed without a matching toolResult stay isPartial=true
  // forever; treating them as pending made interrupted tools blink again on resume.
  if (
    tool?.isPartial === true &&
    tool?.executionStarted === true &&
    groupingHostPorts.transcript.transcriptTiming.currentAgentWorkStartMs !==
      undefined
  ) {
    return "pending";
  }
  return "success";
}

export let TOOL_STATUS_SUCCESS = "\x1b[32m";
export let TOOL_STATUS_ERROR = "\x1b[31m";
export let TOOL_STATUS_PENDING = "\x1b[90m";

export function setToolStatusColors(colors: {
  success: string;
  error: string;
  pending: string;
}): void {
  TOOL_STATUS_SUCCESS = colors.success;
  TOOL_STATUS_ERROR = colors.error;
  TOOL_STATUS_PENDING = colors.pending;
}

function statusText(status: ToolStatus, count: number): string {
  const label =
    status === "success" ? "done" : status === "error" ? "failed" : "running";
  const color =
    status === "success"
      ? TOOL_STATUS_SUCCESS
      : status === "error"
        ? TOOL_STATUS_ERROR
        : TOOL_STATUS_PENDING;
  return `${color}${count}${TRANSPARENT_RESET} ${label}`;
}

function countToolStatuses(tools: any[]): Record<ToolStatus, number> {
  return tools.reduce(
    (counts, tool) => {
      counts[getToolStatusForGroup(tool)]++;
      return counts;
    },
    { pending: 0, success: 0, error: 0 } as Record<ToolStatus, number>,
  );
}

function formatToolGroupCounts(tools: any[]): string {
  const counts = countToolStatuses(tools);
  const parts: string[] = [];
  if (counts.pending) parts.push(statusText("pending", counts.pending));
  if (counts.success) parts.push(statusText("success", counts.success));
  if (counts.error) parts.push(statusText("error", counts.error));
  return parts.join(`${TRANSPARENT_RESET} • `);
}

function getToolName(tool: any): string {
  return typeof tool?.toolName === "string" && tool.toolName
    ? tool.toolName
    : "tool";
}

function getGroupedToolName(tools: any[]): string | undefined {
  const first = getToolName(tools[0]);
  return tools.every((tool) => getToolName(tool) === first) ? first : undefined;
}

function getToolGroupLabel(tools: any[]): string {
  const sameName = getGroupedToolName(tools);
  return sameName
    ? groupingHostPorts.toolFamily.humanizeToolName(sameName)
    : "Multiple Tools";
}

// Claude Code: solid filled circle that is either fully present or fully gone
// while pending — never a hollow outlined ○. Classic ● + bold is the sweet
// spot for ordinary tools. Agent-family tools use a breathing size cycle.
const STATUS_DOT_FILLED = "●";
const STATUS_DOT_BOLD = "\x1b[1m";
// Single-cell glyphs only (⬤ is often double-width and walks the baseline).
// Optical sizes share the same cell so the center stays put while breathing:
// big ● → medium • → small · → invisible → small · → medium •
const AGENT_BREATHE_GLYPHS = ["●", "•", "·", " ", "·", "•"] as const;
export const AGENT_BREATHE_LEN = AGENT_BREATHE_GLYPHS.length;

function paintStatusDot(colorAnsi: string): string {
  return `${colorAnsi}${STATUS_DOT_BOLD}${STATUS_DOT_FILLED}${TRANSPARENT_RESET}`;
}

export function themeStatusDot(
  theme: Theme,
  colorKey: "success" | "error" | "dim" | "muted",
): string {
  // theme.fg may not preserve nested SGR cleanly — color the glyph string itself.
  return theme.fg(colorKey, `${STATUS_DOT_BOLD}${STATUS_DOT_FILLED}`);
}

function agentBreatheGlyphRaw(): string {
  // Always exactly one display cell — matches ordinary tool dots, keeps titles aligned.
  return AGENT_BREATHE_GLYPHS[
    groupingHostPorts.toolExecution._globalBlinkPhaseIndex % AGENT_BREATHE_LEN
  ];
}

function paintAgentBreatheDot(colorAnsi: string = TOOL_STATUS_SUCCESS): string {
  const glyph = agentBreatheGlyphRaw();
  if (glyph === " ") return " ";
  // Bold only on the largest frame so weight changes without shifting the cell.
  const bold = glyph === "●" ? STATUS_DOT_BOLD : "";
  return `${colorAnsi}${bold}${glyph}${TRANSPARENT_RESET}`;
}

export function agentBreatheDot(theme: Theme): string {
  const glyph = agentBreatheGlyphRaw();
  if (glyph === " ") return " ";
  const bold = glyph === "●" ? STATUS_DOT_BOLD : "";
  return theme.fg("success", `${bold}${glyph}`);
}

function groupStatusLight(
  status: ToolStatus,
  options?: { agentBreathe?: boolean },
): string {
  const color =
    status === "success"
      ? TOOL_STATUS_SUCCESS
      : status === "error"
        ? TOOL_STATUS_ERROR
        : TOOL_STATUS_PENDING;
  if (status === "pending") {
    // Prefer the shared blink phase over wall-clock so group lights stay in sync
    // with the global timer (and Agent breathe). Space keeps column alignment.
    if (options?.agentBreathe) return paintAgentBreatheDot(TOOL_STATUS_SUCCESS);
    return groupingHostPorts.toolExecution._globalBlinkPhase
      ? paintStatusDot(TOOL_STATUS_SUCCESS)
      : " ";
  }
  return paintStatusDot(color);
}

function formatToolNameList(tools: any[]): string {
  const counts = new Map<string, number>();
  for (const tool of tools) {
    const name = getToolName(tool);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(
      ([name, count]) =>
        `${groupingHostPorts.toolFamily.humanizeToolName(name)}${count > 1 ? `×${count}` : ""}`,
    )
    .join(", ");
}

function getRepeatedToolSubject(
  tools: any[],
  groupedName: string | undefined,
): string {
  if (!groupedName || tools.length === 0) return "";
  if (groupedName === "read") {
    const paths = tools.map((tool) => String(tool?.args?.path ?? ""));
    if (paths[0] && paths.every((path) => path === paths[0])) {
      return groupingHostPorts.toolExecution.shortPath(process.cwd(), paths[0]);
    }
  }
  const summaries = tools.map(getToolArgSummary);
  return summaries[0] && summaries.every((summary) => summary === summaries[0])
    ? summaries[0]
    : "";
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripGroupedToolLabel(
  line: string,
  label: string | undefined,
): string {
  if (!label) return line;
  const ansi = "(?:\\x1b\\[[0-9;]*m)*";
  const pattern = new RegExp(`^(${ansi})${escapeRegex(label)}(${ansi})\\s+`);
  return line.replace(pattern, "$1$2");
}

function isOuterToolRule(line: string): boolean {
  const plain = stripAnsi(line).trim();
  return plain.length >= 8 && /^[─━]+$/.test(plain);
}

function stripToolChrome(lines: string[]): string[] {
  // ToolExecutionComponent wraps its card in horizontal rules. Remove only the
  // two outer rules. A blank or box-drawing-only row between them can be tool
  // output and must stay intact.
  let content = groupingHostPorts.transcript.trimRenderedBlankLines(lines);
  if (content.length > 0 && isOuterToolRule(content[0]))
    content = content.slice(1);
  if (content.length > 0 && isOuterToolRule(content[content.length - 1]))
    content = content.slice(0, -1);
  return content;
}

function stripLeadingToolStatus(line: string): string {
  // Drop the single-cell status marker so group rows can re-prefix a fresh light.
  // Include Agent breathe glyphs (·) and the blank off-phase (space) so the title
  // never keeps a leftover marker that shifts when size changes.
  return line.replace(
    /^((?:\x1b\[[0-9;]*m|[ \t]|[├└│─])*)(?:\x1b\[[0-9;]*m)*(?:[●○✗■⬤•·]| )(?:\x1b\[[0-9;]*m)*\s+/,
    "$1",
  );
}

function trimAnsiLeft(text: string): string {
  let current = text;
  while (true) {
    const next = current.replace(/^((?:\x1b\[[0-9;]*m)*)[ \t]+/, "$1");
    if (next === current) return current;
    current = next;
  }
}

function trimAnsiLeftColumns(text: string, columns: number): string {
  let current = text;
  for (let index = 0; index < columns; index++) {
    const next = current.replace(/^((?:\x1b\[[0-9;]*m)*)[ \t]/, "$1");
    if (next === current) break;
    current = next;
  }
  return current;
}

function closedBranchContinuationTrims(lines: string[]): Map<number, number> {
  const trims = new Map<number, number>();
  let closedBranch: { outerIndent: number; contentColumn: number } | undefined;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const plain = stripAnsi(lines[lineIndex]);
    const closedMatch = /^([ \t]*)(└─ |└ )/.exec(plain);
    if (closedMatch) {
      const outerIndent = visibleWidth(closedMatch[1]);
      closedBranch = {
        outerIndent,
        contentColumn: outerIndent + visibleWidth(closedMatch[2]),
      };
      continue;
    }
    if (closedBranch) {
      const leading = plain.match(/^[ \t]*/)?.[0] ?? "";
      const leadingWidth = visibleWidth(leading);
      const firstContent = plain.slice(leading.length, leading.length + 1);
      if (!firstContent && leadingWidth >= closedBranch.contentColumn) {
        // An output-owned empty or whitespace-only row is still part of the closed
        // branch continuation. Keep the branch active for the payload rows after it.
        trims.set(lineIndex, closedBranch.outerIndent);
        continue;
      }
      if (
        firstContent &&
        !"│├└".includes(firstContent) &&
        leadingWidth >= closedBranch.contentColumn
      ) {
        trims.set(lineIndex, closedBranch.outerIndent);
        continue;
      }
    }
    closedBranch = undefined;
  }
  return trims;
}

function removeGroupedToolPrefix(line: string, groupedLabel?: string): string {
  return trimAnsiLeft(
    stripGroupedToolLabel(
      trimAnsiLeft(stripLeadingToolStatus(line)),
      groupedLabel,
    ),
  );
}

function tintGroupedToolLine(line: string, _groupedLabel?: string): string {
  return trimAnsiLeft(line);
}

function bashCallMetadata(args: unknown, elapsedMs?: number) {
  const decision =
    groupingHostPorts.presentation.toolPresentationModule.present({
      surface: "call",
      tool: { family: "tool-native", name: "bash", label: "Bash" },
      cwd: process.cwd(),
      args,
      lifecycle: {
        status: "idle",
        partial: false,
        argsComplete: true,
        ...(typeof elapsedMs === "number" ? { elapsedMs } : {}),
      },
    });
  return decision.kind === "present" ? decision.metadata?.bash : undefined;
}

function bashResultMetadata(result: any, args: unknown = {}) {
  const decision =
    groupingHostPorts.presentation.toolPresentationModule.present({
      surface: "result",
      tool: { family: "tool-native", name: "bash", label: "Bash" },
      cwd: process.cwd(),
      args,
      lifecycle: { status: "pending", partial: true, argsComplete: true },
      result: {
        content: Array.isArray(result?.content) ? result.content : [],
        details: result?.details,
        error: result?.isError === true,
        partial: true,
      },
    });
  return decision.kind === "present" ? decision.metadata?.bash : undefined;
}

function getToolArgSummary(tool: any): string {
  const args = tool?.args ?? {};
  const name = getToolName(tool);
  if (name === "read") {
    let value = groupingHostPorts.toolExecution.shortPath(
      process.cwd(),
      args.path ?? "",
    );
    const parts: string[] = [];
    if (args.offset) parts.push(`offset=${args.offset}`);
    if (args.limit) parts.push(`limit=${args.limit}`);
    if (parts.length > 0) value += ` (${parts.join(", ")})`;
    return value;
  }
  if (name === "bash")
    return bashCallMetadata(args)?.command.headline ?? "command";
  if (name === "grep")
    return `"${groupingHostPorts.clickRouting.summarizeText(args.pattern ?? "", 40)}"${args.path ? ` in ${args.path}` : ""}`;
  if (name === "find")
    return `"${groupingHostPorts.clickRouting.summarizeText(args.pattern ?? "", 40)}"${args.path ? ` in ${args.path}` : ""}`;
  if (name === "ls")
    return groupingHostPorts.toolExecution.shortPath(
      process.cwd(),
      args.path ?? ".",
    );
  return groupingHostPorts.clickRouting.summarizeText(
    groupingHostPorts.toolFamily.getStringArg(
      args,
      "path",
      "file_path",
      "url",
      "query",
      "name",
      "subject",
      "tool",
      "description",
      "prompt",
    ) || name,
    72,
  );
}

function getToolCallLine(tool: any, width?: number): string {
  const callComponent = tool?.callRendererComponent;
  if (
    typeof width === "number" &&
    groupingHostPorts.toolExecution.isToolTextComponent(callComponent) &&
    typeof callComponent.getPresentationSurface === "function" &&
    callComponent.getPresentationSurface() === "call"
  ) {
    const line = callComponent
      .render(width)
      .find((row) => stripAnsi(row).trim());
    if (line) return line;
  }
  const value = callComponent?.value;
  if (typeof value === "string" && value.trim()) {
    const line =
      value.split("\n").find((row: string) => stripAnsi(row).trim()) ?? value;
    return groupingHostPorts.toolExecution
      .stripWrapMarks(line)
      .replaceAll(CLIP_MARK, "");
  }
  const summary = getToolArgSummary(tool);
  const label = groupingHostPorts.toolFamily.humanizeToolName(
    getToolName(tool),
  );
  return `${label}${summary ? ` ${summary}` : ""}`;
}

export function alignTrailingMarkedLine(line: string, width: number): string {
  const markerIndex = line.indexOf(TRAILING_MARK);
  if (markerIndex === -1) return clampLineWidth(line, width);
  const safeWidth = Math.max(1, width);
  const left = groupingHostPorts.toolExecution.stripWrapMarks(
    line.slice(0, markerIndex),
  );
  const right = groupingHostPorts.toolExecution.stripWrapMarks(
    line.slice(markerIndex + TRAILING_MARK.length),
  );
  const rightWidth = visibleWidth(right);
  if (rightWidth >= safeWidth)
    return truncateToWidth(right, safeWidth, "", false);
  const leftBudget = Math.max(0, safeWidth - rightWidth);
  const clippedLeft =
    leftBudget > 0 ? truncateToWidth(left, leftBudget, "…", false) : "";
  return `${clippedLeft}${right}`;
}

function getCompactToolLine(
  tool: any,
  width: number,
  groupedLabel?: string,
  showTrailing = true,
): string {
  const callComponent = tool?.callRendererComponent;
  const preserveKernelCallLabel =
    groupingHostPorts.toolExecution.isToolTextComponent(callComponent) &&
    typeof callComponent.getPresentationSurface === "function" &&
    callComponent.getPresentationSurface() === "call";
  let content = removeGroupedToolPrefix(
    getToolCallLine(tool, width),
    preserveKernelCallLabel ? undefined : groupedLabel,
  );
  if (!showTrailing) content = content.split(TRAILING_MARK, 1)[0] ?? content;
  return alignTrailingMarkedLine(content || getToolName(tool), width);
}

interface CollapsedToolEntry {
  tools: any[];
  name: string;
  subject: string;
}

function collapseRepeatedToolEntries(tools: any[]): CollapsedToolEntry[] {
  const entries: CollapsedToolEntry[] = [];
  for (const tool of tools) {
    const name = getToolName(tool);
    const subject = getRepeatedToolSubject([tool], name);
    const previous = entries[entries.length - 1];
    if (subject && previous?.name === name && previous.subject === subject) {
      previous.tools.push(tool);
    } else {
      entries.push({ tools: [tool], name, subject });
    }
  }
  return entries;
}

function stripReadRangeFromToolLine(line: string): string {
  return line.replace(
    /\s+(?:\x1b\[[0-9;]*m)*\((?:offset|limit)=\d+(?:,\s*(?:offset|limit)=\d+)*\)(?=(?:\x1b\[[0-9;]*m)*$)/,
    "",
  );
}

function getCollapsedToolEntryLine(
  entry: CollapsedToolEntry,
  width: number,
  groupedLabel?: string,
): string {
  if (entry.tools.length === 1)
    return getCompactToolLine(entry.tools[0], width, groupedLabel);
  const counts = countToolStatuses(entry.tools);
  const attentionCounts =
    counts.pending > 0 || counts.error > 0
      ? ` • ${formatToolGroupCounts(entry.tools)}`
      : "";
  const suffix = ` ${groupingHostPorts.toolExecution.FG_DIM}×${entry.tools.length}${TRANSPARENT_RESET}${attentionCounts}`;
  const firstLine = getCompactToolLine(
    entry.tools[0],
    Math.max(1, width - visibleWidth(suffix)),
    groupedLabel,
    false,
  );
  const sharedLine =
    entry.name === "read" ? stripReadRangeFromToolLine(firstLine) : firstLine;
  return clampLineWidth(`${sharedLine}${suffix}`, width);
}

function getCollapsedToolEntryLines(
  entry: CollapsedToolEntry,
  width: number,
  groupedLabel?: string,
): string[] {
  const lines = [getCollapsedToolEntryLine(entry, width, groupedLabel)];
  if (entry.name !== "bash") return lines;
  const running = [...entry.tools]
    .reverse()
    .find((tool) => getToolStatusForGroup(tool) === "pending");
  const latestOutput = running
    ? bashResultMetadata(running.result, running.args)?.lastOutputLine
    : undefined;
  if (latestOutput)
    lines.push(
      `${groupingHostPorts.toolExecution.FG_DIM}${latestOutput}${TRANSPARENT_RESET}`,
    );
  return lines;
}

function getExpandedToolGroupLines(
  tool: any,
  width: number,
  groupedLabel?: string,
): string[] {
  const rendered = stripToolChrome(tool.render(Math.max(1, width)));
  const jsonTreeRootIndex = rendered.findIndex(
    (line, lineIndex) =>
      lineIndex > 0 &&
      /^[├└]\s+Responded\s+\[(?:object|array)\]\s+\(/.test(
        stripAnsi(line).trimStart(),
      ),
  );
  const closedContinuationTrims = closedBranchContinuationTrims(rendered);
  const lines = rendered.map((line, lineIndex) => {
    if (jsonTreeRootIndex >= 0 && lineIndex >= jsonTreeRootIndex) return line;
    const closedContinuationTrim = closedContinuationTrims.get(lineIndex);
    if (closedContinuationTrim !== undefined)
      return trimAnsiLeftColumns(line, closedContinuationTrim);
    if (lineIndex === 0)
      return tintGroupedToolLine(
        removeGroupedToolPrefix(line, groupedLabel),
        groupedLabel,
      );
    return tintGroupedToolLine(line, groupedLabel);
  });
  return lines.length > 0
    ? lines
    : [
        `${groupingHostPorts.toolExecution.FG_DIM}${String(tool?.toolName ?? "tool")}${TRANSPARENT_RESET}`,
      ];
}

function branchPrefix(index: number, total: number, theme?: Theme): string {
  // Bare tee/corner only — no horizontal ─ arm.
  const branch = index === total - 1 ? "└" : "├";
  const rule = groupingHostPorts.toolExecution.currentToolBranchAnsi(theme);
  return ` ${rule}${branch}${TRANSPARENT_RESET} `;
}

function branchContinuation(
  index: number,
  total: number,
  theme?: Theme,
): string {
  const rule = groupingHostPorts.toolExecution.currentToolBranchAnsi(theme);
  // Match lead width of ` X ` (3 cols of structure + spaces handled outside).
  return index === total - 1 ? "   " : ` ${rule}│${TRANSPARENT_RESET} `;
}

function formatBranchedToolLines(
  lines: string[],
  index: number,
  total: number,
  width: number,
  status: ToolStatus,
  options?: { agentBreathe?: boolean },
): string[] {
  const output: string[] = [];
  const safeContent = lines.length > 0 ? lines : [""];
  const jsonTreeRootIndex = safeContent.findIndex(
    (line, lineIndex) =>
      lineIndex > 0 &&
      /^[├└]\s+Responded\s+\[(?:object|array)\]\s+\(/.test(
        stripAnsi(line).trimStart(),
      ),
  );
  const jsonTreeBaseIndent =
    jsonTreeRootIndex >= 0
      ? (stripAnsi(safeContent[jsonTreeRootIndex] ?? "").match(/^[ \t]*/)?.[0]
          .length ?? 0)
      : 0;
  const closedContinuationTrims = closedBranchContinuationTrims(safeContent);
  const light = groupStatusLight(status, options);
  for (let lineIndex = 0; lineIndex < safeContent.length; lineIndex++) {
    const line = safeContent[lineIndex];
    if (isTerminalImageLine(line)) {
      output.push(line);
      continue;
    }
    // Always strip any leftover status marker from the child call line before
    // re-prefixing. Agent breathe used · which the old stripper missed, so the
    // title walked sideways as size changed inside groups.
    const isJsonTreeLine =
      jsonTreeRootIndex >= 0 && lineIndex >= jsonTreeRootIndex;
    const closedContinuationTrim = closedContinuationTrims.get(lineIndex);
    const body =
      lineIndex === 0
        ? removeGroupedToolPrefix(line)
        : isJsonTreeLine
          ? trimAnsiLeftColumns(line, jsonTreeBaseIndent)
          : closedContinuationTrim !== undefined
            ? trimAnsiLeftColumns(line, closedContinuationTrim)
            : trimAnsiLeft(line);
    const prefix =
      lineIndex === 0
        ? `${branchPrefix(index, total)}${light} `
        : branchContinuation(index, total);
    output.push(clampLineWidth(`${prefix}${body}`, width));
  }
  return output;
}

const NON_GROUPABLE_TOOL_NAMES = new Set([
  "edit",
  "write",
  "apply_patch",
  "ask_parent",
  "subagent_done",
]);
// /reload keeps old group instances alive while commands run from the new module.
const ACTIVE_TOOL_GROUPS = ((globalThis as any)[ACTIVE_TOOL_GROUPS_KEY] ??=
  new Set<any>()) as Set<any>;

export function isToolExecutionComponent(
  value: unknown,
): value is InstanceType<typeof ToolExecutionComponent> {
  // jiti can load the host and extensions through separate module contexts.
  // Constructor names stay stable when instanceof identities do not.
  return (
    value instanceof ToolExecutionComponent ||
    (value as any)?.constructor?.name === "ToolExecutionComponent"
  );
}

function isGroupableTool(
  value: unknown,
): value is InstanceType<typeof ToolExecutionComponent> {
  return (
    isToolExecutionComponent(value) &&
    !NON_GROUPABLE_TOOL_NAMES.has(getToolName(value))
  );
}

export type PublishedToolClickAnchor = {
  line: number;
  start: number;
  end: number;
  tool: any;
  action: ToolClickAction;
  viewportAnchor: ToolViewportAnchor;
};

export type ToolClickDetailLevel = 0 | 1 | 2;

export function requestedToolClickViewportAnchor(
  tool: any,
  action: ToolClickAction,
  viewportAnchor: ToolViewportAnchor,
): RequestedToolCollapseViewportAnchor {
  return action === "expand" &&
    tool?.expanded === true &&
    groupingHostPorts.clickRouting.isSideQuestBinaryTool(tool)
    ? "adaptive"
    : viewportAnchor;
}

function toolGroupClickGuidance(): string {
  const theme = getGlobalPiTheme() as Theme | undefined;
  if (!theme || typeof theme.fg !== "function")
    return " • click any for details";
  return `${theme.fg("muted", " • ")}${theme.fg("dim", "click")}${theme.fg("muted", " any for details")}`;
}

class ToolGroupComponent extends Container {
  private tools: any[] = [];
  private expanded = false;
  declare clickAnchorAtPoint: (
    x: number,
    y: number,
  ) => PublishedToolClickAnchor | undefined;
  declare toggleToolAtPoint: (x: number, y: number) => boolean;
  // Memoize full group output. Grouped history is the long-chat bottleneck:
  // each warm frame used to re-render every child tool, re-branch lines, and
  // re-clamp every row even when nothing changed.
  private dirty = true;
  private cachedWidth?: number;
  private cachedEpoch?: number;
  private cachedMode?: string;
  private cachedExpanded?: boolean;
  private cachedClickState?: string;
  private cachedLines?: string[];

  private clearRenderCache(): void {
    this.dirty = true;
    this.cachedWidth = undefined;
    this.cachedEpoch = undefined;
    this.cachedMode = undefined;
    this.cachedExpanded = undefined;
    this.cachedClickState = undefined;
    this.cachedLines = undefined;
  }

  private statusSnapshot(): {
    key: string;
    pending: number;
    success: number;
    error: number;
  } {
    // Status counts + per-tool identity/expanded/partial bits detect membership
    // and completion changes without walking full child render output. Child
    // content changes still reach us via clearToolRenderCache → invalidate().
    const counts = countToolStatuses(this.tools);
    let idBits = "";
    for (let i = 0; i < this.tools.length; i++) {
      const tool = this.tools[i];
      const id =
        typeof tool?.toolCallId === "string"
          ? tool.toolCallId
          : getToolName(tool);
      const flags =
        (tool?.isPartial === true ? 1 : 0) |
        (tool?.result?.isError ? 2 : 0) |
        (tool?.expanded ? 4 : 0) |
        (tool?.argsComplete ? 8 : 0) |
        (tool?.executionStarted ? 16 : 0);
      idBits += `${id}:${flags},`;
    }
    return {
      key: `${this.tools.length}:${counts.pending}:${counts.success}:${counts.error}:${idBits}`,
      pending: counts.pending,
      success: counts.success,
      error: counts.error,
    };
  }

  addTool(tool: any): void {
    ACTIVE_TOOL_GROUPS.add(this);
    this.tools.push(tool);
    tool[COMPONENT_PARENT] = this;
    // A new execution inherits the global group mode, not a locally expanded sibling.
    tool.setExpanded?.(this.expanded);
    // Don't cascade invalidate into every child — only drop our own cache.
    // Child tools already rebuild via their own updateDisplay path.
    this.clearRenderCache();
  }

  forEachTool(visitor: (tool: any) => void): void {
    for (const tool of this.tools) visitor(tool);
  }

  releaseTools(): any[] {
    const tools = this.tools;
    this.tools = [];
    ACTIVE_TOOL_GROUPS.delete(this);
    this.clearRenderCache();
    return tools;
  }

  setExpanded(expanded: boolean): void {
    if (this.expanded === expanded) return;
    this.expanded = expanded;
    for (const tool of this.tools) tool.setExpanded?.(expanded);
    this.clearRenderCache();
  }

  invalidate(): void {
    // Parent/group invalidation should NOT force every child tool through
    // updateDisplay() (which re-runs call/result renderers). Drop our memo
    // only; children keep their own ToolText/TOOL_RENDER_CACHE entries and
    // recompute only when their content actually changes.
    this.clearRenderCache();
  }

  private clickAnchorsEnabled(): boolean {
    return (
      !this.expanded &&
      this.tools.some(
        (tool) =>
          groupingHostPorts.clickRouting.toolClickExpansionActive(tool) &&
          groupingHostPorts.transcript.toolHasEffectiveClickAction(tool),
      )
    );
  }

  render(width: number): string[] {
    if (this.tools.length === 0) return [];
    const safeWidth = Number.isFinite(width)
      ? Math.max(1, Math.floor(width))
      : 1;
    const clickState = `${clickRuntime.visualEpoch}:${this.clickAnchorsEnabled() ? 1 : 0}`;
    // Fast path: settled groups with a valid memo skip ALL child walks.
    // Child mutations mark dirty via clearToolRenderCache → invalidate().
    if (
      !this.dirty &&
      this.cachedLines &&
      this.cachedWidth === safeWidth &&
      this.cachedEpoch ===
        groupingHostPorts.toolExecution._toolBranchVisualEpoch &&
      this.cachedMode === toolBackgroundMode &&
      this.cachedExpanded === this.expanded &&
      this.cachedClickState === clickState
    ) {
      return this.cachedLines;
    }

    const status = this.statusSnapshot();
    // Only memoize fully-settled groups. Pending groups must recompute so
    // blink dots and live partial child content stay fresh. Long chats are
    // almost entirely settled history, which is the expensive warm path.
    const canCache = status.pending === 0;

    const groupedName = getGroupedToolName(this.tools);
    const label = getToolGroupLabel(this.tools);
    const names = groupedName ? "" : formatToolNameList(this.tools);
    const overall: ToolStatus =
      status.error > 0 ? "error" : status.pending > 0 ? "pending" : "success";
    // Group header breathes only when every pending member is Agent-family;
    // mixed groups keep the ordinary on/off light.
    const pendingTools = this.tools.filter(
      (tool) => getToolStatusForGroup(tool) === "pending",
    );
    const headerBreathe =
      pendingTools.length > 0 &&
      pendingTools.every((tool) => isAgentFamilyToolName(getToolName(tool)));
    const light = groupStatusLight(overall, { agentBreathe: headerBreathe });
    const summaryLabel = `${label}:`;
    const countParts: string[] = [];
    if (status.pending) countParts.push(statusText("pending", status.pending));
    if (status.success) countParts.push(statusText("success", status.success));
    if (status.error) countParts.push(statusText("error", status.error));
    const countsText = countParts.join(`${TRANSPARENT_RESET} • `);
    const clicksEnabled = this.clickAnchorsEnabled();
    const resultlessHistoricalAgents = this.tools.every(
      (tool) =>
        getToolName(tool).toLowerCase() === "agent" &&
        tool?.isPartial === true &&
        tool?.executionStarted !== true &&
        tool?.result === undefined,
    );
    const detailHint = clicksEnabled
      ? toolGroupClickGuidance()
      : resultlessHistoricalAgents
        ? ""
        : groupingHostPorts.clickRouting.baselineToolOutputDetailHint(
            undefined,
            this.expanded,
            true,
          );
    const summary = ` ${light} ${summaryLabel} ${countsText}${names ? ` ${TRANSPARENT_RESET}• ${names}` : ""}${detailHint}`;
    const lines = [" ".repeat(safeWidth), clampLineWidth(summary, safeWidth)];
    const childWidth = Math.max(1, safeWidth - 6);
    const total = this.tools.length;

    for (let index = 0; index < total; index++) {
      const tool = this.tools[index];
      const childExpanded = this.expanded || Boolean(tool.expanded);
      const rawLines = childExpanded
        ? getExpandedToolGroupLines(
            tool,
            childWidth,
            groupedName ? label : undefined,
          )
        : [
            getCompactToolLine(
              tool,
              childWidth,
              groupedName ? label : undefined,
            ),
          ];
      const branched = formatBranchedToolLines(
        rawLines,
        index,
        total,
        safeWidth,
        getToolStatusForGroup(tool),
        { agentBreathe: isAgentFamilyToolName(getToolName(tool)) },
      );
      if (
        clicksEnabled &&
        groupingHostPorts.clickRouting.toolClickExpansionActive(tool) &&
        groupingHostPorts.transcript.toolHasEffectiveClickAction(tool) &&
        branched.length > 0
      ) {
        const callRows = groupingHostPorts.toolExecution.isToolTextComponent(
          tool.callRendererComponent,
        )
          ? tool.callRendererComponent
              .getSemanticRows()
              .filter((row: ToolTextSemanticRow) => row.action === "header")
              .length
          : groupingHostPorts.clickRouting.isKnownSideQuestAgentTool(tool)
            ? (tool.callRendererComponent?.render?.(childWidth)?.length ?? 0)
            : 0;
        const headerRows = childExpanded
          ? groupingHostPorts.clickRouting.isKnownSideQuestAgentTool(tool)
            ? 1
            : Math.max(1, callRows)
          : branched.length;
        for (let row = 0; row < Math.min(headerRows, branched.length); row++) {
          const start = groupingHostPorts.clickRouting.isSideQuestBinaryTool(
            tool,
          )
            ? 0
            : groupingHostPorts.transcript.clickAnchorStart(branched[row]);
          const end = groupingHostPorts.clickRouting.isSideQuestBinaryTool(tool)
            ? safeWidth
            : visibleWidth(stripAnsi(branched[row]).trimEnd());
          if (end > start) {
            if (groupingHostPorts.clickRouting.clickExpansionModule) {
              branched[row] =
                groupingHostPorts.clickRouting.clickExpansionModule.declare(
                  { kind: "tool-execution", execution: tool },
                  branched[row],
                  {
                    behavior: "toggle",
                    compatibilityAction: "header",
                    ...(groupingHostPorts.clickRouting.isSideQuestBinaryTool(
                      tool,
                    )
                      ? { span: { text: stripAnsi(branched[row]) } }
                      : {}),
                  } as InternalClickExpansionDeclaration,
                );
            }
          }
        }
        if (
          childExpanded &&
          groupingHostPorts.clickRouting.isKnownSideQuestAgentTool(tool)
        ) {
          const presentation =
            groupingHostPorts.clickRouting.sideQuestAgentPresentation(tool);
          const label = presentation
            ? `${groupingHostPorts.clickRouting.sideQuestAgentResultLabel(presentation)} [`
            : "";
          const row = label
            ? branched.findIndex(
                (line, lineIndex) =>
                  lineIndex >= headerRows && stripAnsi(line).includes(label),
              )
            : -1;
          if (row >= 0) {
            const start = groupingHostPorts.transcript.clickAnchorStart(
              branched[row],
            );
            const end = visibleWidth(stripAnsi(branched[row]).trimEnd());
            if (end > start) {
              if (groupingHostPorts.clickRouting.clickExpansionModule) {
                branched[row] =
                  groupingHostPorts.clickRouting.clickExpansionModule.declare(
                    { kind: "tool-execution", execution: tool },
                    branched[row],
                    {
                      behavior: "toggle",
                      viewport: "adaptive",
                      compatibilityAction: "expand",
                    } as InternalClickExpansionDeclaration,
                  );
              }
            }
          }
        }
        if (
          childExpanded &&
          groupingHostPorts.toolExecution.isToolTextComponent(
            tool.resultRendererComponent,
          )
        ) {
          for (const semantic of tool.resultRendererComponent.getSemanticRows()) {
            if (semantic.action === "header") continue;
            const needle =
              semantic.anchorText ?? stripAnsi(semantic.text).trim();
            if (!needle) continue;
            // Group formatting removes nested status bullets. Use the visible click phrase
            // as a matching fallback, but keep the full semantic row as the action area.
            const clickPhrase =
              /click (?:to (?:expand|collapse)|for (?:more|less) detail)/.exec(
                needle,
              )?.[0];
            const row = branched.findIndex((line, lineIndex) => {
              if (lineIndex < headerRows) return false;
              const plain = stripAnsi(line);
              return (
                plain.includes(needle) ||
                (clickPhrase !== undefined && plain.includes(clickPhrase))
              );
            });
            if (row < 0) continue;
            const plain = stripAnsi(branched[row]);
            const targetIndex = semantic.anchorText
              ? plain.indexOf(semantic.anchorText)
              : -1;
            const start =
              targetIndex >= 0
                ? visibleWidth(plain.slice(0, targetIndex))
                : groupingHostPorts.transcript.clickAnchorStart(branched[row]);
            const end =
              targetIndex >= 0
                ? start + visibleWidth(semantic.anchorText!)
                : visibleWidth(plain.trimEnd());
            if (end > start) {
              if (groupingHostPorts.clickRouting.clickExpansionModule) {
                const behavior =
                  semantic.action === "detail"
                    ? "next-detail"
                    : semantic.action === "detail-extra"
                      ? "toggle-max-detail"
                      : "toggle";
                const viewport =
                  semantic.action === "expand" &&
                  tool?.expanded === true &&
                  groupingHostPorts.clickRouting.isSideQuestBinaryTool(tool)
                    ? "adaptive"
                    : semantic.viewportAnchor;
                branched[row] =
                  groupingHostPorts.clickRouting.clickExpansionModule.declare(
                    { kind: "tool-execution", execution: tool },
                    branched[row],
                    {
                      behavior,
                      viewport,
                      compatibilityAction: semantic.action,
                      ...(targetIndex >= 0
                        ? { span: { text: semantic.anchorText! } }
                        : {}),
                    } as InternalClickExpansionDeclaration,
                  );
              }
            }
          }
        }
      }
      for (let i = 0; i < branched.length; i++) {
        lines.push(clampLineWidth(branched[i], safeWidth));
      }
    }

    // Publish after branch formatting so grouped child anchors use final coordinates.
    const output = groupingHostPorts.clickRouting.clickExpansionModule
      ? [
          ...groupingHostPorts.clickRouting.clickExpansionModule.publish(
            this,
            lines,
          ),
        ]
      : lines;
    // Final clamp already applied per-line above; avoid a second full pass.
    if (canCache) {
      this.dirty = false;
      this.cachedWidth = safeWidth;
      this.cachedEpoch = groupingHostPorts.toolExecution._toolBranchVisualEpoch;
      this.cachedMode = toolBackgroundMode;
      this.cachedExpanded = this.expanded;
      this.cachedClickState = clickState;
      this.cachedLines = output;
    } else {
      this.clearRenderCache();
    }
    return output;
  }
}

export function refreshRetainedToolGroupClickHandlers(): void {
  const current = ToolGroupComponent.prototype as any;
  for (const group of ACTIVE_TOOL_GROUPS) {
    const retained = Object.getPrototypeOf(group);
    if (!retained) continue;
    delete group.clickAnchorsEnabled;
    retained.clickAnchorsEnabled = current.clickAnchorsEnabled;
    delete group.clickAnchorAtPoint;
    delete group.toggleToolAtPoint;
    delete group.clickActionAtPoint;
    delete group.captureClickRollbackAtPoint;
    delete group.handleMouse;
    group.forEachTool?.((tool: any) => {
      delete tool.activateClickAction;
    });
  }
}

type ToolGroupMouseTarget = MouseTarget;

type ClickRuntimeState = {
  activeInteractiveMode?: ToolGroupInteractiveMode;
  visualEpoch: number;
};
// Host patches survive /reload. Commands and retained patches need one runtime.
export const clickRuntime = ((globalThis as any)[CLICK_RUNTIME_KEY] ??= {
  visualEpoch: 0,
}) as ClickRuntimeState;

type BuiltinExpansionState = {
  width?: number;
  height?: number;
  rows?: string[];
  version: number;
  probeWidth?: number;
  probeVersion?: number;
  probeResult?: boolean;
};

type BuiltinExpandableComponent = {
  expanded?: boolean;
  _expanded?: boolean;
  message?: { customType?: string };
  customComponent?: { render(width: number): string[] };
  setExpanded(expanded: boolean): void;
  render(width: number): string[];
  [BUILTIN_EXPANSION_STATE]?: BuiltinExpansionState;
};

export function builtinExpansionState(
  component: BuiltinExpandableComponent,
): BuiltinExpansionState {
  return (component[BUILTIN_EXPANSION_STATE] ??= { version: 0 });
}

export function builtinComponentExpanded(
  component: BuiltinExpandableComponent,
): boolean {
  return component.expanded === true || component._expanded === true;
}

export function isSideQuestEventMessage(
  component: BuiltinExpandableComponent,
): boolean {
  const customType = component.message?.customType;
  return (
    customType === "side-quest-result" ||
    customType === "side-quest-continuation"
  );
}

function builtinClickComponentSupported(
  component: BuiltinExpandableComponent,
): boolean {
  const isCustomMessage =
    component instanceof CustomMessageComponent ||
    (component as any)?.constructor?.name === "CustomMessageComponent";
  return !isCustomMessage || isSideQuestEventMessage(component);
}

function isBuiltinExpandableComponent(
  value: unknown,
): value is BuiltinExpandableComponent {
  const name = (value as any)?.constructor?.name;
  return (
    value instanceof BashExecutionComponent ||
    value instanceof CompactionSummaryMessageComponent ||
    value instanceof BranchSummaryMessageComponent ||
    name === "BashExecutionComponent" ||
    name === "CompactionSummaryMessageComponent" ||
    name === "BranchSummaryMessageComponent"
  );
}

function isBuiltinSummaryComponent(value: unknown): boolean {
  const name = (value as any)?.constructor?.name;
  return (
    value instanceof CompactionSummaryMessageComponent ||
    value instanceof BranchSummaryMessageComponent ||
    name === "CompactionSummaryMessageComponent" ||
    name === "BranchSummaryMessageComponent"
  );
}

function builtinClickExpansionActive(): boolean {
  return (
    groupingHostPorts.clickRouting.clickExpansionEnabled() &&
    clickRuntime.activeInteractiveMode?.toolOutputExpanded !== true
  );
}

export function builtinExpansionChangesOutput(
  component: BuiltinExpandableComponent,
  width: number,
  render: (width: number) => string[] = (nextWidth) =>
    component.render(nextWidth),
): boolean {
  const state = builtinExpansionState(component);
  if (
    state.probeWidth === width &&
    state.probeVersion === state.version &&
    state.probeResult !== undefined
  )
    return state.probeResult;

  const expanded = builtinComponentExpanded(component);
  const currentRows =
    state.width === width && state.rows ? state.rows : render(width);
  let oppositeRows: string[] = [];
  try {
    component.setExpanded(!expanded);
    oppositeRows = render(width);
  } finally {
    component.setExpanded(expanded);
    state.width = width;
    state.height = currentRows.length;
    state.rows = currentRows;
  }
  const changed =
    currentRows.length !== oppositeRows.length ||
    currentRows.some((line, index) => line !== oppositeRows[index]);
  state.probeWidth = width;
  state.probeVersion = state.version;
  state.probeResult = changed;
  return changed;
}

export function sideQuestPaintedBounds(
  component: BuiltinExpandableComponent,
  width: number,
  height: number,
): { first: number; last: number } | undefined {
  const paintedRows = component.customComponent?.render(width);
  if (!paintedRows?.length || paintedRows.length > height) return undefined;
  return { first: height - paintedRows.length, last: height - 1 };
}

function builtinClickActionAtPoint(
  component: BuiltinExpandableComponent,
  x: number,
  y: number,
): ToolClickAction | undefined {
  if (
    !builtinClickExpansionActive() ||
    !builtinClickComponentSupported(component)
  )
    return undefined;
  const state = builtinExpansionState(component);
  if (
    state.width === undefined ||
    state.height === undefined ||
    x < 0 ||
    x >= state.width ||
    y < 0 ||
    y >= state.height
  )
    return undefined;
  if (isSideQuestEventMessage(component)) {
    // The custom renderer owns the painted suffix after Pi's outer Spacer.
    // Use its full geometry so blank Markdown rows remain inside the banner.
    const bounds = sideQuestPaintedBounds(component, state.width, state.height);
    if (!bounds || y < bounds.first || y > bounds.last) return undefined;
  }
  return builtinExpansionChangesOutput(component, state.width)
    ? "expand"
    : undefined;
}

function beginBuiltinClickActivation(
  component: BuiltinExpandableComponent,
  behavior: string,
  requestedViewport: "top" | "bottom" | "adaptive",
): false | { complete(): void } {
  if (
    behavior !== "toggle" ||
    !builtinClickExpansionActive() ||
    !builtinClickComponentSupported(component)
  )
    return false;
  const state = builtinExpansionState(component);
  if (
    state.width === undefined ||
    !builtinExpansionChangesOutput(component, state.width)
  )
    return false;
  return beginToolCollapseViewportTransaction(component, requestedViewport);
}

function captureBuiltinViewportRollback(
  component: BuiltinExpandableComponent,
  viewport: "top" | "bottom" | "adaptive",
): () => void {
  return captureToolCollapseViewportRollback(component, viewport);
}

export function refreshBuiltinClickHandlers(proto: any): void {
  proto[CLICK_EXPANSION_ACTIVATION_HOST] = function builtinActivationHost(
    behavior: string,
    viewport: "top" | "bottom" | "adaptive",
  ) {
    return beginBuiltinClickActivation(this, behavior, viewport);
  };
  proto[CLICK_EXPANSION_ROLLBACK_HOST] = function builtinRollbackHost(
    _behavior: string,
    viewport: "top" | "bottom" | "adaptive",
  ) {
    return captureBuiltinViewportRollback(this, viewport);
  };
  proto.activateClickAction = function activatePublishedBuiltin(
    action: ToolClickAction,
    viewport: ToolViewportAnchor = "top",
  ): boolean {
    const activate = (globalThis as any)[CLICK_EXPANSION_ACTIVATE_TARGET];
    const requestedViewport = builtinComponentExpanded(this)
      ? "adaptive"
      : viewport;
    return (
      activate?.(
        { kind: "pi-owned-transcript", transcript: this },
        "toggle",
        requestedViewport,
        action,
      ) === true
    );
  };
}

export function padPaintedLineToWidth(line: string, width: number): string {
  const gap = width - visibleWidth(line);
  if (gap <= 0) return line;
  const trailingSgr = /(?:\x1b\[[0-9;]*m)+$/.exec(line);
  const insertionIndex = trailingSgr?.index ?? line.length;
  return `${line.slice(0, insertionIndex)}${" ".repeat(gap)}${line.slice(insertionIndex)}`;
}

export function patchBuiltinTranscriptExpansion(): void {
  for (const ComponentClass of [
    BashExecutionComponent,
    CompactionSummaryMessageComponent,
    BranchSummaryMessageComponent,
  ]) {
    const proto = ComponentClass.prototype as any;
    refreshBuiltinClickHandlers(proto);
    proto[BUILTIN_EXPANSION_RENDER_TRANSFORM] = (
      component: BuiltinExpandableComponent,
      rows: string[],
    ): string[] => {
      if (
        !builtinClickExpansionActive() ||
        builtinComponentExpanded(component) ||
        !isBuiltinSummaryComponent(component)
      )
        return rows;
      const keyboardHint = keyText("app.tools.expand");
      if (!keyboardHint) return rows;
      return rows.map((row) => {
        if (!row.includes(keyboardHint)) return row;
        const originalWidth = visibleWidth(row);
        return padPaintedLineToWidth(
          row.replace(keyboardHint, "click"),
          originalWidth,
        );
      });
    };
    if (proto[BUILTIN_EXPANSION_RENDER_PATCH_FLAG]) continue;
    const originalRender = proto.render;
    proto.render = function patchedBuiltinExpandableRender(
      width: number,
    ): string[] {
      const renderRows = (nextWidth: number): string[] => {
        const rendered = originalRender.call(this, nextWidth);
        const transform = this[BUILTIN_EXPANSION_RENDER_TRANSFORM];
        return typeof transform === "function"
          ? transform(this, rendered)
          : rendered;
      };
      const rows = renderRows(width);
      const state = builtinExpansionState(this);
      state.width = width;
      state.height = rows.length;
      state.rows = rows;
      const target = { kind: "pi-owned-transcript", transcript: this } as const;
      const expansion = groupingHostPorts.clickRouting.clickExpansionModule;
      if (!expansion) return rows;
      let output = rows;
      if (
        expansion.state(target).active &&
        builtinClickComponentSupported(this) &&
        builtinExpansionChangesOutput(this, width, renderRows)
      ) {
        const bounds = isSideQuestEventMessage(this)
          ? sideQuestPaintedBounds(this, width, rows.length)
          : { first: 0, last: rows.length - 1 };
        if (bounds) {
          const viewport = builtinComponentExpanded(this) ? "adaptive" : "top";
          output = rows.map((row: string, index: number) => {
            if (index < bounds.first || index > bounds.last) return row;
            const padded = padPaintedLineToWidth(row, width);
            return expansion.declare(target, padded, {
              behavior: "toggle",
              span: { text: stripAnsi(padded) },
              viewport,
            });
          });
        }
      }
      output = [...expansion.publish(this, output)];
      state.height = output.length;
      state.rows = output;
      return output;
    };
    proto[BUILTIN_EXPANSION_PATCH_FLAG] = true;
    proto[BUILTIN_EXPANSION_RENDER_PATCH_FLAG] = true;
  }

  const bashProto = BashExecutionComponent.prototype as any;
  for (const method of ["appendOutput", "setComplete"]) {
    const original = bashProto[method];
    const patchFlag = Symbol.for(
      `pi-claude-style-tools:builtin-expansion-${method}-patch`,
    );
    if (typeof original !== "function" || bashProto[patchFlag]) continue;
    bashProto[method] = function patchedBuiltinExpansionMutation(
      ...args: any[]
    ) {
      const state = builtinExpansionState(this);
      state.version++;
      delete state.probeResult;
      return original.apply(this, args);
    };
    bashProto[patchFlag] = true;
  }
}

function standaloneToolMouseTarget(
  tool: any,
  anchor: ToolClickAnchor,
): ToolGroupMouseTarget {
  return {
    component: tool,
    action: anchor.action,
    viewportAnchor: anchor.viewportAnchor,
    activate: () =>
      tool.activateClickAction?.(anchor.action, anchor.viewportAnchor) === true,
    captureRollback: () =>
      tool.captureClickRollback?.(anchor.action, anchor.viewportAnchor) ??
      (() => {}),
  };
}

function frameMatchedStandaloneToolTarget(
  mode: ToolGroupInteractiveMode,
  documentBox: ToolGroupLayoutBox,
  x: number,
  y: number,
): ToolGroupMouseTarget | undefined {
  if (!documentBox.lines) return undefined;
  const frameLineIndex = (documentBox.lineOffset ?? 0) + y - documentBox.rect.y;
  const frameLine = documentBox.lines[frameLineIndex];
  if (frameLine === undefined) return undefined;
  const frameKeys = documentBox.lines.map((line) => stripAnsi(line).trimEnd());
  const clickedKey = frameKeys[frameLineIndex];
  // Empty transcript rows are not unique. Matching one against an internal tool
  // spacer can leak the click across the tool's actual rendered boundary.
  if (!clickedKey.trim()) return undefined;
  const width = documentBox.rect.width;
  const localX = x - documentBox.rect.x;
  let approximateRow =
    documentBox.rect.y -
    (documentBox.lineOffset ?? 0) +
    mode.headerContainer.render(width).length +
    mode.loadedResourcesContainer.render(width).length;
  let best:
    | {
        tool: any;
        anchor: PublishedToolClickAnchor;
        score: number;
        distance: number;
      }
    | undefined;
  for (const component of mode.chatContainer.children) {
    const sourceRows = component.render(width);
    const rendered = isToolExecutionComponent(component)
      ? groupingHostPorts.transcript.publishStandaloneToolClickAnchors(
          component,
          sourceRows,
        )
      : sourceRows;
    if (isToolExecutionComponent(component)) {
      for (let anchorLine = 0; anchorLine < rendered.length; anchorLine++) {
        const anchor = groupingHostPorts.transcript.toolClickAnchorAtPoint(
          component,
          localX,
          anchorLine,
        );
        if (
          !anchor ||
          stripAnsi(rendered[anchor.line] ?? "").trimEnd() !== clickedKey
        )
          continue;
        let score = 4;
        for (let line = 0; line < rendered.length; line++) {
          if (line === anchor.line) continue;
          const candidateKey = stripAnsi(rendered[line]).trimEnd();
          const comparedFrameLine =
            frameKeys[frameLineIndex + line - anchor.line];
          if (candidateKey && candidateKey === comparedFrameLine) score++;
        }
        const distance = Math.abs(approximateRow + anchor.line - y);
        if (
          !best ||
          score > best.score ||
          (score === best.score && distance < best.distance)
        ) {
          best = { tool: component, anchor, score, distance };
        }
      }
    }
    approximateRow += rendered.length;
  }
  return best ? standaloneToolMouseTarget(best.tool, best.anchor) : undefined;
}

function toolGroupAtScreenPoint(
  renderer: ToolGroupFullscreenRenderer,
  mode: ToolGroupInteractiveMode,
  x: number,
  y: number,
): ToolGroupMouseTarget | undefined {
  const frame = renderer.currentLayout;
  if (!frame || renderer.hasOverlay?.() || renderer.hasOverlayEntries)
    return undefined;
  const documentBox = findToolGroupLayoutBox(
    frame.root,
    mode.documentContainer,
  );
  if (!documentBox || !toolGroupBoxContains(documentBox.clip, x, y))
    return undefined;

  const width = documentBox.rect.width;
  const frameMatchedTarget = frameMatchedStandaloneToolTarget(
    mode,
    documentBox,
    x,
    y,
  );
  if (frameMatchedTarget) return frameMatchedTarget;
  // Component rows are document coordinates. Project them through the same
  // scroll offset used by the captured fullscreen frame before hit testing.
  let row =
    documentBox.rect.y -
    (documentBox.lineOffset ?? 0) +
    mode.headerContainer.render(width).length +
    mode.loadedResourcesContainer.render(width).length;
  for (const component of mode.chatContainer.children) {
    const sourceRows = component.render(width);
    const rendered = isToolExecutionComponent(component)
      ? groupingHostPorts.transcript.publishStandaloneToolClickAnchors(
          component,
          sourceRows,
        )
      : sourceRows;
    const height = rendered.length;
    const localX = x - documentBox.rect.x;
    const localY = y - row;
    if (isToolGroupComponent(component)) {
      const anchor = component.clickAnchorAtPoint(localX, localY);
      if (anchor) {
        return {
          component: anchor.tool,
          action: anchor.action,
          viewportAnchor: anchor.viewportAnchor,
          activate: () => component.toggleToolAtPoint(localX, localY),
          captureRollback: () =>
            (component as any).captureClickRollbackAtPoint?.(localX, localY) ??
            (() => {}),
        };
      }
    } else if (isToolExecutionComponent(component)) {
      const anchor = groupingHostPorts.transcript.toolClickAnchorAtPoint(
        component,
        localX,
        localY,
      );
      if (anchor) return standaloneToolMouseTarget(component, anchor);
    } else if (
      isBuiltinExpandableComponent(component) &&
      builtinClickActionAtPoint(component, localX, localY) === "expand"
    ) {
      return {
        component,
        action: "expand",
        viewportAnchor: "top",
        activate: () =>
          (component as any).activateClickAction?.("expand") === true,
        captureRollback: () =>
          (component as any).captureClickRollback?.("expand", "top") ??
          (() => {}),
      };
    }
    row += height;
  }
  return undefined;
}

export function installToolGroupMouseAdapter(): void {
  registerMouseHostAdapter({
    targetAt: toolGroupAtScreenPoint,
    resetLocalClickStates,
  });
}

export function isToolGroupComponent(
  value: unknown,
): value is ToolGroupComponent {
  // /reload replaces extension-local class identities while old host wrappers
  // can still own transcript components. Accept the stable group interface too.
  const candidate = value as Partial<ToolGroupComponent> | undefined;
  return (
    value instanceof ToolGroupComponent ||
    (Boolean(candidate) &&
      typeof candidate?.clickAnchorAtPoint === "function" &&
      typeof candidate?.toggleToolAtPoint === "function" &&
      typeof candidate?.forEachTool === "function" &&
      typeof candidate?.releaseTools === "function")
  );
}

function isSpacerComponent(
  value: unknown,
): value is InstanceType<typeof Spacer> {
  return (
    value instanceof Spacer || (value as any)?.constructor?.name === "Spacer"
  );
}

export function isTextComponent(
  value: unknown,
): value is InstanceType<typeof Text> {
  return value instanceof Text || (value as any)?.constructor?.name === "Text";
}

export function isMarkdownComponent(
  value: unknown,
): value is InstanceType<typeof Markdown> {
  return (
    value instanceof Markdown ||
    (value as any)?.constructor?.name === "Markdown"
  );
}

function forEachModeTool(
  mode: ToolGroupInteractiveMode | undefined,
  visitor: (tool: any) => void,
): void {
  if (!mode) return;
  for (const component of mode.chatContainer.children) {
    if (isToolExecutionComponent(component)) visitor(component);
    else if (isToolGroupComponent(component)) component.forEachTool(visitor);
  }
}

export function resetLocalClickStates(
  mode: ToolGroupInteractiveMode | undefined,
  collapseLocal: boolean,
): void {
  const groups = new Set<ToolGroupComponent>();
  forEachModeTool(mode, (tool) => {
    const locallyExpanded = tool[TOOL_CLICK_LOCAL_EXPANDED] === true;
    const detailLevel =
      groupingHostPorts.clickRouting.toolLocalDetailLevel(tool);
    delete tool[TOOL_CLICK_LOCAL_EXPANDED];
    groupingHostPorts.clickRouting.setToolLocalDetailLevel(tool, 0);
    if (collapseLocal && locallyExpanded) tool.setExpanded?.(false);
    else if (detailLevel > 0) tool.updateDisplay?.();
    groupingHostPorts.clickRouting.clearToolRenderCache(tool);
    const parent = tool[COMPONENT_PARENT];
    if (isToolGroupComponent(parent)) groups.add(parent);
  });
  if (collapseLocal && mode?.toolOutputExpanded !== true) {
    for (const component of mode?.chatContainer.children ?? []) {
      if (
        isBuiltinExpandableComponent(component) &&
        component.expanded === true
      ) {
        component.setExpanded(false);
      }
    }
  }
  for (const group of groups) group.invalidate();
  clickRuntime.visualEpoch++;
}

function isIgnorableToolSeparator(value: unknown): boolean {
  if (isSpacerComponent(value)) return true;
  if (
    value instanceof AssistantMessageComponent ||
    (value as any)?.constructor?.name === "AssistantMessageComponent"
  ) {
    // Empty assistant framing stays ignorable so it never splits tool groups.
    // A rendered thinking row ("Thought for Xs" / live thinking) is a visible
    // boundary: tool calls that follow it must start a new group instead of
    // silently joining the batch that ran before the thought.
    const contentChildren = (value as any).contentContainer?.children;
    if (!Array.isArray(contentChildren) || contentChildren.length === 0)
      return true;
    return contentChildren.every((child: any) => isSpacerComponent(child));
  }
  return false;
}

function findPreviousToolSibling(
  children: any[],
  startIndex: number,
): { child: any; index: number } | undefined {
  for (let index = startIndex; index >= 0; index--) {
    const child = children[index];
    if (isIgnorableToolSeparator(child)) continue;
    return { child, index };
  }
  return undefined;
}

export function ungroupActiveToolGroups(): void {
  for (const group of [...ACTIVE_TOOL_GROUPS]) {
    const parent = group?.[COMPONENT_PARENT];
    const children = parent?.children;
    if (!Array.isArray(children)) {
      ACTIVE_TOOL_GROUPS.delete(group);
      continue;
    }
    const index = children.indexOf(group);
    if (index === -1) {
      ACTIVE_TOOL_GROUPS.delete(group);
      continue;
    }
    const tools = group.releaseTools();
    for (const tool of tools) tool[COMPONENT_PARENT] = parent;
    children.splice(index, 1, ...tools);
  }
}

function isThinkingOnlyAssistantComponent(
  comp: unknown,
): comp is InstanceType<typeof AssistantMessageComponent> {
  if (
    !comp ||
    ((comp as any).constructor?.name !== "AssistantMessageComponent" &&
      !(comp instanceof AssistantMessageComponent))
  ) {
    return false;
  }
  const msg = (comp as any).lastMessage;
  if (!msg || msg.role !== "assistant" || !Array.isArray(msg.content))
    return false;
  const hasThinking = msg.content.some(
    (c: any) =>
      c?.type === "thinking" &&
      typeof c?.thinking === "string" &&
      c.thinking.trim(),
  );
  if (!hasThinking) return false;
  const hasText = msg.content.some(
    (c: any) =>
      c?.type === "text" && typeof c?.text === "string" && c.text.trim(),
  );
  if (hasText) return false;
  const hasToolCalls = msg.content.some((c: any) => c?.type === "toolCall");
  if (hasToolCalls) return false;
  if (
    (comp as any).isStreaming === true ||
    msg[groupingHostPorts.transcript.THINKING_ACTIVE_KEY]
  )
    return false;
  return true;
}

function maybeMergeConsecutiveThinkingMessages(parent: any): void {
  const children = parent?.children;
  if (!Array.isArray(children) || children.length < 2) return;

  for (let i = 0; i < children.length; i++) {
    const current = children[i];
    if (!isThinkingOnlyAssistantComponent(current)) continue;

    let nextIdx = i + 1;
    while (nextIdx < children.length && isSpacerComponent(children[nextIdx])) {
      nextIdx++;
    }
    if (nextIdx >= children.length) break;

    const nextComp = children[nextIdx];
    if (isThinkingOnlyAssistantComponent(nextComp)) {
      const curMsg = (current as any).lastMessage;
      const nextMsg = (nextComp as any).lastMessage;

      const durA =
        groupingHostPorts.transcript.getMessageThinkingDurationMs(curMsg);
      const durB =
        groupingHostPorts.transcript.getMessageThinkingDurationMs(nextMsg);
      const mergedDuration = durA + durB;

      const nextThinkingBlocks = nextMsg.content.filter(
        (c: any) => c?.type === "thinking",
      );
      curMsg.content.push(...nextThinkingBlocks);
      curMsg[groupingHostPorts.transcript.THINKING_DURATION_KEY] =
        mergedDuration;

      (current as any).updateContent(curMsg);

      const removeCount = nextIdx - i;
      children.splice(i + 1, removeCount);
      i--;
    }
  }
}

function maybeGroupToolComponent(parent: any, component: any): void {
  if (
    !toolGroupingEnabled() ||
    !isGroupableTool(component) ||
    isToolGroupComponent(parent)
  )
    return;
  const children = parent?.children;
  if (!Array.isArray(children)) return;
  const index = children.indexOf(component);
  if (index <= 0) return;
  const previousEntry = findPreviousToolSibling(children, index - 1);
  if (!previousEntry) return;
  const previous = previousEntry.child;
  if (isToolGroupComponent(previous)) {
    children.splice(index, 1);
    previous.addTool(component);
    maybeMergeConsecutiveThinkingMessages(parent);
    return;
  }
  if (isGroupableTool(previous)) {
    const group = new ToolGroupComponent();
    group.setExpanded(Boolean((previous as any).expanded));
    group.addTool(previous);
    group.addTool(component);
    (group as any)[COMPONENT_PARENT] = parent;
    children[previousEntry.index] = group;
    children.splice(index, 1);
    maybeMergeConsecutiveThinkingMessages(parent);
  }
}

export function patchContainerParentTracking(): void {
  const proto = Container.prototype as any;
  if (proto[PARENT_TRACKING_PATCH_FLAG]) return;
  const originalAddChild = proto.addChild;
  const originalRemoveChild = proto.removeChild;
  const originalClear = proto.clear;
  proto.addChild = function patchedAddChild(component: any) {
    const result = originalAddChild.call(this, component);
    if (component && typeof component === "object")
      component[COMPONENT_PARENT] = this;
    maybeGroupToolComponent(this, component);
    maybeMergeConsecutiveThinkingMessages(this);
    return result;
  };
  proto.removeChild = function patchedRemoveChild(component: any) {
    const result = originalRemoveChild.call(this, component);
    if (
      component &&
      typeof component === "object" &&
      component[COMPONENT_PARENT] === this
    )
      delete component[COMPONENT_PARENT];
    return result;
  };
  proto.clear = function patchedClear() {
    for (const child of this.children ?? []) {
      if (
        child &&
        typeof child === "object" &&
        child[COMPONENT_PARENT] === this
      )
        delete child[COMPONENT_PARENT];
    }
    return originalClear.call(this);
  };
  proto[PARENT_TRACKING_PATCH_FLAG] = true;
}

function formatTodoOverlayLines(lines: string[], width: number): string[] {
  // Hot path: nearly every Container.render hits this. Bail after the first
  // non-empty line unless it's actually the Magic Context todo overlay.
  let firstContent: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const plain = stripAnsi(lines[i]).trim();
    if (!plain) continue;
    firstContent = plain;
    break;
  }
  if (!firstContent || !/^[●○]\s+Todos\s+—/.test(firstContent)) return lines;
  return lines.map((line) => {
    const plain = stripAnsi(line);
    if (/^[●○]\s+Todos\s+—/.test(plain))
      return clampLineWidth(` ${line}`, width);
    // Magic Context emits `├─` / `└─` or bare `├` / `└`; strip any arm to bare tee/corner.
    if (!/^[├└]─?\s+[✓○◐✗●⬤•]\s/.test(plain) && !/^[├└]─?\s+/.test(plain))
      return line;
    const withoutTodoHash = line.replace(/#(?=[A-Za-z0-9_-]+)/, "");
    const bare = withoutTodoHash.replace(/([├└])─/, "$1");
    const colored = bare.replace(
      /[├└]/,
      (branch) =>
        `${groupingHostPorts.toolExecution.currentToolBranchAnsi()}${branch}${TRANSPARENT_RESET}`,
    );
    return clampLineWidth(` ${colored}`, width);
  });
}

export function patchGlobalToolBorders(): void {
  const proto = Container.prototype as any;
  if (proto[PATCH_FLAG]) return;

  const originalRender = proto.render;
  proto.render = function patchedContainerRender(width: number): string[] {
    maybeMergeConsecutiveThinkingMessages(this);
    if (isToolExecutionLike(this)) {
      const outputPad = readPiOutputPad();
      syncToolOutputPad(this, outputPad);
      const cached = (this as any)[TOOL_RENDER_CACHE];
      const branchKey =
        groupingHostPorts.toolExecution.toolBranchRenderCacheKey();
      const clickKey = groupingHostPorts.clickRouting.toolClickStateKey(this);
      if (
        cached?.width === width &&
        cached?.mode === toolBackgroundMode &&
        cached?.outputPad === outputPad &&
        cached?.branchKey === branchKey &&
        cached?.branchEpoch ===
          groupingHostPorts.toolExecution._toolBranchVisualEpoch &&
        cached?.clickKey === clickKey
      ) {
        return cached.lines;
      }
    }

    const rendered = originalRender.call(this, width);
    if (!Array.isArray(rendered) || rendered.length === 0) return rendered;
    const todoOverlay = formatTodoOverlayLines(rendered, width);
    if (!isToolExecutionLike(this)) return todoOverlay;
    const branchCache = {
      outputPad: readPiOutputPad(),
      branchKey: groupingHostPorts.toolExecution.toolBranchRenderCacheKey(),
      branchEpoch: groupingHostPorts.toolExecution._toolBranchVisualEpoch,
      clickKey: groupingHostPorts.clickRouting.toolClickStateKey(this),
    };
    if (
      toolBackgroundMode === "default" ||
      groupingHostPorts.clickRouting.isSideQuestBinaryTool(this)
    ) {
      (this as any)[TOOL_RENDER_CACHE] = {
        width,
        mode: toolBackgroundMode,
        lines: rendered,
        ...branchCache,
      };
      return rendered;
    }

    let start = 0;
    while (start < rendered.length && isBlankLine(rendered[start])) start++;
    let end = rendered.length - 1;
    while (end >= start && isBlankLine(rendered[end])) end--;
    if (start > end) return rendered;

    const { textLines, imageLines } = splitRenderedImageBlock(
      rendered.slice(start, end + 1),
    );
    if (imageLines.length > 0) {
      (this as any)[TOOL_RENDER_CACHE] = {
        width,
        mode: toolBackgroundMode,
        lines: rendered,
        ...branchCache,
      };
      return rendered;
    }
    // Agent-family tools stay column-aligned with every other tool row — no extra
    // leading indent (the old nested pad made Agent look offset from Read/Bash).
    const core = textLines.map((line) => {
      const normalized = stripOuterBackgroundAnsi(
        normalizeLeadingCheckGlyph(line),
      );
      return clampLineWidth(normalized, width);
    });
    const spacerLine = " ".repeat(width);
    let result: string[];

    if (toolBackgroundMode === "outlines") {
      const ruleWidth = Math.max(1, width);
      const framed =
        core.length > 0
          ? [borderLine(ruleWidth), ...core, borderLine(ruleWidth)]
          : [];
      result = [spacerLine, ...framed, ...imageLines];
    } else {
      result = [spacerLine, ...core, ...imageLines];
    }

    (this as any)[TOOL_RENDER_CACHE] = {
      width,
      mode: toolBackgroundMode,
      lines: result,
      ...branchCache,
    };
    return result;
  };

  proto[PATCH_FLAG] = true;
}
