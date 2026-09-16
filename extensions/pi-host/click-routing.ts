import type { Theme } from "@earendil-works/pi-coding-agent";
import { keyHint, keyText, rawKeyHint } from "@earendil-works/pi-coding-agent";
import type { ClickExpansionRuntime } from "../click-expansion/index";
import {
  settleToolCollapseViewport,
  type ToolCollapseViewportSettlement,
} from "../click-expansion/viewport";

import {
  CLICK_CONTROL_BREAK_MARK,
  CLICK_HINT_CLOSE,
  CLICK_HINT_OPEN,
  CLICK_HINT_SEPARATOR,
  COMPONENT_PARENT,
  TOOL_CLICK_DETAIL_LEVEL,
  TOOL_CLICK_GLOBAL_EXPANDED,
  TOOL_CLICK_LOCAL_EXPANDED,
  TOOL_RENDER_BRIDGE_KEY,
  TOOL_RENDER_CACHE,
  getGlobalPiTheme,
  readSettings,
  stripAnsi,
  writeSettingsKey,
} from "./chrome.ts";
import type { ToolClickDetailLevel } from "./grouping.ts";
import type { ClickRoutingHostPorts } from "./ports.ts";

let clickRoutingHostPorts: ClickRoutingHostPorts;

export function connectClickRoutingHost(ports: ClickRoutingHostPorts): void {
  clickRoutingHostPorts = ports;
}

