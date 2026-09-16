import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import {
  Text,
  getCapabilities,
  getImageDimensions,
  imageFallback,
} from "@earendil-works/pi-tui";
import { claimToolCollapseViewportSettlement } from "../click-expansion/viewport";
import { type DiffEvidence, type DiffTheme } from "../diff-presentation/index";
import {
  type MutationToolName,
  type PresentationToolFamily,
} from "../tool-presentation/index";

import {
  ANSI_PRESENT_RE,
  ANSI_RE,
  BORDER_COLOR,
  TRANSPARENT_RESET,
  readSettings,
} from "./chrome.ts";

import { beginPresentationSettlement } from "./presentation-settlement.ts";
import type { ToolFamilyHostPorts } from "./ports.ts";

let toolFamilyHostPorts: ToolFamilyHostPorts;

export function connectToolFamilyHost(ports: ToolFamilyHostPorts): void {
  toolFamilyHostPorts = ports;
}

export function getEditOperations(
  input: any,
): Array<{ oldText: string; newText: string }> {
  if (Array.isArray(input?.edits)) {
    return input.edits
      .map((edit: any) => ({
        oldText:
          typeof edit?.oldText === "string"
            ? edit.oldText
            : typeof edit?.old_text === "string"
              ? edit.old_text
              : "",
        newText:
          typeof edit?.newText === "string"
            ? edit.newText
            : typeof edit?.new_text === "string"
              ? edit.new_text
              : "",
      }))
      .filter(
        (edit: { oldText: string; newText: string }) =>
          edit.oldText && edit.oldText !== edit.newText,
      );
  }
  const oldText =
    typeof input?.oldText === "string"
      ? input.oldText
      : typeof input?.old_text === "string"
        ? input.old_text
        : "";
  const newText =
    typeof input?.newText === "string"
      ? input.newText
      : typeof input?.new_text === "string"
        ? input.new_text
        : "";
  return oldText && oldText !== newText ? [{ oldText, newText }] : [];
}

function stripThinkingPresentationArtifacts(text: string): string {
  if (!ANSI_PRESENT_RE.test(text) && !/^\s*thinking:\s*/i.test(text))
    return text;
  let current = ANSI_PRESENT_RE.test(text) ? text.replace(ANSI_RE, "") : text;
  while (true) {
    const next = current.replace(/^(?:thinking:\s*)+/i, "").trimStart();
    if (next === current) return current;
    current = next;
  }
}

function prefixThinkingLine(text: string, _theme: Theme | undefined): string {
  if (
    !ANSI_PRESENT_RE.test(text) &&
    text.startsWith("Thinking: ") &&
    !/^Thinking:\s*thinking:\s*/i.test(text)
  ) {
    return text;
  }
  const normalized = stripThinkingPresentationArtifacts(text).trim();
  if (!normalized) return text;
  return `Thinking: ${normalized}`;
}

