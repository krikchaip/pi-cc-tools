import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  AssistantMessageComponent,
  CustomMessageComponent,
  ToolExecutionComponent,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import {
  Markdown,
  ProcessTerminal,
  Spacer,
  Text,
  deleteAllKittyImages,
  getCapabilities,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import {
  beginToolCollapseViewportTransaction,
  captureToolCollapseViewportRollback,
} from "../click-expansion/viewport";

import type { MarkdownTransformer } from "./chrome.ts";
import {
  ANSI_RE,
  BORDER_COLOR,
  CLICK_EXPANSION_ACTIVATE_TARGET,
  CLICK_EXPANSION_ACTIVATION_HOST,
  CLICK_EXPANSION_ROLLBACK_HOST,
  CUSTOM_MESSAGE_PATCH_FLAG,
  MAX_MCP_PRESENTATION_SPILL_BYTES,
  MCP_SPILL_PRESENTATION_CACHE,
  OSC133_ZONE_END,
  OSC133_ZONE_FINAL,
  OSC133_ZONE_START,
  RESET,
  RESULT_SUMMARY_WRAP_MARK,
  TOOL_CACHE_PATCH_FLAG,
  TOOL_CLICK_LOCAL_EXPANDED,
  TOOL_CLICK_OWNER,
  TOOL_CLICK_RENDERED_FALLBACK,
  TOOL_IMAGE_EXPAND_PATCH_FLAG,
  TRANSPARENT_BG,
  TRANSPARENT_RESET,
  USER_MESSAGE_PATCH_FLAG,
  applyTerminalCopyZones,
  applyToolBackgroundMode,
  borderLine,
  clampLineWidth,
  getGlobalPiTheme,
  isBlankLine,
  isCodeBoxChromeLine,
  padRenderedLineToWidth,
  readPiOutputPad,
  readSettings,
  sanitizeRenderedTextBlockLines,
  stripAnsi,
  syncToolBackgroundMode,
  syncToolOutputPad,
  toolBackgroundMode,
} from "./chrome.ts";
import type {
  InternalClickExpansionDeclaration,
  ToolClickAction,
  ToolClickAnchor,
  ToolViewportAnchor,
} from "./click-routing.ts";

import type { PublishedToolClickAnchor } from "./grouping.ts";

import { hasPendingPresentation } from "./presentation-settlement.ts";
import type { TranscriptHostPorts } from "./ports.ts";

let transcriptHostPorts: TranscriptHostPorts;

export function connectTranscriptHost(ports: TranscriptHostPorts): void {
  transcriptHostPorts = ports;
}

const ASSISTANT_PATCH_FLAG = Symbol.for(
  "pi-claude-style-tools:patched-assistant-message",
);
const ASSISTANT_RENDER_PATCH_FLAG = Symbol.for(
  "pi-claude-style-tools:patched-assistant-message-render",
);
const ASSISTANT_UPDATE_BASE = Symbol.for(
  "pi-claude-style-tools:assistant-message-update-base",
);
const TOOL_EXECUTION_PATCH_FLAG = Symbol.for(
  "pi-claude-style-tools:patched-tool-execution",
);
const TOOL_RESULT_GETTER_SEEN = Symbol.for(
  "pi-claude-style-tools:tool-result-getter-seen",
);
const TOOL_RESULT_GETTER_ADAPTED = Symbol.for(
  "pi-claude-style-tools:tool-result-getter-adapted",
);

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
const MESSAGE_RENDER_CACHE = Symbol.for(
  "pi-claude-style-tools:message-render-cache",
);

function messageRenderCacheHit(thisArg: any, width: number): string[] | null {
  const cache = thisArg?.[MESSAGE_RENDER_CACHE];
  if (
    cache &&
    cache.width === width &&
    cache.epoch === transcriptHostPorts.toolExecution._toolBranchVisualEpoch &&
    cache.mode === toolBackgroundMode &&
    Array.isArray(cache.lines)
  ) {
    return cache.lines;
  }
  return null;
}

function storeMessageRenderCache(
  thisArg: any,
  width: number,
  lines: string[],
): string[] {
  if (thisArg && typeof thisArg === "object") {
    thisArg[MESSAGE_RENDER_CACHE] = {
      width,
      epoch: transcriptHostPorts.toolExecution._toolBranchVisualEpoch,
      mode: toolBackgroundMode,
      lines,
    };
  }
  return lines;
}

function clearMessageRenderCache(thisArg: any): void {
  if (thisArg && typeof thisArg === "object")
    thisArg[MESSAGE_RENDER_CACHE] = undefined;
}
export const WORKED_DURATION_KEY = "_piClaudeStyleWorkedDurationMs";
export const WORKED_START_KEY = "_piClaudeStyleWorkedStartMs";
export const WORKED_SESSION_TOTAL_KEY = "_piClaudeStyleWorkedSessionTotalMs";
export const WORKED_TURNS_KEY = "_piClaudeStyleWorkedTurns";
const WORKED_DURATION_MARKER = "Turn took";
export const THINKING_DURATION_KEY = "_piClaudeStyleThinkingDurationMs";
export const THINKING_ACTIVE_KEY = "_piClaudeStyleThinkingActive";
const MIN_THINKING_SUMMARY_MS = 100;

export const transcriptTiming: {
  lastThinkingBlockDurationMs: number | undefined;
  thinkingBlockStartMs: number;
  thinkingBlockInFlight: boolean;
  currentAgentWorkStartMs: number | undefined;
  currentAssistantMessageStartMs: number | undefined;
  sessionStartMs: number | undefined;
  userTurnCount: number;
} = {
  lastThinkingBlockDurationMs: undefined,
  thinkingBlockStartMs: 0,
  thinkingBlockInFlight: false,
  currentAgentWorkStartMs: undefined,
  currentAssistantMessageStartMs: undefined,
  sessionStartMs: undefined,
  userTurnCount: 0,
};

// WORKED_LINE_FG is theme-derived (from "muted") when themeAdaptive is on.
export let WORKED_LINE_FG = "\x1b[38;2;140;140;140m";

export function setWorkedLineForeground(foreground: string): void {
  WORKED_LINE_FG = foreground;
}

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
    const safeWidth = Number.isFinite(width)
      ? Math.max(0, Math.floor(width))
      : 0;
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

export function getMessageThinkingDurationMs(message: any): number {
  const stored = (message as any)?.[THINKING_DURATION_KEY];
  if (typeof stored === "number" && stored > 0) return stored;
  if (
    typeof transcriptTiming.lastThinkingBlockDurationMs === "number" &&
    transcriptTiming.lastThinkingBlockDurationMs > 0
  ) {
    return transcriptTiming.lastThinkingBlockDurationMs;
  }
  if (
    typeof (message as any)?.[WORKED_DURATION_KEY] === "number" &&
    (message as any)[WORKED_DURATION_KEY] > 0
  ) {
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
  return transcriptHostPorts.grouping.isAssistantThinkingComplete(
    this,
    message,
  );
}

function hiddenThinkingSummaryForMessage(message: any, comp?: any): string {
  if (
    message &&
    !transcriptHostPorts.grouping.isAssistantThinkingComplete(comp, message) &&
    transcriptHostPorts.grouping.isLiveThinkingMessage(comp, message)
  ) {
    return thinkingActiveSummaryText();
  }
  const durationMs = getMessageThinkingDurationMs(message);
  if (message && typeof message === "object") {
    (message as any)[THINKING_DURATION_KEY] = durationMs;
  }
  return thoughtDurationSummaryText(durationMs);
}

function isHiddenThinkingPlaceholderText(
  child: unknown,
): child is InstanceType<typeof Text> {
  if (!transcriptHostPorts.grouping.isTextComponent(child)) return false;
  const plain = stripAnsi(String((child as any).text ?? "")).trim();
  if (/^[✻∴]\s*Thinking/i.test(plain)) return true;
  if (/^[✻∴]\s*Thought for/i.test(plain)) return true;
  if (/^Thought for\b/i.test(plain)) return true;
  if (/^Thinking\.\.\.$/i.test(plain)) return true;
  if (/^Thinking…$/i.test(plain)) return true;
  return /^Thinking:?\s*$/i.test(plain);
}

function messageHasThinkingContent(message: any): boolean {
  return (
    Array.isArray(message?.content) &&
    message.content.some(
      (block: any) =>
        block?.type === "thinking" &&
        typeof block.thinking === "string" &&
        block.thinking.trim(),
    )
  );
}

function workedDurationText(
  ms: number,
  sessionTotalMs?: number,
  turns?: number,
): string {
  let text = `${WORKED_LINE_FG}✻ Turn took ${formatWorkedDuration(ms)}`;
  if (
    typeof sessionTotalMs === "number" &&
    typeof turns === "number" &&
    turns > 0
  ) {
    text += ` (Total time ${formatSessionTotal(sessionTotalMs)} · ${pluralizeTurns(turns)})`;
  }
  return `${text}${RESET}`;
}

function isWorkedDurationLine(line: string): boolean {
  return (
    line.includes(WORKED_DURATION_MARKER) &&
    /^✻ Turn took [^\r\n]+$/.test(stripAnsi(line).trim())
  );
}

export function stripWorkedDurationLine(text: string): string {
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
    if (
      block?.type !== "text" ||
      typeof block.text !== "string" ||
      !block.text.includes(WORKED_DURATION_MARKER)
    )
      return false;
    return block.text.split(/\r?\n/).some(isWorkedDurationLine);
  });
}