export function summarizeText(text: string, max = 60): string {
  const oneLine = text.replace(/\n/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, Math.max(0, max - 3))}...`;
}

export let extraToolOutputExpanded = false;
type ToolRenderBridge = { localDetailTool?: any };
// Pi keeps host method patches across /reload, while renderer functions come
// from the new extension instance. Both generations must share this context.
export const toolRenderBridge = ((globalThis as any)[TOOL_RENDER_BRIDGE_KEY] ??=
  {}) as ToolRenderBridge;

export type ToolClickAction = "header" | "expand" | "detail" | "detail-extra";
export type InternalClickExpansionDeclaration = NonNullable<
  Parameters<ClickExpansionRuntime["declare"]>[2]
> &
  Readonly<{
    compatibilityAction?: ToolClickAction;
  }>;
export type ToolViewportAnchor = "top" | "bottom";

export type ToolClickAnchor = {
  line: number;
  start: number;
  end: number;
  action: ToolClickAction;
  viewportAnchor: ToolViewportAnchor;
};

export function syncExtraToolDetailMode(): void {
  extraToolOutputExpanded = readSettings().extraToolOutputExpanded === true;
}

export function setExtraToolDetailMode(enabled: boolean): void {
  extraToolOutputExpanded = enabled;
  writeSettingsKey("extraToolOutputExpanded", enabled);
  clickRoutingHostPorts.grouping.clickRuntime.visualEpoch++;
}

export function clickExpansionEnabled(): boolean {
  return readSettings().clickExpansion === true;
}

function toolGlobalExpansionActive(tool: any): boolean {
  return tool?.ui?.[TOOL_CLICK_GLOBAL_EXPANDED] === true;
}

export let clickExpansionModule: ClickExpansionRuntime | undefined;

export function setClickExpansionModule(
  runtime: ClickExpansionRuntime,
): ClickExpansionRuntime {
  clickExpansionModule = runtime;
  return runtime;
}

export function toolClickExpansionActive(tool: any): boolean {
  if (!tool || typeof tool !== "object") return false;
  if (!clickExpansionModule) return false;
  return clickExpansionModule.state({ kind: "tool-execution", execution: tool })
    .active;
}

export function normalizeToolClickDetailLevel(
  value: unknown,
): ToolClickDetailLevel {
  return value === 1 || value === 2 ? value : 0;
}

export function toolLocalDetailLevel(tool: any): ToolClickDetailLevel {
  if (!tool || typeof tool !== "object") return 0;
  if (!clickExpansionModule) return 0;
  return clickExpansionModule.state({ kind: "tool-execution", execution: tool })
    .localDetail;
}

export function setToolLocalDetailLevel(
  tool: any,
  level: ToolClickDetailLevel,
): void {
  if (!tool?.rendererState) return;
  if (level === 0) delete tool.rendererState[TOOL_CLICK_DETAIL_LEVEL];
  else tool.rendererState[TOOL_CLICK_DETAIL_LEVEL] = level;
}

export function sideQuestAgentPresentation(value: any) {
  const details = value?.details ?? value?.result?.details;
  const decision =
    clickRoutingHostPorts.presentation.toolPresentationModule.present({
      surface: "result",
      tool: { family: "openai", name: "Agent", label: "Agent" },
      cwd: process.cwd(),
      args: value?.args ?? {},
      lifecycle: { status: "success", partial: false, argsComplete: true },
      result: {
        content: Array.isArray(value?.content)
          ? value.content
          : Array.isArray(value?.result?.content)
            ? value.result.content
            : [],
        details,
        error: value?.isError === true || value?.result?.isError === true,
        partial: false,
      },
    });
  return decision.kind === "present" ? decision.metadata?.sideQuest : undefined;
}

export const sideQuestAgentResultLabel = (presentation: {
  readonly label: string;
}) => presentation.label;

export function isKnownSideQuestAgentTool(tool: any): boolean {
  return (
    String(tool?.toolName ?? "").toLowerCase() === "agent" &&
    sideQuestAgentPresentation(tool) !== undefined
  );
}

export function isSideQuestBinaryTool(tool: any): boolean {
  const name = String(tool?.toolName ?? "").toLowerCase();
  return name === "ask_parent" || name === "subagent_done";
}

export function sideQuestBinaryHasHiddenContent(tool: any): boolean {
  const name = String(tool?.toolName ?? "").toLowerCase();
  const field =
    name === "ask_parent"
      ? "prompt"
      : name === "subagent_done"
        ? "result"
        : undefined;
  if (field === undefined) return false;
  const content = String(tool?.args?.[field] ?? "");
  const renderedContent = name === "subagent_done" ? content.trim() : content;
  return Array.from(renderedContent).length > 240;
}

function toolUsesTieredTextPreview(tool: any): boolean {
  return (
    tool?.toolName === "read" ||
    tool?.toolName === "grep" ||
    tool?.toolName === "bash"
  );
}

export function toolSupportsProgressiveLocalDetail(tool: any): boolean {
  const name =
    typeof tool?.toolName === "string" ? tool.toolName.toLowerCase() : "";
  return (
    toolUsesTieredTextPreview(tool) ||
    isKnownSideQuestAgentTool(tool) ||
    name === "write" ||
    name === "edit" ||
    name === "apply_patch" ||
    name === "find" ||
    name === "ls" ||
    name === "tasklist" ||
    clickRoutingHostPorts.toolFamily.isMcpToolName(name) ||
    clickRoutingHostPorts.toolFamily.isMcpToolCandidate(tool?.toolDefinition)
  );
}

function tieredToolNormalPreviewLimit(tool: any): number {
  return tool?.toolName === "bash"
    ? clickRoutingHostPorts.toolExecution.bashCollapsedLimit()
    : clickRoutingHostPorts.toolExecution.previewLimit();
}

export function toolClickStateKey(tool: any): string {
  return `${clickRoutingHostPorts.grouping.clickRuntime.visualEpoch}:${toolClickExpansionActive(tool) ? 1 : 0}:${toolLocalDetailLevel(tool)}`;
}

export function themedRawKeyHint(
  theme: Theme | undefined,
  key: string,
  description: string,
): string {
  if (theme) return theme.fg("dim", key) + theme.fg("muted", ` ${description}`);
  try {
    return rawKeyHint(key, description);
  } catch {
    return `${key} ${description}`;
  }
}

export function configuredKeyHint(
  binding: Parameters<typeof keyText>[0],
  fallbackKey: string,
  description: string,
): string {
  try {
    if (keyText(binding).trim()) return keyHint(binding, description);
  } catch {
    /* fall back below */
  }
  return themedRawKeyHint(undefined, fallbackKey, description);
}

function hintSeparator(
  theme: Theme | undefined,
  color: "muted" | "warning",
): string {
  return theme ? theme.fg(color, " • ") : " • ";
}

function expandHint(
  theme: Theme | undefined,
  action: "expand" | "collapse" = "expand",
): string {
  return `${hintSeparator(theme, "muted")}${configuredKeyHint("app.tools.expand", "ctrl+o", `to ${action}`)}`;
}

function baselineDeepExpandHint(
  theme: Theme | undefined,
  separatorColor: "muted" | "warning" = "muted",
): string {
  return `${hintSeparator(theme, separatorColor)}${themedRawKeyHint(theme, "ctrl+shift+o", extraToolOutputExpanded ? "less detail" : "more detail")}`;
}

type EncodedClickHintAction =
  "expand" | "detail" | "detail-extra" | "collapse-final" | "none";

function encodedClickHint(
  action: EncodedClickHintAction,
  fallback: string,
): string {
  return `${CLICK_HINT_OPEN}${action}${CLICK_HINT_SEPARATOR}${fallback}${CLICK_HINT_CLOSE}`;
}

function deepExpandHint(
  theme: Theme | undefined,
  separatorColor: "muted" | "warning" = "muted",
  progressiveDetail = false,
): string {
  return encodedClickHint(
    progressiveDetail ? "detail" : "detail-extra",
    baselineDeepExpandHint(theme, separatorColor),
  );
}

export function localCollapseActionHint(theme: Theme | undefined): string {
  return encodedClickHint("collapse-final", expandHint(theme, "collapse"));
}

export function baselineToolOutputDetailHint(
  theme: Theme | undefined,
  expanded: boolean,
  hasMore = false,
): string {
  if (!expanded) return expandHint(theme, "expand");
  const parts = [expandHint(theme, "collapse")];
  if (hasMore || extraToolOutputExpanded)
    parts.push(baselineDeepExpandHint(theme));
  return parts.join("");
}

export function toolOutputDetailHint(
  theme: Theme | undefined,
  expanded: boolean,
  hasMore = false,
  localDetailEnabled = true,
  progressiveDetail = false,
): string {
  const fallback = baselineToolOutputDetailHint(theme, expanded, hasMore);
  if (!expanded) return encodedClickHint("expand", fallback);
  if (!hasMore && !extraToolOutputExpanded)
    return encodedClickHint("none", fallback);
  if (progressiveDetail) {
    return encodedClickHint(localDetailEnabled ? "detail" : "none", fallback);
  }
  const collapse = encodedClickHint("expand", expandHint(theme, "collapse"));
  const detail = localDetailEnabled
    ? encodedClickHint("detail-extra", baselineDeepExpandHint(theme))
    : baselineDeepExpandHint(theme);
  return `${collapse}${detail}`;
}

function clickHintText(
  action: "expand" | "detail" | "detail-extra",
  tool: any,
): string {
  const theme = getGlobalPiTheme() as Theme | undefined;
  const separator = theme ? theme.fg("muted", " • ") : " • ";
  const click = theme ? theme.fg("dim", "click") : "click";
  const description =
    action === "expand"
      ? tool?.expanded === true
        ? " to collapse"
        : " to expand"
      : action === "detail-extra" && toolLocalDetailLevel(tool) === 2
        ? " for less detail"
        : " for more detail";
  return `${separator}${click}${theme ? theme.fg("muted", description) : description}`;
}

function finalCollapseHintText(): string {
  const theme = getGlobalPiTheme() as Theme | undefined;
  const beforeClick = "Output ends here • ";
  const click = "click";
  const afterClick = " to collapse";
  if (!theme) return `${beforeClick}${click}${afterClick}`;
  return `${theme.fg("muted", beforeClick)}${theme.fg("dim", click)}${theme.fg("muted", afterClick)}`;
}

type ResolvedClickAnchor = {
  action: "expand" | "detail" | "detail-extra";
  text: string;
  viewportAnchor: ToolViewportAnchor;
  exactTextSpan?: boolean;
};

function declareClickHint(
  tool: any,
  hint: string,
  behavior: "toggle" | "next-detail" | "toggle-max-detail",
  viewport: "top" | "bottom" = "top",
  exactTextSpan = false,
): string {
  if (!tool || typeof tool !== "object") return hint;
  if (!clickExpansionModule) return hint;
  return clickExpansionModule.declare(
    { kind: "tool-execution", execution: tool },
    hint,
    {
      behavior,
      viewport,
      ...(exactTextSpan ? { span: { text: stripAnsi(hint).trim() } } : {}),
    },
  );
}

export function resolveClickHints(
  text: string,
  tool: any,
  declareMarkers = false,
): { text: string; anchors: ResolvedClickAnchor[] } {
  let output = "";
  let cursor = 0;
  const anchors: ResolvedClickAnchor[] = [];
  while (cursor < text.length) {
    const open = text.indexOf(CLICK_HINT_OPEN, cursor);
    if (open < 0) {
      output += text.slice(cursor);
      break;
    }
    output += text.slice(cursor, open);
    const separator = text.indexOf(
      CLICK_HINT_SEPARATOR,
      open + CLICK_HINT_OPEN.length,
    );
    const close =
      separator < 0
        ? -1
        : text.indexOf(
            CLICK_HINT_CLOSE,
            separator + CLICK_HINT_SEPARATOR.length,
          );
    if (separator < 0 || close < 0) {
      output += text.slice(open);
      break;
    }
    const action = text.slice(
      open + CLICK_HINT_OPEN.length,
      separator,
    ) as EncodedClickHintAction;
    const fallback = text.slice(separator + CLICK_HINT_SEPARATOR.length, close);
    if (!toolClickExpansionActive(tool)) {
      output += fallback;
    } else if (action === "expand" || action === "collapse-final") {
      const finalCollapse = action === "collapse-final";
      const hint = finalCollapse
        ? finalCollapseHintText()
        : clickHintText("expand", tool);
      output += declareMarkers
        ? declareClickHint(
            tool,
            hint,
            "toggle",
            finalCollapse ? "bottom" : "top",
            finalCollapse,
          )
        : hint;
      anchors.push({
        action: "expand",
        text: stripAnsi(hint).trim(),
        viewportAnchor: finalCollapse ? "bottom" : "top",
        exactTextSpan: finalCollapse,
      });
    } else if (
      (action === "detail" || action === "detail-extra") &&
      (!extraToolOutputExpanded || tool?.[TOOL_CLICK_LOCAL_EXPANDED] === true)
    ) {
      const hint = clickHintText(action, tool);
      if (anchors.some((anchor) => anchor.action === "expand"))
        output += CLICK_CONTROL_BREAK_MARK;
      output += declareMarkers
        ? declareClickHint(
            tool,
            hint,
            action === "detail" ? "next-detail" : "toggle-max-detail",
          )
        : hint;
      anchors.push({
        action,
        text: stripAnsi(hint).trim(),
        viewportAnchor: "top",
      });
    }
    cursor = close + CLICK_HINT_CLOSE.length;
  }
  return { text: output, anchors };
}

export function clearToolRenderCache(value: unknown): void {
  if (!value || typeof value !== "object") return;
  delete (value as any)[TOOL_RENDER_CACHE];
  // If this tool lives inside a ToolGroupComponent, drop the group's memo so
  // settled headers/counts/child lines can't go stale after a child update.
  // Only the parent group is touched — we do NOT cascade invalidate siblings.
  const parent = (value as any)[COMPONENT_PARENT];
  if (clickRoutingHostPorts.grouping.isToolGroupComponent(parent))
    parent.invalidate();
}

export function unrefTimer(
  timer: ReturnType<typeof setTimeout> | null | undefined,
): void {
  (timer as any)?.unref?.();
}

export function safeInvalidate(
  ctx: any,
  pendingViewport?: ToolCollapseViewportSettlement,
): void {
  try {
    // The host and an extension can load ToolExecutionComponent through
    // different module contexts. In that case our prototype mutation hooks
    // do not clear the host component's outer rendered-line cache. Resolve
    // the stable owner attached to the reused ToolText and clear it here,
    // before ctx.invalidate() requests the next frame.
    clearToolRenderCache(
      clickRoutingHostPorts.toolExecution.findToolExecutionAncestor(
        ctx?.lastComponent,
      ),
    );
    if (typeof ctx?.invalidate === "function") ctx.invalidate();
  } catch {
    // Tool render contexts may outlive their row during reload/session switches.
  } finally {
    settleToolCollapseViewport(ctx?.state, pendingViewport);
  }
}