function trackThinkingBlockEvents(event: any, ctx?: any): void {
  const evt = event?.assistantMessageEvent;
  const message = event?.message;
  if (!evt || typeof evt.type !== "string") return;
  function refreshThinkingChrome(): void {
    try {
      ctx?.ui?.invalidate?.();
      ctx?.ui?.requestRender?.();
    } catch {
      /* noop */
    }
    // Pi may call AssistantMessageComponent.updateContent before extension
    // handlers run on the same thinking_end event — nudge one more frame.
    setTimeout(() => {
      try {
        ctx?.ui?.invalidate?.();
        ctx?.ui?.requestRender?.();
      } catch {
        /* noop */
      }
    }, 0);
  }

  if (evt.type === "thinking_start") {
    toolFamilyHostPorts.transcript.transcriptTiming.thinkingBlockInFlight = true;
    toolFamilyHostPorts.transcript.transcriptTiming.thinkingBlockStartMs =
      Date.now();
    toolFamilyHostPorts.transcript.transcriptTiming.lastThinkingBlockDurationMs =
      undefined;
    if (message?.role === "assistant") {
      (message as any)[toolFamilyHostPorts.transcript.THINKING_ACTIVE_KEY] =
        true;
      delete (message as any)[
        toolFamilyHostPorts.transcript.THINKING_DURATION_KEY
      ];
    }
    refreshThinkingChrome();
    return;
  }
  if (evt.type === "thinking_end") {
    toolFamilyHostPorts.transcript.transcriptTiming.thinkingBlockInFlight = false;
    const duration = Math.max(
      0,
      Date.now() -
        toolFamilyHostPorts.transcript.transcriptTiming.thinkingBlockStartMs,
    );
    if (message?.role === "assistant")
      delete (message as any)[
        toolFamilyHostPorts.transcript.THINKING_ACTIVE_KEY
      ];
    toolFamilyHostPorts.transcript.transcriptTiming.lastThinkingBlockDurationMs =
      duration;
    if (message?.role === "assistant")
      (message as any)[toolFamilyHostPorts.transcript.THINKING_DURATION_KEY] =
        duration;
    refreshThinkingChrome();
    return;
  }
  // Fallback: some providers/models never emit thinking_end (a second
  // thinking_start can overwrite the first, or the turn can end with toolUse).
  // The live "Thinking..." row would otherwise stick forever while later calls
  // run normally. Any non-thinking stream event on the same assistant message
  // means thinking is no longer the live activity: freeze the elapsed time into
  // a "Thought for Xs" duration so the row always resolves.
  if (
    (message as any)?.[toolFamilyHostPorts.transcript.THINKING_ACTIVE_KEY] ||
    toolFamilyHostPorts.transcript.transcriptTiming.thinkingBlockInFlight
  ) {
    if (
      evt.type === "text_start" ||
      evt.type === "text_delta" ||
      evt.type === "toolcall_start" ||
      evt.type === "toolcall_end"
    ) {
      toolFamilyHostPorts.transcript.transcriptTiming.thinkingBlockInFlight = false;
      const duration =
        toolFamilyHostPorts.transcript.transcriptTiming.thinkingBlockStartMs > 0
          ? Math.max(
              0,
              Date.now() -
                toolFamilyHostPorts.transcript.transcriptTiming
                  .thinkingBlockStartMs,
            )
          : undefined;
      if (message?.role === "assistant")
        delete (message as any)[
          toolFamilyHostPorts.transcript.THINKING_ACTIVE_KEY
        ];
      if (typeof duration === "number") {
        toolFamilyHostPorts.transcript.transcriptTiming.lastThinkingBlockDurationMs =
          duration;
        if (message?.role === "assistant")
          (message as any)[
            toolFamilyHostPorts.transcript.THINKING_DURATION_KEY
          ] = duration;
      }
      refreshThinkingChrome();
    }
  }
}

