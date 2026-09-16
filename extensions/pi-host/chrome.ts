import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPresentationThemeAdapter } from "../tool-presentation/index";

export const presentationThemeAdapter = createPresentationThemeAdapter();

export const OSC133_ZONE_START = "\x1b]133;A\x07";
export const OSC133_ZONE_END = "\x1b]133;B\x07";
export const OSC133_ZONE_FINAL = "\x1b]133;C\x07";
export const RESET = "\x1b[0m";
export const TRANSPARENT_BG = "\x1b[49m";
export const TRANSPARENT_RESET = `${RESET}${TRANSPARENT_BG}`;

// User/code box borders and thinking/thought text: branch color + OUTLINE_CHROME_BRIGHTEN.
// Branch ├└│ stay at `currentToolBranchAnsi` (see syncOutlineChromeFromBranch).
export let BORDER_COLOR = "\x1b[38;5;238m";
export let CODE_BLOCK_LANG_FG = "\x1b[38;2;95;95;95m";

export function setChromeColors(colors: {
  border?: string;
  codeBlockLanguage?: string;
}): void {
  if (colors.border !== undefined) BORDER_COLOR = colors.border;
  if (colors.codeBlockLanguage !== undefined)
    CODE_BLOCK_LANG_FG = colors.codeBlockLanguage;
}