type MarkdownThemeLike = ConstructorParameters<typeof Markdown>[3];

type ParagraphSegment = { kind: "markdown"; md: InstanceType<typeof Markdown> };

const COPY_SAFE_MARKDOWN_LINKS_FLAG = Symbol.for(
  "pi-claude-style-tools:copy-safe-markdown-links",
);

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

function makeMarkdownLinksCopySafe(
  markdown: InstanceType<typeof Markdown>,
): void {
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
const TERMINAL_SCRUB_PATCH_FLAG = Symbol.for(
  "pi-claude-style-tools:terminal-write-tag-scrub",
);

export function patchTerminalWriteTagScrubber(): void {
  const proto = (ProcessTerminal as any)?.prototype;
  if (!proto || proto[TERMINAL_SCRUB_PATCH_FLAG]) return;
  const originalWrite = proto.write;
  if (typeof originalWrite !== "function") return;
  proto.write = function patchedTerminalWrite(
    this: any,
    data: any,
    ...rest: any[]
  ) {
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
  return text.replace(
    /```(?:latex|tex)\s*\r?\n([\s\S]*?)```/gi,
    (_match, body: string) => {
      return `\\[\n${body.trim()}\n\\]`;
    },
  );
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
    md: new Markdown(text, 0, 0, theme, undefined, {
      transform,
      renderLatex: true,
    } as any),
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
  appendMarkdownSegment(
    segments,
    normalizeFencedLatexBlocks(text),
    theme,
    transform,
  );
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
    const transform = createAssistantMarkdownTransform(
      isStreaming,
      markdownTransformers,
    );
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
    const safeWidth = Number.isFinite(width)
      ? Math.max(0, Math.floor(width))
      : 0;
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
      sanitizeRenderedTextBlockLines(
        segment.md.render(contentWidth),
        contentWidth,
      ),
    );
    const looksLikeTaskStatus = lines.some((line) =>
      /\b(?:transcript:|No output\.|Wrapped up)/.test(stripAnsi(line)),
    );
    const displayLines = looksLikeTaskStatus
      ? lines.map(transcriptHostPorts.grouping.normalizeLeadingCheckGlyph)
      : lines;
    let dotPlaced = false;
    const rendered = displayLines
      .map((line: string) => {
        if (!stripAnsi(line).trim()) return `   ${line}`;
        if (isCodeBoxChromeLine(line)) return `   ${line}`;
        if (!dotPlaced) {
          dotPlaced = true;
          return ` ● ${line}`;
        }
        return `   ${line}`;
      })
      .map((line) => {
        const gap = safeWidth - visibleWidth(line);
        return gap > 0
          ? line + " ".repeat(gap)
          : gap < 0
            ? truncateToWidth(line, safeWidth, "", false)
            : line;
      });
    this.cachedWidth = width;
    this.cachedLines = rendered;
    return rendered;
  }
}