export function registerThinkingLabels(pi: ExtensionAPI): void {
  const patchMessage = (event: any, theme?: Theme) => {
    // Keep theme-derived border / dim text colors in sync with the
    // active pi theme. Cheap when the theme hasn't changed (identity check).
    if (theme)
      toolFamilyHostPorts.toolExecution.applyThemePaletteIfNeeded(theme);
    const message = event?.message;
    if (
      !message ||
      message.role !== "assistant" ||
      !Array.isArray(message.content)
    )
      return;
    for (const block of message.content) {
      if (
        block &&
        block.type === "thinking" &&
        typeof block.thinking === "string"
      ) {
        block.thinking = prefixThinkingLine(block.thinking, theme);
      }
    }
  };
  pi.on("before_agent_start", async () => {
    // Start once per top-level request. Steering/follow-up messages can be
    // injected while the agent is already active; those must not reset the
    // request timer.
    if (
      toolFamilyHostPorts.transcript.transcriptTiming
        .currentAgentWorkStartMs === undefined
    ) {
      toolFamilyHostPorts.transcript.transcriptTiming.currentAgentWorkStartMs =
        Date.now();
    }
    if (
      toolFamilyHostPorts.transcript.transcriptTiming.sessionStartMs ===
      undefined
    )
      toolFamilyHostPorts.transcript.transcriptTiming.sessionStartMs =
        Date.now();
    toolFamilyHostPorts.transcript.transcriptTiming.currentAssistantMessageStartMs =
      undefined;
  });
  pi.on("agent_start", async () => {
    if (
      toolFamilyHostPorts.transcript.transcriptTiming
        .currentAgentWorkStartMs === undefined
    ) {
      toolFamilyHostPorts.transcript.transcriptTiming.currentAgentWorkStartMs =
        Date.now();
    }
    if (
      toolFamilyHostPorts.transcript.transcriptTiming.sessionStartMs ===
      undefined
    )
      toolFamilyHostPorts.transcript.transcriptTiming.sessionStartMs =
        Date.now();
    toolFamilyHostPorts.transcript.transcriptTiming.currentAssistantMessageStartMs =
      undefined;
  });
  pi.on("message_start", async (event: any) => {
    const message = event?.message;
    if (
      message?.role === "user" &&
      toolFamilyHostPorts.transcript.transcriptTiming
        .currentAgentWorkStartMs === undefined
    ) {
      toolFamilyHostPorts.transcript.transcriptTiming.currentAgentWorkStartMs =
        Date.now();
    }
    if (message?.role === "assistant") {
      toolFamilyHostPorts.transcript.transcriptTiming.currentAssistantMessageStartMs =
        Date.now();
      (message as any)[toolFamilyHostPorts.transcript.WORKED_START_KEY] =
        toolFamilyHostPorts.transcript.transcriptTiming.currentAssistantMessageStartMs;
      // A new assistant message starts a fresh thinking lifecycle. Without
      // this, a missing thinking_end on the previous message leaves the
      // global in-flight flag set and the next message renders a stale
      // "Thinking..." row until its own thinking events arrive.
      toolFamilyHostPorts.transcript.transcriptTiming.thinkingBlockInFlight = false;
      delete (message as any)[
        toolFamilyHostPorts.transcript.THINKING_ACTIVE_KEY
      ];
    }
  });
  pi.on("message_update", async (event, ctx) => {
    trackThinkingBlockEvents(event, ctx);
    patchMessage(event, ctx.ui?.theme);
  });
  pi.on("message_end", async (event, ctx) => {
    const message = (event as any)?.message;
    if (message?.role === "assistant") {
      // Belt-and-suspenders: if thinking_end never fired (provider skipped
      // it, or the turn ended on toolUse/text), freeze any live "Thinking..."
      // into its "Thought for Xs" duration here so the row always resolves
      // at the end of the message instead of sticking into later calls.
      toolFamilyHostPorts.transcript.transcriptTiming.thinkingBlockInFlight = false;
      delete (message as any)[
        toolFamilyHostPorts.transcript.THINKING_ACTIVE_KEY
      ];
      if (
        typeof (message as any)[
          toolFamilyHostPorts.transcript.THINKING_DURATION_KEY
        ] !== "number"
      ) {
        const duration =
          toolFamilyHostPorts.transcript.transcriptTiming.thinkingBlockStartMs >
          0
            ? Math.max(
                0,
                Date.now() -
                  toolFamilyHostPorts.transcript.transcriptTiming
                    .thinkingBlockStartMs,
              )
            : undefined;
        if (typeof duration === "number" && duration > 0) {
          toolFamilyHostPorts.transcript.transcriptTiming.lastThinkingBlockDurationMs =
            duration;
          (message as any)[
            toolFamilyHostPorts.transcript.THINKING_DURATION_KEY
          ] = duration;
        } else if (
          typeof toolFamilyHostPorts.transcript.transcriptTiming
            .lastThinkingBlockDurationMs === "number" &&
          toolFamilyHostPorts.transcript.transcriptTiming
            .lastThinkingBlockDurationMs > 0
        ) {
          (message as any)[
            toolFamilyHostPorts.transcript.THINKING_DURATION_KEY
          ] =
            toolFamilyHostPorts.transcript.transcriptTiming.lastThinkingBlockDurationMs;
        }
      }
      toolFamilyHostPorts.transcript.transcriptTiming.thinkingBlockStartMs = 0;
      const started =
        typeof toolFamilyHostPorts.transcript.transcriptTiming
          .currentAgentWorkStartMs === "number"
          ? toolFamilyHostPorts.transcript.transcriptTiming
              .currentAgentWorkStartMs
          : typeof (message as any)[
                toolFamilyHostPorts.transcript.WORKED_START_KEY
              ] === "number"
            ? (message as any)[toolFamilyHostPorts.transcript.WORKED_START_KEY]
            : toolFamilyHostPorts.transcript.transcriptTiming
                .currentAssistantMessageStartMs;
      const isFinalAssistantMessage = message.stopReason === "stop";
      if (started !== undefined && isFinalAssistantMessage) {
        const durationMs = Date.now() - started;
        const sessionTotalMs =
          typeof toolFamilyHostPorts.transcript.transcriptTiming
            .sessionStartMs === "number"
            ? Date.now() -
              toolFamilyHostPorts.transcript.transcriptTiming.sessionStartMs
            : undefined;
        const turns =
          toolFamilyHostPorts.transcript.transcriptTiming.userTurnCount > 0
            ? toolFamilyHostPorts.transcript.transcriptTiming.userTurnCount
            : undefined;
        (message as any)[toolFamilyHostPorts.transcript.WORKED_DURATION_KEY] =
          durationMs;
        if (typeof sessionTotalMs === "number")
          (message as any)[
            toolFamilyHostPorts.transcript.WORKED_SESSION_TOTAL_KEY
          ] = sessionTotalMs;
        if (typeof turns === "number")
          (message as any)[toolFamilyHostPorts.transcript.WORKED_TURNS_KEY] =
            turns;
        // Duration metadata drives the assistant component's TUI-only status line.
        // Message content stays presentation-neutral for persistence and consumers.
      }
      toolFamilyHostPorts.transcript.transcriptTiming.currentAssistantMessageStartMs =
        undefined;
    }
    patchMessage(event, ctx.ui?.theme);
    try {
      (ctx as any)?.ui?.invalidate?.();
      (ctx as any)?.ui?.requestRender?.();
    } catch {
      /* noop */
    }
  });
  pi.on("agent_end", async () => {
    toolFamilyHostPorts.transcript.transcriptTiming.currentAgentWorkStartMs =
      undefined;
    toolFamilyHostPorts.transcript.transcriptTiming.currentAssistantMessageStartMs =
      undefined;
  });
  pi.on("session_start", async () => {
    // Reset session-wide accumulators on every session transition (new / resume /
    // fork / reload). The `context` event re-seeds them from the new session's
    // message history, so /new starts fresh while /resume picks up past prompts
    // and the original session start time. Resetting here is what lets /new
    // clear the totals (Math.min / Math.max seeding alone could never lower them).
    // Also drop the live-agent marker so history partials rebuilt during resume
    // never look "in flight" and re-arm blink timers.
    toolFamilyHostPorts.transcript.transcriptTiming.currentAgentWorkStartMs =
      undefined;
    toolFamilyHostPorts.transcript.transcriptTiming.currentAssistantMessageStartMs =
      undefined;
    toolFamilyHostPorts.transcript.transcriptTiming.sessionStartMs = undefined;
    toolFamilyHostPorts.transcript.transcriptTiming.userTurnCount = 0;
  });
  pi.on("context", async (event) => {
    const messages = (event as any)?.messages;
    if (!Array.isArray(messages)) return;
    // Seed session-wide accumulators from the full message history (covers
    // /resume — past prompts and the original session start time are included).
    // Values are monotonic, so recomputing on every fire stays stable.
    let earliest: number | undefined;
    let userCount = 0;
    for (const msg of messages) {
      if (!msg) continue;
      if (msg.role === "user") userCount++;
      if (typeof msg.timestamp === "number" && Number.isFinite(msg.timestamp)) {
        if (earliest === undefined || msg.timestamp < earliest)
          earliest = msg.timestamp;
      }
    }
    if (earliest !== undefined) {
      toolFamilyHostPorts.transcript.transcriptTiming.sessionStartMs =
        toolFamilyHostPorts.transcript.transcriptTiming.sessionStartMs ===
        undefined
          ? earliest
          : Math.min(
              toolFamilyHostPorts.transcript.transcriptTiming.sessionStartMs,
              earliest,
            );
    }
    if (
      userCount > toolFamilyHostPorts.transcript.transcriptTiming.userTurnCount
    )
      toolFamilyHostPorts.transcript.transcriptTiming.userTurnCount = userCount;
    for (const msg of messages) {
      if (!msg || msg.role !== "assistant" || !Array.isArray(msg.content))
        continue;
      for (const block of msg.content) {
        if (
          block &&
          block.type === "thinking" &&
          typeof block.thinking === "string"
        ) {
          block.thinking = stripThinkingPresentationArtifacts(block.thinking);
        }
        if (block && block.type === "text" && typeof block.text === "string") {
          block.text = toolFamilyHostPorts.transcript.stripWorkedDurationLine(
            block.text,
          );
        }
      }
    }
  });
}