const CHROME_ITALIC = "\x1b[3m";
/** Lift outline chrome above branch connectors so boxes and thought read brighter. */
export const OUTLINE_CHROME_BRIGHTEN = 64;
export const ANSI_RE = /\x1b\[[0-9;]*m/g;
export const ANSI_PRESENT_RE = /\x1b\[[0-9;]*m/;
export const PATCH_FLAG = Symbol.for(
  "pi-claude-style-tools:patched-container-render",
);
export const TOOL_RENDER_CACHE = Symbol.for(
  "pi-claude-style-tools:tool-render-cache",
);
export const COMPONENT_PARENT = Symbol.for(
  "pi-claude-style-tools:component-parent",
);
export const MCP_SPILL_PRESENTATION_CACHE = Symbol.for(
  "pi-claude-style-tools:mcp-spill-presentation-cache",
);
export const MAX_MCP_PRESENTATION_SPILL_BYTES = 1024 * 1024;
export const PARENT_TRACKING_PATCH_FLAG = Symbol.for(
  "pi-claude-style-tools:patched-parent-tracking",
);
export const TOOL_CACHE_PATCH_FLAG = Symbol.for(
  "pi-claude-style-tools:patched-tool-cache-invalidation",
);
export const TOOL_IMAGE_EXPAND_PATCH_FLAG = Symbol.for(
  "pi-claude-style-tools:patched-read-image-expansion",
);
export const CUSTOM_MESSAGE_PATCH_FLAG = Symbol.for(
  "pi-claude-style-tools:patched-custom-message-render",
);
export const USER_MESSAGE_PATCH_FLAG = Symbol.for(
  "pi-claude-style-tools:patched-user-message-render",
);
export const UI_NOTIFY_PATCH_FLAG = Symbol.for(
  "pi-claude-style-tools:patched-ui-notifications-v2",
);
export const BUILTIN_EXPANSION_PATCH_FLAG = Symbol.for(
  "pi-claude-style-tools:builtin-expansion-patch",
);
export const BUILTIN_EXPANSION_RENDER_PATCH_FLAG = Symbol.for(
  "pi-claude-style-tools:builtin-expansion-render-patch-v2",
);
export const BUILTIN_EXPANSION_RENDER_TRANSFORM = Symbol.for(
  "pi-claude-style-tools:builtin-expansion-render-transform",
);
export const BUILTIN_EXPANSION_STATE = Symbol.for(
  "pi-claude-style-tools:builtin-expansion-state",
);
export const TOOL_CLICK_RENDERED_FALLBACK = Symbol.for(
  "pi-claude-style-tools:tool-click-rendered-fallback",
);
export const TOOL_CLICK_OWNER = Symbol.for(
  "pi-claude-style-tools:tool-click-owner",
);
export const TOOL_CLICK_GLOBAL_EXPANDED = Symbol.for(
  "pi-claude-style-tools:tool-click-global-expanded",
);
export const TOOL_CLICK_LOCAL_EXPANDED = Symbol.for(
  "pi-claude-style-tools:tool-click-local-expanded",
);
export const TOOL_CLICK_DETAIL_LEVEL = Symbol.for(
  "pi-claude-style-tools:tool-click-detail-level",
);
export const CLICK_EXPANSION_ACTIVATION_HOST = Symbol.for(
  "pi-claude-style-tools:click-expansion-activation-host:v1",
);
const CLICK_EXPANSION_TARGET_ACTIVATE = Symbol.for(
  "pi-claude-style-tools:click-expansion-target-activate:v1",
);
export const CLICK_EXPANSION_ACTIVATE_TARGET = Symbol.for(
  "pi-claude-style-tools:click-expansion-activate-target:v1",
);
export const CLICK_EXPANSION_ROLLBACK_HOST = Symbol.for(
  "pi-claude-style-tools:click-expansion-rollback-host:v1",
);
export const TOOL_RENDER_BRIDGE_KEY = Symbol.for(
  "pi-claude-style-tools:tool-render-bridge",
);
const SETTINGS_CACHE_KEY = Symbol.for("pi-claude-style-tools:settings-cache");
export const CLICK_RUNTIME_KEY = Symbol.for(
  "pi-claude-style-tools:click-runtime",
);
export const ACTIVE_TOOL_GROUPS_KEY = Symbol.for(
  "pi-claude-style-tools:active-tool-groups",
);
export const CLICK_HINT_OPEN = "\uE100";
export const CLICK_HINT_SEPARATOR = "\uE101";
export const CLICK_HINT_CLOSE = "\uE102";
export const WRAP_MARK = "\u200B";
export const HEADER_WRAP_MARK = "\uE103";
export const CLICK_CONTROL_BREAK_MARK = "\uE104";
export const RESULT_SUMMARY_WRAP_MARK = "\uE105";
export const LEGACY_WRAP_MARK = "\uE000";
export const CLIP_MARK = "\uE001";
export const TRAILING_MARK = "\uE106";
export const KITTY_IMAGE_PREFIX = "\x1b_G";
export const ITERM2_IMAGE_PREFIX = "\x1b]1337;File=";

export type MarkdownTransformer = (
  markdown: string,
  context: {
    messageType: "assistant" | "assistant-thinking" | "user";
    isStreaming: boolean;
    availableWidth: number;
  },
) => string;

export let toolBackgroundMode: "default" | "transparent" | "outlines" =
  "outlines";

interface SettingsFile {
  toolBackground?: "default" | "transparent" | "outlines" | "border";
  readOutputMode?: "hidden" | "summary" | "preview";
  searchOutputMode?: "hidden" | "count" | "preview";
  mcpOutputMode?: "hidden" | "summary" | "preview";
  previewLines?: number;
  expandedPreviewMaxLines?: number;
  extraExpandedPreviewMaxLines?: number;
  extraToolOutputExpanded?: boolean;
  /** Enable local click expansion anchors in Fullscreen TUI mode. Defaults to false. */
  clickExpansion?: boolean;
  groupToolCalls?: boolean;
  bashOutputMode?: "opencode" | "summary" | "preview";
  bashCollapsedLines?: number;
  /** Verbatim script lines shown while bash is running or after failure. Defaults to 8. */
  bashCommandPreviewLines?: number;
  /** Show a small live output preview while tools are still running. Defaults to true. */
  liveToolPreview?: boolean;
  /** Number of live output lines to show while collapsed. Defaults to 5. */
  liveToolPreviewLines?: number;
  showTruncationHints?: boolean;
  diffCollapsedLines?: number;
  diffTheme?: string;
  diffColors?: Record<string, string>;
  /**
   * When true (default), derive borders, dim text, branch rules, and diff
   * accents from the active pi theme via `theme.getFgAnsi`/`getBgAnsi`.
   * Explicit `diffTheme` / `diffColors` always win over theme-derived
   * defaults so users keep full control.
   */
  themeAdaptive?: boolean;
  /**
   * Theme color key used for the spinner verb (e.g. "Cooking…"). Defaults
   * to "accent". Useful when the active theme's accent is overloaded for
   * borders, headings, or bash mode and the verb should pop differently.
   * Valid keys are any of the pi theme `ThemeColor` names (e.g. accent,
   * borderAccent, success, warning, mdHeading, thinkingMedium, bashMode).
   */
  spinnerVerbColor?: string;
  /**
   * Theme color key used for the spinner status suffix (the parenthesized
   * "(thinking · ↓ 10 tokens · 2s)" trailer). Defaults to "muted".
   */
  spinnerStatusColor?: string;
  /**
   * Thinking display mode. `live` (default): only the currently-streaming
   * thinking is expanded; finished thinking collapses to a one-line
   * `Thought for Xs` row (Ctrl+O still expands it). `full`: thinking always
   * renders expanded, like stock pi.
   */
  thinkingMode?: "live" | "full";
  /** Gray level 0–255 for ├ └ │ when branch color mode is `fixed`. */
  toolBranchRgbGray?: number;
  /** `fixed` (default): rgb gray 72, theme-independent. `theme`: dim → muted → borderMuted. */
  toolBranchColorMode?: "theme" | "fixed";
}

type SettingsCacheEntry = { value: SettingsFile; timestamp: number };
type SettingsCacheState = { entry: SettingsCacheEntry | null };
// Retained host patches must see command writes from a new /reload generation.
export const settingsCacheState = ((globalThis as any)[SETTINGS_CACHE_KEY] ??= {
  entry: null,
}) as SettingsCacheState;
const SETTINGS_CACHE_TTL_MS = 5_000;
let _piOutputPadCache: { value: 0 | 1; timestamp: number } | null = null;
const PI_OUTPUT_PAD_CACHE_TTL_MS = 250;

export function readPiOutputPad(): 0 | 1 {
  const now = Date.now();
  if (
    _piOutputPadCache &&
    now - _piOutputPadCache.timestamp < PI_OUTPUT_PAD_CACHE_TTL_MS
  ) {
    return _piOutputPadCache.value;
  }
  let value: 0 | 1 = 1;
  try {
    const agentDir =
      process.env.PI_CODING_AGENT_DIR ||
      resolve(process.env.HOME ?? "", ".pi", "agent");
    const raw = JSON.parse(
      readFileSync(resolve(agentDir, "settings.json"), "utf8"),
    );
    if (raw?.outputPad === 0) value = 0;
  } catch {
    // Keep Pi's default output padding when settings are absent or invalid.
  }
  _piOutputPadCache = { value, timestamp: now };
  return value;
}

export function syncToolOutputPad(component: any, outputPad: 0 | 1): void {
  const contentBox = component?.contentBox;
  if (
    !contentBox ||
    typeof contentBox !== "object" ||
    contentBox.paddingX === outputPad
  )
    return;
  contentBox.paddingX = outputPad;
  contentBox.invalidate?.();
  component[TOOL_RENDER_CACHE] = undefined;
}

export function readSettings(): SettingsFile {
  const now = Date.now();
  if (
    settingsCacheState.entry &&
    now - settingsCacheState.entry.timestamp < SETTINGS_CACHE_TTL_MS
  ) {
    return settingsCacheState.entry.value;
  }
  const cwdPath = `${process.cwd()}/.pi/settings.json`;
  const homePath = `${process.env.HOME ?? ""}/.pi/settings.json`;
  const merged: SettingsFile = {};
  for (const path of [cwdPath, homePath]) {
    try {
      if (!path || !existsSync(path)) continue;
      const raw = JSON.parse(readFileSync(path, "utf8"));
      if (raw && typeof raw === "object")
        Object.assign(merged, raw as SettingsFile);
    } catch {
      // ignore invalid settings files
    }
  }
  settingsCacheState.entry = { value: merged, timestamp: now };
  return merged;
}

// Cross-extension bust signal for spinner.ts — it watches this counter on
// globalThis and invalidates its settings cache when it changes. Lets
// /cc-spinner edits take effect on the next 250ms spinner tick instead of
// waiting for the file-stat TTL.
const SPINNER_BUST_KEY = Symbol.for(
  "pi-claude-style-tools:spinner-settings-bust",
);
export function bustSpinnerSettingsCache(): void {
  const current =
    ((globalThis as any)[SPINNER_BUST_KEY] as number | undefined) ?? 0;
  (globalThis as any)[SPINNER_BUST_KEY] = current + 1;
}

export function writeSettingsKey(key: string, value: unknown): void {
  settingsCacheState.entry = null; // invalidate every extension generation on write
  const home = process.env.HOME ?? "";
  if (!home) return;
  const dir = `${home}/.pi`;
  const path = `${dir}/settings.json`;
  let settings: Record<string, unknown> = {};
  try {
    if (existsSync(path))
      settings = JSON.parse(readFileSync(path, "utf8")) ?? {};
  } catch {
    /* start fresh */
  }
  if (value === undefined) {
    delete settings[key];
  } else {
    settings[key] = value;
  }
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(settings, null, 2) + "\n");
  } catch {
    /* best effort */
  }
}

