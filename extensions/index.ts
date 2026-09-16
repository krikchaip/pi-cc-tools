import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import type {
	ExtensionAPI,
	GrepToolDetails,
	Theme,
} from "@earendil-works/pi-coding-agent";
import {
	AssistantMessageComponent,
	BashExecutionComponent,
	BranchSummaryMessageComponent,
	CompactionSummaryMessageComponent,
	CustomMessageComponent,
	ToolExecutionComponent,
	UserMessageComponent,
	keyHint,
	keyText,
	rawKeyHint,
	SettingsManager,
	createBashTool,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
	createWriteTool,
} from "@earendil-works/pi-coding-agent";
import {
	Container,
	deleteAllKittyImages,
	getCapabilities,
	getImageDimensions,
	imageFallback,
	Markdown,
	ProcessTerminal,
	Spacer,
	Text,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

import {
	installClickExpansion,
	type ClickExpansionRuntime,
} from "./click-expansion/index";
import { createDiffPresentationModule, type DiffEvidence, type DiffTheme } from "./diff-presentation/index";
import {
	presentationKernel,
	type PresentationThemeSnapshot,
	type SemanticCallPresentation,
	type SemanticPresentation,
} from "./presentation-kernel/index";
import {
	CHROME_STYLE_DEFAULTS,
	DEFAULT_TOOL_BRANCH_GRAY,
	createPresentationThemeAdapter,
	createToolPresentationModule,
	type MutationToolName,
	type PresentationToolFamily,
	type RtkRewriteRecord,
	type ToolPresentationPolicy,
} from "./tool-presentation/index";
import {
	registerMouseHostAdapter,
	type MouseTarget,
} from "./click-expansion/mouse";
import {
	beginToolCollapseViewportTransaction,
	captureToolCollapseViewportRollback,
	claimToolCollapseViewportSettlement,
	findToolGroupLayoutBox,
	settleToolCollapseViewport,
	toolGroupBoxContains,
	type RequestedToolCollapseViewportAnchor,
	type ToolCollapseViewportSettlement,
	type ToolGroupFullscreenRenderer,
	type ToolGroupInteractiveMode,
	type ToolGroupLayoutBox,
} from "./click-expansion/viewport";

const presentationThemeAdapter = createPresentationThemeAdapter();

const RESET = "\x1b[0m";
const TRANSPARENT_BG = "\x1b[49m";
const TRANSPARENT_RESET = `${RESET}${TRANSPARENT_BG}`;

// User/code box borders and thinking/thought text: branch color + OUTLINE_CHROME_BRIGHTEN.
// Branch ├└│ stay at `currentToolBranchAnsi` (see syncOutlineChromeFromBranch).
let BORDER_COLOR = "\x1b[38;5;238m";
let CODE_BLOCK_LANG_FG = "\x1b[38;2;95;95;95m";
const CHROME_ITALIC = "\x1b[3m";
/** Lift outline chrome above branch connectors so boxes and thought read brighter. */
const OUTLINE_CHROME_BRIGHTEN = 64;
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const ANSI_PRESENT_RE = /\x1b\[[0-9;]*m/;
const PATCH_FLAG = Symbol.for("pi-claude-style-tools:patched-container-render");
const TOOL_RENDER_CACHE = Symbol.for("pi-claude-style-tools:tool-render-cache");
const COMPONENT_PARENT = Symbol.for("pi-claude-style-tools:component-parent");
const MCP_SPILL_PRESENTATION_CACHE = Symbol.for("pi-claude-style-tools:mcp-spill-presentation-cache");
const MAX_MCP_PRESENTATION_SPILL_BYTES = 1024 * 1024;
const PARENT_TRACKING_PATCH_FLAG = Symbol.for("pi-claude-style-tools:patched-parent-tracking");
const TOOL_CACHE_PATCH_FLAG = Symbol.for("pi-claude-style-tools:patched-tool-cache-invalidation");
const TOOL_IMAGE_EXPAND_PATCH_FLAG = Symbol.for("pi-claude-style-tools:patched-read-image-expansion");
const CUSTOM_MESSAGE_PATCH_FLAG = Symbol.for("pi-claude-style-tools:patched-custom-message-render");
const USER_MESSAGE_PATCH_FLAG = Symbol.for("pi-claude-style-tools:patched-user-message-render");
const UI_NOTIFY_PATCH_FLAG = Symbol.for("pi-claude-style-tools:patched-ui-notifications-v2");
const BUILTIN_EXPANSION_PATCH_FLAG = Symbol.for("pi-claude-style-tools:builtin-expansion-patch");
const BUILTIN_EXPANSION_RENDER_PATCH_FLAG = Symbol.for("pi-claude-style-tools:builtin-expansion-render-patch-v2");
const BUILTIN_EXPANSION_RENDER_TRANSFORM = Symbol.for("pi-claude-style-tools:builtin-expansion-render-transform");
const BUILTIN_EXPANSION_STATE = Symbol.for("pi-claude-style-tools:builtin-expansion-state");
const TOOL_CLICK_RENDERED_FALLBACK = Symbol.for("pi-claude-style-tools:tool-click-rendered-fallback");
const TOOL_CLICK_OWNER = Symbol.for("pi-claude-style-tools:tool-click-owner");
const TOOL_CLICK_GLOBAL_EXPANDED = Symbol.for("pi-claude-style-tools:tool-click-global-expanded");
const TOOL_CLICK_LOCAL_EXPANDED = Symbol.for("pi-claude-style-tools:tool-click-local-expanded");
const TOOL_CLICK_DETAIL_LEVEL = Symbol.for("pi-claude-style-tools:tool-click-detail-level");
const CLICK_EXPANSION_ACTIVATION_HOST = Symbol.for("pi-claude-style-tools:click-expansion-activation-host:v1");
const CLICK_EXPANSION_TARGET_ACTIVATE = Symbol.for("pi-claude-style-tools:click-expansion-target-activate:v1");
const CLICK_EXPANSION_ACTIVATE_TARGET = Symbol.for("pi-claude-style-tools:click-expansion-activate-target:v1");
const CLICK_EXPANSION_ROLLBACK_HOST = Symbol.for("pi-claude-style-tools:click-expansion-rollback-host:v1");
const TOOL_RENDER_BRIDGE_KEY = Symbol.for("pi-claude-style-tools:tool-render-bridge");
const SETTINGS_CACHE_KEY = Symbol.for("pi-claude-style-tools:settings-cache");
const CLICK_RUNTIME_KEY = Symbol.for("pi-claude-style-tools:click-runtime");
const ACTIVE_TOOL_GROUPS_KEY = Symbol.for("pi-claude-style-tools:active-tool-groups");
const CLICK_HINT_OPEN = "\uE100";
const CLICK_HINT_SEPARATOR = "\uE101";
const CLICK_HINT_CLOSE = "\uE102";
const WRAP_MARK = "\u200B";
const HEADER_WRAP_MARK = "\uE103";
const CLICK_CONTROL_BREAK_MARK = "\uE104";
const RESULT_SUMMARY_WRAP_MARK = "\uE105";
const LEGACY_WRAP_MARK = "\uE000";
const CLIP_MARK = "\uE001";
const TRAILING_MARK = "\uE106";
const KITTY_IMAGE_PREFIX = "\x1b_G";
const ITERM2_IMAGE_PREFIX = "\x1b]1337;File=";

type MarkdownTransformer = (
	markdown: string,
	context: {
		messageType: "assistant" | "assistant-thinking" | "user";
		isStreaming: boolean;
		availableWidth: number;
	},
) => string;

let toolBackgroundMode: "default" | "transparent" | "outlines" = "outlines";

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
const settingsCacheState = ((globalThis as any)[SETTINGS_CACHE_KEY] ??= { entry: null }) as SettingsCacheState;
const SETTINGS_CACHE_TTL_MS = 5_000;
let _piOutputPadCache: { value: 0 | 1; timestamp: number } | null = null;
const PI_OUTPUT_PAD_CACHE_TTL_MS = 250;

function readPiOutputPad(): 0 | 1 {
	const now = Date.now();
	if (_piOutputPadCache && now - _piOutputPadCache.timestamp < PI_OUTPUT_PAD_CACHE_TTL_MS) {
		return _piOutputPadCache.value;
	}
	let value: 0 | 1 = 1;
	try {
		const agentDir = process.env.PI_CODING_AGENT_DIR || resolve(process.env.HOME ?? "", ".pi", "agent");
		const raw = JSON.parse(readFileSync(resolve(agentDir, "settings.json"), "utf8"));
		if (raw?.outputPad === 0) value = 0;
	} catch {
		// Keep Pi's default output padding when settings are absent or invalid.
	}
	_piOutputPadCache = { value, timestamp: now };
	return value;
}

function syncToolOutputPad(component: any, outputPad: 0 | 1): void {
	const contentBox = component?.contentBox;
	if (!contentBox || typeof contentBox !== "object" || contentBox.paddingX === outputPad) return;
	contentBox.paddingX = outputPad;
	contentBox.invalidate?.();
	component[TOOL_RENDER_CACHE] = undefined;
}

function readSettings(): SettingsFile {
	const now = Date.now();
	if (settingsCacheState.entry && now - settingsCacheState.entry.timestamp < SETTINGS_CACHE_TTL_MS) {
		return settingsCacheState.entry.value;
	}
	const cwdPath = `${process.cwd()}/.pi/settings.json`;
	const homePath = `${process.env.HOME ?? ""}/.pi/settings.json`;
	const merged: SettingsFile = {};
	for (const path of [cwdPath, homePath]) {
		try {
			if (!path || !existsSync(path)) continue;
			const raw = JSON.parse(readFileSync(path, "utf8"));
			if (raw && typeof raw === "object") Object.assign(merged, raw as SettingsFile);
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
const SPINNER_BUST_KEY = Symbol.for("pi-claude-style-tools:spinner-settings-bust");
function bustSpinnerSettingsCache(): void {
	const current = ((globalThis as any)[SPINNER_BUST_KEY] as number | undefined) ?? 0;
	(globalThis as any)[SPINNER_BUST_KEY] = current + 1;
}

function writeSettingsKey(key: string, value: unknown): void {
	settingsCacheState.entry = null; // invalidate every extension generation on write
	const home = process.env.HOME ?? "";
	if (!home) return;
	const dir = `${home}/.pi`;
	const path = `${dir}/settings.json`;
	let settings: Record<string, unknown> = {};
	try {
		if (existsSync(path)) settings = JSON.parse(readFileSync(path, "utf8")) ?? {};
	} catch { /* start fresh */ }
	if (value === undefined) {
		delete settings[key];
	} else {
		settings[key] = value;
	}
	try {
		mkdirSync(dir, { recursive: true });
		writeFileSync(path, JSON.stringify(settings, null, 2) + "\n");
	} catch { /* best effort */ }
}

let toolBackgroundOverride: "default" | "transparent" | "outlines" | null = null;

function syncToolBackgroundMode(): void {
	if (toolBackgroundOverride) {
		toolBackgroundMode = toolBackgroundOverride;
		return;
	}
	const settings = readSettings();
	// Backward compat: "border" was renamed to "outlines"
	const raw = settings.toolBackground === "border" ? "outlines" : settings.toolBackground;
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

function getGlobalPiTheme(): unknown {
	return (globalThis as any)[PI_GLOBAL_THEME_KEY];
}

/** Pi's ToolExecutionComponent reads `theme` from globalThis — keep it in sync with ctx.ui.theme. */
function applyToolBackgroundMode(theme: unknown): void {
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

function stripAnsi(text: string): string {
	return text.replace(ANSI_RE, "");
}

function stripRenderedHeadingMarkers(line: string): string {
	return line.replace(/^((?:\x1b\[[0-9;]*m|[ \t])*)#{3,6}[ \t]*((?:\x1b\[[0-9;]*m)*)/, "$1$2");
}

const PLAIN_FENCE_LANGS = new Set(["text", "txt", "plain", "plaintext", ""]);

function parseRenderedFenceLine(line: string): { kind: "open" | "close"; language: string } | undefined {
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

function padRenderedLineToWidth(line: string, width: number): string {
	if (width <= 0) return "";
	const ceiling = Math.min(width, terminalColumnCeiling() || width);
	const gap = ceiling - visibleWidth(line);
	if (gap <= 0) return line;
	return line + " ".repeat(gap);
}

function isCodeBoxChromeLine(line: string): boolean {
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
	return plain.slice(start + 1, end).replace(/^\s+/, "").replace(/\s+$/, "");
}

function applyTerminalCopyZones(lines: string[]): string[] {
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

function boxRenderedCodeBlock(bodyLines: string[], language: string, width: number): string[] {
	const safeWidth = Math.max(4, Number.isFinite(width) ? Math.floor(width) : 0);
	const framed = [
		roundedCodeBlockTop(safeWidth, language),
		...bodyLines.map((line) => borderedCodeBlockLine(line, safeWidth)),
		roundedCodeBlockBottom(safeWidth),
	];
	return framed.map((line) => padRenderedLineToWidth(line, safeWidth));
}

function sanitizeRenderedTextBlockLines(lines: string[], width?: number): string[] {
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

function isBlankLine(text: string): boolean {
	return stripAnsi(text).trim().length === 0;
}

function borderLine(width: number): string {
	return `${BORDER_COLOR}${"─".repeat(Math.max(1, width))}${TRANSPARENT_RESET}`;
}

function terminalColumnCeiling(): number {
	const cols = typeof process !== "undefined" ? process.stdout?.columns : undefined;
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
	return visibleWidth(line) > ceiling ? truncateToWidth(line, ceiling, "") : line;
}

function isToolExecutionLike(value: unknown): value is { toolName: string; toolCallId: string } {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Record<string, unknown>;
	return typeof candidate.toolName === "string" && typeof candidate.toolCallId === "string";
}

const AGENT_FAMILY_TOOL_NAMES = new Set(["Agent", "Agents", "get_subagent_result", "steer_subagent"]);

function isAgentFamilyToolName(name: unknown): boolean {
	return typeof name === "string" && AGENT_FAMILY_TOOL_NAMES.has(name);
}

function isTerminalImageLine(line: string): boolean {
	return line.includes(KITTY_IMAGE_PREFIX) || line.includes(ITERM2_IMAGE_PREFIX);
}

function normalizeLeadingCheckGlyph(line: string): string {
	return line.replace(/^((?:\x1b\[[0-9;]*m|[ \t]|[├└│─])*)[✓✔]((?:\x1b\[[0-9;]*m)*)(?=\s)/, "$1●$2");
}

function stripOuterBackgroundAnsi(line: string): string {
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

function splitRenderedImageBlock(lines: string[]): { textLines: string[]; imageLines: string[] } {
	const imageStart = firstImageBlockStart(lines);
	if (imageStart === -1) return { textLines: lines, imageLines: [] };
	const textLines = lines.slice(0, imageStart);
	while (textLines.length > 0 && isBlankLine(textLines[textLines.length - 1])) textLines.pop();
	return { textLines, imageLines: lines.slice(imageStart) };
}

function toolGroupingEnabled(): boolean {
	return readSettings().groupToolCalls !== false;
}

function setToolGroupingEnabled(enabled: boolean): void {
	writeSettingsKey("groupToolCalls", enabled);
}

type ThinkingMode = "live" | "full";

function getThinkingMode(): ThinkingMode {
	return getMode(readSettings().thinkingMode, ["live", "full"] as const, "live");
}

function isAssistantThinkingComplete(comp: any, message: any): boolean {
	if (!message || message.role !== "assistant") return false;
	if (typeof message[THINKING_DURATION_KEY] === "number") return true;
	if (message[THINKING_ACTIVE_KEY]) return false;
	// Providers keep stopReason "pending" for the whole stream ("deferred" while
	// a deferred call is unresolved); both are in-flight sentinels, never
	// completion signals. Without this, live-thinking detection would depend on
	// THINKING_ACTIVE_KEY being stamped before the UI renders the same event.
	if (message.stopReason === "pending" || message.stopReason === "deferred") return false;
	if (typeof message.stopReason === "string" && message.stopReason.length > 0) return true;
	if (Array.isArray(message.content)) {
		let sawThinking = false;
		for (const block of message.content) {
			if (block?.type === "thinking" && typeof block.thinking === "string" && block.thinking.trim()) {
				sawThinking = true;
			} else if (sawThinking && (
				(block?.type === "text" && typeof block.text === "string" && block.text.trim()) ||
				block?.type === "toolCall"
			)) {
				return true;
			}
		}
		if (sawThinking) return false;
	}
	return true;
}

function isLiveThinkingMessage(comp: any, message: any): boolean {
	if (!message || message.role !== "assistant") return false;
	if (isAssistantThinkingComplete(comp, message)) return false;
	if ((message as any)[THINKING_ACTIVE_KEY]) return true;
	if (Array.isArray(message.content)) {
		return message.content.some((b: any) => b?.type === "thinking" && typeof b?.thinking === "string" && b.thinking.trim());
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
	if (tool?.isPartial === true && tool?.executionStarted === true && currentAgentWorkStartMs !== undefined) {
		return "pending";
	}
	return "success";
}

let TOOL_STATUS_SUCCESS = "\x1b[32m";
let TOOL_STATUS_ERROR = "\x1b[31m";
let TOOL_STATUS_PENDING = "\x1b[90m";

function statusText(status: ToolStatus, count: number): string {
	const label = status === "success" ? "done" : status === "error" ? "failed" : "running";
	const color = status === "success" ? TOOL_STATUS_SUCCESS : status === "error" ? TOOL_STATUS_ERROR : TOOL_STATUS_PENDING;
	return `${color}${count}${TRANSPARENT_RESET} ${label}`;
}

function countToolStatuses(tools: any[]): Record<ToolStatus, number> {
	return tools.reduce((counts, tool) => {
		counts[getToolStatusForGroup(tool)]++;
		return counts;
	}, { pending: 0, success: 0, error: 0 } as Record<ToolStatus, number>);
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
	return typeof tool?.toolName === "string" && tool.toolName ? tool.toolName : "tool";
}

function getGroupedToolName(tools: any[]): string | undefined {
	const first = getToolName(tools[0]);
	return tools.every((tool) => getToolName(tool) === first) ? first : undefined;
}

function getToolGroupLabel(tools: any[]): string {
	const sameName = getGroupedToolName(tools);
	return sameName ? humanizeToolName(sameName) : "Multiple Tools";
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
const AGENT_BREATHE_LEN = AGENT_BREATHE_GLYPHS.length;

function paintStatusDot(colorAnsi: string): string {
	return `${colorAnsi}${STATUS_DOT_BOLD}${STATUS_DOT_FILLED}${TRANSPARENT_RESET}`;
}

function themeStatusDot(theme: Theme, colorKey: "success" | "error" | "dim" | "muted"): string {
	// theme.fg may not preserve nested SGR cleanly — color the glyph string itself.
	return theme.fg(colorKey, `${STATUS_DOT_BOLD}${STATUS_DOT_FILLED}`);
}

function agentBreatheGlyphRaw(): string {
	// Always exactly one display cell — matches ordinary tool dots, keeps titles aligned.
	return AGENT_BREATHE_GLYPHS[_globalBlinkPhaseIndex % AGENT_BREATHE_LEN];
}

function paintAgentBreatheDot(colorAnsi: string = TOOL_STATUS_SUCCESS): string {
	const glyph = agentBreatheGlyphRaw();
	if (glyph === " ") return " ";
	// Bold only on the largest frame so weight changes without shifting the cell.
	const bold = glyph === "●" ? STATUS_DOT_BOLD : "";
	return `${colorAnsi}${bold}${glyph}${TRANSPARENT_RESET}`;
}

function agentBreatheDot(theme: Theme): string {
	const glyph = agentBreatheGlyphRaw();
	if (glyph === " ") return " ";
	const bold = glyph === "●" ? STATUS_DOT_BOLD : "";
	return theme.fg("success", `${bold}${glyph}`);
}

function groupStatusLight(status: ToolStatus, options?: { agentBreathe?: boolean }): string {
	const color = status === "success" ? TOOL_STATUS_SUCCESS : status === "error" ? TOOL_STATUS_ERROR : TOOL_STATUS_PENDING;
	if (status === "pending") {
		// Prefer the shared blink phase over wall-clock so group lights stay in sync
		// with the global timer (and Agent breathe). Space keeps column alignment.
		if (options?.agentBreathe) return paintAgentBreatheDot(TOOL_STATUS_SUCCESS);
		return _globalBlinkPhase ? paintStatusDot(TOOL_STATUS_SUCCESS) : " ";
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
		.map(([name, count]) => `${humanizeToolName(name)}${count > 1 ? `×${count}` : ""}`)
		.join(", ");
}

function getRepeatedToolSubject(tools: any[], groupedName: string | undefined): string {
	if (!groupedName || tools.length === 0) return "";
	if (groupedName === "read") {
		const paths = tools.map((tool) => String(tool?.args?.path ?? ""));
		if (paths[0] && paths.every((path) => path === paths[0])) {
			return shortPath(process.cwd(), paths[0]);
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

function stripGroupedToolLabel(line: string, label: string | undefined): string {
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
	let content = trimRenderedBlankLines(lines);
	if (content.length > 0 && isOuterToolRule(content[0])) content = content.slice(1);
	if (content.length > 0 && isOuterToolRule(content[content.length - 1])) content = content.slice(0, -1);
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
				firstContent
				&& !"│├└".includes(firstContent)
				&& leadingWidth >= closedBranch.contentColumn
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
	return trimAnsiLeft(stripGroupedToolLabel(trimAnsiLeft(stripLeadingToolStatus(line)), groupedLabel));
}

function tintGroupedToolLine(line: string, _groupedLabel?: string): string {
	return trimAnsiLeft(line);
}

function bashCallMetadata(args: unknown, elapsedMs?: number) {
	const decision = toolPresentationModule.present({
		surface: "call",
		tool: { family: "tool-native", name: "bash", label: "Bash" },
		cwd: process.cwd(),
		args,
		lifecycle: { status: "idle", partial: false, argsComplete: true, ...(typeof elapsedMs === "number" ? { elapsedMs } : {}) },
	});
	return decision.kind === "present" ? decision.metadata?.bash : undefined;
}

function bashResultMetadata(result: any, args: unknown = {}) {
	const decision = toolPresentationModule.present({
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
		let value = shortPath(process.cwd(), args.path ?? "");
		const parts: string[] = [];
		if (args.offset) parts.push(`offset=${args.offset}`);
		if (args.limit) parts.push(`limit=${args.limit}`);
		if (parts.length > 0) value += ` (${parts.join(", ")})`;
		return value;
	}
	if (name === "bash") return bashCallMetadata(args)?.command.headline ?? "command";
	if (name === "grep") return `"${summarizeText(args.pattern ?? "", 40)}"${args.path ? ` in ${args.path}` : ""}`;
	if (name === "find") return `"${summarizeText(args.pattern ?? "", 40)}"${args.path ? ` in ${args.path}` : ""}`;
	if (name === "ls") return shortPath(process.cwd(), args.path ?? ".");
	return summarizeText(getStringArg(args, "path", "file_path", "url", "query", "name", "subject", "tool", "description", "prompt") || name, 72);
}

function getToolCallLine(tool: any, width?: number): string {
	const callComponent = tool?.callRendererComponent;
	if (
		typeof width === "number"
		&& isToolTextComponent(callComponent)
		&& typeof callComponent.getPresentationSurface === "function"
		&& callComponent.getPresentationSurface() === "call"
	) {
		const line = callComponent.render(width).find((row) => stripAnsi(row).trim());
		if (line) return line;
	}
	const value = callComponent?.value;
	if (typeof value === "string" && value.trim()) {
		const line = value.split("\n").find((row: string) => stripAnsi(row).trim()) ?? value;
		return stripWrapMarks(line).replaceAll(CLIP_MARK, "");
	}
	const summary = getToolArgSummary(tool);
	const label = humanizeToolName(getToolName(tool));
	return `${label}${summary ? ` ${summary}` : ""}`;
}

function alignTrailingMarkedLine(line: string, width: number): string {
	const markerIndex = line.indexOf(TRAILING_MARK);
	if (markerIndex === -1) return clampLineWidth(line, width);
	const safeWidth = Math.max(1, width);
	const left = stripWrapMarks(line.slice(0, markerIndex));
	const right = stripWrapMarks(line.slice(markerIndex + TRAILING_MARK.length));
	const rightWidth = visibleWidth(right);
	if (rightWidth >= safeWidth) return truncateToWidth(right, safeWidth, "", false);
	const leftBudget = Math.max(0, safeWidth - rightWidth);
	const clippedLeft = leftBudget > 0 ? truncateToWidth(left, leftBudget, "…", false) : "";
	return `${clippedLeft}${right}`;
}

function getCompactToolLine(tool: any, width: number, groupedLabel?: string, showTrailing = true): string {
	const callComponent = tool?.callRendererComponent;
	const preserveKernelCallLabel = isToolTextComponent(callComponent)
		&& typeof callComponent.getPresentationSurface === "function"
		&& callComponent.getPresentationSurface() === "call";
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

function getCollapsedToolEntryLine(entry: CollapsedToolEntry, width: number, groupedLabel?: string): string {
	if (entry.tools.length === 1) return getCompactToolLine(entry.tools[0], width, groupedLabel);
	const counts = countToolStatuses(entry.tools);
	const attentionCounts = counts.pending > 0 || counts.error > 0
		? ` • ${formatToolGroupCounts(entry.tools)}`
		: "";
	const suffix = ` ${FG_DIM}×${entry.tools.length}${TRANSPARENT_RESET}${attentionCounts}`;
	const firstLine = getCompactToolLine(entry.tools[0], Math.max(1, width - visibleWidth(suffix)), groupedLabel, false);
	const sharedLine = entry.name === "read" ? stripReadRangeFromToolLine(firstLine) : firstLine;
	return clampLineWidth(`${sharedLine}${suffix}`, width);
}

function getCollapsedToolEntryLines(entry: CollapsedToolEntry, width: number, groupedLabel?: string): string[] {
	const lines = [getCollapsedToolEntryLine(entry, width, groupedLabel)];
	if (entry.name !== "bash") return lines;
	const running = [...entry.tools].reverse().find((tool) => getToolStatusForGroup(tool) === "pending");
	const latestOutput = running ? bashResultMetadata(running.result, running.args)?.lastOutputLine : undefined;
	if (latestOutput) lines.push(`${FG_DIM}${latestOutput}${TRANSPARENT_RESET}`);
	return lines;
}

function getExpandedToolGroupLines(tool: any, width: number, groupedLabel?: string): string[] {
	const rendered = stripToolChrome(tool.render(Math.max(1, width)));
	const jsonTreeRootIndex = rendered.findIndex((line, lineIndex) => (
		lineIndex > 0 && /^[├└]\s+Responded\s+\[(?:object|array)\]\s+\(/.test(stripAnsi(line).trimStart())
	));
	const closedContinuationTrims = closedBranchContinuationTrims(rendered);
	const lines = rendered.map((line, lineIndex) => {
		if (jsonTreeRootIndex >= 0 && lineIndex >= jsonTreeRootIndex) return line;
		const closedContinuationTrim = closedContinuationTrims.get(lineIndex);
		if (closedContinuationTrim !== undefined) return trimAnsiLeftColumns(line, closedContinuationTrim);
		if (lineIndex === 0) return tintGroupedToolLine(removeGroupedToolPrefix(line, groupedLabel), groupedLabel);
		return tintGroupedToolLine(line, groupedLabel);
	});
	return lines.length > 0 ? lines : [`${FG_DIM}${String(tool?.toolName ?? "tool")}${TRANSPARENT_RESET}`];
}

function branchPrefix(index: number, total: number, theme?: Theme): string {
	// Bare tee/corner only — no horizontal ─ arm.
	const branch = index === total - 1 ? "└" : "├";
	const rule = currentToolBranchAnsi(theme);
	return ` ${rule}${branch}${TRANSPARENT_RESET} `;
}

function branchContinuation(index: number, total: number, theme?: Theme): string {
	const rule = currentToolBranchAnsi(theme);
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
	const jsonTreeRootIndex = safeContent.findIndex((line, lineIndex) => (
		lineIndex > 0 && /^[├└]\s+Responded\s+\[(?:object|array)\]\s+\(/.test(stripAnsi(line).trimStart())
	));
	const jsonTreeBaseIndent = jsonTreeRootIndex >= 0
		? (stripAnsi(safeContent[jsonTreeRootIndex] ?? "").match(/^[ \t]*/)?.[0].length ?? 0)
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
		const isJsonTreeLine = jsonTreeRootIndex >= 0 && lineIndex >= jsonTreeRootIndex;
		const closedContinuationTrim = closedContinuationTrims.get(lineIndex);
		const body = lineIndex === 0
			? removeGroupedToolPrefix(line)
			: isJsonTreeLine
				? trimAnsiLeftColumns(line, jsonTreeBaseIndent)
				: closedContinuationTrim !== undefined
					? trimAnsiLeftColumns(line, closedContinuationTrim)
					: trimAnsiLeft(line);
		const prefix = lineIndex === 0
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
const ACTIVE_TOOL_GROUPS = ((globalThis as any)[ACTIVE_TOOL_GROUPS_KEY] ??= new Set<any>()) as Set<any>;

function isToolExecutionComponent(value: unknown): value is InstanceType<typeof ToolExecutionComponent> {
	// jiti can load the host and extensions through separate module contexts.
	// Constructor names stay stable when instanceof identities do not.
	return value instanceof ToolExecutionComponent
		|| (value as any)?.constructor?.name === "ToolExecutionComponent";
}

function isGroupableTool(value: unknown): value is InstanceType<typeof ToolExecutionComponent> {
	return isToolExecutionComponent(value) && !NON_GROUPABLE_TOOL_NAMES.has(getToolName(value));
}

type PublishedToolClickAnchor = {
	line: number;
	start: number;
	end: number;
	tool: any;
	action: ToolClickAction;
	viewportAnchor: ToolViewportAnchor;
};

type ToolClickDetailLevel = 0 | 1 | 2;

function requestedToolClickViewportAnchor(
	tool: any,
	action: ToolClickAction,
	viewportAnchor: ToolViewportAnchor,
): RequestedToolCollapseViewportAnchor {
	return action === "expand"
		&& tool?.expanded === true
		&& isSideQuestBinaryTool(tool)
		? "adaptive"
		: viewportAnchor;
}

function toolGroupClickGuidance(): string {
	const theme = getGlobalPiTheme() as Theme | undefined;
	if (!theme || typeof theme.fg !== "function") return " • click any for details";
	return `${theme.fg("muted", " • ")}${theme.fg("dim", "click")}${theme.fg("muted", " any for details")}`;
}

class ToolGroupComponent extends Container {
	private tools: any[] = [];
	private expanded = false;
	declare clickAnchorAtPoint: (x: number, y: number) => PublishedToolClickAnchor | undefined;
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

	private statusSnapshot(): { key: string; pending: number; success: number; error: number } {
		// Status counts + per-tool identity/expanded/partial bits detect membership
		// and completion changes without walking full child render output. Child
		// content changes still reach us via clearToolRenderCache → invalidate().
		const counts = countToolStatuses(this.tools);
		let idBits = "";
		for (let i = 0; i < this.tools.length; i++) {
			const tool = this.tools[i];
			const id = typeof tool?.toolCallId === "string" ? tool.toolCallId : getToolName(tool);
			const flags = (tool?.isPartial === true ? 1 : 0)
				| (tool?.result?.isError ? 2 : 0)
				| (tool?.expanded ? 4 : 0)
				| (tool?.argsComplete ? 8 : 0)
				| (tool?.executionStarted ? 16 : 0);
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
		return !this.expanded && this.tools.some((tool) => (
			toolClickExpansionActive(tool) && toolHasEffectiveClickAction(tool)
		));
	}

	render(width: number): string[] {
		if (this.tools.length === 0) return [];
		const safeWidth = Number.isFinite(width) ? Math.max(1, Math.floor(width)) : 1;
		const clickState = `${clickRuntime.visualEpoch}:${this.clickAnchorsEnabled() ? 1 : 0}`;
		// Fast path: settled groups with a valid memo skip ALL child walks.
		// Child mutations mark dirty via clearToolRenderCache → invalidate().
		if (
			!this.dirty
			&& this.cachedLines
			&& this.cachedWidth === safeWidth
			&& this.cachedEpoch === _toolBranchVisualEpoch
			&& this.cachedMode === toolBackgroundMode
			&& this.cachedExpanded === this.expanded
			&& this.cachedClickState === clickState
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
		const overall: ToolStatus = status.error > 0 ? "error" : status.pending > 0 ? "pending" : "success";
		// Group header breathes only when every pending member is Agent-family;
		// mixed groups keep the ordinary on/off light.
		const pendingTools = this.tools.filter((tool) => getToolStatusForGroup(tool) === "pending");
		const headerBreathe = pendingTools.length > 0 && pendingTools.every((tool) => isAgentFamilyToolName(getToolName(tool)));
		const light = groupStatusLight(overall, { agentBreathe: headerBreathe });
		const summaryLabel = `${label}:`;
		const countParts: string[] = [];
		if (status.pending) countParts.push(statusText("pending", status.pending));
		if (status.success) countParts.push(statusText("success", status.success));
		if (status.error) countParts.push(statusText("error", status.error));
		const countsText = countParts.join(`${TRANSPARENT_RESET} • `);
		const clicksEnabled = this.clickAnchorsEnabled();
		const resultlessHistoricalAgents = this.tools.every((tool) => (
			getToolName(tool).toLowerCase() === "agent"
			&& tool?.isPartial === true
			&& tool?.executionStarted !== true
			&& tool?.result === undefined
		));
		const detailHint = clicksEnabled
			? toolGroupClickGuidance()
			: resultlessHistoricalAgents
				? ""
				: baselineToolOutputDetailHint(undefined, this.expanded, true);
		const summary = ` ${light} ${summaryLabel} ${countsText}${names ? ` ${TRANSPARENT_RESET}• ${names}` : ""}${detailHint}`;
		const lines = [" ".repeat(safeWidth), clampLineWidth(summary, safeWidth)];
		const childWidth = Math.max(1, safeWidth - 6);
		const total = this.tools.length;

		for (let index = 0; index < total; index++) {
			const tool = this.tools[index];
			const childExpanded = this.expanded || Boolean(tool.expanded);
			const rawLines = childExpanded
				? getExpandedToolGroupLines(tool, childWidth, groupedName ? label : undefined)
				: [getCompactToolLine(tool, childWidth, groupedName ? label : undefined)];
			const branched = formatBranchedToolLines(
				rawLines,
				index,
				total,
				safeWidth,
				getToolStatusForGroup(tool),
				{ agentBreathe: isAgentFamilyToolName(getToolName(tool)) },
			);
			if (
				clicksEnabled
				&& toolClickExpansionActive(tool)
				&& toolHasEffectiveClickAction(tool)
				&& branched.length > 0
			) {
				const callRows = isToolTextComponent(tool.callRendererComponent)
					? tool.callRendererComponent.getSemanticRows().filter((row: ToolTextSemanticRow) => row.action === "header").length
					: isKnownSideQuestAgentTool(tool)
						? tool.callRendererComponent?.render?.(childWidth)?.length ?? 0
						: 0;
				const headerRows = childExpanded
					? isKnownSideQuestAgentTool(tool) ? 1 : Math.max(1, callRows)
					: branched.length;
				for (let row = 0; row < Math.min(headerRows, branched.length); row++) {
					const start = isSideQuestBinaryTool(tool) ? 0 : clickAnchorStart(branched[row]);
					const end = isSideQuestBinaryTool(tool) ? safeWidth : visibleWidth(stripAnsi(branched[row]).trimEnd());
					if (end > start) {
						if (clickExpansionModule) {
							branched[row] = clickExpansionModule.declare(
								{ kind: "tool-execution", execution: tool },
								branched[row],
								{
									behavior: "toggle",
									compatibilityAction: "header",
									...(isSideQuestBinaryTool(tool)
										? { span: { text: stripAnsi(branched[row]) } }
										: {}),
								} as InternalClickExpansionDeclaration,
							);
						}
					}
				}
				if (childExpanded && isKnownSideQuestAgentTool(tool)) {
					const presentation = sideQuestAgentPresentation(tool);
					const label = presentation ? `${sideQuestAgentResultLabel(presentation)} [` : "";
					const row = label
						? branched.findIndex((line, lineIndex) => lineIndex >= headerRows && stripAnsi(line).includes(label))
						: -1;
					if (row >= 0) {
						const start = clickAnchorStart(branched[row]);
						const end = visibleWidth(stripAnsi(branched[row]).trimEnd());
						if (end > start) {
							if (clickExpansionModule) {
								branched[row] = clickExpansionModule.declare(
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
				if (childExpanded && isToolTextComponent(tool.resultRendererComponent)) {
					for (const semantic of tool.resultRendererComponent.getSemanticRows()) {
						if (semantic.action === "header") continue;
						const needle = semantic.anchorText ?? stripAnsi(semantic.text).trim();
						if (!needle) continue;
						// Group formatting removes nested status bullets. Use the visible click phrase
						// as a matching fallback, but keep the full semantic row as the action area.
						const clickPhrase = /click (?:to (?:expand|collapse)|for (?:more|less) detail)/.exec(needle)?.[0];
						const row = branched.findIndex((line, lineIndex) => {
							if (lineIndex < headerRows) return false;
							const plain = stripAnsi(line);
							return plain.includes(needle) || (clickPhrase !== undefined && plain.includes(clickPhrase));
						});
						if (row < 0) continue;
						const plain = stripAnsi(branched[row]);
						const targetIndex = semantic.anchorText ? plain.indexOf(semantic.anchorText) : -1;
						const start = targetIndex >= 0 ? visibleWidth(plain.slice(0, targetIndex)) : clickAnchorStart(branched[row]);
						const end = targetIndex >= 0 ? start + visibleWidth(semantic.anchorText!) : visibleWidth(plain.trimEnd());
						if (end > start) {
							if (clickExpansionModule) {
								const behavior = semantic.action === "detail"
									? "next-detail"
									: semantic.action === "detail-extra" ? "toggle-max-detail" : "toggle";
								const viewport = semantic.action === "expand"
									&& tool?.expanded === true
									&& isSideQuestBinaryTool(tool)
									? "adaptive"
									: semantic.viewportAnchor;
								branched[row] = clickExpansionModule.declare(
									{ kind: "tool-execution", execution: tool },
									branched[row],
									{
										behavior,
										viewport,
										compatibilityAction: semantic.action,
										...(targetIndex >= 0 ? { span: { text: semantic.anchorText! } } : {}),
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
		const output = clickExpansionModule ? [...clickExpansionModule.publish(this, lines)] : lines;
		// Final clamp already applied per-line above; avoid a second full pass.
		if (canCache) {
			this.dirty = false;
			this.cachedWidth = safeWidth;
			this.cachedEpoch = _toolBranchVisualEpoch;
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

function refreshRetainedToolGroupClickHandlers(): void {
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
const clickRuntime = ((globalThis as any)[CLICK_RUNTIME_KEY] ??= { visualEpoch: 0 }) as ClickRuntimeState;

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

function builtinExpansionState(component: BuiltinExpandableComponent): BuiltinExpansionState {
	return (component[BUILTIN_EXPANSION_STATE] ??= { version: 0 });
}

function builtinComponentExpanded(component: BuiltinExpandableComponent): boolean {
	return component.expanded === true || component._expanded === true;
}

function isSideQuestEventMessage(component: BuiltinExpandableComponent): boolean {
	const customType = component.message?.customType;
	return customType === "side-quest-result" || customType === "side-quest-continuation";
}

function builtinClickComponentSupported(component: BuiltinExpandableComponent): boolean {
	const isCustomMessage = component instanceof CustomMessageComponent
		|| (component as any)?.constructor?.name === "CustomMessageComponent";
	return !isCustomMessage || isSideQuestEventMessage(component);
}

function isBuiltinExpandableComponent(value: unknown): value is BuiltinExpandableComponent {
	const name = (value as any)?.constructor?.name;
	return value instanceof BashExecutionComponent
		|| value instanceof CompactionSummaryMessageComponent
		|| value instanceof BranchSummaryMessageComponent
		|| name === "BashExecutionComponent"
		|| name === "CompactionSummaryMessageComponent"
		|| name === "BranchSummaryMessageComponent";
}

function isBuiltinSummaryComponent(value: unknown): boolean {
	const name = (value as any)?.constructor?.name;
	return value instanceof CompactionSummaryMessageComponent
		|| value instanceof BranchSummaryMessageComponent
		|| name === "CompactionSummaryMessageComponent"
		|| name === "BranchSummaryMessageComponent";
}

function builtinClickExpansionActive(): boolean {
	return clickExpansionEnabled() && clickRuntime.activeInteractiveMode?.toolOutputExpanded !== true;
}

function builtinExpansionChangesOutput(
	component: BuiltinExpandableComponent,
	width: number,
	render: (width: number) => string[] = (nextWidth) => component.render(nextWidth),
): boolean {
	const state = builtinExpansionState(component);
	if (
		state.probeWidth === width
		&& state.probeVersion === state.version
		&& state.probeResult !== undefined
	) return state.probeResult;

	const expanded = builtinComponentExpanded(component);
	const currentRows = state.width === width && state.rows ? state.rows : render(width);
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
	const changed = currentRows.length !== oppositeRows.length
		|| currentRows.some((line, index) => line !== oppositeRows[index]);
	state.probeWidth = width;
	state.probeVersion = state.version;
	state.probeResult = changed;
	return changed;
}

function sideQuestPaintedBounds(
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
	if (!builtinClickExpansionActive() || !builtinClickComponentSupported(component)) return undefined;
	const state = builtinExpansionState(component);
	if (
		state.width === undefined
		|| state.height === undefined
		|| x < 0
		|| x >= state.width
		|| y < 0
		|| y >= state.height
	) return undefined;
	if (isSideQuestEventMessage(component)) {
		// The custom renderer owns the painted suffix after Pi's outer Spacer.
		// Use its full geometry so blank Markdown rows remain inside the banner.
		const bounds = sideQuestPaintedBounds(component, state.width, state.height);
		if (!bounds || y < bounds.first || y > bounds.last) return undefined;
	}
	return builtinExpansionChangesOutput(component, state.width) ? "expand" : undefined;
}

function beginBuiltinClickActivation(
	component: BuiltinExpandableComponent,
	behavior: string,
	requestedViewport: "top" | "bottom" | "adaptive",
): false | { complete(): void } {
	if (behavior !== "toggle" || !builtinClickExpansionActive() || !builtinClickComponentSupported(component)) return false;
	const state = builtinExpansionState(component);
	if (state.width === undefined || !builtinExpansionChangesOutput(component, state.width)) return false;
	return beginToolCollapseViewportTransaction(component, requestedViewport);
}

function captureBuiltinViewportRollback(
	component: BuiltinExpandableComponent,
	viewport: "top" | "bottom" | "adaptive",
): () => void {
	return captureToolCollapseViewportRollback(component, viewport);
}

function refreshBuiltinClickHandlers(proto: any): void {
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
		const requestedViewport = builtinComponentExpanded(this) ? "adaptive" : viewport;
		return activate?.(
			{ kind: "pi-owned-transcript", transcript: this },
			"toggle",
			requestedViewport,
			action,
		) === true;
	};
}

function padPaintedLineToWidth(line: string, width: number): string {
	const gap = width - visibleWidth(line);
	if (gap <= 0) return line;
	const trailingSgr = /(?:\x1b\[[0-9;]*m)+$/.exec(line);
	const insertionIndex = trailingSgr?.index ?? line.length;
	return `${line.slice(0, insertionIndex)}${" ".repeat(gap)}${line.slice(insertionIndex)}`;
}

function patchBuiltinTranscriptExpansion(): void {
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
				!builtinClickExpansionActive()
				|| builtinComponentExpanded(component)
				|| !isBuiltinSummaryComponent(component)
			) return rows;
			const keyboardHint = keyText("app.tools.expand");
			if (!keyboardHint) return rows;
			return rows.map((row) => {
				if (!row.includes(keyboardHint)) return row;
				const originalWidth = visibleWidth(row);
				return padPaintedLineToWidth(row.replace(keyboardHint, "click"), originalWidth);
			});
		};
		if (proto[BUILTIN_EXPANSION_RENDER_PATCH_FLAG]) continue;
		const originalRender = proto.render;
		proto.render = function patchedBuiltinExpandableRender(width: number): string[] {
			const renderRows = (nextWidth: number): string[] => {
				const rendered = originalRender.call(this, nextWidth);
				const transform = this[BUILTIN_EXPANSION_RENDER_TRANSFORM];
				return typeof transform === "function" ? transform(this, rendered) : rendered;
			};
			const rows = renderRows(width);
			const state = builtinExpansionState(this);
			state.width = width;
			state.height = rows.length;
			state.rows = rows;
			const target = { kind: "pi-owned-transcript", transcript: this } as const;
			clickExpansionModule ??= installClickExpansion({ enabled: clickExpansionEnabled() });
			let output = rows;
			if (
				clickExpansionModule.state(target).active
				&& builtinClickComponentSupported(this)
				&& builtinExpansionChangesOutput(this, width, renderRows)
			) {
				const bounds = isSideQuestEventMessage(this)
					? sideQuestPaintedBounds(this, width, rows.length)
					: { first: 0, last: rows.length - 1 };
				if (bounds) {
					const viewport = builtinComponentExpanded(this) ? "adaptive" : "top";
					output = rows.map((row: string, index: number) => {
						if (index < bounds.first || index > bounds.last) return row;
						const padded = padPaintedLineToWidth(row, width);
						return clickExpansionModule!.declare(target, padded, {
							behavior: "toggle",
							span: { text: stripAnsi(padded) },
							viewport,
						});
					});
				}
			}
			output = [...clickExpansionModule.publish(this, output)];
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
		const patchFlag = Symbol.for(`pi-claude-style-tools:builtin-expansion-${method}-patch`);
		if (typeof original !== "function" || bashProto[patchFlag]) continue;
		bashProto[method] = function patchedBuiltinExpansionMutation(...args: any[]) {
			const state = builtinExpansionState(this);
			state.version++;
			delete state.probeResult;
			return original.apply(this, args);
		};
		bashProto[patchFlag] = true;
	}
}

function standaloneToolMouseTarget(tool: any, anchor: ToolClickAnchor): ToolGroupMouseTarget {
	return {
		component: tool,
		action: anchor.action,
		viewportAnchor: anchor.viewportAnchor,
		activate: () => tool.activateClickAction?.(anchor.action, anchor.viewportAnchor) === true,
		captureRollback: () => tool.captureClickRollback?.(anchor.action, anchor.viewportAnchor) ?? (() => {}),
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
	let approximateRow = documentBox.rect.y
		- (documentBox.lineOffset ?? 0)
		+ mode.headerContainer.render(width).length
		+ mode.loadedResourcesContainer.render(width).length;
	let best: { tool: any; anchor: PublishedToolClickAnchor; score: number; distance: number } | undefined;
	for (const component of mode.chatContainer.children) {
		const sourceRows = component.render(width);
		const rendered = isToolExecutionComponent(component)
			? publishStandaloneToolClickAnchors(component, sourceRows)
			: sourceRows;
		if (isToolExecutionComponent(component)) {
			for (let anchorLine = 0; anchorLine < rendered.length; anchorLine++) {
				const anchor = toolClickAnchorAtPoint(component, localX, anchorLine);
				if (!anchor || stripAnsi(rendered[anchor.line] ?? "").trimEnd() !== clickedKey) continue;
				let score = 4;
				for (let line = 0; line < rendered.length; line++) {
					if (line === anchor.line) continue;
					const candidateKey = stripAnsi(rendered[line]).trimEnd();
					const comparedFrameLine = frameKeys[frameLineIndex + line - anchor.line];
					if (candidateKey && candidateKey === comparedFrameLine) score++;
				}
				const distance = Math.abs(approximateRow + anchor.line - y);
				if (!best || score > best.score || (score === best.score && distance < best.distance)) {
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
	if (!frame || renderer.hasOverlay?.() || renderer.hasOverlayEntries) return undefined;
	const documentBox = findToolGroupLayoutBox(frame.root, mode.documentContainer);
	if (!documentBox || !toolGroupBoxContains(documentBox.clip, x, y)) return undefined;

	const width = documentBox.rect.width;
	const frameMatchedTarget = frameMatchedStandaloneToolTarget(mode, documentBox, x, y);
	if (frameMatchedTarget) return frameMatchedTarget;
	// Component rows are document coordinates. Project them through the same
	// scroll offset used by the captured fullscreen frame before hit testing.
	let row = documentBox.rect.y
		- (documentBox.lineOffset ?? 0)
		+ mode.headerContainer.render(width).length
		+ mode.loadedResourcesContainer.render(width).length;
	for (const component of mode.chatContainer.children) {
		const sourceRows = component.render(width);
		const rendered = isToolExecutionComponent(component)
			? publishStandaloneToolClickAnchors(component, sourceRows)
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
					captureRollback: () => (component as any).captureClickRollbackAtPoint?.(localX, localY) ?? (() => {}),
				};
			}
		} else if (isToolExecutionComponent(component)) {
			const anchor = toolClickAnchorAtPoint(component, localX, localY);
			if (anchor) return standaloneToolMouseTarget(component, anchor);
		} else if (
			isBuiltinExpandableComponent(component)
			&& builtinClickActionAtPoint(component, localX, localY) === "expand"
		) {
			return {
				component,
				action: "expand",
				viewportAnchor: "top",
				activate: () => (component as any).activateClickAction?.("expand") === true,
				captureRollback: () => (component as any).captureClickRollback?.("expand", "top") ?? (() => {}),
			};
		}
		row += height;
	}
	return undefined;
}

function installToolGroupMouseAdapter(): void {
	registerMouseHostAdapter({
		targetAt: toolGroupAtScreenPoint,
		resetLocalClickStates,
	});
}

function isToolGroupComponent(value: unknown): value is ToolGroupComponent {
	// /reload replaces extension-local class identities while old host wrappers
	// can still own transcript components. Accept the stable group interface too.
	const candidate = value as Partial<ToolGroupComponent> | undefined;
	return value instanceof ToolGroupComponent || Boolean(candidate)
		&& typeof candidate?.clickAnchorAtPoint === "function"
		&& typeof candidate?.toggleToolAtPoint === "function"
		&& typeof candidate?.forEachTool === "function"
		&& typeof candidate?.releaseTools === "function";
}

function isSpacerComponent(value: unknown): value is InstanceType<typeof Spacer> {
	return value instanceof Spacer || (value as any)?.constructor?.name === "Spacer";
}

function isTextComponent(value: unknown): value is InstanceType<typeof Text> {
	return value instanceof Text || (value as any)?.constructor?.name === "Text";
}

function isMarkdownComponent(value: unknown): value is InstanceType<typeof Markdown> {
	return value instanceof Markdown || (value as any)?.constructor?.name === "Markdown";
}

function forEachModeTool(mode: ToolGroupInteractiveMode | undefined, visitor: (tool: any) => void): void {
	if (!mode) return;
	for (const component of mode.chatContainer.children) {
		if (isToolExecutionComponent(component)) visitor(component);
		else if (isToolGroupComponent(component)) component.forEachTool(visitor);
	}
}

function resetLocalClickStates(mode: ToolGroupInteractiveMode | undefined, collapseLocal: boolean): void {
	const groups = new Set<ToolGroupComponent>();
	forEachModeTool(mode, (tool) => {
		const locallyExpanded = tool[TOOL_CLICK_LOCAL_EXPANDED] === true;
		const detailLevel = toolLocalDetailLevel(tool);
		delete tool[TOOL_CLICK_LOCAL_EXPANDED];
		setToolLocalDetailLevel(tool, 0);
		if (collapseLocal && locallyExpanded) tool.setExpanded?.(false);
		else if (detailLevel > 0) tool.updateDisplay?.();
		clearToolRenderCache(tool);
		const parent = tool[COMPONENT_PARENT];
		if (isToolGroupComponent(parent)) groups.add(parent);
	});
	if (collapseLocal && mode?.toolOutputExpanded !== true) {
		for (const component of mode?.chatContainer.children ?? []) {
			if (isBuiltinExpandableComponent(component) && component.expanded === true) {
				component.setExpanded(false);
			}
		}
	}
	for (const group of groups) group.invalidate();
	clickRuntime.visualEpoch++;
}

function isIgnorableToolSeparator(value: unknown): boolean {
	if (isSpacerComponent(value)) return true;
	if (value instanceof AssistantMessageComponent || (value as any)?.constructor?.name === "AssistantMessageComponent") {
		// Empty assistant framing stays ignorable so it never splits tool groups.
		// A rendered thinking row ("Thought for Xs" / live thinking) is a visible
		// boundary: tool calls that follow it must start a new group instead of
		// silently joining the batch that ran before the thought.
		const contentChildren = (value as any).contentContainer?.children;
		if (!Array.isArray(contentChildren) || contentChildren.length === 0) return true;
		return contentChildren.every((child: any) => isSpacerComponent(child));
	}
	return false;
}

function findPreviousToolSibling(children: any[], startIndex: number): { child: any; index: number } | undefined {
	for (let index = startIndex; index >= 0; index--) {
		const child = children[index];
		if (isIgnorableToolSeparator(child)) continue;
		return { child, index };
	}
	return undefined;
}

function ungroupActiveToolGroups(): void {
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

function isThinkingOnlyAssistantComponent(comp: unknown): comp is InstanceType<typeof AssistantMessageComponent> {
	if (!comp || ((comp as any).constructor?.name !== "AssistantMessageComponent" && !(comp instanceof AssistantMessageComponent))) {
		return false;
	}
	const msg = (comp as any).lastMessage;
	if (!msg || msg.role !== "assistant" || !Array.isArray(msg.content)) return false;
	const hasThinking = msg.content.some((c: any) => c?.type === "thinking" && typeof c?.thinking === "string" && c.thinking.trim());
	if (!hasThinking) return false;
	const hasText = msg.content.some((c: any) => c?.type === "text" && typeof c?.text === "string" && c.text.trim());
	if (hasText) return false;
	const hasToolCalls = msg.content.some((c: any) => c?.type === "toolCall");
	if (hasToolCalls) return false;
	if ((comp as any).isStreaming === true || msg[THINKING_ACTIVE_KEY]) return false;
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

			const durA = getMessageThinkingDurationMs(curMsg);
			const durB = getMessageThinkingDurationMs(nextMsg);
			const mergedDuration = durA + durB;

			const nextThinkingBlocks = nextMsg.content.filter((c: any) => c?.type === "thinking");
			curMsg.content.push(...nextThinkingBlocks);
			curMsg[THINKING_DURATION_KEY] = mergedDuration;

			(current as any).updateContent(curMsg);

			const removeCount = nextIdx - i;
			children.splice(i + 1, removeCount);
			i--;
		}
	}
}

function maybeGroupToolComponent(parent: any, component: any): void {
	if (!toolGroupingEnabled() || !isGroupableTool(component) || isToolGroupComponent(parent)) return;
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

function patchContainerParentTracking(): void {
	const proto = Container.prototype as any;
	if (proto[PARENT_TRACKING_PATCH_FLAG]) return;
	const originalAddChild = proto.addChild;
	const originalRemoveChild = proto.removeChild;
	const originalClear = proto.clear;
	proto.addChild = function patchedAddChild(component: any) {
		const result = originalAddChild.call(this, component);
		if (component && typeof component === "object") component[COMPONENT_PARENT] = this;
		maybeGroupToolComponent(this, component);
		maybeMergeConsecutiveThinkingMessages(this);
		return result;
	};
	proto.removeChild = function patchedRemoveChild(component: any) {
		const result = originalRemoveChild.call(this, component);
		if (component && typeof component === "object" && component[COMPONENT_PARENT] === this) delete component[COMPONENT_PARENT];
		return result;
	};
	proto.clear = function patchedClear() {
		for (const child of this.children ?? []) {
			if (child && typeof child === "object" && child[COMPONENT_PARENT] === this) delete child[COMPONENT_PARENT];
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
		if (/^[●○]\s+Todos\s+—/.test(plain)) return clampLineWidth(` ${line}`, width);
		// Magic Context emits `├─` / `└─` or bare `├` / `└`; strip any arm to bare tee/corner.
		if (!/^[├└]─?\s+[✓○◐✗●⬤•]\s/.test(plain) && !/^[├└]─?\s+/.test(plain)) return line;
		const withoutTodoHash = line.replace(/#(?=[A-Za-z0-9_-]+)/, "");
		const bare = withoutTodoHash.replace(/([├└])─/, "$1");
		const colored = bare.replace(/[├└]/, (branch) => `${currentToolBranchAnsi()}${branch}${TRANSPARENT_RESET}`);
		return clampLineWidth(` ${colored}`, width);
	});
}

function patchGlobalToolBorders(): void {
	const proto = Container.prototype as any;
	if (proto[PATCH_FLAG]) return;

	const originalRender = proto.render;
	proto.render = function patchedContainerRender(width: number): string[] {
		maybeMergeConsecutiveThinkingMessages(this);
		if (isToolExecutionLike(this)) {
			const outputPad = readPiOutputPad();
			syncToolOutputPad(this, outputPad);
			const cached = (this as any)[TOOL_RENDER_CACHE];
			const branchKey = toolBranchRenderCacheKey();
			const clickKey = toolClickStateKey(this);
			if (
				cached?.width === width
				&& cached?.mode === toolBackgroundMode
				&& cached?.outputPad === outputPad
				&& cached?.branchKey === branchKey
				&& cached?.branchEpoch === _toolBranchVisualEpoch
				&& cached?.clickKey === clickKey
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
			branchKey: toolBranchRenderCacheKey(),
			branchEpoch: _toolBranchVisualEpoch,
			clickKey: toolClickStateKey(this),
		};
		if (toolBackgroundMode === "default" || isSideQuestBinaryTool(this)) {
			(this as any)[TOOL_RENDER_CACHE] = { width, mode: toolBackgroundMode, lines: rendered, ...branchCache };
			return rendered;
		}

		let start = 0;
		while (start < rendered.length && isBlankLine(rendered[start])) start++;
		let end = rendered.length - 1;
		while (end >= start && isBlankLine(rendered[end])) end--;
		if (start > end) return rendered;

		const { textLines, imageLines } = splitRenderedImageBlock(rendered.slice(start, end + 1));
		if (imageLines.length > 0) {
			(this as any)[TOOL_RENDER_CACHE] = { width, mode: toolBackgroundMode, lines: rendered, ...branchCache };
			return rendered;
		}
		// Agent-family tools stay column-aligned with every other tool row — no extra
		// leading indent (the old nested pad made Agent look offset from Read/Bash).
		const core = textLines.map((line) => {
			const normalized = stripOuterBackgroundAnsi(normalizeLeadingCheckGlyph(line));
			return clampLineWidth(normalized, width);
		});
		const spacerLine = " ".repeat(width);
		let result: string[];

		if (toolBackgroundMode === "outlines") {
			const ruleWidth = Math.max(1, width);
			const framed = core.length > 0 ? [borderLine(ruleWidth), ...core, borderLine(ruleWidth)] : [];
			result = [spacerLine, ...framed, ...imageLines];
		} else {
			result = [spacerLine, ...core, ...imageLines];
		}

		(this as any)[TOOL_RENDER_CACHE] = { width, mode: toolBackgroundMode, lines: result, ...branchCache };
		return result;
	};

	proto[PATCH_FLAG] = true;
}

function summarizeText(text: string, max = 60): string {
	const oneLine = text.replace(/\n/g, " ").trim();
	if (oneLine.length <= max) return oneLine;
	return `${oneLine.slice(0, Math.max(0, max - 3))}...`;
}

let extraToolOutputExpanded = false;
type ToolRenderBridge = { localDetailTool?: any };
// Pi keeps host method patches across /reload, while renderer functions come
// from the new extension instance. Both generations must share this context.
const toolRenderBridge = ((globalThis as any)[TOOL_RENDER_BRIDGE_KEY] ??= {}) as ToolRenderBridge;

type ToolClickAction = "header" | "expand" | "detail" | "detail-extra";
type InternalClickExpansionDeclaration = NonNullable<Parameters<ClickExpansionRuntime["declare"]>[2]> & Readonly<{
	compatibilityAction?: ToolClickAction;
}>;
type ToolViewportAnchor = "top" | "bottom";

type ToolClickAnchor = {
	line: number;
	start: number;
	end: number;
	action: ToolClickAction;
	viewportAnchor: ToolViewportAnchor;
};

function syncExtraToolDetailMode(): void {
	extraToolOutputExpanded = readSettings().extraToolOutputExpanded === true;
}

function setExtraToolDetailMode(enabled: boolean): void {
	extraToolOutputExpanded = enabled;
	writeSettingsKey("extraToolOutputExpanded", enabled);
	clickRuntime.visualEpoch++;
}

function clickExpansionEnabled(): boolean {
	return readSettings().clickExpansion === true;
}

function toolGlobalExpansionActive(tool: any): boolean {
	return tool?.ui?.[TOOL_CLICK_GLOBAL_EXPANDED] === true;
}

let clickExpansionModule: ClickExpansionRuntime | undefined;

function toolClickExpansionActive(tool: any): boolean {
	if (!tool || typeof tool !== "object") return false;
	clickExpansionModule ??= installClickExpansion({ enabled: clickExpansionEnabled() });
	return clickExpansionModule.state({ kind: "tool-execution", execution: tool }).active;
}

function normalizeToolClickDetailLevel(value: unknown): ToolClickDetailLevel {
	return value === 1 || value === 2 ? value : 0;
}

function toolLocalDetailLevel(tool: any): ToolClickDetailLevel {
	if (!tool || typeof tool !== "object") return 0;
	clickExpansionModule ??= installClickExpansion({ enabled: clickExpansionEnabled() });
	return clickExpansionModule.state({ kind: "tool-execution", execution: tool }).localDetail;
}

function setToolLocalDetailLevel(tool: any, level: ToolClickDetailLevel): void {
	if (!tool?.rendererState) return;
	if (level === 0) delete tool.rendererState[TOOL_CLICK_DETAIL_LEVEL];
	else tool.rendererState[TOOL_CLICK_DETAIL_LEVEL] = level;
}

function sideQuestAgentPresentation(value: any) {
	const details = value?.details ?? value?.result?.details;
	const decision = toolPresentationModule.present({
		surface: "result",
		tool: { family: "openai", name: "Agent", label: "Agent" },
		cwd: process.cwd(),
		args: value?.args ?? {},
		lifecycle: { status: "success", partial: false, argsComplete: true },
		result: {
			content: Array.isArray(value?.content) ? value.content : Array.isArray(value?.result?.content) ? value.result.content : [],
			details,
			error: value?.isError === true || value?.result?.isError === true,
			partial: false,
		},
	});
	return decision.kind === "present" ? decision.metadata?.sideQuest : undefined;
}

const sideQuestAgentResultLabel = (presentation: { readonly label: string }) => presentation.label;

function isKnownSideQuestAgentTool(tool: any): boolean {
	return String(tool?.toolName ?? "").toLowerCase() === "agent"
		&& sideQuestAgentPresentation(tool) !== undefined;
}

function isSideQuestBinaryTool(tool: any): boolean {
	const name = String(tool?.toolName ?? "").toLowerCase();
	return name === "ask_parent" || name === "subagent_done";
}

function sideQuestBinaryHasHiddenContent(tool: any): boolean {
	const name = String(tool?.toolName ?? "").toLowerCase();
	const field = name === "ask_parent" ? "prompt" : name === "subagent_done" ? "result" : undefined;
	if (field === undefined) return false;
	const content = String(tool?.args?.[field] ?? "");
	const renderedContent = name === "subagent_done" ? content.trim() : content;
	return Array.from(renderedContent).length > 240;
}

function toolUsesTieredTextPreview(tool: any): boolean {
	return tool?.toolName === "read" || tool?.toolName === "grep" || tool?.toolName === "bash";
}

function toolSupportsProgressiveLocalDetail(tool: any): boolean {
	const name = typeof tool?.toolName === "string" ? tool.toolName.toLowerCase() : "";
	return toolUsesTieredTextPreview(tool)
		|| isKnownSideQuestAgentTool(tool)
		|| name === "write"
		|| name === "edit"
		|| name === "apply_patch"
		|| name === "find"
		|| name === "ls"
		|| name === "tasklist"
		|| isMcpToolName(name)
		|| isMcpToolCandidate(tool?.toolDefinition);
}

function tieredToolNormalPreviewLimit(tool: any): number {
	return tool?.toolName === "bash" ? bashCollapsedLimit() : previewLimit();
}

function toolClickStateKey(tool: any): string {
	return `${clickRuntime.visualEpoch}:${toolClickExpansionActive(tool) ? 1 : 0}:${toolLocalDetailLevel(tool)}`;
}

function themedRawKeyHint(theme: Theme | undefined, key: string, description: string): string {
	if (theme) return theme.fg("dim", key) + theme.fg("muted", ` ${description}`);
	try { return rawKeyHint(key, description); } catch { return `${key} ${description}`; }
}

function configuredKeyHint(binding: Parameters<typeof keyText>[0], fallbackKey: string, description: string): string {
	try {
		if (keyText(binding).trim()) return keyHint(binding, description);
	} catch { /* fall back below */ }
	return themedRawKeyHint(undefined, fallbackKey, description);
}

function hintSeparator(theme: Theme | undefined, color: "muted" | "warning"): string {
	return theme ? theme.fg(color, " • ") : " • ";
}

function expandHint(theme: Theme | undefined, action: "expand" | "collapse" = "expand"): string {
	return `${hintSeparator(theme, "muted")}${configuredKeyHint("app.tools.expand", "ctrl+o", `to ${action}`)}`;
}

function baselineDeepExpandHint(theme: Theme | undefined, separatorColor: "muted" | "warning" = "muted"): string {
	return `${hintSeparator(theme, separatorColor)}${themedRawKeyHint(theme, "ctrl+shift+o", extraToolOutputExpanded ? "less detail" : "more detail")}`;
}

type EncodedClickHintAction = "expand" | "detail" | "detail-extra" | "collapse-final" | "none";

function encodedClickHint(action: EncodedClickHintAction, fallback: string): string {
	return `${CLICK_HINT_OPEN}${action}${CLICK_HINT_SEPARATOR}${fallback}${CLICK_HINT_CLOSE}`;
}

function deepExpandHint(
	theme: Theme | undefined,
	separatorColor: "muted" | "warning" = "muted",
	progressiveDetail = false,
): string {
	return encodedClickHint(progressiveDetail ? "detail" : "detail-extra", baselineDeepExpandHint(theme, separatorColor));
}

function localCollapseActionHint(theme: Theme | undefined): string {
	return encodedClickHint("collapse-final", expandHint(theme, "collapse"));
}

function baselineToolOutputDetailHint(theme: Theme | undefined, expanded: boolean, hasMore = false): string {
	if (!expanded) return expandHint(theme, "expand");
	const parts = [expandHint(theme, "collapse")];
	if (hasMore || extraToolOutputExpanded) parts.push(baselineDeepExpandHint(theme));
	return parts.join("");
}

function toolOutputDetailHint(
	theme: Theme | undefined,
	expanded: boolean,
	hasMore = false,
	localDetailEnabled = true,
	progressiveDetail = false,
): string {
	const fallback = baselineToolOutputDetailHint(theme, expanded, hasMore);
	if (!expanded) return encodedClickHint("expand", fallback);
	if (!hasMore && !extraToolOutputExpanded) return encodedClickHint("none", fallback);
	if (progressiveDetail) {
		return encodedClickHint(localDetailEnabled ? "detail" : "none", fallback);
	}
	const collapse = encodedClickHint("expand", expandHint(theme, "collapse"));
	const detail = localDetailEnabled
		? encodedClickHint("detail-extra", baselineDeepExpandHint(theme))
		: baselineDeepExpandHint(theme);
	return `${collapse}${detail}`;
}

function clickHintText(action: "expand" | "detail" | "detail-extra", tool: any): string {
	const theme = getGlobalPiTheme() as Theme | undefined;
	const separator = theme ? theme.fg("muted", " • ") : " • ";
	const click = theme ? theme.fg("dim", "click") : "click";
	const description = action === "expand"
		? tool?.expanded === true ? " to collapse" : " to expand"
		: action === "detail-extra" && toolLocalDetailLevel(tool) === 2 ? " for less detail" : " for more detail";
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
	clickExpansionModule ??= installClickExpansion({ enabled: clickExpansionEnabled() });
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

function resolveClickHints(
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
		const separator = text.indexOf(CLICK_HINT_SEPARATOR, open + CLICK_HINT_OPEN.length);
		const close = separator < 0 ? -1 : text.indexOf(CLICK_HINT_CLOSE, separator + CLICK_HINT_SEPARATOR.length);
		if (separator < 0 || close < 0) {
			output += text.slice(open);
			break;
		}
		const action = text.slice(open + CLICK_HINT_OPEN.length, separator) as EncodedClickHintAction;
		const fallback = text.slice(separator + CLICK_HINT_SEPARATOR.length, close);
		if (!toolClickExpansionActive(tool)) {
			output += fallback;
		} else if (action === "expand" || action === "collapse-final") {
			const finalCollapse = action === "collapse-final";
			const hint = finalCollapse ? finalCollapseHintText() : clickHintText("expand", tool);
			output += declareMarkers
				? declareClickHint(tool, hint, "toggle", finalCollapse ? "bottom" : "top", finalCollapse)
				: hint;
			anchors.push({
				action: "expand",
				text: stripAnsi(hint).trim(),
				viewportAnchor: finalCollapse ? "bottom" : "top",
				exactTextSpan: finalCollapse,
			});
		} else if ((action === "detail" || action === "detail-extra") && (!extraToolOutputExpanded || tool?.[TOOL_CLICK_LOCAL_EXPANDED] === true)) {
			const hint = clickHintText(action, tool);
			if (anchors.some((anchor) => anchor.action === "expand")) output += CLICK_CONTROL_BREAK_MARK;
			output += declareMarkers
				? declareClickHint(tool, hint, action === "detail" ? "next-detail" : "toggle-max-detail")
				: hint;
			anchors.push({ action, text: stripAnsi(hint).trim(), viewportAnchor: "top" });
		}
		cursor = close + CLICK_HINT_CLOSE.length;
	}
	return { text: output, anchors };
}

function clearToolRenderCache(value: unknown): void {
	if (!value || typeof value !== "object") return;
	delete (value as any)[TOOL_RENDER_CACHE];
	// If this tool lives inside a ToolGroupComponent, drop the group's memo so
	// settled headers/counts/child lines can't go stale after a child update.
	// Only the parent group is touched — we do NOT cascade invalidate siblings.
	const parent = (value as any)[COMPONENT_PARENT];
	if (isToolGroupComponent(parent)) parent.invalidate();
}

function unrefTimer(timer: ReturnType<typeof setTimeout> | null | undefined): void {
	(timer as any)?.unref?.();
}

function safeInvalidate(ctx: any, pendingViewport?: ToolCollapseViewportSettlement): void {
	try {
		// The host and an extension can load ToolExecutionComponent through
		// different module contexts. In that case our prototype mutation hooks
		// do not clear the host component's outer rendered-line cache. Resolve
		// the stable owner attached to the reused ToolText and clear it here,
		// before ctx.invalidate() requests the next frame.
		clearToolRenderCache(findToolExecutionAncestor(ctx?.lastComponent));
		if (typeof ctx?.invalidate === "function") ctx.invalidate();
	} catch {
		// Tool render contexts may outlive their row during reload/session switches.
	} finally {
		settleToolCollapseViewport(ctx?.state, pendingViewport);
	}
}

const ASSISTANT_PATCH_FLAG = Symbol.for("pi-claude-style-tools:patched-assistant-message");
const ASSISTANT_RENDER_PATCH_FLAG = Symbol.for("pi-claude-style-tools:patched-assistant-message-render");
const ASSISTANT_UPDATE_BASE = Symbol.for("pi-claude-style-tools:assistant-message-update-base");
const TOOL_EXECUTION_PATCH_FLAG = Symbol.for("pi-claude-style-tools:patched-tool-execution");
const TOOL_RESULT_GETTER_SEEN = Symbol.for("pi-claude-style-tools:tool-result-getter-seen");
const TOOL_RESULT_GETTER_ADAPTED = Symbol.for("pi-claude-style-tools:tool-result-getter-adapted");

// Rendered-output cache for assistant/user/custom message components.
// Keyed by (width, branch visual epoch, tool background mode). The epoch changes on
// theme / /cc-tools branch / /cc-theme rebinds; the mode is included because subagent
// (custom-message) framing follows `toolBackgroundMode` via frameToolLikeLines. This avoids
// re-running the per-line ANSI stripping (applyTerminalCopyZones, normalizeLeadingCheckGlyph,
// border boxing) on every scroll/expand re-render — the dominant CPU cost on long chats,
// scaling linearly with chat length.
// Correctness:
//  - UserMessageComponent content is immutable after construction, so output is deterministic
//    given (width, epoch, mode).
//  - AssistantMessageComponent rebuilds children only via updateContent(), which clears the cache.
//  - CustomMessageComponent rebuilds children only via rebuild(), which clears the cache.
// The returned arrays are only ever spread-copied by Container.render (never mutated in place),
// so sharing the cached array reference across renders is safe.
const MESSAGE_RENDER_CACHE = Symbol.for("pi-claude-style-tools:message-render-cache");

function messageRenderCacheHit(thisArg: any, width: number): string[] | null {
	const cache = thisArg?.[MESSAGE_RENDER_CACHE];
	if (
		cache
		&& cache.width === width
		&& cache.epoch === _toolBranchVisualEpoch
		&& cache.mode === toolBackgroundMode
		&& Array.isArray(cache.lines)
	) {
		return cache.lines;
	}
	return null;
}

function storeMessageRenderCache(thisArg: any, width: number, lines: string[]): string[] {
	if (thisArg && typeof thisArg === "object") {
		thisArg[MESSAGE_RENDER_CACHE] = {
			width,
			epoch: _toolBranchVisualEpoch,
			mode: toolBackgroundMode,
			lines,
		};
	}
	return lines;
}

function clearMessageRenderCache(thisArg: any): void {
	if (thisArg && typeof thisArg === "object") thisArg[MESSAGE_RENDER_CACHE] = undefined;
}
const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";
const WORKED_DURATION_KEY = "_piClaudeStyleWorkedDurationMs";
const WORKED_START_KEY = "_piClaudeStyleWorkedStartMs";
const WORKED_SESSION_TOTAL_KEY = "_piClaudeStyleWorkedSessionTotalMs";
const WORKED_TURNS_KEY = "_piClaudeStyleWorkedTurns";
const WORKED_DURATION_MARKER = "Turn took";
const THINKING_DURATION_KEY = "_piClaudeStyleThinkingDurationMs";
const THINKING_ACTIVE_KEY = "_piClaudeStyleThinkingActive";
const MIN_THINKING_SUMMARY_MS = 100;

let lastThinkingBlockDurationMs: number | undefined;
let thinkingBlockStartMs = 0;
/** True from thinking_start until thinking_end on the current assistant stream. */
let thinkingBlockInFlight = false;
// WORKED_LINE_FG is theme-derived (from "muted") when themeAdaptive is on.
let WORKED_LINE_FG = "\x1b[38;2;140;140;140m";
let currentAgentWorkStartMs: number | undefined;
let currentAssistantMessageStartMs: number | undefined;
// Session-wide accumulators for the "Turn took … (Total time … · N turns)" line.
// Seeded from the `context` event (which carries the full message history,
// including resumed sessions) so totals reflect the whole session, not just the
// current process. `userTurnCount` counts role==="user" messages (= prompts sent).
let sessionStartMs: number | undefined;
let userTurnCount = 0;

function formatWorkedDuration(ms: number): string {
	const safeMs = Math.max(0, Number.isFinite(ms) ? ms : 0);
	if (safeMs < 60_000) {
		return `${Math.max(0, Math.floor(safeMs / 1000))}s`;
	}
	let days = Math.floor(safeMs / 86_400_000);
	let hours = Math.floor((safeMs % 86_400_000) / 3_600_000);
	let minutes = Math.floor((safeMs % 3_600_000) / 60_000);
	let seconds = Math.round((safeMs % 60_000) / 1000);
	if (seconds === 60) {
		seconds = 0;
		minutes++;
	}
	if (minutes === 60) {
		minutes = 0;
		hours++;
	}
	if (hours === 24) {
		hours = 0;
		days++;
	}
	if (days > 0) return `${days}d ${hours}h ${minutes}m`;
	if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
	return `${minutes}m ${seconds}s`;
}

function formatThoughtDuration(ms: number): string {
	const safeMs = Math.max(0, Number.isFinite(ms) ? ms : 0);
	if (safeMs < 60_000) return `${Math.max(1, Math.round(safeMs / 1000))}s`;
	return formatWorkedDuration(safeMs);
}

/** Session-total duration: seconds are always shown; minutes and hours are
 *  added only once the session has actually lasted that long.
 *  e.g. 45s, 12m 30s, 1h 12m 30s. */
function formatSessionTotal(ms: number): string {
	const safeMs = Math.max(0, Number.isFinite(ms) ? ms : 0);
	const totalSeconds = Math.floor(safeMs / 1000);
	const seconds = totalSeconds % 60;
	const totalMinutes = Math.floor(totalSeconds / 60);
	const minutes = totalMinutes % 60;
	const hours = Math.floor(totalMinutes / 60);
	if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
	if (totalMinutes > 0) return `${minutes}m ${seconds}s`;
	return `${seconds}s`;
}

function pluralizeTurns(n: number): string {
	return `${n} turn${n === 1 ? "" : "s"}`;
}

function thinkingSummaryStyledText(body: string): string {
	// Preserve the visible thinking text column while omitting ∴ when collapsed.
	return `   ${WORKED_LINE_FG}${body}${RESET}`;
}

function thinkingActiveSummaryText(): string {
	return thinkingSummaryStyledText("Thinking…");
}

function thoughtDurationSummaryText(ms: number): string {
	return thinkingSummaryStyledText(`Thought for ${formatThoughtDuration(ms)}`);
}

/** Single-line hidden thinking row — no Text paddingX or thinking symbol. */
class HiddenThinkingSummary {
	private summaryText: string;
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(summaryText: string) {
		this.summaryText = summaryText;
	}

	setSummary(summaryText: string): void {
		this.summaryText = summaryText;
		this.invalidate();
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
		const safeWidth = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
		if (safeWidth <= 0) {
			this.cachedWidth = width;
			this.cachedLines = [""];
			return this.cachedLines;
		}
		const line = padRenderedLineToWidth(this.summaryText, safeWidth);
		this.cachedWidth = width;
		this.cachedLines = [line];
		return this.cachedLines;
	}
}

function getMessageThinkingDurationMs(message: any): number {
	const stored = (message as any)?.[THINKING_DURATION_KEY];
	if (typeof stored === "number" && stored > 0) return stored;
	if (typeof lastThinkingBlockDurationMs === "number" && lastThinkingBlockDurationMs > 0) {
		return lastThinkingBlockDurationMs;
	}
	if (typeof (message as any)?.[WORKED_DURATION_KEY] === "number" && (message as any)[WORKED_DURATION_KEY] > 0) {
		return (message as any)[WORKED_DURATION_KEY];
	}
	let totalChars = 0;
	if (Array.isArray(message?.content)) {
		for (const block of message.content) {
			if (block?.type === "thinking" && typeof block.thinking === "string") {
				totalChars += block.thinking.length;
			}
		}
	}
	return Math.max(1000, Math.round((totalChars / 150) * 1000));
}

function assistantMessageThinkingComplete(this: any, message: any): boolean {
	return isAssistantThinkingComplete(this, message);
}

function hiddenThinkingSummaryForMessage(message: any, comp?: any): string {
	if (message && !isAssistantThinkingComplete(comp, message) && isLiveThinkingMessage(comp, message)) {
		return thinkingActiveSummaryText();
	}
	const durationMs = getMessageThinkingDurationMs(message);
	if (message && typeof message === "object") {
		(message as any)[THINKING_DURATION_KEY] = durationMs;
	}
	return thoughtDurationSummaryText(durationMs);
}

function isHiddenThinkingPlaceholderText(child: unknown): child is InstanceType<typeof Text> {
	if (!isTextComponent(child)) return false;
	const plain = stripAnsi(String((child as any).text ?? "")).trim();
	if (/^[✻∴]\s*Thinking/i.test(plain)) return true;
	if (/^[✻∴]\s*Thought for/i.test(plain)) return true;
	if (/^Thought for\b/i.test(plain)) return true;
	if (/^Thinking\.\.\.$/i.test(plain)) return true;
	if (/^Thinking…$/i.test(plain)) return true;
	return /^Thinking:?\s*$/i.test(plain);
}

function messageHasThinkingContent(message: any): boolean {
	return Array.isArray(message?.content)
		&& message.content.some((block: any) => block?.type === "thinking" && typeof block.thinking === "string" && block.thinking.trim());
}

function workedDurationText(ms: number, sessionTotalMs?: number, turns?: number): string {
	let text = `${WORKED_LINE_FG}✻ Turn took ${formatWorkedDuration(ms)}`;
	if (typeof sessionTotalMs === "number" && typeof turns === "number" && turns > 0) {
		text += ` (Total time ${formatSessionTotal(sessionTotalMs)} · ${pluralizeTurns(turns)})`;
	}
	return `${text}${RESET}`;
}

function isWorkedDurationLine(line: string): boolean {
	return line.includes(WORKED_DURATION_MARKER) && /^✻ Turn took [^\r\n]+$/.test(stripAnsi(line).trim());
}

function stripWorkedDurationLine(text: string): string {
	if (!text.includes(WORKED_DURATION_MARKER)) return text;
	return text
		.split(/\r?\n/)
		.filter((line) => !isWorkedDurationLine(line))
		.join("\n")
		.replace(/\n{3,}/g, "\n\n");
}

function hasWorkedDurationLine(message: any): boolean {
	if (!Array.isArray(message?.content)) return false;
	return message.content.some((block: any) => {
		if (block?.type !== "text" || typeof block.text !== "string" || !block.text.includes(WORKED_DURATION_MARKER)) return false;
		return block.text.split(/\r?\n/).some(isWorkedDurationLine);
	});
}

type MarkdownThemeLike = ConstructorParameters<typeof Markdown>[3];

type ParagraphSegment = { kind: "markdown"; md: InstanceType<typeof Markdown> };

const COPY_SAFE_MARKDOWN_LINKS_FLAG = Symbol.for("pi-claude-style-tools:copy-safe-markdown-links");

/** Unordered list marker: monochrome ◉ (fisheye) instead of "- " (thinking blocks skip this). */
function assistantListBulletMarker(marker: string): string {
	if (marker.startsWith("- ")) return `◉ ${marker.slice(2)}`;
	return marker;
}

function copySafeMarkdownTheme(theme: MarkdownThemeLike): MarkdownThemeLike {
	const listBullet = theme.listBullet;
	return {
		...theme,
		link: (text: string) => stripAnsi(text),
		linkUrl: (text: string) => stripAnsi(text),
		listBullet: listBullet
			? (marker: string) => listBullet(assistantListBulletMarker(marker))
			: (marker: string) => assistantListBulletMarker(marker),
	};
}

function makeMarkdownLinksCopySafe(markdown: InstanceType<typeof Markdown>): void {
	const markdownAny = markdown as any;
	if (markdownAny[COPY_SAFE_MARKDOWN_LINKS_FLAG] || !markdownAny.theme) return;
	markdownAny.theme = copySafeMarkdownTheme(markdownAny.theme);
	markdownAny[COPY_SAFE_MARKDOWN_LINKS_FLAG] = true;
	markdown.invalidate?.();
}

// Magic Context prefixes live assistant text with §N§ while the response is
// streaming and removes that metadata on message_end. Keep the transient tag
// out of the display without mutating the message used by context management.
const MAGIC_CONTEXT_TAG_LINE_PREFIX = /(^|\r?\n)[ \t]*(?:§\d+§[ \t]*)+/g;

function stripTransientMagicContextTags(text: string): string {
	return text.replace(MAGIC_CONTEXT_TAG_LINE_PREFIX, "$1");
}

// Tool results can carry transient Magic Context tags too (live-prefixed output
// chunks). Renderers must see sanitized text WITHOUT mutating this.result — the
// result object is the stored message used by context management. Clone blocks
// only when a tag is actually present so the common path stays zero-cost.
function sanitizeToolResultForDisplay(result: any): any {
	if (!result || !Array.isArray(result.content)) return result;
	let changed = false;
	const content = result.content.map((block: any) => {
		if (block && typeof block.text === "string") {
			const stripped = stripTransientMagicContextTags(block.text);
			if (stripped !== block.text) {
				changed = true;
				return { ...block, text: stripped };
			}
		}
		return block;
	});
	return changed ? { ...result, content } : result;
}

// Last-resort display scrubber at the terminal writer choke point. Every
// rendered frame — every component, overlay, preview, and search hit — exits
// through ProcessTerminal.write, so stripping complete §N§ tokens there covers
// any surface the targeted strips above can't reach, including mid-sentence
// tag references replayed from old tool output on resume. Display only:
// storage, LLM context, copy/paste sources, and ANSI sequences are untouched
// (tags are plain characters; escape sequences never contain them).
const MAGIC_CONTEXT_TAG_TOKEN = /§\d+§/g;
const TERMINAL_SCRUB_PATCH_FLAG = Symbol.for("pi-claude-style-tools:terminal-write-tag-scrub");

function patchTerminalWriteTagScrubber(): void {
	const proto = (ProcessTerminal as any)?.prototype;
	if (!proto || proto[TERMINAL_SCRUB_PATCH_FLAG]) return;
	const originalWrite = proto.write;
	if (typeof originalWrite !== "function") return;
	proto.write = function patchedTerminalWrite(this: any, data: any, ...rest: any[]) {
		if (typeof data === "string" && data.includes("§")) {
			data = data.replace(MAGIC_CONTEXT_TAG_TOKEN, "");
		}
		return originalWrite.call(this, data, ...rest);
	};
	proto[TERMINAL_SCRUB_PATCH_FLAG] = true;
}

function createAssistantMarkdownTransform(
isStreaming: boolean,
transformers: readonly MarkdownTransformer[],
): (markdown: string, availableWidth: number) => string {
return (markdown, availableWidth) => {
let transformed = markdown;
for (const transformer of transformers) {
try {
const next = transformer(transformed, {
messageType: "assistant",
isStreaming,
availableWidth,
});
if (typeof next === "string") transformed = next;
} catch {
// Match Pi's transformer chain: an optional renderer must not break text output.
}
}
return transformed;
};
}

function normalizeFencedLatexBlocks(text: string): string {
// Models often use a dedicated latex/tex fence. Treat it as display math so
// it uses the same terminal-friendly renderer as \[...\] and $$...$$.
return text.replace(/```(?:latex|tex)\s*\r?\n([\s\S]*?)```/gi, (_match, body: string) => {
return `\\[\n${body.trim()}\n\\]`;
});
}

function appendMarkdownSegment(
segments: ParagraphSegment[],
text: string,
theme: MarkdownThemeLike,
transform: (markdown: string, availableWidth: number) => string,
): void {
if (!text.trim()) return;
// Pi 0.84 renders math with stacked fractions, matrices, and operator layout.
// Do not flatten its LaTeX tokens into cc-tools' legacy one-line fallback.
segments.push({
kind: "markdown",
md: new Markdown(text, 0, 0, theme, undefined, { transform, renderLatex: true } as any),
});
}

function buildParagraphSegments(
text: string,
theme: MarkdownThemeLike,
transform: (markdown: string, availableWidth: number) => string,
): ParagraphSegment[] {
const segments: ParagraphSegment[] = [];
// Keep native delimiters together. Markdown performs LaTeX layout after the
// Mermaid transformer runs, so equations retain fractions and matrices.
appendMarkdownSegment(segments, normalizeFencedLatexBlocks(text), theme, transform);
return segments;
}

class DottedParagraph {
	private segments: ParagraphSegment[];
	private markdownTheme: MarkdownThemeLike;
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(
		text: string,
		markdownTheme: MarkdownThemeLike,
		markdownTransformers: readonly MarkdownTransformer[] = [],
		isStreaming = false,
	) {
		this.markdownTheme = copySafeMarkdownTheme(markdownTheme);
		const transform = createAssistantMarkdownTransform(isStreaming, markdownTransformers);
		this.segments = buildParagraphSegments(
			stripTransientMagicContextTags(text),
			this.markdownTheme,
			transform,
		);
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
		for (const segment of this.segments) {
			if (segment.kind === "markdown") segment.md.invalidate();
		}
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
		const safeWidth = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
		if (safeWidth <= 0) {
			this.cachedWidth = width;
			this.cachedLines = [""];
			return this.cachedLines;
		}
		// " ● " = 1 margin + dot + space = 3 visible chars
		const PREFIX_W = 3;
		if (safeWidth <= PREFIX_W) {
			this.cachedWidth = width;
			this.cachedLines = [clampLineWidth(" ● ", safeWidth)];
			return this.cachedLines;
		}
		const contentWidth = safeWidth - PREFIX_W;
		const lines = this.segments.flatMap((segment) =>
sanitizeRenderedTextBlockLines(segment.md.render(contentWidth), contentWidth),
);
		const looksLikeTaskStatus = lines.some((line) => /\b(?:transcript:|No output\.|Wrapped up)/.test(stripAnsi(line)));
		const displayLines = looksLikeTaskStatus ? lines.map(normalizeLeadingCheckGlyph) : lines;
		let dotPlaced = false;
		const rendered = displayLines.map((line: string) => {
			if (!stripAnsi(line).trim()) return `   ${line}`;
			if (isCodeBoxChromeLine(line)) return `   ${line}`;
			if (!dotPlaced) {
				dotPlaced = true;
				return ` ● ${line}`;
			}
			return `   ${line}`;
		}).map((line) => {
			const gap = safeWidth - visibleWidth(line);
			return gap > 0 ? line + " ".repeat(gap) : gap < 0 ? truncateToWidth(line, safeWidth, "", false) : line;
		});
		this.cachedWidth = width;
		this.cachedLines = rendered;
		return rendered;
	}
}

function replaceHiddenThinkingPlaceholders(container: { children?: any[] }, message: any): void {
	if (!container?.children) return;
	const summary = hiddenThinkingSummaryForMessage(message);
	let firstReplaced = false;
	for (let i = 0; i < container.children.length; i++) {
		const child = container.children[i];
		const inner = (child as any)?.child ?? child;
		if (inner instanceof HiddenThinkingSummary || (inner as any)?.constructor?.name === "HiddenThinkingSummary") {
			if (!firstReplaced) {
				inner.setSummary(summary);
				firstReplaced = true;
			} else {
				container.children.splice(i, 1);
				i--;
			}
			continue;
		}
		if (isHiddenThinkingPlaceholderText(inner)) {
			if (!firstReplaced) {
				const summaryComp = new HiddenThinkingSummary(summary);
				if ((child as any)?.child !== undefined) {
					(child as any).child = summaryComp;
				} else {
					container.children[i] = summaryComp;
				}
				firstReplaced = true;
			} else {
				container.children.splice(i, 1);
				i--;
			}
		}
	}
}

class ThinkingParagraph {
	private text: string;
	private cachedWidth?: number;
	private cachedLines?: string[];
	private chromeEpoch = -1;

	constructor(
		text: string,
		_markdownTheme: ConstructorParameters<typeof Markdown>[3],
		_defaultTextStyle?: ConstructorParameters<typeof Markdown>[4],
	) {
		this.text = stripTransientMagicContextTags(text);
	}

	private thinkingMarkdown(): InstanceType<typeof Markdown> {
		const DIM_FG = WORKED_LINE_FG;
		const wrap = (s: string) => `${DIM_FG}${s}`;
		const wrapPlain = (s: string) => wrap(stripAnsi(s));
		const plainTheme: ConstructorParameters<typeof Markdown>[3] = {
			heading: wrap,
			link: wrapPlain,
			linkUrl: wrapPlain,
			code: wrap,
			codeBlock: wrap,
			codeBlockBorder: wrap,
			quote: wrap,
			quoteBorder: wrap,
			hr: wrap,
			listBullet: (marker: string) => wrap(marker),
			bold: wrap,
			italic: wrap,
			strikethrough: wrap,
			underline: wrap,
			highlightCode: (code: string, _lang?: string) => code.split("\n").map((line) => `${DIM_FG}${line}`),
		};
		const plainStyle: ConstructorParameters<typeof Markdown>[4] = {
			italic: false,
			color: (s: string) => `${DIM_FG}${s}`,
		};
		return new Markdown(this.text, 0, 0, plainTheme, plainStyle);
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
		this.chromeEpoch = -1;
	}

	render(width: number): string[] {
		if (
			this.cachedLines
			&& this.cachedWidth === width
			&& this.chromeEpoch === _toolBranchVisualEpoch
		) {
			return this.cachedLines;
		}
		const safeWidth = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
		if (safeWidth <= 0) {
			this.cachedWidth = width;
			this.cachedLines = [""];
			this.chromeEpoch = _toolBranchVisualEpoch;
			return this.cachedLines;
		}
		const md = this.thinkingMarkdown();
		// " ∴ " = 1 margin + symbol + space = 3 visible chars
		const PREFIX_W = 3;
		const prefix = `${WORKED_LINE_FG}∴${RESET}`;
		if (safeWidth <= PREFIX_W) {
			this.cachedWidth = width;
			this.cachedLines = [clampLineWidth(` ${prefix} `, safeWidth)];
			return this.cachedLines;
		}
		const lines = sanitizeRenderedTextBlockLines(md.render(safeWidth - PREFIX_W), safeWidth - PREFIX_W);
		let symbolPlaced = false;
		const rendered = lines.map((line: string) => {
			if (!symbolPlaced && stripAnsi(line).trim()) {
				symbolPlaced = true;
				return ` ${prefix} ${line}`;
			}
			return `   ${line}`;
		}).map((line) => clampLineWidth(line, safeWidth));
		this.cachedWidth = width;
		this.cachedLines = rendered;
		this.chromeEpoch = _toolBranchVisualEpoch;
		return rendered;
	}
}

function trimRenderedBlankLines(lines: string[]): string[] {
	let start = 0;
	while (start < lines.length && isBlankLine(lines[start])) start++;
	let end = lines.length - 1;
	while (end >= start && isBlankLine(lines[end])) end--;
	return start <= end ? lines.slice(start, end + 1) : [];
}

function isSubagentNotificationMessage(message: unknown): boolean {
	const candidate = message as Record<string, unknown> | undefined;
	return candidate?.customType === "subagent-notification";
}

function isSubagentHeaderLine(line: string): boolean {
	return /^[✓✔✗■●]\s+/.test(stripAnsi(line).trimStart());
}

function isSubagentDetailLine(line: string): boolean {
	const plain = stripAnsi(line).trimStart();
	return plain.startsWith("⎿")
		|| plain.startsWith("transcript:")
		|| plain === "No output."
		|| /^(?:Done|Wrapped up|Stopped|Error:|Aborted)\b/.test(plain);
}

function cleanSubagentDetailLine(line: string): string {
	const markerIndex = line.indexOf("⎿");
	if (markerIndex !== -1) {
		const prefixAnsi = (line.slice(0, markerIndex).match(ANSI_RE) ?? []).join("");
		return `${prefixAnsi}${line.slice(markerIndex + 1).replace(/^\s+/, "")}`;
	}
	return line
		.replace(/^((?:\x1b\[[0-9;]*m)*)\s{2}/, "$1")
		.replace(/^\s{2}/, "");
}

function formatSubagentNotificationGroup(lines: string[]): string[] {
	if (lines.length === 0) return [];
	const header = normalizeLeadingCheckGlyph(lines[0]);
	const rest = lines.slice(1);
	const detailStart = rest.findIndex(isSubagentDetailLine);
	if (detailStart === -1) {
		return [header, ...rest];
	}

	const metadata = rest.slice(0, detailStart);
	const detailLines = rest.slice(detailStart).map(cleanSubagentDetailLine).filter((line) => stripAnsi(line).trim().length > 0);
	const formattedDetails = withFinalBranchBlock(detailLines.join("\n"), undefined as any).split("\n").filter((line) => line.length > 0);
	return [header, ...metadata, ...formattedDetails];
}

function splitSubagentNotificationGroups(lines: string[]): string[][] {
	const groups: string[][] = [];
	let current: string[] = [];
	for (const line of lines) {
		if (isSubagentHeaderLine(line) && current.length > 0) {
			groups.push(current);
			current = [line];
		} else {
			current.push(line);
		}
	}
	if (current.length > 0) groups.push(current);
	return groups;
}

function frameToolLikeLines(lines: string[], width: number): string[] {
	syncToolBackgroundMode();
	const safeWidth = Math.max(1, width);
	const core = trimRenderedBlankLines(lines).map((line) => clampLineWidth(line, safeWidth));
	if (core.length === 0 || toolBackgroundMode === "default") return core;
	const spacerLine = " ".repeat(safeWidth);
	if (toolBackgroundMode === "outlines") {
		return [spacerLine, borderLine(safeWidth), ...core, borderLine(safeWidth)];
	}
	return [spacerLine, ...core];
}

function formatBannerLikeLines(lines: string[], width: number): string[] {
	const safeWidth = Math.max(1, width);
	// Side Quests owns this banner's Box. Preserve its painted vertical padding;
	// cc-tools owns only interaction and must not replace producer chrome.
	return lines.map((line) => clampLineWidth(line, safeWidth));
}

function formatSubagentNotification(lines: string[], width: number): string[] {
	const core = trimRenderedBlankLines(lines).map(normalizeLeadingCheckGlyph);
	if (core.length === 0) return lines;
	const formatted = splitSubagentNotificationGroups(core).flatMap((group, index) => {
		const groupLines = formatSubagentNotificationGroup(group);
		return index === 0 ? groupLines : ["", ...groupLines];
	});
	const safeWidth = Math.max(1, width);
	const indented = formatted.map((line) => clampLineWidth(line ? ` ${line}` : line, safeWidth));
	syncToolBackgroundMode();
	return toolBackgroundMode === "default" ? indented : [" ".repeat(safeWidth), ...indented];
}

function patchCustomMessageRender(): void {
	const proto = CustomMessageComponent.prototype as any;
	refreshBuiltinClickHandlers(proto);
	if (proto[CUSTOM_MESSAGE_PATCH_FLAG]) return;
	const originalRender = proto.render;
	if (typeof originalRender !== "function") return;
	proto.render = function patchedCustomMessageRender(width: number) {
		// Subagent framing follows `toolBackgroundMode` (via frameToolLikeLines), which
		// can change via /cc-tools or by editing settings.json. Re-sync before the
		// cache check so the mode key reflects the current setting on warm renders too.
		syncToolBackgroundMode();
		const cached = messageRenderCacheHit(this, width);
		if (cached) return cached;
		visitMarkdownDescendants(this, (child) => {
			const markdownAny = child as any;
			if (typeof markdownAny.text === "string") {
				const stripped = stripTransientMagicContextTags(markdownAny.text);
				if (stripped !== markdownAny.text) {
					markdownAny.text = stripped;
					child.invalidate?.();
				}
			}
		});
		const renderRows = (nextWidth: number): string[] => {
			const lines = originalRender.call(this, nextWidth);
			if (!Array.isArray(lines)) return lines;
			return isSubagentNotificationMessage(this?.message)
				? formatSubagentNotification(lines, nextWidth)
				: isSideQuestEventMessage(this)
					? formatBannerLikeLines(lines.map(normalizeLeadingCheckGlyph), nextWidth)
					: lines.map(normalizeLeadingCheckGlyph);
		};
		const result = renderRows(width);
		let output = result;
		if (isSideQuestEventMessage(this)) {
			const state = builtinExpansionState(this);
			state.width = width;
			state.height = result.length;
			state.rows = result;
			const target = { kind: "pi-owned-transcript", transcript: this } as const;
			clickExpansionModule ??= installClickExpansion({ enabled: clickExpansionEnabled() });
			if (
				clickExpansionModule.state(target).active
				&& builtinExpansionChangesOutput(this, width, renderRows)
			) {
				const bounds = sideQuestPaintedBounds(this, width, result.length);
				if (bounds) {
					const viewport = builtinComponentExpanded(this) ? "adaptive" : "top";
					output = result.map((row: string, index: number) => {
						if (index < bounds.first || index > bounds.last) return row;
						const padded = padPaintedLineToWidth(row, width);
						return clickExpansionModule!.declare(target, padded, {
							behavior: "toggle",
							span: { text: stripAnsi(padded) },
							viewport,
						});
					});
				}
			}
			output = [...clickExpansionModule.publish(this, output)];
			state.height = output.length;
			state.rows = output;
		}
		return storeMessageRenderCache(this, width, output);
	};
	// CustomMessageComponent rebuilds its children via rebuild() (called from
	// invalidate() and setExpanded()); drop the cached render so the next render
	// reflects the rebuilt content.
	const originalRebuild = proto.rebuild;
	if (typeof originalRebuild === "function") {
		proto.rebuild = function patchedCustomMessageRebuild(...args: any[]) {
			clearMessageRenderCache(this);
			const state = builtinExpansionState(this);
			state.version++;
			state.probeResult = undefined;
			return originalRebuild.apply(this, args);
		};
	}
	proto[CUSTOM_MESSAGE_PATCH_FLAG] = true;
}

function stripOsc133Zones(line: string): string {
	return line
		.replace(OSC133_ZONE_START, "")
		.replace(OSC133_ZONE_END, "")
		.replace(OSC133_ZONE_FINAL, "");
}

function stripBackgroundAnsi(text: string): string {
	return text.replace(/\x1b\[([0-9;]*)m/g, (_match, paramsText: string) => {
		const params = paramsText === "" ? ["0"] : paramsText.split(";");
		const kept: string[] = [];
		for (let i = 0; i < params.length; i++) {
			const code = Number(params[i] || "0");
			if (code === 48) {
				const mode = Number(params[i + 1] || "0");
				i += mode === 2 ? 4 : mode === 5 ? 2 : 0;
				continue;
			}
			if (code === 49 || (code >= 40 && code <= 47) || (code >= 100 && code <= 107)) continue;
			kept.push(params[i]);
		}
		return kept.length === 0 ? "" : `\x1b[${kept.join(";")}m`;
	});
}

function roundedUserBorder(width: number, top: boolean): string {
	if (width <= 1) return `${BORDER_COLOR}│${TRANSPARENT_RESET}`;
	const left = top ? "╭" : "╰";
	const right = top ? "╮" : "╯";
	if (!top || width < 10) {
		return `${BORDER_COLOR}${left}${"─".repeat(Math.max(0, width - 2))}${right}${TRANSPARENT_RESET}`;
	}
	const label = `${WORKED_LINE_FG} User ${TRANSPARENT_RESET}`;
	const prefix = "─";
	const suffixWidth = Math.max(0, width - 2 - visibleWidth(prefix) - visibleWidth(label));
	return `${BORDER_COLOR}${left}${prefix}${TRANSPARENT_RESET}${label}${BORDER_COLOR}${"─".repeat(suffixWidth)}${right}${TRANSPARENT_RESET}`;
}

function trimAnsiRight(text: string): string {
	let trimmed = text;
	while (true) {
		const next = trimmed.replace(/[ \t]+((?:\x1b\[[0-9;]*m)*)$/g, "$1");
		if (next === trimmed) return trimmed;
		trimmed = next;
	}
}

function cleanUserMessageLine(line: string): string {
	return `${TRANSPARENT_BG}${trimAnsiRight(stripBackgroundAnsi(stripOsc133Zones(line)))}${TRANSPARENT_BG}`;
}

function borderedUserMessageLine(line: string, width: number): string {
	const innerWidth = Math.max(1, width - 4);
	const content = clampLineWidth(cleanUserMessageLine(line), innerWidth);
	const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(content)));
	return `${BORDER_COLOR}│${TRANSPARENT_RESET} ${content}${padding} ${BORDER_COLOR}│${TRANSPARENT_RESET}`;
}

function visitMarkdownDescendants(root: unknown, visit: (md: InstanceType<typeof Markdown>) => void): void {
	if (!root || typeof root !== "object") return;
	const node = root as { children?: unknown[] };
	for (const child of node.children ?? []) {
		if (isMarkdownComponent(child)) visit(child);
		else visitMarkdownDescendants(child, visit);
	}
}

function patchUserMessageRender(): void {
	const proto = UserMessageComponent.prototype as any;
	if (proto[USER_MESSAGE_PATCH_FLAG]) return;
	const originalRender = proto.render;
	if (typeof originalRender !== "function") return;
	proto.render = function patchedUserMessageRender(width: number) {
		const cached = messageRenderCacheHit(this, width);
		if (cached) return cached;
		visitMarkdownDescendants(this, (child) => {
			const markdownAny = child as any;
			if (typeof markdownAny.text === "string") {
				const stripped = stripTransientMagicContextTags(markdownAny.text);
				if (stripped !== markdownAny.text) {
					markdownAny.text = stripped;
					child.invalidate?.();
				}
			}
			makeMarkdownLinksCopySafe(child);
			if (markdownAny.defaultTextStyle?.bgColor) {
				markdownAny.defaultTextStyle.bgColor = undefined;
				child.invalidate?.();
			}
		});
		const borderWidth = Math.max(1, width);
		const contentWidth = Math.max(1, borderWidth - 4);
		const lines = originalRender.call(this, contentWidth);
		if (!Array.isArray(lines) || lines.length === 0) return lines;
		const rendered = [
			roundedUserBorder(borderWidth, true),
			...lines.slice(1, -1).map((line: string) => borderedUserMessageLine(line, borderWidth)),
			roundedUserBorder(borderWidth, false),
		];
		const clamped = rendered.map((line) => clampLineWidth(line, borderWidth));
		return storeMessageRenderCache(this, width, applyTerminalCopyZones(clamped));
	};
	proto[USER_MESSAGE_PATCH_FLAG] = true;
}

function patchAssistantMessages(): void {
	const proto = AssistantMessageComponent.prototype as any;
	const originalRender = proto.render;
	if (typeof originalRender === "function" && !proto[ASSISTANT_RENDER_PATCH_FLAG]) {
		proto.render = function patchedAssistantMessageRender(width: number) {
			const cached = messageRenderCacheHit(this, width);
			if (cached) return cached;
			visitMarkdownDescendants(this, (child) => {
				const markdownAny = child as any;
				if (typeof markdownAny.text === "string") {
					const stripped = stripTransientMagicContextTags(markdownAny.text);
					if (stripped !== markdownAny.text) {
						markdownAny.text = stripped;
						child.invalidate?.();
					}
				}
			});
			const lines = originalRender.call(this, width);
			if (!Array.isArray(lines) || lines.length === 0) return lines;
			if ((this as any).hasToolCalls) {
				// Tool-call messages skip copy-zone processing, but still benefit from
				// caching the rendered output to avoid re-rendering stable children.
				return storeMessageRenderCache(this, width, lines);
			}
			return storeMessageRenderCache(this, width, applyTerminalCopyZones(lines));
		};
		proto[ASSISTANT_RENDER_PATCH_FLAG] = true;
	}
	// Pi reloads Markdown with a new class identity before it rebuilds the chat.
	// Refresh this wrapper on each extension load so instanceof uses that identity.
	// Keep one base method to prevent wrappers from stacking across reloads.
	if (typeof proto[ASSISTANT_UPDATE_BASE] !== "function") {
		proto[ASSISTANT_UPDATE_BASE] = proto.updateContent;
	}
	const originalUpdateContent = proto[ASSISTANT_UPDATE_BASE];
	if (typeof originalUpdateContent !== "function") return;
	proto.updateContent = function patchedUpdateContent(message: any, isStreaming?: boolean) {
		// Content changed (also reached via invalidate() → updateContent): drop the
		// cached rendered output so the next render rebuilds with the new children.
		clearMessageRenderCache(this);
		if (!(this as any)[WORKED_START_KEY]) {
			(this as any)[WORKED_START_KEY] = Date.now();
		}
		if (!message || !Array.isArray(message.content)) {
			return originalUpdateContent.call(this, message, isStreaming);
		}
		// Thinking display:
		// When thinking blocks are expanded via Ctrl+T (`hideThinkingBlock === false`),
		// all thinking blocks (old and new) render in full markdown.
		// When thinking blocks are collapsed (`hideThinkingBlock === true`):
		// - "live" mode (default): the actively-streaming thinking block renders
		//   expanded while streaming, and collapses to `Thought for Xs` once done.
		// - "full" mode: behaves like stock pi (stays collapsed).
		const liveMode = getThinkingMode() === "live";
		const thinkingCollapsed = !!(this as any).hideThinkingBlock;
		const showLiveThinking = liveMode && thinkingCollapsed && isLiveThinkingMessage(this, message);
		if (thinkingCollapsed && messageHasThinkingContent(message)) {
			// Pi wraps this in theme.italic/fg again — keep plain label for the placeholder pass.
			(this as any).hiddenThinkingLabel = "Thinking…";
		}
		if (showLiveThinking) (this as any).hideThinkingBlock = false;
		try {
			// Call original to build all children (text, thinking, spacers, errors)
			originalUpdateContent.call(this, message, isStreaming);
		} finally {
			if (showLiveThinking) (this as any).hideThinkingBlock = true;
		}
		// Replace text-block Markdown children with DottedParagraph wrappers
		const container = (this as any).contentContainer;
		if (!container?.children) return;
		if (thinkingCollapsed && !showLiveThinking && messageHasThinkingContent(message)) {
			replaceHiddenThinkingPlaceholders(container, message);
		}
		const mdTheme = (this as any).markdownTheme;
		for (let i = container.children.length - 1; i >= 0; i--) {
			const child = container.children[i];
			const inner = (child as any)?.child ?? child;
			if (isMarkdownComponent(inner)) {
				const text = (inner as any).text;
				if (!text) continue;
				const isThinking = !!(inner as any).defaultTextStyle?.italic;
				if (isThinking) {
					const style = (inner as any).defaultTextStyle;
					const replacement = new ThinkingParagraph(text, mdTheme, style);
					if ((child as any)?.child !== undefined) {
						(child as any).child = replacement;
					} else {
						container.children[i] = replacement;
					}
				} else {
					const replacement = new DottedParagraph(
						text,
						mdTheme,
						(this as any).markdownTransformers,
						(this as any).isStreaming,
					);
					if ((child as any)?.child !== undefined) {
						(child as any).child = replacement;
					} else {
						container.children[i] = replacement;
					}
				}
			}
		}
		const explicitDuration = (message as any)[WORKED_DURATION_KEY];
		const explicitSessionTotal = (message as any)[WORKED_SESSION_TOTAL_KEY];
		const explicitTurns = (message as any)[WORKED_TURNS_KEY];
		// The "Turn took" line must only appear once the stream has truly closed.
		// `message.stopReason === "stop"` is not a safe "finished" signal here because
		// providers may initialize a live message with that value. The `message_end`
		// handler stamps `explicitDuration` after the final stream event. Render the
		// styled line as a TUI child so ANSI presentation never enters message content
		// or persisted session transcripts.
		const isFinalAssistantMessage = message.stopReason === "stop";
		const workedDuration = typeof explicitDuration === "number" ? explicitDuration : undefined;
		const workedSessionTotal = typeof explicitSessionTotal === "number"
			? explicitSessionTotal
			: typeof sessionStartMs === "number"
				? Date.now() - sessionStartMs
				: undefined;
		const workedTurns = typeof explicitTurns === "number" ? explicitTurns : userTurnCount;
		const hasAssistantText = message.content.some((block: any) => block?.type === "text" && typeof block.text === "string" && block.text.trim());
		if (typeof workedDuration === "number" && isFinalAssistantMessage && hasAssistantText && !hasWorkedDurationLine(message)) {
			container.children.push(new Spacer(1), new Text(workedDurationText(workedDuration, workedSessionTotal, workedTurns), 1, 0));
		}
	};
	proto[ASSISTANT_PATCH_FLAG] = true;
}

const TOOL_BG_PATCH_FLAG = Symbol.for("pi-claude-style-tools:patched-tool-bg-sync");

function patchToolExecutionBackgroundSync(): void {
	const proto = ToolExecutionComponent.prototype as any;
	if (proto[TOOL_BG_PATCH_FLAG]) return;
	const originalUpdateDisplay = proto.updateDisplay;
	if (typeof originalUpdateDisplay !== "function") return;
	proto.updateDisplay = function patchedToolBackgroundSync(this: any) {
		syncToolBackgroundMode();
		applyToolBackgroundMode(getGlobalPiTheme());
		return originalUpdateDisplay.apply(this, arguments as any);
	};
	proto[TOOL_BG_PATCH_FLAG] = true;
}

function resultTextContent(result: any): string {
	if (!Array.isArray(result?.content)) return "";
	return result.content
		.filter((block: any) => block?.type === "text" && typeof block.text === "string")
		.map((block: any) => block.text)
		.join("\n")
		.replace(/\r\n?/g, "\n");
}

function completeMcpResultForPresentation(result: any, state: any): any {
	const path = result?.details?.outputGuard?.truncated === true ? result.details.outputGuard.fullOutputPath : undefined;
	if (typeof path !== "string" || !path) return result;
	const cached = state?.[MCP_SPILL_PRESENTATION_CACHE]; if (cached?.source === result && cached.path === path) return cached.result;
	let descriptor: number | undefined;
	try {
		descriptor = openSync(path, "r");
		const metadata = fstatSync(descriptor);
		if (!metadata.isFile() || metadata.size <= 0 || metadata.size > MAX_MCP_PRESENTATION_SPILL_BYTES) return result;
		const bytes = Buffer.allocUnsafe(metadata.size); let offset = 0;
		while (offset < bytes.length) { const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset); if (count <= 0) return result; offset += count; }
		const text = bytes.toString("utf8"); JSON.parse(text.trim());
		const presentationResult = Object.freeze({ ...result, content: Object.freeze([
			Object.freeze({ type: "text", text }), ...(Array.isArray(result?.content) ? result.content.filter((block: any) => block?.type !== "text") : []),
		]) });
		if (state && typeof state === "object") state[MCP_SPILL_PRESENTATION_CACHE] = { source: result, path, result: presentationResult };
		return presentationResult;
	} catch { return result; }
	finally { if (descriptor !== undefined) try { closeSync(descriptor); } catch { /* Keep the raw preview fallback. */ } }
}

function syncLiveToolRenderState(component: any): void {
	// updateDisplay paints call header BEFORE result. Pre-seed status + live line
	// count so the header's blinking ● and `(N lines)` trail stay in sync with
	// the partial result that is about to render underneath.
	const state = component?.rendererState;
	if (!state || typeof state !== "object") return;
	const ctxLike = {
		state,
		isPartial: component?.isPartial === true,
		executionStarted: component?.executionStarted === true,
		isError: component?.result?.isError === true,
	};
	syncToolCallStatus(ctxLike);
	if (component?.isPartial === true && component?.result) {
		state._liveLineCount = resultTextContent(component.result).split("\n").filter((line) => line.trim()).length;
	} else if (component?.isPartial !== true) {
		delete state._liveLineCount;
	}
}

function patchToolRenderCacheInvalidation(): void {
	const proto = ToolExecutionComponent.prototype as any;
	if (proto[TOOL_CACHE_PATCH_FLAG]) return;

	const methods = [
		"updateDisplay",
		"updateArgs",
		"markExecutionStarted",
		"setArgsComplete",
		"updateResult",
		"setExpanded",
		"setShowImages",
		"setImageWidthCells",
		"invalidate",
	];

	for (const method of methods) {
		const original = proto[method];
		if (typeof original !== "function") continue;
		proto[method] = function patchedToolMutation(...args: any[]) {
			clearToolRenderCache(this);
			if (method === "updateDisplay" || method === "updateResult" || method === "invalidate") {
				syncLiveToolRenderState(this);
			}
			const previousDetailTool = toolRenderBridge.localDetailTool;
			if (method === "updateDisplay") toolRenderBridge.localDetailTool = this;
			try {
				return original.apply(this, args);
			} finally {
				if (previousDetailTool === undefined) delete toolRenderBridge.localDetailTool;
				else toolRenderBridge.localDetailTool = previousDetailTool;
				clearToolRenderCache(this);
			}
		};
	}

	proto[TOOL_CACHE_PATCH_FLAG] = true;
}

function deleteRenderedKittyImages(component: any): void {
	if (!process.stdout.isTTY || getCapabilities().images !== "kitty" || !Array.isArray(component.imageComponents) || component.imageComponents.length === 0) return;
	try { process.stdout.write(deleteAllKittyImages()); } catch { /* noop */ }
}

function removeImageChildren(component: any): void {
	deleteRenderedKittyImages(component);
	const children = [
		...(Array.isArray(component.imageComponents) ? component.imageComponents : []),
		...(Array.isArray(component.imageSpacers) ? component.imageSpacers : []),
	];
	for (const child of children) {
		try { component.removeChild?.(child); } catch { /* noop */ }
	}
	component.imageComponents = [];
	component.imageSpacers = [];
}

function patchReadImageExpansion(): void {
	const proto = ToolExecutionComponent.prototype as any;
	if (proto[TOOL_IMAGE_EXPAND_PATCH_FLAG]) return;
	const originalUpdateDisplay = proto.updateDisplay;
	if (typeof originalUpdateDisplay !== "function") return;
	proto.updateDisplay = function patchedReadImageUpdateDisplay(...args: any[]) {
		const result = originalUpdateDisplay.apply(this, args);
		const hasImage = Array.isArray(this.result?.content) && this.result.content.some((block: any) => block?.type === "image");
		const isMcp = isMcpToolName(this.toolName ?? "") || isMcpToolCandidate(this.toolDefinition);
		const mcpMode = getMode(readSettings().mcpOutputMode, ["hidden", "summary", "preview"] as const, "preview");
		const hideImage = this.toolName === "read" && this.expanded !== true
			|| isMcp && (this.expanded !== true || mcpMode !== "preview");
		if (hasImage && hideImage) {
			removeImageChildren(this);
			clearToolRenderCache(this);
		}
		return result;
	};
	proto[TOOL_IMAGE_EXPAND_PATCH_FLAG] = true;
}

function clickAnchorStart(line: string): number {
	const plain = stripAnsi(line);
	const leading = plain.match(/^\s*/)?.[0] ?? "";
	let start = visibleWidth(leading);
	let rest = plain.slice(leading.length);
	let branch = /^(?:├|└|│)(?:─{1,2})?\s+/.exec(rest);
	while (branch) {
		start += visibleWidth(branch[0]);
		rest = rest.slice(branch[0].length);
		branch = /^(?:├|└|│)(?:─{1,2})?\s+/.exec(rest);
	}
	const status = /^[●⬤•·✓✗○◐]\s+/.exec(rest);
	if (status) start += visibleWidth(status[0]);
	return start;
}

function renderedToolClickAnchors(tool: any, rendered: string[]): ToolClickAnchor[] {
	const anchors: ToolClickAnchor[] = [];
	for (let line = 0; line < rendered.length; line++) {
		const plain = stripAnsi(rendered[line]);
		const matches = [...plain.matchAll(/click (?:to expand|to collapse|for more detail|for less detail)/gi)];
		for (const match of matches) {
			const phrase = match[0].toLowerCase();
			const action: ToolClickAction = phrase === "click to expand" || phrase === "click to collapse"
				? "expand"
				: phrase === "click for less detail" || !toolSupportsProgressiveLocalDetail(tool)
					? "detail-extra"
					: "detail";
			const finalCollapse = phrase === "click to collapse" && /output ends here/i.test(plain);
			const exactSpan = matches.length > 1 || finalCollapse;
			const targetStart = finalCollapse ? plain.toLowerCase().indexOf("output ends here") : match.index ?? 0;
			const start = exactSpan ? visibleWidth(plain.slice(0, targetStart)) : clickAnchorStart(rendered[line]);
			const end = exactSpan
				? finalCollapse
					? visibleWidth(plain.trimEnd())
					: visibleWidth(plain.slice(0, (match.index ?? 0) + match[0].length))
				: visibleWidth(plain.trimEnd());
			if (end > start) anchors.push({
				line,
				start,
				end,
				action,
				viewportAnchor: finalCollapse ? "bottom" : "top",
			});
		}
	}
	return anchors;
}

function renderedToolHeaderFallbackAnchor(
	tool: any,
	rendered: string[],
	fallbacks: ToolClickAnchor[],
): ToolClickAnchor | undefined {
	if (String(tool?.toolName ?? "").toLowerCase() !== "bash") return undefined;
	const collapsedResult = fallbacks.find((anchor) => (
		/click to expand/i.test(stripAnsi(rendered[anchor.line] ?? ""))
	));
	if (!collapsedResult) return undefined;
	for (let line = collapsedResult.line - 1; line >= 0; line--) {
		const plain = stripAnsi(rendered[line]);
		let rest = plain.trimStart();
		let branch = /^(?:├|└|│)(?:─{1,2})?\s+/.exec(rest);
		while (branch) {
			rest = rest.slice(branch[0].length);
			branch = /^(?:├|└|│)(?:─{1,2})?\s+/.exec(rest);
		}
		if (!/^[●⬤•·✓✗○◐]\s+Bash(?:\s|$)/i.test(rest)) continue;
		const start = clickAnchorStart(rendered[line]);
		const end = visibleWidth(plain.trimEnd());
		if (end > start) return { line, start, end, action: "header", viewportAnchor: "top" };
	}
	return undefined;
}

function toolHasEffectiveClickAction(tool: any): boolean {
	if (tool?.[TOOL_CLICK_LOCAL_EXPANDED] === true) return true;
	if (tool?.[TOOL_CLICK_RENDERED_FALLBACK] === true) return true;
	if (isSideQuestBinaryTool(tool)) return sideQuestBinaryHasHiddenContent(tool);
	return [tool.callRendererComponent, tool.resultRendererComponent]
		.filter(isToolTextComponent)
		.some((component) => component.hasClickAction(tool));
}

function collectToolClickAnchors(tool: any, rendered: string[]): ToolClickAnchor[] {
	if (!toolClickExpansionActive(tool)) {
		tool[TOOL_CLICK_RENDERED_FALLBACK] = false;
		return [];
	}
	const anchors: ToolClickAnchor[] = [];
	if (isSideQuestBinaryTool(tool)) {
		if (sideQuestBinaryHasHiddenContent(tool)) {
			const firstLine = rendered.length >= 2
				&& !stripAnsi(rendered[0]).trim()
				&& !rendered[0].includes("\x1b[48;") ? 1 : 0;
			for (let line = firstLine; line < rendered.length; line++) {
				anchors.push({
					line,
					start: 0,
					end: Math.max(1, visibleWidth(stripAnsi(rendered[line]))),
					action: "expand",
					viewportAnchor: "top",
				});
			}
		}
		tool[TOOL_CLICK_RENDERED_FALLBACK] = false;
		return anchors;
	}
	const components = [tool.callRendererComponent, tool.resultRendererComponent]
		.filter(isToolTextComponent);
	let declaredResultSummaryRow = -1;
	for (const component of components) {
		for (const semantic of component.getSemanticRows()) {
			const needle = semantic.anchorText ?? stripAnsi(semantic.text).trim();
			if (!needle) continue;
			const matched = rendered.findIndex((line) => stripAnsi(line).includes(needle));
			if (matched < 0) continue;
			if (
				declaredResultSummaryRow < 0
				&& component === tool.resultRendererComponent
				&& semantic.action === "expand"
			) declaredResultSummaryRow = matched;
			const plain = stripAnsi(rendered[matched]);
			const targetIndex = semantic.anchorText ? plain.indexOf(semantic.anchorText) : -1;
			const start = targetIndex >= 0 ? visibleWidth(plain.slice(0, targetIndex)) : clickAnchorStart(rendered[matched]);
			const end = targetIndex >= 0 ? start + visibleWidth(semantic.anchorText!) : visibleWidth(plain.trimEnd());
			if (end > start) anchors.push({
				line: matched,
				start,
				end,
				action: semantic.action,
				viewportAnchor: semantic.viewportAnchor,
			});
		}
	}
	const agentPresentation = sideQuestAgentPresentation(tool);
	if (String(tool?.toolName ?? "").toLowerCase() === "agent" && agentPresentation) {
		const summaryRow = declaredResultSummaryRow;
		const headerStart = rendered.findIndex((line, index) => index < summaryRow && /\bAgent\b/.test(stripAnsi(line)));
		for (let line = headerStart; line >= 0 && line < summaryRow; line++) {
			const plain = stripAnsi(rendered[line]);
			if (!plain.trim() || /^─+$/.test(plain.trim())) continue;
			const start = clickAnchorStart(rendered[line]);
			const end = visibleWidth(plain.trimEnd());
			if (end > start) anchors.push({ line, start, end, action: "header", viewportAnchor: "top" });
		}
	}
	const renderedFallbacks = renderedToolClickAnchors(tool, rendered);
	for (const fallback of renderedFallbacks) {
		if (!anchors.some((anchor) => (
			anchor.line === fallback.line
			&& anchor.action === fallback.action
			&& anchor.viewportAnchor === fallback.viewportAnchor
		))) anchors.push(fallback);
	}
	if (!anchors.some((anchor) => anchor.action === "header")) {
		const headerFallback = renderedToolHeaderFallbackAnchor(tool, rendered, renderedFallbacks);
		if (headerFallback) anchors.push(headerFallback);
	}
	tool[TOOL_CLICK_RENDERED_FALLBACK] = renderedFallbacks.length > 0;
	return anchors;
}

function rawIndexAtVisibleColumn(text: string, targetColumn: number): number {
	let index = 0;
	let column = 0;
	while (index < text.length) {
		if (text[index] === "\x1b") {
			const control = /^(?:\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\))/.exec(text.slice(index));
			if (control) {
				index += control[0].length;
				continue;
			}
		}
		if (column >= targetColumn) return index;
		const point = text.codePointAt(index);
		if (point === undefined) break;
		const character = String.fromCodePoint(point);
		const nextColumn = column + visibleWidth(character);
		if (nextColumn > targetColumn) return index;
		column = nextColumn;
		index += character.length;
	}
	return index;
}

function declarePublishedToolClickAnchors(tool: any, rendered: string[]): string[] {
	if (!clickExpansionModule) return rendered;
	const anchors = collectToolClickAnchors(tool, rendered);
	if (anchors.length === 0) return rendered;
	const output = [...rendered];
	for (let line = 0; line < output.length; line++) {
		const selected: ToolClickAnchor[] = [];
		for (const anchor of anchors) {
			if (anchor.line !== line || anchor.end <= anchor.start) continue;
			if (selected.some((candidate) => anchor.start < candidate.end && anchor.end > candidate.start)) continue;
			selected.push(anchor);
		}
		selected.sort((left, right) => right.start - left.start);
		for (const anchor of selected) {
			const startIndex = rawIndexAtVisibleColumn(output[line], anchor.start);
			const endIndex = rawIndexAtVisibleColumn(output[line], anchor.end);
			const segment = output[line].slice(startIndex, endIndex);
			const exactText = stripAnsi(segment);
			if (!exactText) continue;
			const behavior = anchor.action === "detail"
				? "next-detail"
				: anchor.action === "detail-extra" ? "toggle-max-detail" : "toggle";
			const viewport = anchor.action === "expand"
				&& tool?.expanded === true
				&& isSideQuestBinaryTool(tool)
				? "adaptive"
				: anchor.viewportAnchor;
			const declared = clickExpansionModule.declare(
				{ kind: "tool-execution", execution: tool },
				segment,
				{
					behavior,
					viewport,
					compatibilityAction: anchor.action,
					span: { text: exactText },
				} as InternalClickExpansionDeclaration,
			);
			output[line] = `${output[line].slice(0, startIndex)}${declared}${output[line].slice(endIndex)}`;
		}
	}
	return output;
}

function publishStandaloneToolClickAnchors(tool: any, rendered: string[]): string[] {
	if (!clickExpansionModule) return rendered;
	const declared = declarePublishedToolClickAnchors(tool, rendered);
	return [...clickExpansionModule.publish(tool, declared)];
}

function beginToolClickActivation(
	tool: any,
	behavior: "toggle" | "next-detail" | "toggle-max-detail",
	viewport: "top" | "bottom" | "adaptive",
	compatibilityAction?: ToolClickAction,
): false | { complete(): void; rollback(): void } {
	if (!toolHasEffectiveClickAction(tool)) return false;
	if (diffPresentationModule.isPending(tool.rendererState ?? tool)) return false;
	const action = compatibilityAction
		?? (behavior === "next-detail" ? "detail" : behavior === "toggle-max-detail" ? "detail-extra" : "header");
	const requested = viewport === "adaptive"
		? "adaptive"
		: requestedToolClickViewportAnchor(tool, action, viewport);
	return beginToolCollapseViewportTransaction(tool, requested, tool.rendererState);
}

function captureToolViewportRollback(
	tool: any,
	behavior: "toggle" | "next-detail" | "toggle-max-detail",
	viewport: "top" | "bottom" | "adaptive",
	compatibilityAction?: ToolClickAction,
): () => void {
	const action = compatibilityAction
		?? (behavior === "next-detail" ? "detail" : behavior === "toggle-max-detail" ? "detail-extra" : "header");
	const requested = viewport === "adaptive"
		? "adaptive"
		: requestedToolClickViewportAnchor(tool, action, viewport);
	return captureToolCollapseViewportRollback(tool, requested, tool.rendererState);
}

function frameStandaloneMcpLines(rendered: string[], width: number): string[] {
	let start = 0;
	while (start < rendered.length && isBlankLine(rendered[start])) start++;
	let end = rendered.length - 1;
	while (end >= start && isBlankLine(rendered[end])) end--;
	if (start > end) return rendered;

	const safeWidth = Math.max(1, width);
	const { textLines, imageLines } = splitRenderedImageBlock(rendered.slice(start, end + 1));
	const core = textLines.map((line) => (
		clampLineWidth(stripOuterBackgroundAnsi(normalizeLeadingCheckGlyph(line)), safeWidth)
	));
	if (core.length === 0) return rendered;
	return [
		" ".repeat(safeWidth),
		borderLine(safeWidth),
		...core,
		borderLine(safeWidth),
		...imageLines,
	];
}

function hasStandaloneOutlineFrame(rendered: string[]): boolean {
	const core = trimRenderedBlankLines(rendered);
	return core.length >= 2
		&& /^─+$/.test(stripAnsi(core[0]).trim())
		&& /^─+$/.test(stripAnsi(core.at(-1) ?? "").trim());
}

function adaptedToolResultRenderer(tool: any, activeGetter: (...args: any[]) => any): any {
	const toolName = typeof tool?.toolName === "string" ? tool.toolName : "";
	let renderer: any;
	if (toolName === "apply_patch") {
		renderer = (result: any, options: any, theme: Theme, ctx: any) =>
			renderApplyPatchResult({ content: result.content, details: result.details }, options.isPartial, theme, ctx);
	} else if (isMcpToolName(toolName)) {
		renderer = (result: any, options: any, theme: Theme, ctx: any) =>
			renderMcpToolResult(result, !!options?.expanded, !!options?.isPartial, theme, ctx);
	} else {
		const delegatedRenderer = activeGetter.call(tool);
		if (typeof delegatedRenderer === "function") {
			renderer = delegatedRenderer;
		} else if (shouldUseGenericToolRenderer(toolName)) {
			renderer = (result: any, options: any, theme: Theme, ctx: any) =>
				renderGenericToolResult(toolName, result, options, theme, ctx);
		}
	}
	if (typeof renderer !== "function") return renderer;
	// Strip transient Magic Context tags from the text the renderer sees,
	// without touching the stored result message.
	return (result: any, options: any, theme: Theme, ctx: any) => {
		const sanitized = sanitizeToolResultForDisplay(result);
		if (
			toolName.toLowerCase() === "agent"
			&& sideQuestAgentPresentation(sanitized)
			&& toolClickExpansionActive(toolRenderBridge.localDetailTool)
		) {
			return renderOpenAiToolResult("Agent", sanitized, !!options?.expanded, !!options?.isPartial, theme, ctx);
		}
		return renderer(sanitized, options, theme, ctx);
	};
}

function toolClickAnchorAtPoint(tool: any, x: number, y: number): PublishedToolClickAnchor | undefined {
	if (!toolClickExpansionActive(tool)) return undefined;
	const hitTest = tool?.clickAnchorAtPoint;
	return typeof hitTest === "function" ? hitTest.call(tool, x, y) : undefined;
}

function refreshToolExecutionClickHandlers(proto: any): void {
	proto[CLICK_EXPANSION_ACTIVATION_HOST] = function toolActivationHost(
		behavior: "toggle" | "next-detail" | "toggle-max-detail",
		viewport: "top" | "bottom" | "adaptive",
		compatibilityAction?: ToolClickAction,
	) {
		return beginToolClickActivation(this, behavior, viewport, compatibilityAction);
	};
	proto[CLICK_EXPANSION_ROLLBACK_HOST] = function toolRollbackHost(
		behavior: "toggle" | "next-detail" | "toggle-max-detail",
		viewport: "top" | "bottom" | "adaptive",
		compatibilityAction?: ToolClickAction,
	) {
		return captureToolViewportRollback(this, behavior, viewport, compatibilityAction);
	};
	proto.activateClickAction = function activatePublishedTool(
		action: ToolClickAction,
		viewport: ToolViewportAnchor = "top",
	): boolean {
		const activate = (globalThis as any)[CLICK_EXPANSION_ACTIVATE_TARGET];
		const behavior = action === "detail"
			? "next-detail"
			: action === "detail-extra" ? "toggle-max-detail" : "toggle";
		return activate?.(
			{ kind: "tool-execution", execution: this },
			behavior,
			viewport,
			action,
		) === true;
	};
}

function patchToolExecutionRenderers(): void {
	const proto = ToolExecutionComponent.prototype as any;
	refreshToolExecutionClickHandlers(proto);
	if (proto[TOOL_EXECUTION_PATCH_FLAG]) return;

	const originalRender = proto.render;
	const originalUpdateDisplay = proto.updateDisplay;
	const originalHasRendererDefinition = proto.hasRendererDefinition;
	const originalGetCallRenderer = proto.getCallRenderer;
	const originalGetResultRenderer = proto.getResultRenderer;
	const originalGetRenderShell = proto.getRenderShell;

	if (typeof originalRender === "function") {
		proto.render = function patchedToolExecutionRender(width: number): string[] {
			const activeResultGetter = this.getResultRenderer;
			const staleAgentAdapter = String(this.toolName ?? "").toLowerCase() === "agent"
				&& this.result !== undefined
				&& sideQuestAgentPresentation(this) === undefined
				&& isToolTextComponent(this.resultRendererComponent)
				&& String(this.resultRendererComponent.value ?? "").includes(RESULT_SUMMARY_WRAP_MARK);
			if (
				staleAgentAdapter
				|| this.result !== undefined && this[TOOL_RESULT_GETTER_SEEN] !== activeResultGetter
			) this.updateDisplay?.();
			syncToolOutputPad(this, readPiOutputPad());
			for (const component of [this.callRendererComponent, this.resultRendererComponent]) {
				if (isToolTextComponent(component)) (component as any)[TOOL_CLICK_OWNER] = this;
			}
			const rendered = originalRender.call(this, width);
			const toolName = String(this.toolName ?? "").toLowerCase();
			const isMcp = isMcpToolName(this.toolName ?? "") || isMcpToolCandidate(this.toolDefinition);
			const isStandaloneSideQuest = toolName === "agent";
			const needsStandaloneFrame = (isMcp || isStandaloneSideQuest && toolBackgroundMode === "outlines")
				&& !hasStandaloneOutlineFrame(rendered);
			const output = needsStandaloneFrame ? frameStandaloneMcpLines(rendered, width) : rendered;
			return publishStandaloneToolClickAnchors(this, output);
		};
	}

	if (typeof originalUpdateDisplay === "function") {
		proto.updateDisplay = function patchedToolExecutionUpdateDisplay(this: any, ...args: any[]): any {
			const activeGetter = this.getResultRenderer;
			if (typeof activeGetter !== "function") return originalUpdateDisplay.apply(this, args);
			if (activeGetter[TOOL_RESULT_GETTER_ADAPTED] === true) {
				const result = originalUpdateDisplay.apply(this, args);
				this[TOOL_RESULT_GETTER_SEEN] = activeGetter;
				return result;
			}
			const execution = this;
			const shadow = Object.create(Object.getPrototypeOf(execution));
			const adaptedExecution = new Proxy(shadow, {
				get(_target, property) {
					if (property === "getResultRenderer") {
						return () => adaptedToolResultRenderer(execution, activeGetter);
					}
					return Reflect.get(execution, property, execution);
				},
				set(_target, property, value) {
					return Reflect.set(execution, property, value, execution);
				},
			});
			const result = originalUpdateDisplay.apply(adaptedExecution, args);
			execution[TOOL_RESULT_GETTER_SEEN] = activeGetter;
			return result;
		};
	}

	if (typeof originalGetResultRenderer === "function") {
		const initialResultGetter = function patchedInitialResultGetter(this: any): any {
			return adaptedToolResultRenderer(this, originalGetResultRenderer);
		};
		initialResultGetter[TOOL_RESULT_GETTER_ADAPTED] = true;
		proto.getResultRenderer = initialResultGetter;
	}

	if (typeof originalHasRendererDefinition === "function") {
		proto.hasRendererDefinition = function patchedHasRendererDefinition() {
			return originalHasRendererDefinition.call(this) || shouldUseGenericToolRenderer(this?.toolName);
		};
	}

	if (typeof originalGetRenderShell === "function") {
		proto.getRenderShell = function patchedGetRenderShell() {
			const toolName = typeof this?.toolName === "string" ? this.toolName : "";
			return isMcpToolName(toolName) ? "self" : originalGetRenderShell.call(this);
		};
	}

	proto.getCallRenderer = function patchedGetCallRenderer() {
		const toolName = typeof this?.toolName === "string" ? this.toolName : "";
		if (toolName === "apply_patch") {
			return (args: any, theme: Theme, ctx: any) => renderApplyPatchCall(args, theme, ctx);
		}
		if (isMcpToolName(toolName)) {
			return (args: any, theme: Theme, ctx: any) => renderGenericToolCall(toolName, args, theme, ctx);
		}
		const originalRenderer = typeof originalGetCallRenderer === "function" ? originalGetCallRenderer.call(this) : undefined;
		if (typeof originalRenderer === "function") return originalRenderer;
		if (shouldUseGenericToolRenderer(toolName)) {
			return (args: any, theme: Theme, ctx: any) => renderGenericToolCall(toolName, args, theme, ctx);
		}
		return undefined;
	};

	// Fallback path for tools without a renderer definition formats raw text.
	const originalFormatToolExecution = proto.formatToolExecution;
	if (typeof originalFormatToolExecution === "function") {
		proto.formatToolExecution = function patchedFormatToolExecution(this: any, ...args: any[]) {
			const formatted = originalFormatToolExecution.apply(this, args);
			return typeof formatted === "string" ? stripTransientMagicContextTags(formatted) : formatted;
		};
	}

	proto[TOOL_EXECUTION_PATCH_FLAG] = true;
}

function shortPath(cwd: string, filePath: string): string {
	if (!filePath) return "";
	const rel = relative(cwd, filePath);
	if (!rel.startsWith("..") && !rel.startsWith("/")) return rel || ".";
	const home = process.env.HOME ?? "";
	return home ? filePath.replace(home, "~") : filePath;
}

// ---------------------------------------------------------------------------
// Status dot — flickers green/gray while pending
// ---------------------------------------------------------------------------

function toolHeader(tool: string, summary: string, theme: Theme, prefix = "", trailing = ""): string {
	applyThemePaletteIfNeeded(theme);
	const label = theme.fg("toolTitle", theme.bold(tool));
	const body = summary
		? `${label} ${HEADER_WRAP_MARK}${theme.fg("accent", summary)}`
		: label;
	return trailing ? `${prefix}${body}${trailing}` : `${prefix}${body}`;
}

function liveLineCountTrailing(ctx: any, theme: Theme): string {
	if (ctx?.isPartial !== true) return "";
	const count = ctx?.state?._liveLineCount;
	if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) return "";
	return ` ${theme.fg("muted", `(${lineCountLabel(count)})`)}`;
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
			try { entry.invalidate(); } catch { /* noop */ }
		}
		scheduleBashDurationTick();
	}, 1_000);
	unrefTimer(bashDurationTimer);
}

function registerBashDurationContext(ctx: any): void {
	const key = ctx?.state ?? ctx;
	if (!key) return;
	const invalidate = typeof ctx?.invalidate === "function" ? () => safeInvalidate(ctx) : () => {};
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

function clearAllBashDurationContexts(): void {
	BASH_DURATION_CONTEXTS.clear();
	if (bashDurationTimer) {
		clearTimeout(bashDurationTimer);
		bashDurationTimer = null;
	}
}

function syncBashDuration(ctx: any, isPartial = true): void {
	const state = ctx?.state;
	if (!state) return;
	if (state._toolStatus === "pending" && typeof state[BASH_STARTED_AT_KEY] !== "number") {
		state[BASH_STARTED_AT_KEY] = Date.now();
		delete state[BASH_ENDED_AT_KEY];
	}
	const startedAt = state[BASH_STARTED_AT_KEY];
	if (typeof startedAt !== "number") return;
	if (!isPartial || ctx?.isError) {
		if (typeof state[BASH_ENDED_AT_KEY] !== "number") state[BASH_ENDED_AT_KEY] = Date.now();
		clearBashDurationContext(ctx);
		return;
	}
	registerBashDurationContext(ctx);
}

function bashElapsedMs(ctx: any): number | undefined {
	const startedAt = ctx?.state?.[BASH_STARTED_AT_KEY];
	if (typeof startedAt !== "number") return undefined;
	const endedAt = ctx?.state?.[BASH_ENDED_AT_KEY];
	return (typeof endedAt === "number" ? endedAt : Date.now()) - startedAt;
}

const BASH_ORIGINAL_COMMANDS = new Map<string, string>();
const BASH_REWRITES = new Map<string, RtkRewriteRecord>();
const BASH_PENDING_REWRITES: RtkRewriteRecord[] = [];
const BASH_PREVIEW_INVALIDATORS = new Map<string, () => void>();

function normalizedBashCommand(command: string): string {
	return command.replace(/\s+/g, " ").trim();
}

function bashCommandsMatch(command: string, preview: string): boolean {
	const normalized = normalizedBashCommand(command);
	const candidate = normalizedBashCommand(preview);
	if (!normalized || !candidate) return false;
	if (normalized === candidate) return true;
	if (candidate.endsWith("…")) return normalized.startsWith(candidate.slice(0, -1));
	return normalized.startsWith(candidate) || candidate.startsWith(normalized);
}

function trackBashOriginal(toolCallId: unknown, args: unknown): void {
	const command = typeof (args as any)?.command === "string" ? (args as any).command : "";
	if (typeof toolCallId === "string" && command.trim()) BASH_ORIGINAL_COMMANDS.set(toolCallId, command);
}

function captureBashRewriteNotice(message: string): boolean {
	const match = message.match(/^RTK rewrite:\s*(.*?)\s*->\s*(.+)$/s);
	const rewrite = match?.[1]?.trim() && match?.[2]?.trim()
		? { original: match[1].trim(), rewritten: match[2].trim(), notice: message }
		: undefined;
	if (!rewrite) return false;
	const toolCallId = [...BASH_ORIGINAL_COMMANDS].reverse().find(([, command]) => bashCommandsMatch(command, rewrite.original))?.[0];
	if (toolCallId) BASH_REWRITES.set(toolCallId, rewrite);
	else {
		BASH_PENDING_REWRITES.push(rewrite);
		if (BASH_PENDING_REWRITES.length > 20) BASH_PENDING_REWRITES.shift();
	}
	return true;
}

function bashRewriteFor(toolCallId: unknown, args: unknown): RtkRewriteRecord | undefined {
	if (typeof toolCallId !== "string") return undefined;
	const current = typeof (args as any)?.command === "string" ? (args as any).command : undefined;
	const original = BASH_ORIGINAL_COMMANDS.get(toolCallId);
	let rewrite = BASH_REWRITES.get(toolCallId);
	if (!rewrite) {
		const index = BASH_PENDING_REWRITES.findIndex((candidate) =>
			!!original && bashCommandsMatch(original, candidate.original)
			|| !!current && (bashCommandsMatch(current, candidate.rewritten) || bashCommandsMatch(current, candidate.original)),
		);
		if (index >= 0) {
			[rewrite] = BASH_PENDING_REWRITES.splice(index, 1);
			BASH_REWRITES.set(toolCallId, rewrite);
		}
	}
	if (!rewrite && original && current && normalizedBashCommand(original) !== normalizedBashCommand(current)) {
		rewrite = { original, rewritten: current, notice: `RTK rewrite: ${original} -> ${current}` };
		BASH_REWRITES.set(toolCallId, rewrite);
	}
	return rewrite;
}

function preserveBashPreview(toolCallId: unknown, invalidate: () => void): void {
	if (typeof toolCallId === "string") BASH_PREVIEW_INVALIDATORS.set(toolCallId, invalidate);
}

function clearPreservedBashPreviews(): void {
	const invalidators = [...BASH_PREVIEW_INVALIDATORS.values()];
	BASH_PREVIEW_INVALIDATORS.clear();
	for (const invalidate of invalidators) {
		try { invalidate(); } catch { /* noop */ }
	}
}

function clearBashHostState(): void {
	BASH_ORIGINAL_COMMANDS.clear();
	BASH_REWRITES.clear();
	BASH_PENDING_REWRITES.length = 0;
	clearPreservedBashPreviews();
}

function setToolStatus(ctx: any, status: "pending" | "success" | "error" | "idle"): void {
	if (ctx?.state) ctx.state._toolStatus = status;
}

function syncToolCallStatus(ctx: any): void {
	if (ctx?.isPartial) {
		// Blink only for tools that actually started in the current agent run.
		// History rebuilds (resume, compaction, /tree) leave unmatched tool calls
		// with isPartial=true forever and never set executionStarted — those must
		// render settled, not keep a pending blink alive across sessions.
		const agentLive = currentAgentWorkStartMs !== undefined;
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

function shouldRevealCallArgs(ctx: any): boolean {
	if (ctx?.argsComplete === true || ctx?.executionStarted === true) return true;
	const args = ctx?.args;
	if (!args || typeof args !== "object") return false;
	return Object.keys(args).some((key) => args[key] !== undefined && args[key] !== null && args[key] !== "");
}

function stableCallSummary(ctx: any, key: string, build: () => string, reveal = shouldRevealCallArgs(ctx)): string {
	const state = ctx?.state;
	const cached = state?.[key];
	const completeKey = `${key}Complete`;
	if (!reveal) return typeof cached === "string" ? cached : "";
	if (ctx?.argsComplete === true && state?.[completeKey] === true && typeof cached === "string") return cached;
	if (!shouldRevealCallArgs(ctx) && typeof cached === "string" && cached) return cached;
	const summary = build();
	if (state) {
		state[key] = summary;
		if (ctx?.argsComplete === true) state[completeKey] = true;
		else delete state[completeKey];
	}
	return summary;
}

function hasOwnArg(args: any, key: string): boolean {
	return !!args && Object.prototype.hasOwnProperty.call(args, key);
}

function fileExistsForTool(cwd: string, filePath: string): boolean {
	if (!filePath) return false;
	try {
		return existsSync(resolve(cwd, filePath));
	} catch {
		return false;
	}
}

const WRITE_EXISTED_BEFORE = new Map<string, boolean>();

function patchUiNotifications(ui: any): void {
	if (!ui || ui[UI_NOTIFY_PATCH_FLAG]) return;
	const originalNotify = ui.notify;
	if (typeof originalNotify !== "function") return;
	ui.notify = function patchedUiNotify(message: string, type?: "info" | "warning" | "error") {
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

function getWriteWasNewFile(ctx: any, cwd: string, filePath: string, reveal = shouldRevealCallArgs(ctx)): boolean | undefined {
	if (typeof ctx?.state?._writeWasNewFile === "boolean") return ctx.state._writeWasNewFile;
	if (!filePath || !reveal) return undefined;
	const existedBefore = typeof ctx?.toolCallId === "string" ? WRITE_EXISTED_BEFORE.get(ctx.toolCallId) : undefined;
	const wasNew = existedBefore === undefined ? !fileExistsForTool(cwd, filePath) : !existedBefore;
	if (ctx?.state) ctx.state._writeWasNewFile = wasNew;
	return wasNew;
}

function toolStatusDot(ctx: any, theme: Theme): string {
	const status = ctx.state?._toolStatus as "pending" | "success" | "error" | "idle" | undefined;
	if (status === "success") return `${themeStatusDot(theme, "success")} `;
	if (status === "error") return `${themeStatusDot(theme, "error")} `;
	if (status === "idle") return `${themeStatusDot(theme, "dim")} `;
	return `${blinkDot(ctx, theme)} `;
}

function semanticToolCallStatus(
	ctx: any,
): Pick<SemanticCallPresentation, "status" | "activity"> {
	const status = ctx.state?._toolStatus as SemanticCallPresentation["status"] | undefined;
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

function withBranch(content: string, theme: Theme, _isError = false, continued = false): string {
	if (!content || !content.trim()) return "";
	const lines = content.split("\n");
	const first = lines[0] ?? "";
	if (lines.length === 1) return branchLead(first, continued, theme);
	const rest = lines.slice(1).map((line) => branchIndent(line, continued, theme));
	return `${branchLead(first, continued, theme)}\n${rest.join("\n")}`;
}

function withToolErrorIndent(content: string): string {
	if (!content || !content.trim()) return "";
	return content.split("\n").map((line) => `  ${WRAP_MARK}${line}`).join("\n");
}

function withClippedBranch(content: string, theme: Theme, continued = false): string {
	return withBranch(content, theme, false, continued).replaceAll(WRAP_MARK, CLIP_MARK);
}

function withFinalBranchBlock(content: string, theme: Theme): string {
	if (!content || !content.trim()) return "";
	const lines = content.split("\n");
	const first = lines[0] ?? "";
	if (lines.length === 1) return branchLead(first, false, theme);
	const middle = lines.slice(1, -1).map((line) => branchIndent(line, true, theme));
	const last = lines[lines.length - 1] ?? "";
	return [branchLead(first, true, theme), ...middle, branchLead(last, false, theme)].join("\n");
}

interface DiffOutputTreeBlock {
	heading?: string;
	content: string;
}

function renderDiffOutputTree(
	summary: string,
	blocks: DiffOutputTreeBlock[],
	terminalAction: string | undefined,
	theme: Theme,
): string {
	const rows: Array<{ text: string; sibling: boolean }> = [{ text: summary, sibling: true }];
	if (blocks[0]?.heading) rows.push({ text: "", sibling: false });
	blocks.forEach((block, blockIndex) => {
		if (block.heading) rows.push({ text: block.heading, sibling: true });
		if (block.content) {
			for (const line of block.content.split("\n")) rows.push({ text: line, sibling: false });
		}
		if (blockIndex < blocks.length - 1) rows.push({ text: "", sibling: false });
	});
	if (terminalAction) rows.push({ text: terminalAction, sibling: true });
	return rows.map((row, index) => {
		if (index === rows.length - 1) return branchLead(row.text, false, theme);
		return row.sibling ? branchLead(row.text, true, theme) : branchIndent(row.text, true, theme);
	}).join("\n");
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

function markBlinkActivity(): void {
	_lastBlinkActivity = Date.now();
}

type BlinkEntry = { key: any; order: number; invalidate: () => void };

const _blinkContexts = new Map<any, BlinkEntry>();
let _globalBlinkTimer: ReturnType<typeof setTimeout> | null = null;
let _blinkOrder = 0;
// Shared phase for all blinkers. Ordinary tools use even/odd (on/off ●).
// Agent-family tools map the index onto a 6-step size breath cycle.
let _globalBlinkPhaseIndex = 0;
let _globalBlinkPhase = true;

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
			try { entry.invalidate(); } catch { /* noop */ }
		}
	}
}

function _clearAllBlinkContexts(): void {
	for (const entry of _blinkContexts.values()) {
		try { entry.key._blinkActive = false; } catch { /* noop */ }
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
		if (currentAgentWorkStartMs !== undefined) {
			markBlinkActivity();
		} else if (_lastBlinkActivity && Date.now() - _lastBlinkActivity > BLINK_STALE_TIMEOUT_MS) {
			// Agent already finished; leftover entries are leaks. Stop the re-render storm.
			_clearAllBlinkContexts();
			return;
		}
		_globalBlinkPhaseIndex = (_globalBlinkPhaseIndex + 1) % AGENT_BREATHE_LEN;
		_globalBlinkPhase = _globalBlinkPhaseIndex % 2 === 0;
		for (const entry of getBlinkingEntries()) {
			try { entry.invalidate(); } catch { /* noop */ }
		}
		_scheduleGlobalBlinkTimer();
	}, intervalMs);
	unrefTimer(_globalBlinkTimer);
}

function _stopGlobalBlinkTimerIfEmpty(): void {
	if (_globalBlinkTimer && _blinkContexts.size === 0) {
		clearTimeout(_globalBlinkTimer);
		_globalBlinkTimer = null;
	}
}

function setupBlinkTimer(ctx: any): void {
	const key = getBlinkKey(ctx);
	if (!key) return;
	const invalidate = typeof ctx?.invalidate === "function" ? () => safeInvalidate(ctx) : () => {};
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

function clearBlinkTimer(ctx: any): void {
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
		return themeStatusDot(theme, "dim");
	}
	setupBlinkTimer(ctx);
	const key = getBlinkKey(ctx);
	if (key?._blinkActive !== true) return " ";
	// Agent-family tools breathe through sizes; ordinary tools still on/off ●.
	if (ctx?.state?._agentBreathe === true) {
		return agentBreatheDot(theme);
	}
	// Claude Code: solid filled circle that either shows or fully disappears —
	// never a hollow outlined ○ in the off phase.
	return _globalBlinkPhase ? themeStatusDot(theme, "success") : " ";
}

function lineCount(text: string): number {
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

function markResultSummary(text: string): string {
	return `${RESULT_SUMMARY_WRAP_MARK}${text}`;
}

function stripWrapMarks(text: string): string {
	return text
		.replaceAll(WRAP_MARK, "")
		.replaceAll(HEADER_WRAP_MARK, "")
		.replaceAll(RESULT_SUMMARY_WRAP_MARK, "")
		.replaceAll(LEGACY_WRAP_MARK, "");
}

function findWrapMark(line: string): { index: number; mark: string } | undefined {
	return [WRAP_MARK, HEADER_WRAP_MARK, RESULT_SUMMARY_WRAP_MARK, LEGACY_WRAP_MARK]
		.map((mark) => ({ index: line.indexOf(mark), mark }))
		.filter((candidate) => candidate.index >= 0)
		.sort((left, right) => left.index - right.index)[0];
}

const TOOL_OUTPUT_TAB_WIDTH = 4;

function expandTabStops(text: string, tabWidth = TOOL_OUTPUT_TAB_WIDTH): string {
	return text.split("\n").map((line) => {
		const segments = line.split("\t");
		if (segments.length === 1) return line;
		let expanded = segments[0];
		for (const segment of segments.slice(1)) {
			const column = visibleWidth(expanded);
			const spaces = tabWidth - (column % tabWidth);
			expanded += `${" ".repeat(spaces)}${segment}`;
		}
		return expanded;
	}).join("\n");
}

function expandToolLineTabs(line: string): string {
	const marker = findWrapMark(line);
	if (!marker) return expandTabStops(line);
	const prefix = line.slice(0, marker.index);
	const body = line.slice(marker.index + marker.mark.length);
	return `${expandTabStops(prefix)}${marker.mark}${expandTabStops(body)}`;
}

function wrapMarkedLine(line: string, width: number): string[] {
	if (line.includes(TRAILING_MARK)) return [alignTrailingMarkedLine(line, width)];
	const clipIndex = line.indexOf(CLIP_MARK);
	if (clipIndex !== -1) {
		const prefix = stripWrapMarks(line.slice(0, clipIndex));
		const body = stripWrapMarks(line.slice(clipIndex + CLIP_MARK.length));
		const bodyWidth = Math.max(1, width - visibleWidth(prefix));
		if (visibleWidth(body) <= bodyWidth) return [`${prefix}${body}`];
		const hint = "…";
		return [`${prefix}${truncateToWidth(body, Math.max(0, bodyWidth - visibleWidth(hint)), "", false)}${hint}`];
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
	const wrapped = wrapTextWithAnsi(unindentedBody, Math.max(1, bodyWidth - indentWidth));
	const continuation = markedContinuationPrefix(prefix);
	return wrapped.map((part, index) => {
		const leadingAnsi = /^(?:\x1b\[[0-9;]*m)*/.exec(part)?.[0] ?? "";
		const indentedPart = bodyIndent
			? `${leadingAnsi}${bodyIndent}${part.slice(leadingAnsi.length)}`
			: part;
		return `${index === 0 ? prefix : continuation}${indentedPart}`;
	});
}

type ToolTextSemanticRow = {
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

function findToolExecutionAncestor(value: any): any | undefined {
	if (isToolExecutionComponent(value?.[TOOL_CLICK_OWNER])) return value[TOOL_CLICK_OWNER];
	let current = value;
	for (let depth = 0; current && depth < 8; depth++) {
		if (isToolExecutionComponent(current)) return current;
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
			const expandable = presentation.surface === "result"
				? presentation.summary.expandable
				: presentation.surface === "stream"
					&& this.kernelPresentation.expansion === "collapsed"
					&& presentation.detail.totalRows > liveToolPreviewLimit();
			return expandable && toolClickExpansionActive(tool);
		}
		return this.value.split("\n").some((line) => resolveClickHints(line, tool).anchors.length > 0);
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
		const clickKey = tool ? toolClickStateKey(tool) : "none";
		const requestedPaddingX = this.followPiOutputPad ? readPiOutputPad() : 0;
		const paddingX = width > requestedPaddingX * 2 ? requestedPaddingX : 0;
		if (
			this.toolCachedLines
			&& this.toolCachedValue === this.value
			&& this.toolCachedWidth === width
			&& this.toolCachedPaddingX === paddingX
			&& this.toolCachedClickKey === clickKey
			&& (this as any)._toolBranchCacheKey === branchKey
			&& (this as any)._toolBranchCacheEpoch === _toolBranchVisualEpoch
		) return this.toolCachedLines;
		if (this.kernelPresentation) {
			const frame = presentationKernel.present(
				this.kernelPresentation.presentation,
				{
					width,
					padding: paddingX === 1 ? 1 : 0,
					expansion: this.kernelPresentation.expansion,
					detail: this.kernelPresentation.presentation.surface === "result"
						&& this.kernelPresentation.presentation.detail?.action === "max"
						? tool && toolLocalDetailLevel(tool) >= 2 ? 2 : 1
						: this.kernelPresentation.detail,
					preview: this.kernelPresentation.preview,
					clickActions: tool ? toolClickExpansionActive(tool) : false,
					theme: this.kernelPresentation.theme,
				},
			);
			const rendered = frame.rows.map((row) => row.text);
			this.semanticRows = frame.rows.flatMap((row, line) => row.actions.map((action) => {
				const plain = stripAnsi(row.text);
				const start = rawIndexAtVisibleColumn(plain, action.span.start);
				const end = rawIndexAtVisibleColumn(plain, action.span.end);
				return {
					line,
					text: row.text,
					action: action.origin === "execution-header"
						? "header" as const
						: action.behavior === "toggle"
							? "expand" as const
							: action.behavior === "max-detail" ? "detail-extra" as const : "detail" as const,
					viewportAnchor: action.viewport,
					anchorText: plain.slice(start, end),
				};
			}));
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
			const resolved = resolveClickHints(logicalLine, tool);
			const breakIndex = resolved.text.indexOf(CLICK_CONTROL_BREAK_MARK);
			let resolvedText = resolved.text.replace(CLICK_CONTROL_BREAK_MARK, "");
			if (breakIndex >= 0) {
				const before = resolved.text.slice(0, breakIndex);
				const after = resolved.text.slice(breakIndex + CLICK_CONTROL_BREAK_MARK.length);
				const usedWidth = visibleWidth(stripWrapMarks(before)) % contentWidth;
				if (usedWidth + visibleWidth(after) > contentWidth) resolvedText = `${before}\n  ${after}`;
			}
			for (const resolvedLine of resolvedText.split("\n")) {
				const wrapped = wrapMarkedLine(resolvedLine, contentWidth);
				for (const part of wrapped) {
					const line = `${horizontalPad}${padToWidth(part, contentWidth)}${horizontalPad}`;
					const lineIndex = rendered.length;
					rendered.push(line);
					if (header) semanticRows.push({ line: lineIndex, text: line, action: "header", viewportAnchor: "top" });
					if (resultSummary) semanticRows.push({ line: lineIndex, text: line, action: "expand", viewportAnchor: "top" });
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
						const target = toolSupportsProgressiveLocalDetail(tool)
							? anchor.action === "expand" ? "click to collapse" : "click for more detail"
							: anchor.action === "expand" ? "collapse" : "detail";
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

function isToolTextComponent(value: unknown): value is ToolText {
	// ToolExecution's host-level render patch survives /reload, but ToolText does
	// not keep the same class identity. Match its narrow renderer interface.
	const candidate = value as Partial<ToolText> | undefined;
	return value instanceof ToolText || Boolean(candidate)
		&& typeof candidate?.setText === "function"
		&& typeof candidate?.setFollowPiOutputPad === "function"
		&& typeof candidate?.getSemanticRows === "function"
		&& typeof candidate?.hasClickAction === "function";
}

function makeText(last: unknown, text: string, followPiOutputPad = false): Text {
	const component = isToolTextComponent(last) ? last : new ToolText();
	component.setWidthObserver();
	component.setFollowPiOutputPad(followPiOutputPad);
	component.setText(text);
	return component;
}

function makePresentationText(
	last: unknown,
	presentation: SemanticPresentation,
	view: Pick<KernelPresentationInput, "expansion" | "detail" | "preview">,
	theme: Theme,
	followPiOutputPad = false,
): Text {
	const component = isToolTextComponent(last)
		&& typeof (last as ToolText).setPresentation === "function"
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

function makeToolFamilyCallText(
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
	const decision = toolPresentationModule.present({
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
	if (decision.kind === "suppress") return makeText(ctx.lastComponent, "", followPiOutputPad);
	return makePresentationText(
		ctx.lastComponent,
		decision.presentation,
		{ expansion: ctx.expanded === true ? "expanded" : "collapsed", ...(name === "bash" ? { preview: { normal: Math.max(0, Math.floor(readSettings().bashCommandPreviewLines ?? 8)) } } : {}) },
		theme,
		followPiOutputPad,
	);
}

function decideToolFamilyResult(
	family: PresentationToolFamily,
	name: string,
	label: string,
	args: unknown,
	result: any,
	isPartial: boolean,
	ctx: any,
	policy?: ToolPresentationPolicy,
) {
	return toolPresentationModule.present({
		surface: "result",
		tool: { family, name, label },
		cwd: ctx.cwd ?? process.cwd(),
		args,
		lifecycle: {
			status: ctx.state?._toolStatus ?? (ctx.isError ? "error" : isPartial ? "pending" : "success"),
			partial: isPartial,
			argsComplete: ctx.argsComplete === true,
		},
		...(policy ? { policy } : {}),
		result: Object.freeze({
			content: Object.freeze(Array.isArray(result?.content) ? [...result.content] : []), details: result?.details, error: ctx.isError === true, partial: isPartial,
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
	const decision = decideToolFamilyResult(family, name, label, args, result, isPartial, ctx, policy);
	if (decision.kind === "suppress") return makeText(ctx.lastComponent, "", followPiOutputPad);
	return makePresentationText(ctx.lastComponent, decision.presentation, view, theme, followPiOutputPad);
}

function makeSettledToolFamilyResultText(
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
	return makeToolFamilyResultText(family, name, label, ctx.args, result, false, {
		expansion: expanded ? "expanded" : "collapsed",
		detail: options.detail ?? (expanded ? progressiveLocalDetailLevelForRender(ctx.state) : 0),
		preview: {
			normal: options.normalPreview ?? settings.previewLines,
			expanded: settings.expandedPreviewMaxLines,
			extra: settings.extraExpandedPreviewMaxLines,
		},
	}, theme, ctx, options.followPiOutputPad, options.policy);
}

function makeResponsiveDiffText(ctx: any, last: unknown, text: string): Text {
	const component = makeText(last, text) as ToolText;
	component.setWidthObserver((width) => {
		if (ctx.state?._diffComponentWidth === width) return;
		if (ctx.state) ctx.state._diffComponentWidth = width;
		safeInvalidate(ctx);
	});
	return component;
}

function makeMcpText(last: unknown, text: string): Text {
	return makeText(last, text, true);
}

function previewLimit(): number {
	const value = readSettings().previewLines;
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 8;
}

function renderedToolLocalDetailLevel(state?: Record<PropertyKey, unknown>): ToolClickDetailLevel {
	const explicit = normalizeToolClickDetailLevel(state?.[TOOL_CLICK_DETAIL_LEVEL]);
	return explicit > 0 ? explicit : toolLocalDetailLevel(toolRenderBridge.localDetailTool);
}

function progressiveLocalDetailLevelForRender(state?: Record<PropertyKey, unknown>): ToolClickDetailLevel {
	const rendererTool = toolRenderBridge.localDetailTool;
	return toolSupportsProgressiveLocalDetail(rendererTool)
		&& rendererTool?.[TOOL_CLICK_LOCAL_EXPANDED] === true
		? renderedToolLocalDetailLevel(state)
		: 0;
}

function progressiveLocalControlsEnabled(): boolean {
	const rendererTool = toolRenderBridge.localDetailTool;
	return toolSupportsProgressiveLocalDetail(rendererTool)
		&& toolClickExpansionActive(rendererTool);
}

function bashCollapsedLimit(): number {
	const value = readSettings().bashCollapsedLines;
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 10;
}

function liveToolPreviewEnabled(): boolean {
	return readSettings().liveToolPreview !== false;
}

function liveToolPreviewLimit(): number {
	const value = readSettings().liveToolPreviewLines;
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 5;
}

const safeFgAnsi = (theme: unknown, key: string) => presentationThemeAdapter.safeForeground(theme, key);
const isLightThemeBackground = (theme: unknown) => presentationThemeAdapter.isLightBackground(theme);

function presentationBranchPolicy() {
	return {
		mode: toolBranchColorModeFixed() ? "fixed" as const : "theme" as const,
		gray: getConfiguredToolBranchGray(),
		outlineBrighten: OUTLINE_CHROME_BRIGHTEN,
	};
}

function invalidateThemePaletteCache(): void {
	presentationKernel.resetPalette();
}

function themeAdaptiveEnabled(): boolean {
	const settings = readSettings();
	return settings.themeAdaptive !== false;
}

function resetThemePalette(): void {
	const configured = diffPresentationModule.compatibility.configuredForegrounds();
	invalidateThemePaletteCache();
	BORDER_COLOR = CHROME_STYLE_DEFAULTS.border;
	WORKED_LINE_FG = CHROME_STYLE_DEFAULTS.workedLine;
	CODE_BLOCK_LANG_FG = CHROME_STYLE_DEFAULTS.codeBlockLanguage;
	TOOL_STATUS_SUCCESS = CHROME_STYLE_DEFAULTS.statusSuccess;
	TOOL_STATUS_ERROR = CHROME_STYLE_DEFAULTS.statusError;
	TOOL_STATUS_PENDING = CHROME_STYLE_DEFAULTS.statusPending;
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
		overrides: diffPresentationModule.compatibility.configuredForegrounds(),
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
		expandHint: configuredKeyHint("app.tools.expand", "ctrl+o", "to expand"),
		collapseHint: configuredKeyHint("app.tools.expand", "ctrl+o", "to collapse"),
		extraDetailHint: themedRawKeyHint(theme, "ctrl+shift+o", extraToolOutputExpanded ? "less detail" : "more detail"),
	};
}

function applyThemePaletteIfNeeded(theme: any): void {
	if (!theme) return;
	applyToolBranchColor(theme);
	const resolution = presentationKernel.resolvePalette(presentationPaletteRequest(theme));
	if (resolution.changed) bumpToolBranchVisualEpoch();
	FG_DIM = resolution.colors.dim;
	FG_RULE = resolution.colors.rule;
	TOOL_STATUS_SUCCESS = resolution.colors.statusSuccess;
	TOOL_STATUS_ERROR = resolution.colors.statusError;
	TOOL_STATUS_PENDING = resolution.colors.statusPending;
}

const D_RST = "\x1b[0m";
let FG_DIM = "\x1b[38;2;80;80;80m";
let FG_RULE = "\x1b[38;2;50;50;50m";
function outlineChromeAnsiFromBranch(theme?: unknown): string {
	return presentationThemeAdapter.outlineAnsi(presentationBranchPolicy(), theme);
}

function getConfiguredToolBranchGray(): number {
	const raw = readSettings().toolBranchRgbGray;
	return typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, Math.min(255, Math.round(raw))) : DEFAULT_TOOL_BRANCH_GRAY;
}

function toolBranchColorModeFixed(): boolean {
	return readSettings().toolBranchColorMode !== "theme";
}

function toolBranchRenderCacheKey(): string {
	if (toolBranchColorModeFixed()) return `fixed:${getConfiguredToolBranchGray()}`;
	return `theme:${stripAnsi(TOOL_RULE)}`;
}

let _toolBranchVisualEpoch = 0;

function bumpToolBranchVisualEpoch(): void {
	_toolBranchVisualEpoch++;
}

/** Shared outline chrome: user box, tool rules, code fences, branch connectors. */
function resolveThemeChromeFg(theme: unknown): string | null {
	return presentationThemeAdapter.chromeForeground(theme, themeAdaptiveEnabled());
}

function currentToolBranchAnsi(theme: unknown = getGlobalPiTheme()): string {
	return presentationThemeAdapter.branchAnsi(presentationBranchPolicy(), theme);
}

/** User box, code fences, thinking/thought: branch + OUTLINE_CHROME_BRIGHTEN (never same as branch). */
function syncOutlineChromeFromBranch(theme?: any): void {
	const outline = outlineChromeAnsiFromBranch(theme);
	const prevBorder = BORDER_COLOR;
	BORDER_COLOR = outline;
	WORKED_LINE_FG = outline;
	CODE_BLOCK_LANG_FG = outline;
	if (outline !== prevBorder) bumpToolBranchVisualEpoch();
}

function applyToolBranchColor(theme?: any): void {
	const prev = TOOL_RULE;
	TOOL_RULE = currentToolBranchAnsi(theme);
	if (TOOL_RULE !== prev) bumpToolBranchVisualEpoch();
	syncOutlineChromeFromBranch(theme);
}

function refreshAllToolBranchVisuals(ctx: any): void {
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
		} catch { /* noop */ }
	}
}

/** Re-derive borders, branches, diffs, and spinner keys from the active pi theme (no cross-extension deps). */
function rebindUiChromeToTheme(ctx: any): void {
	if (!ctx?.hasUI) return;
	settingsCacheState.entry = null;
	syncToolBackgroundMode();
	bustSpinnerSettingsCache();
	applyToolBackgroundMode(ctx.ui?.theme);
	applyThemePaletteIfNeeded(ctx.ui?.theme);
	diffPresentationModule.reset();
	bumpToolBranchVisualEpoch();
	refreshAllToolBranchVisuals(ctx);
}

function scheduleDeferredChromeRebind(ctx: any, delayMs = 0): void {
	const timer = setTimeout(() => {
		try {
			rebindUiChromeToTheme(ctx);
		} catch { /* noop */ }
	}, delayMs);
	unrefTimer(timer);
}

let TOOL_RULE = currentToolBranchAnsi();
function getEditOperations(input: any): Array<{ oldText: string; newText: string }> {
	if (Array.isArray(input?.edits)) {
		return input.edits
			.map((edit: any) => ({
				oldText: typeof edit?.oldText === "string" ? edit.oldText : typeof edit?.old_text === "string" ? edit.old_text : "",
				newText: typeof edit?.newText === "string" ? edit.newText : typeof edit?.new_text === "string" ? edit.new_text : "",
			}))
			.filter((edit: { oldText: string; newText: string }) => edit.oldText && edit.oldText !== edit.newText);
	}
	const oldText = typeof input?.oldText === "string" ? input.oldText : typeof input?.old_text === "string" ? input.old_text : "";
	const newText = typeof input?.newText === "string" ? input.newText : typeof input?.new_text === "string" ? input.new_text : "";
	return oldText && oldText !== newText ? [{ oldText, newText }] : [];
}

function stripThinkingPresentationArtifacts(text: string): string {
	if (!ANSI_PRESENT_RE.test(text) && !/^\s*thinking:\s*/i.test(text)) return text;
	let current = ANSI_PRESENT_RE.test(text) ? text.replace(ANSI_RE, "") : text;
	while (true) {
		const next = current.replace(/^(?:thinking:\s*)+/i, "").trimStart();
		if (next === current) return current;
		current = next;
	}
}

function prefixThinkingLine(text: string, _theme: Theme | undefined): string {
	if (!ANSI_PRESENT_RE.test(text) && text.startsWith("Thinking: ") && !/^Thinking:\s*thinking:\s*/i.test(text)) {
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
		} catch { /* noop */ }
		// Pi may call AssistantMessageComponent.updateContent before extension
		// handlers run on the same thinking_end event — nudge one more frame.
		setTimeout(() => {
			try {
				ctx?.ui?.invalidate?.();
				ctx?.ui?.requestRender?.();
			} catch { /* noop */ }
		}, 0);
	}

	if (evt.type === "thinking_start") {
		thinkingBlockInFlight = true;
		thinkingBlockStartMs = Date.now();
		lastThinkingBlockDurationMs = undefined;
		if (message?.role === "assistant") {
			(message as any)[THINKING_ACTIVE_KEY] = true;
			delete (message as any)[THINKING_DURATION_KEY];
		}
		refreshThinkingChrome();
		return;
	}
	if (evt.type === "thinking_end") {
		thinkingBlockInFlight = false;
		const duration = Math.max(0, Date.now() - thinkingBlockStartMs);
		if (message?.role === "assistant") delete (message as any)[THINKING_ACTIVE_KEY];
		lastThinkingBlockDurationMs = duration;
		if (message?.role === "assistant") (message as any)[THINKING_DURATION_KEY] = duration;
		refreshThinkingChrome();
		return;
	}
	// Fallback: some providers/models never emit thinking_end (a second
	// thinking_start can overwrite the first, or the turn can end with toolUse).
	// The live "Thinking..." row would otherwise stick forever while later calls
	// run normally. Any non-thinking stream event on the same assistant message
	// means thinking is no longer the live activity: freeze the elapsed time into
	// a "Thought for Xs" duration so the row always resolves.
	if ((message as any)?.[THINKING_ACTIVE_KEY] || thinkingBlockInFlight) {
		if (evt.type === "text_start" || evt.type === "text_delta" || evt.type === "toolcall_start" || evt.type === "toolcall_end") {
			thinkingBlockInFlight = false;
			const duration = thinkingBlockStartMs > 0 ? Math.max(0, Date.now() - thinkingBlockStartMs) : undefined;
			if (message?.role === "assistant") delete (message as any)[THINKING_ACTIVE_KEY];
			if (typeof duration === "number") {
				lastThinkingBlockDurationMs = duration;
				if (message?.role === "assistant") (message as any)[THINKING_DURATION_KEY] = duration;
			}
			refreshThinkingChrome();
		}
	}
}

function registerThinkingLabels(pi: ExtensionAPI): void {
	const patchMessage = (event: any, theme?: Theme) => {
		// Keep theme-derived border / dim text colors in sync with the
		// active pi theme. Cheap when the theme hasn't changed (identity check).
		if (theme) applyThemePaletteIfNeeded(theme);
		const message = event?.message;
		if (!message || message.role !== "assistant" || !Array.isArray(message.content)) return;
		for (const block of message.content) {
			if (block && block.type === "thinking" && typeof block.thinking === "string") {
				block.thinking = prefixThinkingLine(block.thinking, theme);
			}
		}
	};
	pi.on("before_agent_start", async () => {
		// Start once per top-level request. Steering/follow-up messages can be
		// injected while the agent is already active; those must not reset the
		// request timer.
		if (currentAgentWorkStartMs === undefined) {
			currentAgentWorkStartMs = Date.now();
		}
		if (sessionStartMs === undefined) sessionStartMs = Date.now();
		currentAssistantMessageStartMs = undefined;
	});
	pi.on("agent_start", async () => {
		if (currentAgentWorkStartMs === undefined) {
			currentAgentWorkStartMs = Date.now();
		}
		if (sessionStartMs === undefined) sessionStartMs = Date.now();
		currentAssistantMessageStartMs = undefined;
	});
	pi.on("message_start", async (event: any) => {
		const message = event?.message;
		if (message?.role === "user" && currentAgentWorkStartMs === undefined) {
			currentAgentWorkStartMs = Date.now();
		}
		if (message?.role === "assistant") {
			currentAssistantMessageStartMs = Date.now();
			(message as any)[WORKED_START_KEY] = currentAssistantMessageStartMs;
			// A new assistant message starts a fresh thinking lifecycle. Without
			// this, a missing thinking_end on the previous message leaves the
			// global in-flight flag set and the next message renders a stale
			// "Thinking..." row until its own thinking events arrive.
			thinkingBlockInFlight = false;
			delete (message as any)[THINKING_ACTIVE_KEY];
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
			thinkingBlockInFlight = false;
			delete (message as any)[THINKING_ACTIVE_KEY];
			if (typeof (message as any)[THINKING_DURATION_KEY] !== "number") {
				const duration = thinkingBlockStartMs > 0 ? Math.max(0, Date.now() - thinkingBlockStartMs) : undefined;
				if (typeof duration === "number" && duration > 0) {
					lastThinkingBlockDurationMs = duration;
					(message as any)[THINKING_DURATION_KEY] = duration;
				} else if (typeof lastThinkingBlockDurationMs === "number" && lastThinkingBlockDurationMs > 0) {
					(message as any)[THINKING_DURATION_KEY] = lastThinkingBlockDurationMs;
				}
			}
			thinkingBlockStartMs = 0;
			const started = typeof currentAgentWorkStartMs === "number"
				? currentAgentWorkStartMs
				: typeof (message as any)[WORKED_START_KEY] === "number"
					? (message as any)[WORKED_START_KEY]
					: currentAssistantMessageStartMs;
			const isFinalAssistantMessage = message.stopReason === "stop";
			if (started !== undefined && isFinalAssistantMessage) {
				const durationMs = Date.now() - started;
				const sessionTotalMs = typeof sessionStartMs === "number" ? Date.now() - sessionStartMs : undefined;
				const turns = userTurnCount > 0 ? userTurnCount : undefined;
				(message as any)[WORKED_DURATION_KEY] = durationMs;
				if (typeof sessionTotalMs === "number") (message as any)[WORKED_SESSION_TOTAL_KEY] = sessionTotalMs;
				if (typeof turns === "number") (message as any)[WORKED_TURNS_KEY] = turns;
				// Duration metadata drives the assistant component's TUI-only status line.
				// Message content stays presentation-neutral for persistence and consumers.
			}
			currentAssistantMessageStartMs = undefined;
		}
		patchMessage(event, ctx.ui?.theme);
		try {
			(ctx as any)?.ui?.invalidate?.();
			(ctx as any)?.ui?.requestRender?.();
		} catch { /* noop */ }
	});
	pi.on("agent_end", async () => {
		currentAgentWorkStartMs = undefined;
		currentAssistantMessageStartMs = undefined;
	});
	pi.on("session_start", async () => {
		// Reset session-wide accumulators on every session transition (new / resume /
		// fork / reload). The `context` event re-seeds them from the new session's
		// message history, so /new starts fresh while /resume picks up past prompts
		// and the original session start time. Resetting here is what lets /new
		// clear the totals (Math.min / Math.max seeding alone could never lower them).
		// Also drop the live-agent marker so history partials rebuilt during resume
		// never look "in flight" and re-arm blink timers.
		currentAgentWorkStartMs = undefined;
		currentAssistantMessageStartMs = undefined;
		sessionStartMs = undefined;
		userTurnCount = 0;
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
				if (earliest === undefined || msg.timestamp < earliest) earliest = msg.timestamp;
			}
		}
		if (earliest !== undefined) {
			sessionStartMs = sessionStartMs === undefined ? earliest : Math.min(sessionStartMs, earliest);
		}
		if (userCount > userTurnCount) userTurnCount = userCount;
		for (const msg of messages) {
			if (!msg || msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
			for (const block of msg.content) {
				if (block && block.type === "thinking" && typeof block.thinking === "string") {
					block.thinking = stripThinkingPresentationArtifacts(block.thinking);
				}
				if (block && block.type === "text" && typeof block.text === "string") {
					block.text = stripWorkedDurationLine(block.text);
				}
			}
		}
	});
}

function getMode<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
	return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

const CORE_TOOL_OVERRIDES = new Set(["read", "bash", "grep", "find", "ls", "write", "edit"]);

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

function isMcpToolCandidate(tool: unknown): boolean {
	const rec = tool as Record<string, unknown> | undefined;
	const name = typeof rec?.name === "string" ? rec.name : "";
	const description = typeof rec?.description === "string" ? rec.description : "";
	return name === "mcp" || /\bmcp\b/i.test(description);
}

function isOpenAiToolCandidate(tool: unknown): boolean {
	const rec = tool as Record<string, unknown> | undefined;
	const name = typeof rec?.name === "string" ? rec.name : "";
	if (!name || CORE_TOOL_OVERRIDES.has(name) || isMcpToolCandidate(tool)) return false;
	return OPENAI_STYLE_TOOL_NAMES.has(name);
}

function humanizeToolName(name: string): string {
	return name
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/[_-]+/g, " ")
		.replace(/\b\w/g, (char) => char.toUpperCase());
}

function isMcpToolName(name: string): boolean {
	return name === "mcp" || /^mcp[_:-]/i.test(name) || /[_:-]mcp[_:-]/i.test(name);
}

function shouldUseGenericToolRenderer(name: unknown): boolean {
	return typeof name === "string" && name.length > 0 && !CORE_TOOL_OVERRIDES.has(name);
}

function genericToolLabel(name: string): string {
	return isMcpToolName(name) ? "MCP" : humanizeToolName(name);
}

function renderGenericToolCall(name: string, args: any, theme: Theme, ctx: any, label = genericToolLabel(name)): Text {
	syncToolCallStatus(ctx);
	ctx.state._openAiPatchFiles = [];
	// Agent / subagent tools get a size-breathing pending marker, not on/off ●.
	if (isAgentFamilyToolName(name)) ctx.state._agentBreathe = true;
	if (isMcpToolName(name)) {
		return makeToolFamilyCallText("mcp", name, "MCP", args, theme, ctx, true);
	}
	return makeToolFamilyCallText("openai", name, label, args, theme, ctx);
}

function renderGenericToolResult(name: string, result: any, options: any, theme: Theme, ctx: any): Text {
	if (isMcpToolName(name)) {
		return renderMcpToolResult(result, !!options?.expanded, !!options?.isPartial, theme, ctx);
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

function lineCountLabel(count: number): string {
	return `${count} line${count === 1 ? "" : "s"}`;
}

function makeToolFamilyStreamText(
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
	syncToolCallStatus(ctx);
	if (ctx?.state?._toolStatus === "pending") setupBlinkTimer(ctx);
	else clearBlinkTimer(ctx);

	const decision = decideToolFamilyResult(family, name, label, args, result, true, ctx);
	const totalLineCount = decision.kind === "present" ? decision.metadata?.output?.total ?? 0 : 0;
	if (ctx?.state) ctx.state._liveLineCount = totalLineCount;
	const limit = liveToolPreviewLimit();
	if (decision.kind === "suppress" || !liveToolPreviewEnabled() || limit <= 0 || totalLineCount === 0) {
		return makeText(ctx.lastComponent, "", followPiOutputPad);
	}
	return makePresentationText(
		ctx.lastComponent,
		decision.presentation,
		{ expansion: expanded ? "expanded" : "collapsed", preview: { normal: limit } },
		theme,
		followPiOutputPad,
	);
}

function getStringArg(args: any, ...keys: string[]): string {
	for (const key of keys) {
		const value = args?.[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return "";
}

function renderApplyPatchCall(args: any, theme: Theme, ctx: any): Text {
	syncToolCallStatus(ctx);
	const presentation = presentMutationDiff(ctx, theme, "apply_patch", "call", args, undefined, 2, ctx.argsComplete === true);
	const summary = stableCallSummary(ctx, "_callSummary", () => presentation.headerSummary ?? theme.fg("muted", "patch"));
	const hdr = toolHeader("Apply Patch", summary, theme, toolStatusDot(ctx, theme), liveLineCountTrailing(ctx, theme));
	if (ctx.argsComplete !== true) return makeText(ctx.lastComponent, hdr);
	ctx.state._openAiPatchFiles = [...presentation.affectedPaths];
	return makeResponsiveDiffText(ctx, ctx.lastComponent, presentation.body ? `${hdr}\n${presentation.body}` : hdr);
}

function renderApplyPatchResult(result: any, isPartial: boolean, theme: Theme, ctx: any): Text {
	if (isPartial) {
		return makeToolFamilyStreamText("tool-native", "apply_patch", "Apply Patch", ctx.args, result, !!ctx?.expanded, theme, ctx);
	}
	clearBlinkTimer(ctx);
	setToolStatus(ctx, ctx.isError ? "error" : "success");
	if (ctx.isError) {
		const raw = resultTextContent(result).trim();
		const firstLine = raw ? raw.split("\n")[0] : "Apply patch failed";
		return makeText(ctx.lastComponent, withToolErrorIndent(theme.fg("error", firstLine)));
	}
	const presentation = presentMutationDiff(ctx, theme, "apply_patch", "result", ctx.args, (result as any).details?.diffEvidence, 2, true, (result as any).details);
	return makeResponsiveDiffText(ctx, ctx.lastComponent, presentation.body);
}

function renderMcpToolResult(result: any, expanded: boolean, isPartial: boolean, theme: Theme, ctx: any): Text {
	if (isPartial) return makeToolFamilyStreamText("mcp", String(ctx?.toolName ?? "mcp"), "MCP", ctx.args, result, expanded, theme, ctx, true);
	const outputMode = getMode(readSettings().mcpOutputMode, ["hidden", "summary", "preview"] as const, "preview");
	const presentationResult = outputMode === "hidden" ? result : completeMcpResultForPresentation(result, ctx?.state);
	return makeSettledToolFamilyResultText("mcp", String(ctx?.toolName ?? "mcp"), "MCP", presentationResult, expanded, theme, ctx, {
		followPiOutputPad: true,
		policy: { outputMode },
	});
}

function getFirstImageBlock(result: any): { data: string; mimeType: string } | undefined {
	if (!Array.isArray(result?.content)) return undefined;
	return result.content.find((block: any) => block?.type === "image" && typeof block.data === "string" && typeof block.mimeType === "string");
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
	const filename = path ? shortPath(ctx.cwd ?? process.cwd(), path) : undefined;
	return imageFallback(image.mimeType, dimensions, filename);
}

function renderReadImageResult(result: any, expanded: boolean, theme: Theme, ctx: any): Text {
	const image = getFirstImageBlock(result);
	const mimeType = image?.mimeType ?? "image";
	const summary = markResultSummary(`${theme.fg("success", "Image loaded")} ${theme.fg("muted", `[${mimeType}]`)}`);
	if (!expanded) {
		return makeText(ctx.lastComponent, withBranch(`${summary}${toolOutputDetailHint(theme, expanded)}`, theme));
	}

	const noteLines = resultTextContent(result)
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line && !/^Read image file\b/i.test(line));
	const lines = [summary, ...noteLines.map((line) => theme.fg("dim", line))];
	if (!getCapabilities().images || !ctx.showImages) {
		const fallback = getReadImageFallback(result, ctx);
		if (fallback) lines.push(theme.fg("toolOutput", fallback));
	}
	return makeText(ctx.lastComponent, withBranch(lines.join("\n"), theme));
}

function renderOpenAiToolResult(name: string, result: any, expanded: boolean, isPartial: boolean, theme: Theme, ctx: any): Text {
	if (isPartial) return makeToolFamilyStreamText("openai", name, humanizeToolName(name), ctx.args, result, expanded, theme, ctx);
	const detail = expanded && name !== "TaskList" && name !== "Agent"
		? extraToolOutputExpanded ? 2 : 1
		: undefined;
	const patchFiles = Array.isArray(ctx.state?._openAiPatchFiles) ? ctx.state._openAiPatchFiles : [];
	return makeSettledToolFamilyResultText("openai", name, humanizeToolName(name), result, expanded, theme, ctx, {
		detail,
		policy: { patchFiles },
	});
}

// ===========================================================================
// Diff presentation host adapter
// ===========================================================================

const diffPresentationModule = createDiffPresentationModule({
	readSettings,
	chrome: {
		markResultSummary,
		branch(content, view, options) {
			const theme = view.theme as Theme;
			return options.final ? withFinalBranchBlock(content, theme) : withBranch(content, theme, false, options.continued === true);
		},
		tree(summary, blocks, terminalAction, view) {
			return renderDiffOutputTree(
				summary,
				blocks.map((block) => ({
					heading: block.heading,
					content: block.content,
				})),
				terminalAction,
				view.theme as Theme,
			);
		},
		detailHint(view, hasMore) {
			return toolOutputDetailHint(view.theme as Theme, view.expanded, hasMore, view.localDetail < 2, true);
		},
		collapseHint(view) {
			return localCollapseActionHint(view.theme as Theme);
		},
	},
	displayPath: shortPath,
	moveArrow: () => `${BORDER_COLOR}→${TRANSPARENT_RESET}`,
	isLightTheme: isLightThemeBackground,
	resolveRuleAnsi: (theme) => resolveThemeChromeFg(theme) ?? safeFgAnsi(theme, "borderMuted") ?? undefined,
});
const toolPresentationModule = createToolPresentationModule({ mutations: diffPresentationModule });

function contextDiffWidth(ctx: any, chromeWidth: 2 | 3): number {
	const measured = ctx.state?._diffComponentWidth;
	const width = typeof measured === "number" && Number.isFinite(measured) ? Math.floor(measured) : Math.max(40, Math.min((process.stdout.columns || Number.parseInt(process.env.COLUMNS ?? "", 10) || 200) - 4, 210));
	return Math.max(20, Math.min(width - chromeWidth, 210));
}

function diffPresentationView(ctx: any, theme: Theme, chromeWidth: 2 | 3) {
	return {
		width: contextDiffWidth(ctx, chromeWidth),
		expanded: ctx.expanded === true,
		localDetail: progressiveLocalDetailLevelForRender(ctx.state),
		localClickControls: progressiveLocalControlsEnabled(),
		theme: theme as DiffTheme,
	} as const;
}

function presentMutationDiff(
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
	return toolPresentationModule.present({
		surface: "mutation-presentation",
		tool: { family: "mutation", name },
		phase,
		cwd: ctx.cwd ?? process.cwd(),
		args,
		evidence,
		resultDetails,
		request: {
			owner: ctx.state ?? ctx,
			sourceComplete,
			view: diffPresentationView(ctx, theme, chromeWidth),
			settlement: {
				begin() {
					const pendingViewport = claimToolCollapseViewportSettlement(ctx.state);
					return { complete: () => safeInvalidate(ctx, pendingViewport) };
				},
			},
		},
	}).snapshot;
}

async function captureMutationDiff(
	name: MutationToolName,
	cwd: string,
	args: unknown,
	before?: string | null,
): Promise<DiffEvidence | undefined> {
	try {
		return await toolPresentationModule.present({
			surface: "mutation-capture",
			tool: { family: "mutation", name },
			cwd,
			args,
			before,
		});
	} catch {
		return undefined;
	}
}

function attachDiffEvidence(result: any, evidence: DiffEvidence | undefined): void {
	if (!evidence || !result || typeof result !== "object") return;
	result.details = { ...(result.details ?? {}), diffEvidence: evidence };
}

// ===========================================================================
// Extension
// ===========================================================================

export default function (pi: ExtensionAPI) {
	clickExpansionModule = installClickExpansion({ enabled: clickExpansionEnabled() });
	patchTerminalWriteTagScrubber();
	patchToolExecutionBackgroundSync();
	patchToolRenderCacheInvalidation();
	patchReadImageExpansion();
	patchContainerParentTracking();
	installToolGroupMouseAdapter();
	patchGlobalToolBorders();
	patchBuiltinTranscriptExpansion();
	patchCustomMessageRender();
	patchUserMessageRender();
	patchAssistantMessages();
	patchToolExecutionRenderers();
	refreshRetainedToolGroupClickHandlers();
	registerThinkingLabels(pi);
	syncExtraToolDetailMode();

	pi.registerShortcut("ctrl+shift+o", {
		description: "Toggle extra tool output detail",
		handler: async (ctx) => {
			setExtraToolDetailMode(!extraToolOutputExpanded);
			if (ctx.hasUI) {
				ctx.ui.setToolsExpanded(ctx.ui.getToolsExpanded());
				ctx.ui.notify(`Extra tool detail: ${extraToolOutputExpanded ? "on" : "off"}`, "info");
			}
		},
	});

	// /cc-tools command — control tool chrome, grouping, and detail level.
	const TOOL_MODES = ["outlines", "transparent", "default"] as const;
	const TOOL_BOOL_MODES = ["on", "off", "toggle", "status"] as const;
	const TOOL_SUBCOMMANDS = [...TOOL_MODES, "group", "detail", "click", "thinking", "branch", "status"] as const;
	const booleanMode = (raw: string | undefined, current: boolean): boolean | "status" | undefined => {
		const mode = raw || "toggle";
		if (mode === "on") return true;
		if (mode === "off") return false;
		if (mode === "toggle") return !current;
		if (mode === "status") return "status";
		return undefined;
	};
	const notifyToolStatus = (ctx: any): void => {
		if (!ctx.hasUI) return;
		const branchMode = toolBranchColorModeFixed() ? "fixed" : "theme";
		const branchGray = getConfiguredToolBranchGray();
		const theme = ctx.ui?.theme;
		const chromeHint = branchMode === "theme" && theme
			? (resolveThemeChromeFg(theme) ? " (attenuated on light themes)" : " (fallback gray if theme keys missing)")
			: "";
		const branchLine = branchMode === "fixed"
			? `Branch color: fixed rgb(${branchGray})`
			: `Branch color: theme${chromeHint}`;
		ctx.ui.notify([
			`Tool style: ${toolBackgroundMode}`,
			`Tool grouping: ${toolGroupingEnabled() ? "on" : "off"}`,
			`Click expansion: ${clickExpansionEnabled() ? "on" : "off"}`,
			`Thinking: ${getThinkingMode()}`,
			`Extra detail: ${extraToolOutputExpanded ? "on" : "off"} (${themedRawKeyHint(theme, "ctrl+shift+o", "toggle")})`,
			branchLine,
			`  /cc-tools branch <0-255> | theme | fixed | reset`,
		].join("\n"), "info");
	};
	pi.registerCommand("cc-tools", {
		description: "Control tool UI: style, grouping, click expansion, and extra detail",
		getArgumentCompletions(prefix) {
			const parts = prefix.trimStart().split(/\s+/);
			const first = parts[0] ?? "";
			if (parts.length <= 1) {
				return TOOL_SUBCOMMANDS
					.filter((m) => m.startsWith(first))
					.map((m) => ({
						value: m,
						label: m,
						description:
							m === "group" ? "Toggle grouped adjacent/concurrent tool rows"
							: m === "thinking" ? "Thinking display: live (default) or full"
							: m === "detail" ? "Toggle Ctrl+Shift+O extra-detail mode"
							: m === "click" ? "Toggle local click expansion in fullscreen mode"
							: m === "branch" ? "├ └ │ gray (0-255), theme, fixed, or reset"
							: m === "status" ? "Show tool UI settings"
							: m === "outlines" ? "Horizontal rules around each tool (default)"
							: m === "transparent" ? "No borders or backgrounds"
							: "Pi built-in tool backgrounds",
					}));
			}
			if (first === "branch") {
				const second = parts[1] ?? "";
				const opts = ["theme", "fixed", "reset", "status"];
				return opts
					.filter((o) => o.startsWith(second))
					.map((o) => ({ value: `branch ${o}`, label: o, description: "Branch connector color" }));
			}
			if (first === "thinking") {
				const second = parts[1] ?? "";
				return ["live", "full", "status"]
					.filter((m) => m.startsWith(second))
					.map((m) => ({ value: `thinking ${m}`, label: m, description: `${m} thinking display` }));
			}
			if (first === "group" || first === "detail" || first === "extra" || first === "click") {
				const second = parts[1] ?? "";
				return TOOL_BOOL_MODES
					.filter((m) => m.startsWith(second))
					.map((m) => ({ value: `${first} ${m}`, label: m, description: `${m} ${first}` }));
			}
			return [];
		},
		async handler(args, ctx) {
			const parts = args.trim().toLowerCase().split(/\s+/).filter(Boolean);
			const sub = parts[0] ?? "";
			if (!sub || sub === "status") {
				notifyToolStatus(ctx);
				return;
			}

			if (sub === "group") {
				const next = booleanMode(parts[1], toolGroupingEnabled());
				if (next === undefined) {
					if (ctx.hasUI) ctx.ui.notify(`Usage: /cc-tools group ${TOOL_BOOL_MODES.join("|")}`, "error");
					return;
				}
				if (next === "status") {
					if (ctx.hasUI) ctx.ui.notify(`Tool grouping: ${toolGroupingEnabled() ? "on" : "off"}`, "info");
					return;
				}
				setToolGroupingEnabled(next);
				if (!next) ungroupActiveToolGroups();
				if (ctx.hasUI) {
					ctx.ui.setToolsExpanded(ctx.ui.getToolsExpanded());
					ctx.ui.notify(`Tool grouping: ${next ? "on" : "off"}${next ? " (future adjacent tool rows)" : ""}`, "info");
				}
				return;
			}

			if (sub === "click") {
				const current = clickExpansionEnabled();
				const next = booleanMode(parts[1], current);
				if (next === undefined) {
					if (ctx.hasUI) ctx.ui.notify(`Usage: /cc-tools click ${TOOL_BOOL_MODES.join("|")}`, "error");
					return;
				}
				if (next === "status") {
					if (ctx.hasUI) ctx.ui.notify(`Click expansion: ${current ? "on" : "off"}`, "info");
					return;
				}
				writeSettingsKey("clickExpansion", next);
				clickExpansionModule = installClickExpansion({ enabled: next });
				if (!next) resetLocalClickStates(clickRuntime.activeInteractiveMode, true);
				else clickRuntime.visualEpoch++;
				if (ctx.hasUI) {
					(ctx.ui as any).invalidate?.();
					(ctx.ui as any).requestRender?.();
					ctx.ui.notify(`Click expansion: ${next ? "on" : "off"}`, "info");
				}
				return;
			}

			if (sub === "branch") {
				const arg = parts[1] ?? "status";
				if (arg === "status" || !arg) {
					notifyToolStatus(ctx);
					return;
				}
				if (arg === "reset") {
					writeSettingsKey("toolBranchRgbGray", undefined);
					writeSettingsKey("toolBranchColorMode", undefined);
					if (ctx.hasUI) refreshAllToolBranchVisuals(ctx);
					if (ctx.hasUI) ctx.ui.notify(`Branch color → fixed rgb(${DEFAULT_TOOL_BRANCH_GRAY}) (default)`, "info");
					return;
				}
				if (arg === "theme") {
					writeSettingsKey("toolBranchColorMode", "theme");
					if (ctx.hasUI) refreshAllToolBranchVisuals(ctx);
					if (ctx.hasUI) ctx.ui.notify("Branch color → follow pi theme (dim/muted)", "info");
					return;
				}
				if (arg === "fixed") {
					writeSettingsKey("toolBranchColorMode", "fixed");
					if (ctx.hasUI) refreshAllToolBranchVisuals(ctx);
					if (ctx.hasUI) ctx.ui.notify(`Branch color → fixed rgb(${getConfiguredToolBranchGray()})`, "info");
					return;
				}
				const gray = Number.parseInt(arg, 10);
				if (!Number.isFinite(gray) || gray < 0 || gray > 255) {
					if (ctx.hasUI) ctx.ui.notify("Usage: /cc-tools branch <0-255> | theme | fixed | reset", "error");
					return;
				}
				writeSettingsKey("toolBranchRgbGray", gray);
				writeSettingsKey("toolBranchColorMode", "fixed");
				if (ctx.hasUI) refreshAllToolBranchVisuals(ctx);
				if (ctx.hasUI) ctx.ui.notify(`Branch color → fixed rgb(${gray})`, "info");
				return;
			}

			if (sub === "thinking") {
				const arg = (parts[1] ?? "status").toLowerCase();
				if (arg === "status" || !arg) {
					if (ctx.hasUI) ctx.ui.notify(`Thinking: ${getThinkingMode()} (live = only streaming thinking expands; full = always expanded)`, "info");
					return;
				}
				if (arg !== "live" && arg !== "full") {
					if (ctx.hasUI) ctx.ui.notify("Usage: /cc-tools thinking live|full|status", "error");
					return;
				}
				writeSettingsKey("thinkingMode", arg);
				if (ctx.hasUI) {
					ctx.ui.setToolsExpanded(ctx.ui.getToolsExpanded());
					ctx.ui.notify(`Thinking → ${arg}${arg === "live" ? " (only the active thinking expands)" : " (thinking always expanded)"}`, "info");
				}
				return;
			}

			if (sub === "detail" || sub === "extra") {
				const next = booleanMode(parts[1], extraToolOutputExpanded);
				if (next === undefined) {
					if (ctx.hasUI) ctx.ui.notify(`Usage: /cc-tools detail ${TOOL_BOOL_MODES.join("|")}`, "error");
					return;
				}
				if (next === "status") {
					if (ctx.hasUI) ctx.ui.notify(`Extra tool detail: ${extraToolOutputExpanded ? "on" : "off"}`, "info");
					return;
				}
				setExtraToolDetailMode(next);
				if (ctx.hasUI) {
					ctx.ui.setToolsExpanded(ctx.ui.getToolsExpanded());
					ctx.ui.notify(`Extra tool detail: ${extraToolOutputExpanded ? "on" : "off"}`, "info");
				}
				return;
			}

			if (!(TOOL_MODES as readonly string[]).includes(sub)) {
				if (ctx.hasUI) ctx.ui.notify(`Unknown option "${sub}". Try /cc-tools status, /cc-tools click toggle, or /cc-tools thinking live.`, "error");
				return;
			}
			toolBackgroundOverride = sub as typeof toolBackgroundMode;
			toolBackgroundMode = toolBackgroundOverride;
			writeSettingsKey("toolBackground", sub);
			if (ctx.hasUI) {
				applyToolBackgroundMode(ctx.ui.theme);
				ctx.ui.notify(`Tool style → ${sub}`, "info");
			}
		},
	});

	// /cc-theme command — toggle pi-theme-adaptive coloring at runtime.
	const THEME_MODES = ["on", "off", "toggle", "status"] as const;
	pi.registerCommand("cc-theme", {
		description: "Toggle whether tool borders / branch rules / diff colors follow the active pi theme",
		getArgumentCompletions(prefix) {
			return THEME_MODES
				.filter((m) => m.startsWith(prefix))
				.map((m) => ({
					value: m,
					label: m,
					description:
						m === "on" ? "Derive borders, branch rules, dim text and diff tints from the active pi theme (default)"
						: m === "off" ? "Keep the fixed Claude-style palette regardless of theme"
						: m === "toggle" ? "Flip between on and off"
						: "Show the current setting and a preview of the derived colors",
				}));
		},
		async handler(args, ctx) {
			const raw = args.trim().toLowerCase();
			const current = themeAdaptiveEnabled();

			if (!raw || raw === "status") {
				if (!ctx.hasUI) return;
				const theme = ctx.ui.theme as any;
				const themeName = theme?.name ?? "unknown";
				const state = current ? "on" : "off";
				if (raw === "status" && current) {
					const settings = readSettings();
					const verbKey = settings.spinnerVerbColor || "borderAccent";
					const statusKey = settings.spinnerStatusColor || "muted";
					const verbAnsi = safeFgAnsi(theme, verbKey) ?? safeFgAnsi(theme, "accent");
					const statusAnsi = safeFgAnsi(theme, statusKey) ?? safeFgAnsi(theme, "muted");
					const chromePreview = resolveThemeChromeFg(theme);
					// Print a short preview of what we derived.
					const preview = [
						`chrome      : ${chromePreview ? `${chromePreview}─┌ User ├─\x1b[39m` : "(unchanged)"}`,
						`  (user box, tool rules, branches)`, 
						`muted text  : ${safeFgAnsi(theme, "muted") ? `${safeFgAnsi(theme, "muted")}example dim text\x1b[39m` : "(unchanged)"}`,
						`diff add    : ${safeFgAnsi(theme, "toolDiffAdded") ? `${safeFgAnsi(theme, "toolDiffAdded")}+ added line\x1b[39m` : "(unchanged)"}`,
						`diff del    : ${safeFgAnsi(theme, "toolDiffRemoved") ? `${safeFgAnsi(theme, "toolDiffRemoved")}- removed line\x1b[39m` : "(unchanged)"}`,
						`spinner verb: ${verbAnsi ? `${verbAnsi}Cooking…\x1b[39m` : "(unchanged)"} (key: ${verbKey})`,
						`spinner stat: ${statusAnsi ? `${statusAnsi}(thinking · ↓ 10 tokens · 2s)\x1b[39m` : "(unchanged)"} (key: ${statusKey})`,
					].join("\n  ");
					ctx.ui.notify(`Theme adaptive: ${state} (theme "${themeName}")\n  ${preview}`, "info");
				} else {
					ctx.ui.notify(`Theme adaptive: ${state} (theme "${themeName}")`, "info");
				}
				return;
			}

			let next: boolean;
			if (raw === "on") next = true;
			else if (raw === "off") next = false;
			else if (raw === "toggle") next = !current;
			else {
				if (ctx.hasUI) ctx.ui.notify(`Unknown option "${raw}". Options: ${THEME_MODES.join(", ")}`, "error");
				return;
			}

			writeSettingsKey("themeAdaptive", next);
			bustSpinnerSettingsCache();
			// Invalidate caches so the next render re-derives from the active
			// theme (or falls back to the fixed Claude palette).
			invalidateThemePaletteCache();
			diffPresentationModule.reset();
			if (next) {
				if (ctx.hasUI) applyThemePaletteIfNeeded(ctx.ui.theme);
			} else {
				resetThemePalette();
			}
			if (ctx.hasUI) {
				const label = next ? "on — colors follow pi theme" : "off — fixed Claude palette";
				ctx.ui.notify(`Theme adaptive: ${label}`, "info");
			}
		},
	});

	// /cc-spinner command — pick which theme color keys drive the spinner verb
	// and status suffix.
	const COMMON_COLOR_KEYS: readonly string[] = [
		"accent", "borderAccent", "success", "error", "warning",
		"muted", "dim", "text", "thinkingText",
		"toolTitle", "mdHeading", "mdCode", "mdLink", "mdListBullet",
		"bashMode",
		"thinkingLow", "thinkingMedium", "thinkingHigh", "thinkingXhigh",
		"syntaxKeyword", "syntaxFunction", "syntaxString", "syntaxType",
	];
	pi.registerCommand("cc-spinner", {
		description: "Set the spinner verb or status theme color, or preview current values",
		getArgumentCompletions(prefix) {
			const subCommands = ["verb", "status", "reset", "preview"];
			const parts = prefix.split(/\s+/);
			if (parts.length <= 1) {
				return subCommands
					.filter((c) => c.startsWith(parts[0] ?? ""))
					.map((c) => ({
						value: c,
						label: c,
						description:
							c === "verb" ? "Set the color key used for the spinner verb (e.g. 'Cooking…')"
							: c === "status" ? "Set the color key used for the spinner status suffix"
							: c === "reset" ? "Reset both verb and status to defaults (borderAccent, muted)"
							: "Preview every theme color key with its current sample",
					}));
			}
			// Second arg: color key completions for verb/status.
			if (parts[0] === "verb" || parts[0] === "status") {
				const keyPrefix = (parts[1] ?? "").toLowerCase();
				return COMMON_COLOR_KEYS
					.filter((k) => k.toLowerCase().startsWith(keyPrefix))
					.map((k) => ({ value: k, label: k, description: `theme.fg("${k}", …)` }));
			}
			return [];
		},
		async handler(args, ctx) {
			const parts = args.trim().split(/\s+/).filter((p) => p.length > 0);
			const sub = (parts[0] ?? "").toLowerCase();
			const theme = ctx.hasUI ? (ctx.ui.theme as any) : null;
			const settings = readSettings();
			const currentVerb = settings.spinnerVerbColor || "borderAccent";
			const currentStatus = settings.spinnerStatusColor || "muted";

			if (!sub || sub === "preview") {
				if (!ctx.hasUI) return;
				if (!theme) {
					ctx.ui.notify(`Spinner verb: ${currentVerb}, status: ${currentStatus} (no theme)`, "info");
					return;
				}
				const lines: string[] = [
					`Current: verb=${currentVerb}, status=${currentStatus}`,
					"",
					"Preview of common theme keys (pick one for verb or status):",
				];
				for (const key of COMMON_COLOR_KEYS) {
					const ansi = safeFgAnsi(theme, key);
					const marker = key === currentVerb ? "(verb)" : key === currentStatus ? "(status)" : "";
					const sample = ansi ? `${ansi}Cooking…\x1b[39m` : "(unmapped)";
					lines.push(`  ${key.padEnd(16)} ${sample} ${marker}`);
				}
				ctx.ui.notify(lines.join("\n"), "info");
				return;
			}

			if (sub === "reset") {
				writeSettingsKey("spinnerVerbColor", undefined);
				writeSettingsKey("spinnerStatusColor", undefined);
				bustSpinnerSettingsCache();
				if (ctx.hasUI) ctx.ui.notify("Spinner colors reset to defaults (verb=borderAccent, status=muted)", "info");
				return;
			}

			if (sub !== "verb" && sub !== "status") {
				if (ctx.hasUI) ctx.ui.notify(`Usage: /cc-spinner verb <key> | status <key> | reset | preview`, "error");
				return;
			}

			const key = parts[1];
			if (!key) {
				if (ctx.hasUI) ctx.ui.notify(`Missing color key. Try /cc-spinner preview to see available keys.`, "error");
				return;
			}

			// Validate the key resolves to *some* color in the active theme;
			// accept anyway if the user insists so themes with custom keys work.
			const ansi = theme ? safeFgAnsi(theme, key) : null;
			const settingKey = sub === "verb" ? "spinnerVerbColor" : "spinnerStatusColor";
			writeSettingsKey(settingKey, key);
			bustSpinnerSettingsCache();
			if (ctx.hasUI) {
				const sample = ansi ? `${ansi}sample\x1b[39m` : "(key unmapped in current theme)";
				ctx.ui.notify(`Spinner ${sub} → ${key} ${sample}`, "info");
			}
		},
	});

	pi.on("session_start", async (event, ctx) => {
		clearBashHostState();
		if (!ctx.hasUI) return;
		patchUiNotifications(ctx.ui);
		// Session switch (/resume, /new) can leave tool chrome from the previous
		// theme; rebind from ctx.ui.theme (other extensions may setTheme in the
		// same tick — deferred passes pick up the final theme without coupling).
		rebindUiChromeToTheme(ctx);
		scheduleDeferredChromeRebind(ctx, 0);
		const reason = (event as { reason?: string })?.reason;
		if (reason === "resume" || reason === "new" || reason === "fork") {
			scheduleDeferredChromeRebind(ctx, 48);
			// Chat history rebuild can run after session_start; re-sync transparent tool bgs.
			scheduleDeferredChromeRebind(ctx, 120);
		}
	});

	pi.on("turn_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		patchUiNotifications(ctx.ui);
		applyToolBackgroundMode(ctx.ui.theme);
		applyThemePaletteIfNeeded(ctx.ui.theme);
	});

	pi.on("message_update", async (event) => {
		const content = (event as any)?.message?.content;
		const hasText = Array.isArray(content) && content.some((block: any) => block?.type === "text" && typeof block.text === "string" && block.text.trim().length > 0);
		if (hasText) clearPreservedBashPreviews();
	});

	pi.on("tool_execution_start", async (event) => {
		clearPreservedBashPreviews();
		if ((event as any)?.toolName === "bash") trackBashOriginal((event as any)?.toolCallId, (event as any)?.args);
	});

	const cwd = process.cwd();
	const sp = (path: string) => shortPath(cwd, path);

	const readTool = createReadTool(cwd);
	pi.registerTool({
		name: "read",
		label: "read",
		description: readTool.description,
		parameters: readTool.parameters,
		async execute(toolCallId, params, signal, onUpdate) {
			return readTool.execute(toolCallId, params, signal, onUpdate);
		},
		renderCall(args, theme, ctx) {
			syncToolCallStatus(ctx);
			return makeToolFamilyCallText("tool-native", "read", "Read", args, theme, ctx);
		},
		renderResult(result, { expanded, isPartial }, theme, ctx) {
			if (isPartial) {
				return makeToolFamilyStreamText("tool-native", "read", "Read", ctx.args, result, expanded, theme, ctx);
			}
			clearBlinkTimer(ctx);
			setToolStatus(ctx, ctx.isError ? "error" : "success");
			if (getFirstImageBlock(result)) return renderReadImageResult(result, expanded, theme, ctx);
			const content = result.content.find((block: any) => block?.type === "text");
			if (content?.type !== "text") return makeText(ctx.lastComponent, withToolErrorIndent(theme.fg("error", "No text content")));
			return makeSettledToolFamilyResultText("tool-native", "read", "Read", result, expanded, theme, ctx);
		},
	});

	const shellPath = SettingsManager.create(cwd).getShellPath();
	const bashTool = createBashTool(cwd, { shellPath });
	pi.registerTool({
		name: "bash",
		label: "bash",
		description: bashTool.description,
		parameters: bashTool.parameters,
		async execute(toolCallId, params, signal, onUpdate) {
			return bashTool.execute(toolCallId, params, signal, onUpdate);
		},
		renderCall(args, theme, ctx) {
			syncToolCallStatus(ctx);
			syncBashDuration(ctx);
			const rewrite = bashRewriteFor(ctx.toolCallId, args);
			return makeToolFamilyCallText(
				"tool-native",
				"bash",
				"Bash",
				args,
				theme,
				ctx,
				false,
				{
					showCallDetail: ctx.expanded === true && shouldRevealCallArgs(ctx),
					showCollapsedCallDetail: ctx.expanded !== true && shouldRevealCallArgs(ctx) && (ctx.state?._toolStatus === "pending" || (ctx.state?._toolStatus === "error" && lineCount(typeof args?.command === "string" ? args.command : "") > 1)),
					...(rewrite ? { bashRewrite: rewrite } : {}),
				},
				bashElapsedMs(ctx),
			);
		},
		renderResult(result, { expanded, isPartial }, theme, ctx) {
			syncBashDuration(ctx, isPartial);
			const rewrite = bashRewriteFor(ctx.toolCallId, ctx.args);
			if (isPartial) return makeToolFamilyStreamText("tool-native", "bash", "Bash", ctx.args, result, expanded, theme, ctx);
			const hasOutput = resultTextContent(result).split("\n").some((line) => line.trim());
			if (hasOutput && ctx.state?._bashPreviewReleased !== true) {
				preserveBashPreview(ctx.toolCallId, () => safeInvalidate(ctx));
				if (ctx.state) ctx.state._bashPreviewReleased = true;
			}
			const showCollapsedResultDetail = !expanded
				&& !progressiveLocalControlsEnabled()
				&& typeof ctx.toolCallId === "string"
				&& BASH_PREVIEW_INVALIDATORS.has(ctx.toolCallId);
			return makeSettledToolFamilyResultText("tool-native", "bash", "Bash", result, expanded, theme, ctx, {
				normalPreview: showCollapsedResultDetail ? liveToolPreviewLimit() : bashCollapsedLimit(),
				policy: {
					preserveBlankLines: expanded,
					showCollapsedResultDetail,
					...(rewrite ? { bashRewrite: rewrite } : {}),
				},
			});
		},
	});

	const registerNativeTextTool = (definition: {
		name: "grep" | "find" | "ls";
		label: "Grep" | "Find" | "List";
		tool: any;
	}): void => {
		const { name, label, tool } = definition;
		pi.registerTool({
			name,
			label: name,
			description: tool.description,
			parameters: tool.parameters,
			async execute(toolCallId, params, signal, onUpdate) {
				return tool.execute(toolCallId, params, signal, onUpdate);
			},
			renderCall(args, theme, ctx) {
				syncToolCallStatus(ctx);
				return makeToolFamilyCallText("tool-native", name, label, args, theme, ctx);
			},
			renderResult(result, { expanded, isPartial }, theme, ctx) {
				if (isPartial) return makeToolFamilyStreamText("tool-native", name, label, ctx.args, result, expanded, theme, ctx);
				return makeSettledToolFamilyResultText("tool-native", name, label, result, expanded, theme, ctx);
			},
		});
	};
	registerNativeTextTool({ name: "grep", label: "Grep", tool: createGrepTool(cwd) });
	registerNativeTextTool({ name: "find", label: "Find", tool: createFindTool(cwd) });
	registerNativeTextTool({ name: "ls", label: "List", tool: createLsTool(cwd) });

	const writeTool = createWriteTool(cwd);
	pi.registerTool({
		name: "write",
		label: "write",
		description: writeTool.description,
		parameters: writeTool.parameters,
		async execute(toolCallId, params, signal, onUpdate, _ctx) {
			const fp = params.path ?? (params as any).file_path ?? "";
			const fullPath = fp ? resolve(cwd, fp) : "";
			const existedBefore = !!fullPath && fileExistsForTool(cwd, fp);
			WRITE_EXISTED_BEFORE.set(toolCallId, existedBefore);
			let old: string | null = null;
			try {
				if (fullPath && existedBefore) old = readFileSync(fullPath, "utf-8");
			} catch {
				old = null;
			}
			const evidence = await captureMutationDiff("write", cwd, params, old);
			const result = await writeTool.execute(toolCallId, params, signal, onUpdate);
			attachDiffEvidence(result, evidence);
			return result;
		},
		renderCall(args, theme, ctx) {
			const fp = args?.path ?? (args as any)?.file_path ?? "";
			const revealSummary = shouldRevealCallArgs(ctx) || (!!fp && hasOwnArg(args, "content"));
			syncToolCallStatus(ctx);
			const wasNew = getWriteWasNewFile(ctx, cwd, fp, revealSummary);
			const label = wasNew === true ? "Create" : "Write";
			const summary = stableCallSummary(
				ctx,
				"_callSummary",
				() => {
					const base = sp(fp);
					return shouldRevealCallArgs(ctx) ? `${base} ${theme.fg("muted", `(${lineCount(args.content ?? "")} lines)`)}` : base;
				},
				revealSummary,
			);
			const hdr = toolHeader(label, summary, theme, toolStatusDot(ctx, theme), liveLineCountTrailing(ctx, theme));
			return makeText(ctx.lastComponent, hdr);
		},
		renderResult(result, { expanded, isPartial }, theme, ctx) {
			if (isPartial) {
				return makeToolFamilyStreamText("tool-native", "write", "Write", ctx.args, result, expanded, theme, ctx);
			}
			clearBlinkTimer(ctx);
			setToolStatus(ctx, ctx.isError ? "error" : "success");
			if (typeof ctx?.toolCallId === "string") WRITE_EXISTED_BEFORE.delete(ctx.toolCallId);
			if (ctx.isError) {
				const e =
					result.content
						?.filter((c: any) => c.type === "text")
						.map((c: any) => c.text || "")
						.join("\n") ?? "Error";
				return makeText(ctx.lastComponent, withToolErrorIndent(theme.fg("error", e)));
			}
			const details = (result as any).details;
			const presentation = presentMutationDiff(ctx, theme, "write", "result", ctx.args, details?.diffEvidence, 2, true, details);
			if (!presentation.body) {
				return makeText(ctx.lastComponent, withBranch(markResultSummary(theme.fg("success", "Written")), theme));
			}
			return makeResponsiveDiffText(ctx, ctx.lastComponent, presentation.body);
		},
	});

	const editTool = createEditTool(cwd);
	pi.registerTool({
		name: "edit",
		label: "edit",
		description: editTool.description,
		parameters: editTool.parameters,
		async execute(toolCallId, params, signal, onUpdate, _ctx) {
			const evidence = await captureMutationDiff("edit", cwd, params);
			const result = await editTool.execute(toolCallId, params, signal, onUpdate);
			attachDiffEvidence(result, evidence);
			return result;
		},
		renderCall(args, theme, ctx) {
			const fp = args?.path ?? (args as any)?.file_path ?? "";
			const operations = getEditOperations(args);
			const revealSummary = shouldRevealCallArgs(ctx) || (!!fp && hasOwnArg(args, "edits"));
			const summary = stableCallSummary(ctx, "_callSummary", () => (shouldRevealCallArgs(ctx) && operations.length > 1 ? `${sp(fp)} ${theme.fg("muted", `(${operations.length} edits)`)}` : sp(fp)), revealSummary);
			syncToolCallStatus(ctx);
			const hdr = toolHeader("Edit", summary, theme, toolStatusDot(ctx, theme), liveLineCountTrailing(ctx, theme));
			if (!(ctx.argsComplete && operations.length > 0)) return makeText(ctx.lastComponent, hdr);
			const presentation = presentMutationDiff(ctx, theme, "edit", "call", args, undefined, 3);
			return makeResponsiveDiffText(ctx, ctx.lastComponent, presentation.body ? `${hdr}\n${presentation.body}` : hdr);
		},
		renderResult(result, { expanded, isPartial }, theme, ctx) {
			if (isPartial) {
				return makeToolFamilyStreamText("tool-native", "edit", "Edit", ctx.args, result, expanded, theme, ctx);
			}
			clearBlinkTimer(ctx);
			setToolStatus(ctx, ctx.isError ? "error" : "success");
			if (ctx.isError) {
				const e =
					result.content
						?.filter((c: any) => c.type === "text")
						.map((c: any) => c.text || "")
						.join("\n") ?? "Error";
				return makeText(ctx.lastComponent, withToolErrorIndent(theme.fg("error", e)));
			}
			const evidence = (result as any).details?.diffEvidence;
			if (!evidence && getEditOperations(ctx.args).length === 0) {
				return makeText(ctx.lastComponent, withBranch(markResultSummary(theme.fg("success", "Applied")), theme));
			}
			const presentation = presentMutationDiff(ctx, theme, "edit", "result", ctx.args, evidence, 3, true, (result as any).details);
			return makeResponsiveDiffText(ctx, ctx.lastComponent, presentation.body);
		},
	});

	const wrappedOpenAiTools = new Set<string>();
	const registerOpenAiToolOverrides = (): void => {
		let allTools: unknown[] = [];
		try {
			allTools = typeof (pi as any).getAllTools === "function" ? (pi as any).getAllTools() : [];
		} catch {
			allTools = [];
		}
		for (const tool of allTools) {
			if (!isOpenAiToolCandidate(tool)) continue;
			const record = tool as Record<string, unknown>;
			const name = typeof record.name === "string" ? record.name : "";
			if (!name || wrappedOpenAiTools.has(name)) continue;
			const execute = typeof record.execute === "function" ? (record.execute as any) : null;
			if (!execute) continue;
			const rawLabel = typeof record.label === "string" ? record.label.trim() : "";
			const label = rawLabel && rawLabel !== name && !rawLabel.includes("_") ? rawLabel : humanizeToolName(name);
			const description = typeof record.description === "string" ? record.description : label;
			(pi as any).registerTool({
				name,
				label,
				description,
				parameters: record.parameters,
				prepareArguments: typeof record.prepareArguments === "function" ? record.prepareArguments : undefined,
				async execute(toolCallId: string, params: any, signal: AbortSignal | undefined, onUpdate: any, ctx: any) {
					const evidence = name === "apply_patch"
						? await captureMutationDiff("apply_patch", ctx?.cwd ?? cwd, params)
						: undefined;
					const result = await Promise.resolve(execute(toolCallId, params, signal, onUpdate, ctx));
					attachDiffEvidence(result, evidence);
					return result;
				},
				renderCall(args: any, theme: Theme, ctx: any) {
					if (name === "apply_patch") return renderApplyPatchCall(args, theme, ctx);
					return renderGenericToolCall(name, args, theme, ctx, label);
				},
				renderResult(result: any, { expanded, isPartial }: any, theme: Theme, ctx: any) {
					if (name === "apply_patch") return renderApplyPatchResult(result, isPartial, theme, ctx);
					return renderOpenAiToolResult(name, result, expanded, isPartial, theme, ctx);
				},
			});
			wrappedOpenAiTools.add(name);
		}
	};

	const wrappedMcpTools = new Set<string>();
	const registerMcpToolOverrides = (): void => {
		let allTools: unknown[] = [];
		try {
			allTools = typeof (pi as any).getAllTools === "function" ? (pi as any).getAllTools() : [];
		} catch {
			allTools = [];
		}
		for (const tool of allTools) {
			if (!isMcpToolCandidate(tool)) continue;
			const record = tool as Record<string, unknown>;
			const name = typeof record.name === "string" ? record.name : "";
			if (!name || wrappedMcpTools.has(name)) continue;
			const execute = typeof record.execute === "function" ? (record.execute as any) : null;
			if (!execute) continue;
			const label = typeof record.label === "string" ? record.label : name === "mcp" ? "MCP" : `MCP ${name}`;
			const description = typeof record.description === "string" ? record.description : "MCP tool";
			(pi as any).registerTool({
				name,
				label,
				description,
				renderShell: "self",
				parameters: record.parameters,
				prepareArguments: typeof record.prepareArguments === "function" ? record.prepareArguments : undefined,
				async execute(toolCallId: string, params: any, signal: AbortSignal | undefined, onUpdate: any, ctx: any) {
					return await Promise.resolve(execute(toolCallId, params, signal, onUpdate, ctx));
				},
				renderCall(args: any, theme: Theme, ctx: any) {
					return renderGenericToolCall(name, args, theme, ctx);
				},
				renderResult(result: any, { expanded, isPartial }: any, theme: Theme, ctx: any) {
					return renderMcpToolResult(result, expanded, isPartial, theme, ctx);
				},
			});
			wrappedMcpTools.add(name);
		}
	};

	pi.on("session_start", async () => {
		registerOpenAiToolOverrides();
		registerMcpToolOverrides();
	});
	pi.on("before_agent_start", async () => {
		registerOpenAiToolOverrides();
		registerMcpToolOverrides();
	});

	// Streaming activity keeps the blink timer alive. Do NOT clear blink contexts
	// on turn_end — a turn ends when the assistant message finishes, BEFORE its
	// tools run. agent_end / agent_settled are the real "work finished" signals.
	pi.on("turn_start", async () => { markBlinkActivity(); });
	pi.on("message_start", async () => { markBlinkActivity(); });
	pi.on("message_update", async () => { markBlinkActivity(); });
	pi.on("tool_execution_start", async () => { markBlinkActivity(); });
	// Partial tool output is the main long-running signal (bash streams for minutes).
	pi.on("tool_execution_update", async () => { markBlinkActivity(); });
	pi.on("tool_execution_end", async () => { markBlinkActivity(); });
	// agent_end fires when a low-level run finishes (tools for that assistant message
	// are done). registerThinkingLabels clears currentAgentWorkStartMs on the same
	// event; defer so we only wipe blink state once the work marker is gone.
	// Do not use agent_settled here — older peer types don't include it, and the
	// live-agent heartbeat already keeps quiet long tools blinking until agent_end.
	pi.on("agent_end", async () => {
		queueMicrotask(() => {
			if (currentAgentWorkStartMs !== undefined) {
				markBlinkActivity();
				return;
			}
			_clearAllBlinkContexts();
		});
	});
	// Session rebuild (resume/reload/fork) must not leave history partials blinking.
	pi.on("session_start", async () => {
		_clearAllBlinkContexts();
		diffPresentationModule.reset();
	});
	pi.on("session_shutdown", async () => {
		_clearAllBlinkContexts();
		clearAllBashDurationContexts();
		clearBashHostState();
		WRITE_EXISTED_BEFORE.clear();
		diffPresentationModule.reset();
		invalidateThemePaletteCache();
		bumpToolBranchVisualEpoch();
	});
}