export function getMode<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

const CORE_TOOL_OVERRIDES = new Set([
  "read",
  "bash",
  "grep",
  "find",
  "ls",
  "write",
  "edit",
]);

const OPENAI_STYLE_TOOL_NAMES = new Set([
  "apply_patch",
  "webfetch",
  "question",
  "questionnaire",
  "context_tag",
  "context_log",
  "context_checkout",
  "annotate",
  "web_search",
  "code_search",
  "fetch_content",
  "get_search_content",
  "alpha_search",
  "alpha_get_paper",
  "alpha_ask_paper",
  "alpha_annotate_paper",
  "alpha_list_annotations",
  "alpha_read_code",
  "Skill",
  "EnterPlanMode",
  "ExitPlanMode",
  "Agent",
  "get_subagent_result",
  "steer_subagent",
  "TaskCreate",
  "TaskList",
  "TaskGet",
  "TaskUpdate",
  "TaskOutput",
  "TaskStop",
  "TaskExecute",
  // Magic Context registers specialized renderers of its own. Re-register its
  // tools through the public API so they use the same Claude-style rows as
  // every other external tool handled by this extension.
  "ctx_search",
  "ctx_memory",
  "ctx_note",
  "ctx_expand",
  "ctx_reduce",
  "todowrite",
]);