export let toolBackgroundOverride:
  "default" | "transparent" | "outlines" | null = null;

export function setToolBackgroundOverride(
  mode: "default" | "transparent" | "outlines",
): void {
  toolBackgroundOverride = mode;
  toolBackgroundMode = mode;
}

export function syncToolBackgroundMode(): void {
  if (toolBackgroundOverride) {
    toolBackgroundMode = toolBackgroundOverride;
    return;
  }
  const settings = readSettings();
  // Backward compat: "border" was renamed to "outlines"
  const raw =
    settings.toolBackground === "border" ? "outlines" : settings.toolBackground;
  toolBackgroundMode = raw ?? "outlines";
}

function setThemeBg(theme: unknown, key: string, value: string): void {
  const themeAny = theme as any;
  if (themeAny.bgColors instanceof Map) {
    themeAny.bgColors.set(key, value);
  } else if (themeAny.bgColors && typeof themeAny.bgColors === "object") {
    themeAny.bgColors[key] = value;
  }
}

const PI_GLOBAL_THEME_KEY = Symbol.for("@earendil-works/pi-coding-agent:theme");

export function getGlobalPiTheme(): unknown {
  return (globalThis as any)[PI_GLOBAL_THEME_KEY];
}

/** Pi's ToolExecutionComponent reads `theme` from globalThis — keep it in sync with ctx.ui.theme. */
export function applyToolBackgroundMode(theme: unknown): void {
  syncToolBackgroundMode();
  const targets = new Set<unknown>();
  if (theme) targets.add(theme);
  const globalTheme = getGlobalPiTheme();
  if (globalTheme) targets.add(globalTheme);
  for (const t of targets) {
    setThemeBg(t, "userMessageBg", TRANSPARENT_BG);
    if (toolBackgroundMode === "default") continue;
    setThemeBg(t, "toolPendingBg", TRANSPARENT_BG);
    setThemeBg(t, "toolSuccessBg", TRANSPARENT_BG);
    setThemeBg(t, "toolErrorBg", TRANSPARENT_BG);
  }
}

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