function replaceHiddenThinkingPlaceholders(
  container: { children?: any[] },
  message: any,
): void {
  if (!container?.children) return;
  const summary = hiddenThinkingSummaryForMessage(message);
  let firstReplaced = false;
  for (let i = 0; i < container.children.length; i++) {
    const child = container.children[i];
    const inner = (child as any)?.child ?? child;
    if (
      inner instanceof HiddenThinkingSummary ||
      (inner as any)?.constructor?.name === "HiddenThinkingSummary"
    ) {
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
      highlightCode: (code: string, _lang?: string) =>
        code.split("\n").map((line) => `${DIM_FG}${line}`),
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
      this.cachedLines &&
      this.cachedWidth === width &&
      this.chromeEpoch ===
        transcriptHostPorts.toolExecution._toolBranchVisualEpoch
    ) {
      return this.cachedLines;
    }
    const safeWidth = Number.isFinite(width)
      ? Math.max(0, Math.floor(width))
      : 0;
    if (safeWidth <= 0) {
      this.cachedWidth = width;
      this.cachedLines = [""];
      this.chromeEpoch =
        transcriptHostPorts.toolExecution._toolBranchVisualEpoch;
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
    const lines = sanitizeRenderedTextBlockLines(
      md.render(safeWidth - PREFIX_W),
      safeWidth - PREFIX_W,
    );
    let symbolPlaced = false;
    const rendered = lines
      .map((line: string) => {
        if (!symbolPlaced && stripAnsi(line).trim()) {
          symbolPlaced = true;
          return ` ${prefix} ${line}`;
        }
        return `   ${line}`;
      })
      .map((line) => clampLineWidth(line, safeWidth));
    this.cachedWidth = width;
    this.cachedLines = rendered;
    this.chromeEpoch = transcriptHostPorts.toolExecution._toolBranchVisualEpoch;
    return rendered;
  }
}

export function trimRenderedBlankLines(lines: string[]): string[] {
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
  return (
    plain.startsWith("⎿") ||
    plain.startsWith("transcript:") ||
    plain === "No output." ||
    /^(?:Done|Wrapped up|Stopped|Error:|Aborted)\b/.test(plain)
  );
}

function cleanSubagentDetailLine(line: string): string {
  const markerIndex = line.indexOf("⎿");
  if (markerIndex !== -1) {
    const prefixAnsi = (line.slice(0, markerIndex).match(ANSI_RE) ?? []).join(
      "",
    );
    return `${prefixAnsi}${line.slice(markerIndex + 1).replace(/^\s+/, "")}`;
  }
  return line
    .replace(/^((?:\x1b\[[0-9;]*m)*)\s{2}/, "$1")
    .replace(/^\s{2}/, "");
}

function formatSubagentNotificationGroup(lines: string[]): string[] {
  if (lines.length === 0) return [];
  const header = transcriptHostPorts.grouping.normalizeLeadingCheckGlyph(
    lines[0],
  );
  const rest = lines.slice(1);
  const detailStart = rest.findIndex(isSubagentDetailLine);
  if (detailStart === -1) {
    return [header, ...rest];
  }

  const metadata = rest.slice(0, detailStart);
  const detailLines = rest
    .slice(detailStart)
    .map(cleanSubagentDetailLine)
    .filter((line) => stripAnsi(line).trim().length > 0);
  const formattedDetails = transcriptHostPorts.toolExecution
    .withFinalBranchBlock(detailLines.join("\n"), undefined as any)
    .split("\n")
    .filter((line) => line.length > 0);
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
  const core = trimRenderedBlankLines(lines).map((line) =>
    clampLineWidth(line, safeWidth),
  );
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
  const core = trimRenderedBlankLines(lines).map(
    transcriptHostPorts.grouping.normalizeLeadingCheckGlyph,
  );
  if (core.length === 0) return lines;
  const formatted = splitSubagentNotificationGroups(core).flatMap(
    (group, index) => {
      const groupLines = formatSubagentNotificationGroup(group);
      return index === 0 ? groupLines : ["", ...groupLines];
    },
  );
  const safeWidth = Math.max(1, width);
  const indented = formatted.map((line) =>
    clampLineWidth(line ? ` ${line}` : line, safeWidth),
  );
  syncToolBackgroundMode();
  return toolBackgroundMode === "default"
    ? indented
    : [" ".repeat(safeWidth), ...indented];
}

export function patchCustomMessageRender(): void {
  const proto = CustomMessageComponent.prototype as any;
  transcriptHostPorts.grouping.refreshBuiltinClickHandlers(proto);
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
        : transcriptHostPorts.grouping.isSideQuestEventMessage(this)
          ? formatBannerLikeLines(
              lines.map(
                transcriptHostPorts.grouping.normalizeLeadingCheckGlyph,
              ),
              nextWidth,
            )
          : lines.map(transcriptHostPorts.grouping.normalizeLeadingCheckGlyph);
    };
    const result = renderRows(width);
    let output = result;
    if (transcriptHostPorts.grouping.isSideQuestEventMessage(this)) {
      const state = transcriptHostPorts.grouping.builtinExpansionState(this);
      state.width = width;
      state.height = result.length;
      state.rows = result;
      const target = { kind: "pi-owned-transcript", transcript: this } as const;
      const expansion = transcriptHostPorts.clickRouting.clickExpansionModule;
      if (!expansion) return storeMessageRenderCache(this, width, output);
      if (
        expansion.state(target).active &&
        transcriptHostPorts.grouping.builtinExpansionChangesOutput(
          this,
          width,
          renderRows,
        )
      ) {
        const bounds = transcriptHostPorts.grouping.sideQuestPaintedBounds(
          this,
          width,
          result.length,
        );
        if (bounds) {
          const viewport =
            transcriptHostPorts.grouping.builtinComponentExpanded(this)
              ? "adaptive"
              : "top";
          output = result.map((row: string, index: number) => {
            if (index < bounds.first || index > bounds.last) return row;
            const padded = transcriptHostPorts.grouping.padPaintedLineToWidth(
              row,
              width,
            );
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
      const state = transcriptHostPorts.grouping.builtinExpansionState(this);
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
      if (
        code === 49 ||
        (code >= 40 && code <= 47) ||
        (code >= 100 && code <= 107)
      )
        continue;
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
  const suffixWidth = Math.max(
    0,
    width - 2 - visibleWidth(prefix) - visibleWidth(label),
  );
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

function visitMarkdownDescendants(
  root: unknown,
  visit: (md: InstanceType<typeof Markdown>) => void,
): void {
  if (!root || typeof root !== "object") return;
  const node = root as { children?: unknown[] };
  for (const child of node.children ?? []) {
    if (transcriptHostPorts.grouping.isMarkdownComponent(child)) visit(child);
    else visitMarkdownDescendants(child, visit);
  }
}

export function patchUserMessageRender(): void {
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
      ...lines
        .slice(1, -1)
        .map((line: string) => borderedUserMessageLine(line, borderWidth)),
      roundedUserBorder(borderWidth, false),
    ];
    const clamped = rendered.map((line) => clampLineWidth(line, borderWidth));
    return storeMessageRenderCache(
      this,
      width,
      applyTerminalCopyZones(clamped),
    );
  };
  proto[USER_MESSAGE_PATCH_FLAG] = true;
}

export function patchAssistantMessages(): void {
  const proto = AssistantMessageComponent.prototype as any;
  const originalRender = proto.render;
  if (
    typeof originalRender === "function" &&
    !proto[ASSISTANT_RENDER_PATCH_FLAG]
  ) {
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
      return storeMessageRenderCache(
        this,
        width,
        applyTerminalCopyZones(lines),
      );
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
  proto.updateContent = function patchedUpdateContent(
    message: any,
    isStreaming?: boolean,
  ) {
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
    const liveMode = transcriptHostPorts.grouping.getThinkingMode() === "live";
    const thinkingCollapsed = !!(this as any).hideThinkingBlock;
    const showLiveThinking =
      liveMode &&
      thinkingCollapsed &&
      transcriptHostPorts.grouping.isLiveThinkingMessage(this, message);
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
    if (
      thinkingCollapsed &&
      !showLiveThinking &&
      messageHasThinkingContent(message)
    ) {
      replaceHiddenThinkingPlaceholders(container, message);
    }
    const mdTheme = (this as any).markdownTheme;
    for (let i = container.children.length - 1; i >= 0; i--) {
      const child = container.children[i];
      const inner = (child as any)?.child ?? child;
      if (transcriptHostPorts.grouping.isMarkdownComponent(inner)) {
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
    const workedDuration =
      typeof explicitDuration === "number" ? explicitDuration : undefined;
    const workedSessionTotal =
      typeof explicitSessionTotal === "number"
        ? explicitSessionTotal
        : typeof transcriptTiming.sessionStartMs === "number"
          ? Date.now() - transcriptTiming.sessionStartMs
          : undefined;
    const workedTurns =
      typeof explicitTurns === "number"
        ? explicitTurns
        : transcriptTiming.userTurnCount;
    const hasAssistantText = message.content.some(
      (block: any) =>
        block?.type === "text" &&
        typeof block.text === "string" &&
        block.text.trim(),
    );
    if (
      typeof workedDuration === "number" &&
      isFinalAssistantMessage &&
      hasAssistantText &&
      !hasWorkedDurationLine(message)
    ) {
      container.children.push(
        new Spacer(1),
        new Text(
          workedDurationText(workedDuration, workedSessionTotal, workedTurns),
          1,
          0,
        ),
      );
    }
  };
  proto[ASSISTANT_PATCH_FLAG] = true;
}

const TOOL_BG_PATCH_FLAG = Symbol.for(
  "pi-claude-style-tools:patched-tool-bg-sync",
);

export function patchToolExecutionBackgroundSync(): void {
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

export function resultTextContent(result: any): string {
  if (!Array.isArray(result?.content)) return "";
  return result.content
    .filter(
      (block: any) => block?.type === "text" && typeof block.text === "string",
    )
    .map((block: any) => block.text)
    .join("\n")
    .replace(/\r\n?/g, "\n");
}

export function completeMcpResultForPresentation(result: any, state: any): any {
  const path =
    result?.details?.outputGuard?.truncated === true
      ? result.details.outputGuard.fullOutputPath
      : undefined;
  if (typeof path !== "string" || !path) return result;
  const cached = state?.[MCP_SPILL_PRESENTATION_CACHE];
  if (cached?.source === result && cached.path === path) return cached.result;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, "r");
    const metadata = fstatSync(descriptor);
    if (
      !metadata.isFile() ||
      metadata.size <= 0 ||
      metadata.size > MAX_MCP_PRESENTATION_SPILL_BYTES
    )
      return result;
    const bytes = Buffer.allocUnsafe(metadata.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(
        descriptor,
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (count <= 0) return result;
      offset += count;
    }
    const text = bytes.toString("utf8");
    JSON.parse(text.trim());
    const presentationResult = Object.freeze({
      ...result,
      content: Object.freeze([
        Object.freeze({ type: "text", text }),
        ...(Array.isArray(result?.content)
          ? result.content.filter((block: any) => block?.type !== "text")
          : []),
      ]),
    });
    if (state && typeof state === "object")
      state[MCP_SPILL_PRESENTATION_CACHE] = {
        source: result,
        path,
        result: presentationResult,
      };
    return presentationResult;
  } catch {
    return result;
  } finally {
    if (descriptor !== undefined)
      try {
        closeSync(descriptor);
      } catch {
        /* Keep the raw preview fallback. */
      }
  }
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
  transcriptHostPorts.toolExecution.syncToolCallStatus(ctxLike);
  if (component?.isPartial === true && component?.result) {
    state._liveLineCount = resultTextContent(component.result)
      .split("\n")
      .filter((line) => line.trim()).length;
  } else if (component?.isPartial !== true) {
    delete state._liveLineCount;
  }
}

export function patchToolRenderCacheInvalidation(): void {
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
      transcriptHostPorts.clickRouting.clearToolRenderCache(this);
      if (
        method === "updateDisplay" ||
        method === "updateResult" ||
        method === "invalidate"
      ) {
        syncLiveToolRenderState(this);
      }
      const previousDetailTool =
        transcriptHostPorts.clickRouting.toolRenderBridge.localDetailTool;
      if (method === "updateDisplay")
        transcriptHostPorts.clickRouting.toolRenderBridge.localDetailTool =
          this;
      try {
        return original.apply(this, args);
      } finally {
        if (previousDetailTool === undefined)
          delete transcriptHostPorts.clickRouting.toolRenderBridge
            .localDetailTool;
        else
          transcriptHostPorts.clickRouting.toolRenderBridge.localDetailTool =
            previousDetailTool;
        transcriptHostPorts.clickRouting.clearToolRenderCache(this);
      }
    };
  }

  proto[TOOL_CACHE_PATCH_FLAG] = true;
}

function deleteRenderedKittyImages(component: any): void {
  if (
    !process.stdout.isTTY ||
    getCapabilities().images !== "kitty" ||
    !Array.isArray(component.imageComponents) ||
    component.imageComponents.length === 0
  )
    return;
  try {
    process.stdout.write(deleteAllKittyImages());
  } catch {
    /* noop */
  }
}

function removeImageChildren(component: any): void {
  deleteRenderedKittyImages(component);
  const children = [
    ...(Array.isArray(component.imageComponents)
      ? component.imageComponents
      : []),
    ...(Array.isArray(component.imageSpacers) ? component.imageSpacers : []),
  ];
  for (const child of children) {
    try {
      component.removeChild?.(child);
    } catch {
      /* noop */
    }
  }
  component.imageComponents = [];
  component.imageSpacers = [];
}

export function patchReadImageExpansion(): void {
  const proto = ToolExecutionComponent.prototype as any;
  if (proto[TOOL_IMAGE_EXPAND_PATCH_FLAG]) return;
  const originalUpdateDisplay = proto.updateDisplay;
  if (typeof originalUpdateDisplay !== "function") return;
  proto.updateDisplay = function patchedReadImageUpdateDisplay(...args: any[]) {
    const result = originalUpdateDisplay.apply(this, args);
    const hasImage =
      Array.isArray(this.result?.content) &&
      this.result.content.some((block: any) => block?.type === "image");
    const isMcp =
      transcriptHostPorts.toolFamily.isMcpToolName(this.toolName ?? "") ||
      transcriptHostPorts.toolFamily.isMcpToolCandidate(this.toolDefinition);
    const mcpMode = transcriptHostPorts.toolFamily.getMode(
      readSettings().mcpOutputMode,
      ["hidden", "summary", "preview"] as const,
      "preview",
    );
    const hideImage =
      (this.toolName === "read" && this.expanded !== true) ||
      (isMcp && (this.expanded !== true || mcpMode !== "preview"));
    if (hasImage && hideImage) {
      removeImageChildren(this);
      transcriptHostPorts.clickRouting.clearToolRenderCache(this);
    }
    return result;
  };
  proto[TOOL_IMAGE_EXPAND_PATCH_FLAG] = true;
}

export function clickAnchorStart(line: string): number {
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

function renderedToolClickAnchors(
  tool: any,
  rendered: string[],
): ToolClickAnchor[] {
  const anchors: ToolClickAnchor[] = [];
  for (let line = 0; line < rendered.length; line++) {
    const plain = stripAnsi(rendered[line]);
    const matches = [
      ...plain.matchAll(
        /click (?:to expand|to collapse|for more detail|for less detail)/gi,
      ),
    ];
    for (const match of matches) {
      const phrase = match[0].toLowerCase();
      const action: ToolClickAction =
        phrase === "click to expand" || phrase === "click to collapse"
          ? "expand"
          : phrase === "click for less detail" ||
              !transcriptHostPorts.clickRouting.toolSupportsProgressiveLocalDetail(
                tool,
              )
            ? "detail-extra"
            : "detail";
      const finalCollapse =
        phrase === "click to collapse" && /output ends here/i.test(plain);
      const exactSpan = matches.length > 1 || finalCollapse;
      const targetStart = finalCollapse
        ? plain.toLowerCase().indexOf("output ends here")
        : (match.index ?? 0);
      const start = exactSpan
        ? visibleWidth(plain.slice(0, targetStart))
        : clickAnchorStart(rendered[line]);
      const end = exactSpan
        ? finalCollapse
          ? visibleWidth(plain.trimEnd())
          : visibleWidth(plain.slice(0, (match.index ?? 0) + match[0].length))
        : visibleWidth(plain.trimEnd());
      if (end > start)
        anchors.push({
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
  const collapsedResult = fallbacks.find((anchor) =>
    /click to expand/i.test(stripAnsi(rendered[anchor.line] ?? "")),
  );
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
    if (end > start)
      return { line, start, end, action: "header", viewportAnchor: "top" };
  }
  return undefined;
}

export function toolHasEffectiveClickAction(tool: any): boolean {
  if (tool?.[TOOL_CLICK_LOCAL_EXPANDED] === true) return true;
  if (tool?.[TOOL_CLICK_RENDERED_FALLBACK] === true) return true;
  if (transcriptHostPorts.clickRouting.isSideQuestBinaryTool(tool))
    return transcriptHostPorts.clickRouting.sideQuestBinaryHasHiddenContent(
      tool,
    );
  return [tool.callRendererComponent, tool.resultRendererComponent]
    .filter(transcriptHostPorts.toolExecution.isToolTextComponent)
    .some((component) => component.hasClickAction(tool));
}

function collectToolClickAnchors(
  tool: any,
  rendered: string[],
): ToolClickAnchor[] {
  if (!transcriptHostPorts.clickRouting.toolClickExpansionActive(tool)) {
    tool[TOOL_CLICK_RENDERED_FALLBACK] = false;
    return [];
  }
  const anchors: ToolClickAnchor[] = [];
  if (transcriptHostPorts.clickRouting.isSideQuestBinaryTool(tool)) {
    if (
      transcriptHostPorts.clickRouting.sideQuestBinaryHasHiddenContent(tool)
    ) {
      const firstLine =
        rendered.length >= 2 &&
        !stripAnsi(rendered[0]).trim() &&
        !rendered[0].includes("\x1b[48;")
          ? 1
          : 0;
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
  const components = [
    tool.callRendererComponent,
    tool.resultRendererComponent,
  ].filter(transcriptHostPorts.toolExecution.isToolTextComponent);
  let declaredResultSummaryRow = -1;
  for (const component of components) {
    for (const semantic of component.getSemanticRows()) {
      const needle = semantic.anchorText ?? stripAnsi(semantic.text).trim();
      if (!needle) continue;
      const matched = rendered.findIndex((line) =>
        stripAnsi(line).includes(needle),
      );
      if (matched < 0) continue;
      if (
        declaredResultSummaryRow < 0 &&
        component === tool.resultRendererComponent &&
        semantic.action === "expand"
      )
        declaredResultSummaryRow = matched;
      const plain = stripAnsi(rendered[matched]);
      const targetIndex = semantic.anchorText
        ? plain.indexOf(semantic.anchorText)
        : -1;
      const start =
        targetIndex >= 0
          ? visibleWidth(plain.slice(0, targetIndex))
          : clickAnchorStart(rendered[matched]);
      const end =
        targetIndex >= 0
          ? start + visibleWidth(semantic.anchorText!)
          : visibleWidth(plain.trimEnd());
      if (end > start)
        anchors.push({
          line: matched,
          start,
          end,
          action: semantic.action,
          viewportAnchor: semantic.viewportAnchor,
        });
    }
  }
  const agentPresentation =
    transcriptHostPorts.clickRouting.sideQuestAgentPresentation(tool);
  if (
    String(tool?.toolName ?? "").toLowerCase() === "agent" &&
    agentPresentation
  ) {
    const summaryRow = declaredResultSummaryRow;
    const headerStart = rendered.findIndex(
      (line, index) => index < summaryRow && /\bAgent\b/.test(stripAnsi(line)),
    );
    for (let line = headerStart; line >= 0 && line < summaryRow; line++) {
      const plain = stripAnsi(rendered[line]);
      if (!plain.trim() || /^─+$/.test(plain.trim())) continue;
      const start = clickAnchorStart(rendered[line]);
      const end = visibleWidth(plain.trimEnd());
      if (end > start)
        anchors.push({
          line,
          start,
          end,
          action: "header",
          viewportAnchor: "top",
        });
    }
  }
  const renderedFallbacks = renderedToolClickAnchors(tool, rendered);
  for (const fallback of renderedFallbacks) {
    if (
      !anchors.some(
        (anchor) =>
          anchor.line === fallback.line &&
          anchor.action === fallback.action &&
          anchor.viewportAnchor === fallback.viewportAnchor,
      )
    )
      anchors.push(fallback);
  }
  if (!anchors.some((anchor) => anchor.action === "header")) {
    const headerFallback = renderedToolHeaderFallbackAnchor(
      tool,
      rendered,
      renderedFallbacks,
    );
    if (headerFallback) anchors.push(headerFallback);
  }
  tool[TOOL_CLICK_RENDERED_FALLBACK] = renderedFallbacks.length > 0;
  return anchors;
}

export function rawIndexAtVisibleColumn(
  text: string,
  targetColumn: number,
): number {
  let index = 0;
  let column = 0;
  while (index < text.length) {
    if (text[index] === "\x1b") {
      const control =
        /^(?:\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\))/.exec(
          text.slice(index),
        );
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

function declarePublishedToolClickAnchors(
  tool: any,
  rendered: string[],
): string[] {
  if (!transcriptHostPorts.clickRouting.clickExpansionModule) return rendered;
  const anchors = collectToolClickAnchors(tool, rendered);
  if (anchors.length === 0) return rendered;
  const output = [...rendered];
  for (let line = 0; line < output.length; line++) {
    const selected: ToolClickAnchor[] = [];
    for (const anchor of anchors) {
      if (anchor.line !== line || anchor.end <= anchor.start) continue;
      if (
        selected.some(
          (candidate) =>
            anchor.start < candidate.end && anchor.end > candidate.start,
        )
      )
        continue;
      selected.push(anchor);
    }
    selected.sort((left, right) => right.start - left.start);
    for (const anchor of selected) {
      const startIndex = rawIndexAtVisibleColumn(output[line], anchor.start);
      const endIndex = rawIndexAtVisibleColumn(output[line], anchor.end);
      const segment = output[line].slice(startIndex, endIndex);
      const exactText = stripAnsi(segment);
      if (!exactText) continue;
      const behavior =
        anchor.action === "detail"
          ? "next-detail"
          : anchor.action === "detail-extra"
            ? "toggle-max-detail"
            : "toggle";
      const viewport =
        anchor.action === "expand" &&
        tool?.expanded === true &&
        transcriptHostPorts.clickRouting.isSideQuestBinaryTool(tool)
          ? "adaptive"
          : anchor.viewportAnchor;
      const declared =
        transcriptHostPorts.clickRouting.clickExpansionModule.declare(
          { kind: "tool-execution", execution: tool },
          segment,
          {
            behavior,
            viewport,
            compatibilityAction: anchor.action,
            span: { text: exactText },
          } as InternalClickExpansionDeclaration,
        );
      output[line] =
        `${output[line].slice(0, startIndex)}${declared}${output[line].slice(endIndex)}`;
    }
  }
  return output;
}

export function publishStandaloneToolClickAnchors(
  tool: any,
  rendered: string[],
): string[] {
  if (!transcriptHostPorts.clickRouting.clickExpansionModule) return rendered;
  const declared = declarePublishedToolClickAnchors(tool, rendered);
  return [
    ...transcriptHostPorts.clickRouting.clickExpansionModule.publish(
      tool,
      declared,
    ),
  ];
}

function beginToolClickActivation(
  tool: any,
  behavior: "toggle" | "next-detail" | "toggle-max-detail",
  viewport: "top" | "bottom" | "adaptive",
  compatibilityAction?: ToolClickAction,
): false | { complete(): void; rollback(): void } {
  if (!toolHasEffectiveClickAction(tool)) return false;
  if (hasPendingPresentation(tool.rendererState ?? tool)) return false;
  const action =
    compatibilityAction ??
    (behavior === "next-detail"
      ? "detail"
      : behavior === "toggle-max-detail"
        ? "detail-extra"
        : "header");
  const requested =
    viewport === "adaptive"
      ? "adaptive"
      : transcriptHostPorts.grouping.requestedToolClickViewportAnchor(
          tool,
          action,
          viewport,
        );
  return beginToolCollapseViewportTransaction(
    tool,
    requested,
    tool.rendererState,
  );
}

function captureToolViewportRollback(
  tool: any,
  behavior: "toggle" | "next-detail" | "toggle-max-detail",
  viewport: "top" | "bottom" | "adaptive",
  compatibilityAction?: ToolClickAction,
): () => void {
  const action =
    compatibilityAction ??
    (behavior === "next-detail"
      ? "detail"
      : behavior === "toggle-max-detail"
        ? "detail-extra"
        : "header");
  const requested =
    viewport === "adaptive"
      ? "adaptive"
      : transcriptHostPorts.grouping.requestedToolClickViewportAnchor(
          tool,
          action,
          viewport,
        );
  return captureToolCollapseViewportRollback(
    tool,
    requested,
    tool.rendererState,
  );
}

function frameStandaloneMcpLines(rendered: string[], width: number): string[] {
  let start = 0;
  while (start < rendered.length && isBlankLine(rendered[start])) start++;
  let end = rendered.length - 1;
  while (end >= start && isBlankLine(rendered[end])) end--;
  if (start > end) return rendered;

  const safeWidth = Math.max(1, width);
  const { textLines, imageLines } =
    transcriptHostPorts.grouping.splitRenderedImageBlock(
      rendered.slice(start, end + 1),
    );
  const core = textLines.map((line) =>
    clampLineWidth(
      transcriptHostPorts.grouping.stripOuterBackgroundAnsi(
        transcriptHostPorts.grouping.normalizeLeadingCheckGlyph(line),
      ),
      safeWidth,
    ),
  );
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
  return (
    core.length >= 2 &&
    /^─+$/.test(stripAnsi(core[0]).trim()) &&
    /^─+$/.test(stripAnsi(core.at(-1) ?? "").trim())
  );
}

function adaptedToolResultRenderer(
  tool: any,
  activeGetter: (...args: any[]) => any,
): any {
  const toolName = typeof tool?.toolName === "string" ? tool.toolName : "";
  let renderer: any;
  if (toolName === "apply_patch") {
    renderer = (result: any, options: any, theme: Theme, ctx: any) =>
      transcriptHostPorts.toolFamily.renderApplyPatchResult(
        { content: result.content, details: result.details },
        options.isPartial,
        theme,
        ctx,
      );
  } else if (transcriptHostPorts.toolFamily.isMcpToolName(toolName)) {
    renderer = (result: any, options: any, theme: Theme, ctx: any) =>
      transcriptHostPorts.toolFamily.renderMcpToolResult(
        result,
        !!options?.expanded,
        !!options?.isPartial,
        theme,
        ctx,
      );
  } else {
    const delegatedRenderer = activeGetter.call(tool);
    if (typeof delegatedRenderer === "function") {
      renderer = delegatedRenderer;
    } else if (
      transcriptHostPorts.toolFamily.shouldUseGenericToolRenderer(toolName)
    ) {
      renderer = (result: any, options: any, theme: Theme, ctx: any) =>
        transcriptHostPorts.toolFamily.renderGenericToolResult(
          toolName,
          result,
          options,
          theme,
          ctx,
        );
    }
  }
  if (typeof renderer !== "function") return renderer;
  // Strip transient Magic Context tags from the text the renderer sees,
  // without touching the stored result message.
  return (result: any, options: any, theme: Theme, ctx: any) => {
    const sanitized = sanitizeToolResultForDisplay(result);
    if (
      toolName.toLowerCase() === "agent" &&
      transcriptHostPorts.clickRouting.sideQuestAgentPresentation(sanitized) &&
      transcriptHostPorts.clickRouting.toolClickExpansionActive(
        transcriptHostPorts.clickRouting.toolRenderBridge.localDetailTool,
      )
    ) {
      return transcriptHostPorts.toolFamily.renderOpenAiToolResult(
        "Agent",
        sanitized,
        !!options?.expanded,
        !!options?.isPartial,
        theme,
        ctx,
      );
    }
    return renderer(sanitized, options, theme, ctx);
  };
}

export function toolClickAnchorAtPoint(
  tool: any,
  x: number,
  y: number,
): PublishedToolClickAnchor | undefined {
  if (!transcriptHostPorts.clickRouting.toolClickExpansionActive(tool))
    return undefined;
  const hitTest = tool?.clickAnchorAtPoint;
  return typeof hitTest === "function" ? hitTest.call(tool, x, y) : undefined;
}

function refreshToolExecutionClickHandlers(proto: any): void {
  proto[CLICK_EXPANSION_ACTIVATION_HOST] = function toolActivationHost(
    behavior: "toggle" | "next-detail" | "toggle-max-detail",
    viewport: "top" | "bottom" | "adaptive",
    compatibilityAction?: ToolClickAction,
  ) {
    return beginToolClickActivation(
      this,
      behavior,
      viewport,
      compatibilityAction,
    );
  };
  proto[CLICK_EXPANSION_ROLLBACK_HOST] = function toolRollbackHost(
    behavior: "toggle" | "next-detail" | "toggle-max-detail",
    viewport: "top" | "bottom" | "adaptive",
    compatibilityAction?: ToolClickAction,
  ) {
    return captureToolViewportRollback(
      this,
      behavior,
      viewport,
      compatibilityAction,
    );
  };
  proto.activateClickAction = function activatePublishedTool(
    action: ToolClickAction,
    viewport: ToolViewportAnchor = "top",
  ): boolean {
    const activate = (globalThis as any)[CLICK_EXPANSION_ACTIVATE_TARGET];
    const behavior =
      action === "detail"
        ? "next-detail"
        : action === "detail-extra"
          ? "toggle-max-detail"
          : "toggle";
    return (
      activate?.(
        { kind: "tool-execution", execution: this },
        behavior,
        viewport,
        action,
      ) === true
    );
  };
}

export function patchToolExecutionRenderers(): void {
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
    proto.render = function patchedToolExecutionRender(
      width: number,
    ): string[] {
      const activeResultGetter = this.getResultRenderer;
      const staleAgentAdapter =
        String(this.toolName ?? "").toLowerCase() === "agent" &&
        this.result !== undefined &&
        transcriptHostPorts.clickRouting.sideQuestAgentPresentation(this) ===
          undefined &&
        transcriptHostPorts.toolExecution.isToolTextComponent(
          this.resultRendererComponent,
        ) &&
        String(this.resultRendererComponent.value ?? "").includes(
          RESULT_SUMMARY_WRAP_MARK,
        );
      if (
        staleAgentAdapter ||
        (this.result !== undefined &&
          this[TOOL_RESULT_GETTER_SEEN] !== activeResultGetter)
      )
        this.updateDisplay?.();
      syncToolOutputPad(this, readPiOutputPad());
      for (const component of [
        this.callRendererComponent,
        this.resultRendererComponent,
      ]) {
        if (transcriptHostPorts.toolExecution.isToolTextComponent(component))
          (component as any)[TOOL_CLICK_OWNER] = this;
      }
      const rendered = originalRender.call(this, width);
      const toolName = String(this.toolName ?? "").toLowerCase();
      const isMcp =
        transcriptHostPorts.toolFamily.isMcpToolName(this.toolName ?? "") ||
        transcriptHostPorts.toolFamily.isMcpToolCandidate(this.toolDefinition);
      const isStandaloneSideQuest = toolName === "agent";
      const needsStandaloneFrame =
        (isMcp ||
          (isStandaloneSideQuest && toolBackgroundMode === "outlines")) &&
        !hasStandaloneOutlineFrame(rendered);
      const output = needsStandaloneFrame
        ? frameStandaloneMcpLines(rendered, width)
        : rendered;
      return publishStandaloneToolClickAnchors(this, output);
    };
  }

  if (typeof originalUpdateDisplay === "function") {
    proto.updateDisplay = function patchedToolExecutionUpdateDisplay(
      this: any,
      ...args: any[]
    ): any {
      const activeGetter = this.getResultRenderer;
      if (typeof activeGetter !== "function")
        return originalUpdateDisplay.apply(this, args);
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
    const initialResultGetter = function patchedInitialResultGetter(
      this: any,
    ): any {
      return adaptedToolResultRenderer(this, originalGetResultRenderer);
    };
    initialResultGetter[TOOL_RESULT_GETTER_ADAPTED] = true;
    proto.getResultRenderer = initialResultGetter;
  }

  if (typeof originalHasRendererDefinition === "function") {
    proto.hasRendererDefinition = function patchedHasRendererDefinition() {
      return (
        originalHasRendererDefinition.call(this) ||
        transcriptHostPorts.toolFamily.shouldUseGenericToolRenderer(
          this?.toolName,
        )
      );
    };
  }

  if (typeof originalGetRenderShell === "function") {
    proto.getRenderShell = function patchedGetRenderShell() {
      const toolName = typeof this?.toolName === "string" ? this.toolName : "";
      return transcriptHostPorts.toolFamily.isMcpToolName(toolName)
        ? "self"
        : originalGetRenderShell.call(this);
    };
  }

  proto.getCallRenderer = function patchedGetCallRenderer() {
    const toolName = typeof this?.toolName === "string" ? this.toolName : "";
    if (toolName === "apply_patch") {
      return (args: any, theme: Theme, ctx: any) =>
        transcriptHostPorts.toolFamily.renderApplyPatchCall(args, theme, ctx);
    }
    if (transcriptHostPorts.toolFamily.isMcpToolName(toolName)) {
      return (args: any, theme: Theme, ctx: any) =>
        transcriptHostPorts.toolFamily.renderGenericToolCall(
          toolName,
          args,
          theme,
          ctx,
        );
    }
    const originalRenderer =
      typeof originalGetCallRenderer === "function"
        ? originalGetCallRenderer.call(this)
        : undefined;
    if (typeof originalRenderer === "function") return originalRenderer;
    if (transcriptHostPorts.toolFamily.shouldUseGenericToolRenderer(toolName)) {
      return (args: any, theme: Theme, ctx: any) =>
        transcriptHostPorts.toolFamily.renderGenericToolCall(
          toolName,
          args,
          theme,
          ctx,
        );
    }
    return undefined;
  };

  // Fallback path for tools without a renderer definition formats raw text.
  const originalFormatToolExecution = proto.formatToolExecution;
  if (typeof originalFormatToolExecution === "function") {
    proto.formatToolExecution = function patchedFormatToolExecution(
      this: any,
      ...args: any[]
    ) {
      const formatted = originalFormatToolExecution.apply(this, args);
      return typeof formatted === "string"
        ? stripTransientMagicContextTags(formatted)
        : formatted;
    };
  }

  proto[TOOL_EXECUTION_PATCH_FLAG] = true;
}