export function isMcpToolCandidate(tool: unknown): boolean {
  const rec = tool as Record<string, unknown> | undefined;
  const name = typeof rec?.name === "string" ? rec.name : "";
  const description =
    typeof rec?.description === "string" ? rec.description : "";
  return name === "mcp" || /\bmcp\b/i.test(description);
}

export function isOpenAiToolCandidate(tool: unknown): boolean {
  const rec = tool as Record<string, unknown> | undefined;
  const name = typeof rec?.name === "string" ? rec.name : "";
  if (!name || CORE_TOOL_OVERRIDES.has(name) || isMcpToolCandidate(tool))
    return false;
  return OPENAI_STYLE_TOOL_NAMES.has(name);
}

export function humanizeToolName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function isMcpToolName(name: string): boolean {
  return (
    name === "mcp" || /^mcp[_:-]/i.test(name) || /[_:-]mcp[_:-]/i.test(name)
  );
}

export function shouldUseGenericToolRenderer(name: unknown): boolean {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    !CORE_TOOL_OVERRIDES.has(name)
  );
}

function genericToolLabel(name: string): string {
  return isMcpToolName(name) ? "MCP" : humanizeToolName(name);
}

export function renderGenericToolCall(
  name: string,
  args: any,
  theme: Theme,
  ctx: any,
  label = genericToolLabel(name),
): Text {
  toolFamilyHostPorts.toolExecution.syncToolCallStatus(ctx);
  ctx.state._openAiPatchFiles = [];
  // Agent / subagent tools get a size-breathing pending marker, not on/off ●.
  if (toolFamilyHostPorts.grouping.isAgentFamilyToolName(name))
    ctx.state._agentBreathe = true;
  if (isMcpToolName(name)) {
    return toolFamilyHostPorts.toolExecution.makeToolFamilyCallText(
      "mcp",
      name,
      "MCP",
      args,
      theme,
      ctx,
      true,
    );
  }
  return toolFamilyHostPorts.toolExecution.makeToolFamilyCallText(
    "openai",
    name,
    label,
    args,
    theme,
    ctx,
  );
}