function stripRenderedHeadingMarkers(line: string): string {
  return line.replace(
    /^((?:\x1b\[[0-9;]*m|[ \t])*)#{3,6}[ \t]*((?:\x1b\[[0-9;]*m)*)/,
    "$1$2",
  );
}

const PLAIN_FENCE_LANGS = new Set(["text", "txt", "plain", "plaintext", ""]);

function parseRenderedFenceLine(
  line: string,
): { kind: "open" | "close"; language: string } | undefined {
  const plain = stripAnsi(line).trim();
  if (plain === "```") return { kind: "close", language: "" };
  if (!plain.startsWith("```")) return undefined;
  const rest = plain.slice(3).trim();
  if (rest.includes("`")) return undefined;
  return { kind: "open", language: rest };
}

function formatCodeBlockLanguageLabel(language: string): string {
  const raw = language.trim();
  if (!raw) return "";
  return raw.toLowerCase();
}

function mutedDotFill(count: number): string {
  if (count <= 0) return "";
  return `${BORDER_COLOR}${"·".repeat(count)}${TRANSPARENT_RESET}`;
}

export function padRenderedLineToWidth(line: string, width: number): string {
  if (width <= 0) return "";
  const ceiling = Math.min(width, terminalColumnCeiling() || width);
  const gap = ceiling - visibleWidth(line);
  if (gap <= 0) return line;
  return line + " ".repeat(gap);
}

export function isCodeBoxChromeLine(line: string): boolean {
  const plain = stripAnsi(line).trim();
  if (!plain) return false;
  if (/^[╭╮╰╯│·\s]+$/.test(plain) && /[╭╮╰╯│]/.test(plain)) return true;
  if (/^╭/.test(plain) && /╮$/.test(plain)) return true;
  if (/^╰/.test(plain) && /╯$/.test(plain)) return true;
  return false;
}

function isUserMessageChromeLine(line: string): boolean {
  const plain = stripAnsi(line).trim();
  if (/^╭/.test(plain) && /╮$/.test(plain)) return true;
  if (/^╰/.test(plain) && /╯$/.test(plain)) return true;
  return false;
}

function isBorderedContentLine(line: string): boolean {
  const plain = stripAnsi(line).trim();
  return plain.startsWith("│") && plain.endsWith("│") && plain.length > 2;
}

function extractBorderedInnerForCopy(line: string): string {
  const plain = stripAnsi(line);
  const start = plain.indexOf("│");
  const end = plain.lastIndexOf("│");
  if (start === -1 || end <= start) return stripAnsi(line).trim();
  return plain
    .slice(start + 1, end)
    .replace(/^\s+/, "")
    .replace(/\s+$/, "");
}

export function applyTerminalCopyZones(lines: string[]): string[] {
  if (!Array.isArray(lines) || lines.length === 0) return lines;
  const out: string[] = [];
  let inZone = false;
  for (const line of lines) {
    if (isCopyExcludedChromeLine(line)) {
      if (inZone) {
        out[out.length - 1] += OSC133_ZONE_END;
        inZone = false;
      }
      out.push(line);
      continue;
    }
    const payload = copyPayloadForLine(line);
    if (!payload) {
      out.push(line);
      continue;
    }
    if (!inZone) {
      out.push(`${OSC133_ZONE_START}${line}`);
      inZone = true;
    } else {
      out.push(line);
    }
  }
  if (inZone && out.length > 0) {
    out[out.length - 1] += OSC133_ZONE_END + OSC133_ZONE_FINAL;
  }
  return out;
}

function isCopyExcludedChromeLine(line: string): boolean {
  return isCodeBoxChromeLine(line) || isUserMessageChromeLine(line);
}

function copyPayloadForLine(line: string): string | undefined {
  if (isCopyExcludedChromeLine(line)) return undefined;
  if (isBorderedContentLine(line)) return extractBorderedInnerForCopy(line);
  const plain = stripAnsi(line).trim();
  if (!plain) return undefined;
  return plain;
}

function roundedCodeBlockTop(width: number, language: string): string {
  if (width <= 1) return `${BORDER_COLOR}│${TRANSPARENT_RESET}`;
  const label = formatCodeBlockLanguageLabel(language);
  if (!label || width < 8) {
    const inner = Math.max(0, width - 2);
    return `${BORDER_COLOR}╭${TRANSPARENT_RESET}${mutedDotFill(inner)}${BORDER_COLOR}╮${TRANSPARENT_RESET}`;
  }
  const labelStyled = `${CODE_BLOCK_LANG_FG}${CHROME_ITALIC}${label}${RESET}${TRANSPARENT_RESET}`;
  const labelW = visibleWidth(labelStyled);
  const dotCount = Math.max(0, width - 6 - labelW);
  return `${BORDER_COLOR}╭· ${TRANSPARENT_RESET}${labelStyled} ${mutedDotFill(dotCount)}${BORDER_COLOR} ╮${TRANSPARENT_RESET}`;
}

function roundedCodeBlockBottom(width: number): string {
  if (width <= 1) return `${BORDER_COLOR}│${TRANSPARENT_RESET}`;
  const inner = Math.max(0, width - 2);
  return `${BORDER_COLOR}╰${TRANSPARENT_RESET}${mutedDotFill(inner)}${BORDER_COLOR}╯${TRANSPARENT_RESET}`;
}

function borderedCodeBlockLine(line: string, width: number): string {
  const innerWidth = Math.max(1, width - 4);
  let content = line;
  if (visibleWidth(content) > innerWidth) {
    content = truncateToWidth(content, innerWidth, "", false);
  }
  const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(content)));
  return `${BORDER_COLOR}│${TRANSPARENT_RESET} ${content}${padding} ${BORDER_COLOR}│${TRANSPARENT_RESET}`;
}