export function renderGenericToolResult(
  name: string,
  result: any,
  options: any,
  theme: Theme,
  ctx: any,
): Text {
  if (isMcpToolName(name)) {
    return renderMcpToolResult(
      result,
      !!options?.expanded,
      !!options?.isPartial,
      theme,
      ctx,
    );
  }
  return renderOpenAiToolResult(
    name,
    { content: result.content, details: result.details },
    !!options?.expanded,
    !!options?.isPartial,
    theme,
    ctx,
  );
}

export function lineCountLabel(count: number): string {
  return `${count} line${count === 1 ? "" : "s"}`;
}

export function makeToolFamilyStreamText(
  family: PresentationToolFamily,
  name: string,
  label: string,
  args: unknown,
  result: any,
  expanded: boolean,
  theme: Theme,
  ctx: any,
  followPiOutputPad = false,
): Text {
  toolFamilyHostPorts.toolExecution.syncToolCallStatus(ctx);
  if (ctx?.state?._toolStatus === "pending")
    toolFamilyHostPorts.toolExecution.setupBlinkTimer(ctx);
  else toolFamilyHostPorts.toolExecution.clearBlinkTimer(ctx);

  const decision = toolFamilyHostPorts.toolExecution.decideToolFamilyResult(
    family,
    name,
    label,
    args,
    result,
    true,
    ctx,
  );
  const totalLineCount =
    decision.kind === "present" ? (decision.metadata?.output?.total ?? 0) : 0;
  if (ctx?.state) ctx.state._liveLineCount = totalLineCount;
  const limit = toolFamilyHostPorts.toolExecution.liveToolPreviewLimit();
  if (
    decision.kind === "suppress" ||
    !toolFamilyHostPorts.toolExecution.liveToolPreviewEnabled() ||
    limit <= 0 ||
    totalLineCount === 0
  ) {
    return toolFamilyHostPorts.toolExecution.makeText(
      ctx.lastComponent,
      "",
      followPiOutputPad,
    );
  }
  return toolFamilyHostPorts.toolExecution.makePresentationText(
    ctx.lastComponent,
    decision.presentation,
    {
      expansion: expanded ? "expanded" : "collapsed",
      preview: { normal: limit },
    },
    theme,
    followPiOutputPad,
  );
}