function boxRenderedCodeBlock(
  bodyLines: string[],
  language: string,
  width: number,
): string[] {
  const safeWidth = Math.max(4, Number.isFinite(width) ? Math.floor(width) : 0);
  const framed = [
    roundedCodeBlockTop(safeWidth, language),
    ...bodyLines.map((line) => borderedCodeBlockLine(line, safeWidth)),
    roundedCodeBlockBottom(safeWidth),
  ];
  return framed.map((line) => padRenderedLineToWidth(line, safeWidth));
}

export function sanitizeRenderedTextBlockLines(
  lines: string[],
  width?: number,
): string[] {
  const result: string[] = [];
  let i = 0;
  const canBox = typeof width === "number" && width > 0;
  while (i < lines.length) {
    const fence = parseRenderedFenceLine(lines[i]);
    if (fence?.kind === "open") {
      const language = fence.language;
      const hideBox = PLAIN_FENCE_LANGS.has(language.trim().toLowerCase());
      const body: string[] = [];
      i++;
      while (i < lines.length) {
        const close = parseRenderedFenceLine(lines[i]);
        if (close?.kind === "close") {
          i++;
          break;
        }
        body.push(lines[i]);
        i++;
      }
      if (hideBox) {
        result.push(...body);
      } else if (canBox && (body.length > 0 || language.trim())) {
        result.push(...boxRenderedCodeBlock(body, language, width));
      } else {
        result.push(...body);
      }
      continue;
    }
    if (fence?.kind === "close") {
      i++;
      continue;
    }
    result.push(stripRenderedHeadingMarkers(lines[i]).replace(/###/g, ""));
    i++;
  }
  return result;
}

export function isBlankLine(text: string): boolean {
  return stripAnsi(text).trim().length === 0;
}

export function borderLine(width: number): string {
  return `${BORDER_COLOR}${"─".repeat(Math.max(1, width))}${TRANSPARENT_RESET}`;
}

function terminalColumnCeiling(): number {
  const cols =
    typeof process !== "undefined" ? process.stdout?.columns : undefined;
  return Number.isFinite(cols) && (cols as number) > 0 ? (cols as number) : 0;
}

export function clampLineWidth(line: string, width: number): string {
  if (width <= 0) return "";
  // Hard ceiling: never emit a line wider than the real terminal. pi sometimes
  // hands renderers a width wider than stdout.columns (e.g. content later placed
  // in a narrower side panel), which trips pi's render width-assertion crash.
  // Clip only the overflow. The default truncate suffix is "...", which repeats
  // at the right edge of every patched row when Pi and stdout widths disagree.
  const ceiling = Math.min(width, terminalColumnCeiling() || width);
  if (ceiling <= 0) return "";
  return visibleWidth(line) > ceiling
    ? truncateToWidth(line, ceiling, "")
    : line;
}