export function getStringArg(args: any, ...keys: string[]): string {
  for (const key of keys) {
    const value = args?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function renderApplyPatchCall(args: any, theme: Theme, ctx: any): Text {
  toolFamilyHostPorts.toolExecution.syncToolCallStatus(ctx);
  const presentation = presentMutationDiff(
    ctx,
    theme,
    "apply_patch",
    "call",
    args,
    undefined,
    2,
    ctx.argsComplete === true,
  );
  const summary = toolFamilyHostPorts.toolExecution.stableCallSummary(
    ctx,
    "_callSummary",
    () => presentation.headerSummary ?? theme.fg("muted", "patch"),
  );
  const hdr = toolFamilyHostPorts.toolExecution.toolHeader(
    "Apply Patch",
    summary,
    theme,
    toolFamilyHostPorts.toolExecution.toolStatusDot(ctx, theme),
    toolFamilyHostPorts.toolExecution.liveLineCountTrailing(ctx, theme),
  );
  if (ctx.argsComplete !== true)
    return toolFamilyHostPorts.toolExecution.makeText(ctx.lastComponent, hdr);
  ctx.state._openAiPatchFiles = [...presentation.affectedPaths];
  return toolFamilyHostPorts.toolExecution.makeResponsiveDiffText(
    ctx,
    ctx.lastComponent,
    presentation.body ? `${hdr}\n${presentation.body}` : hdr,
  );
}

export function renderApplyPatchResult(
  result: any,
  isPartial: boolean,
  theme: Theme,
  ctx: any,
): Text {
  if (isPartial) {
    return makeToolFamilyStreamText(
      "tool-native",
      "apply_patch",
      "Apply Patch",
      ctx.args,
      result,
      !!ctx?.expanded,
      theme,
      ctx,
    );
  }
  toolFamilyHostPorts.toolExecution.clearBlinkTimer(ctx);
  toolFamilyHostPorts.toolExecution.setToolStatus(
    ctx,
    ctx.isError ? "error" : "success",
  );
  if (ctx.isError) {
    const raw = toolFamilyHostPorts.transcript.resultTextContent(result).trim();
    const firstLine = raw ? raw.split("\n")[0] : "Apply patch failed";
    return toolFamilyHostPorts.toolExecution.makeText(
      ctx.lastComponent,
      toolFamilyHostPorts.toolExecution.withToolErrorIndent(
        theme.fg("error", firstLine),
      ),
    );
  }
  const presentation = presentMutationDiff(
    ctx,
    theme,
    "apply_patch",
    "result",
    ctx.args,
    (result as any).details?.diffEvidence,
    2,
    true,
    (result as any).details,
  );
  return toolFamilyHostPorts.toolExecution.makeResponsiveDiffText(
    ctx,
    ctx.lastComponent,
    presentation.body,
  );
}

export function renderMcpToolResult(
  result: any,
  expanded: boolean,
  isPartial: boolean,
  theme: Theme,
  ctx: any,
): Text {
  if (isPartial)
    return makeToolFamilyStreamText(
      "mcp",
      String(ctx?.toolName ?? "mcp"),
      "MCP",
      ctx.args,
      result,
      expanded,
      theme,
      ctx,
      true,
    );
  const outputMode = getMode(
    readSettings().mcpOutputMode,
    ["hidden", "summary", "preview"] as const,
    "preview",
  );
  const presentationResult =
    outputMode === "hidden"
      ? result
      : toolFamilyHostPorts.transcript.completeMcpResultForPresentation(
          result,
          ctx?.state,
        );
  return toolFamilyHostPorts.toolExecution.makeSettledToolFamilyResultText(
    "mcp",
    String(ctx?.toolName ?? "mcp"),
    "MCP",
    presentationResult,
    expanded,
    theme,
    ctx,
    {
      followPiOutputPad: true,
      policy: { outputMode },
    },
  );
}

export function getFirstImageBlock(
  result: any,
): { data: string; mimeType: string } | undefined {
  if (!Array.isArray(result?.content)) return undefined;
  return result.content.find(
    (block: any) =>
      block?.type === "image" &&
      typeof block.data === "string" &&
      typeof block.mimeType === "string",
  );
}

function getReadImageFallback(result: any, ctx: any): string {
  const image = getFirstImageBlock(result);
  if (!image) return "";
  let dimensions;
  try {
    dimensions = getImageDimensions(image.data, image.mimeType) ?? undefined;
  } catch {
    dimensions = undefined;
  }
  const path = getStringArg(ctx.args, "path", "file_path");
  const filename = path
    ? toolFamilyHostPorts.toolExecution.shortPath(
        ctx.cwd ?? process.cwd(),
        path,
      )
    : undefined;
  return imageFallback(image.mimeType, dimensions, filename);
}

export function renderReadImageResult(
  result: any,
  expanded: boolean,
  theme: Theme,
  ctx: any,
): Text {
  const image = getFirstImageBlock(result);
  const mimeType = image?.mimeType ?? "image";
  const summary = toolFamilyHostPorts.toolExecution.markResultSummary(
    `${theme.fg("success", "Image loaded")} ${theme.fg("muted", `[${mimeType}]`)}`,
  );
  if (!expanded) {
    return toolFamilyHostPorts.toolExecution.makeText(
      ctx.lastComponent,
      toolFamilyHostPorts.toolExecution.withBranch(
        `${summary}${toolFamilyHostPorts.clickRouting.toolOutputDetailHint(theme, expanded)}`,
        theme,
      ),
    );
  }

  const noteLines = toolFamilyHostPorts.transcript
    .resultTextContent(result)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^Read image file\b/i.test(line));
  const lines = [summary, ...noteLines.map((line) => theme.fg("dim", line))];
  if (!getCapabilities().images || !ctx.showImages) {
    const fallback = getReadImageFallback(result, ctx);
    if (fallback) lines.push(theme.fg("toolOutput", fallback));
  }
  return toolFamilyHostPorts.toolExecution.makeText(
    ctx.lastComponent,
    toolFamilyHostPorts.toolExecution.withBranch(lines.join("\n"), theme),
  );
}

export function renderOpenAiToolResult(
  name: string,
  result: any,
  expanded: boolean,
  isPartial: boolean,
  theme: Theme,
  ctx: any,
): Text {
  if (isPartial)
    return makeToolFamilyStreamText(
      "openai",
      name,
      humanizeToolName(name),
      ctx.args,
      result,
      expanded,
      theme,
      ctx,
    );
  const detail =
    expanded && name !== "TaskList" && name !== "Agent"
      ? toolFamilyHostPorts.clickRouting.extraToolOutputExpanded
        ? 2
        : 1
      : undefined;
  const patchFiles = Array.isArray(ctx.state?._openAiPatchFiles)
    ? ctx.state._openAiPatchFiles
    : [];
  return toolFamilyHostPorts.toolExecution.makeSettledToolFamilyResultText(
    "openai",
    name,
    humanizeToolName(name),
    result,
    expanded,
    theme,
    ctx,
    {
      detail,
      policy: { patchFiles },
    },
  );
}

function contextDiffWidth(ctx: any, chromeWidth: 2 | 3): number {
  const measured = ctx.state?._diffComponentWidth;
  const width =
    typeof measured === "number" && Number.isFinite(measured)
      ? Math.floor(measured)
      : Math.max(
          40,
          Math.min(
            (process.stdout.columns ||
              Number.parseInt(process.env.COLUMNS ?? "", 10) ||
              200) - 4,
            210,
          ),
        );
  return Math.max(20, Math.min(width - chromeWidth, 210));
}

function diffPresentationView(ctx: any, theme: Theme, chromeWidth: 2 | 3) {
  return {
    width: contextDiffWidth(ctx, chromeWidth),
    expanded: ctx.expanded === true,
    localDetail:
      toolFamilyHostPorts.toolExecution.progressiveLocalDetailLevelForRender(
        ctx.state,
      ),
    localClickControls:
      toolFamilyHostPorts.toolExecution.progressiveLocalControlsEnabled(),
    theme: theme as DiffTheme,
  } as const;
}

export function presentMutationDiff(
  ctx: any,
  theme: Theme,
  name: MutationToolName,
  phase: "call" | "result",
  args: unknown,
  evidence: unknown,
  chromeWidth: 2 | 3,
  sourceComplete = true,
  resultDetails?: unknown,
) {
  const owner = ctx.state ?? ctx;
  return toolFamilyHostPorts.presentation.toolPresentationModule.present({
    surface: "mutation-presentation",
    tool: { family: "mutation", name },
    phase,
    cwd: ctx.cwd ?? process.cwd(),
    args,
    evidence,
    resultDetails,
    request: {
      owner,
      sourceComplete,
      view: diffPresentationView(ctx, theme, chromeWidth),
      settlement: {
        begin() {
          const pendingViewport = claimToolCollapseViewportSettlement(
            ctx.state,
          );
          return beginPresentationSettlement(owner, () =>
            toolFamilyHostPorts.clickRouting.safeInvalidate(
              ctx,
              pendingViewport,
            ),
          );
        },
      },
    },
  }).snapshot;
}

export async function captureMutationDiff(
  name: MutationToolName,
  cwd: string,
  args: unknown,
  before?: string | null,
): Promise<DiffEvidence | undefined> {
  try {
    return await toolFamilyHostPorts.presentation.toolPresentationModule.present(
      {
        surface: "mutation-capture",
        tool: { family: "mutation", name },
        cwd,
        args,
        before,
      },
    );
  } catch {
    return undefined;
  }
}

export function attachDiffEvidence(
  result: any,
  evidence: DiffEvidence | undefined,
): void {
  if (!evidence || !result || typeof result !== "object") return;
  result.details = { ...(result.details ?? {}), diffEvidence: evidence };
}
