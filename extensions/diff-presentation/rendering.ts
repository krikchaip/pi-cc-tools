import { extname, relative } from "node:path";

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import * as Diff from "diff";
import type { BundledLanguage } from "shiki";

import type { ApplyPatchChangePreview, DiffLine, ParsedDiff } from "./model.ts";
import type { DiffPalette } from "./palette.ts";
import type {
  DiffPresentationChrome,
  DiffPresentationSettings,
  DiffTheme,
  DiffView,
} from "./types.ts";

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const RESET = "\x1b[0m";
export const MAX_PREVIEW_LINES = 60;
export const MAX_RENDER_LINES = 150;
export const MAX_HL_CHARS = 32_000;
const CACHE_LIMIT = 48;
export const DIFF_RENDER_CONCURRENCY = 2;
export const WORD_DIFF_MIN_SIM = 0.15;
const SPLIT_MIN_WIDTH = 150;
const SPLIT_MIN_CODE_WIDTH = 60;
const SPLIT_MAX_WRAP_RATIO = 0.2;
const SPLIT_MAX_WRAP_LINES = 8;
const MAX_TERM_WIDTH = 210;
const DEFAULT_TERM_WIDTH = 200;
const MAX_WRAP_ROWS_WIDE = 3;
const MAX_WRAP_ROWS_MED = 2;
const MAX_WRAP_ROWS_NARROW = 1;

export interface DiffRenderState {
  readonly toolExpanded: boolean;
  readonly localDetailEnabled: boolean;
  readonly progressiveLocalDetail: true;
  readonly view: DiffView;
}

const EXT_LANG: Readonly<Record<string, BundledLanguage>> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  go: "go",
  java: "java",
  c: "c",
  cpp: "cpp",
  h: "c",
  hpp: "cpp",
  cs: "csharp",
  swift: "swift",
  kt: "kotlin",
  html: "html",
  css: "css",
  scss: "scss",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  md: "markdown",
  sql: "sql",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  lua: "lua",
  php: "php",
  dart: "dart",
  xml: "xml",
  graphql: "graphql",
  svelte: "svelte",
  vue: "vue",
};

function shouldUseSplit(
  diff: ParsedDiff,
  renderWidth: number,
  maxRows = MAX_PREVIEW_LINES,
): boolean {
  if (!diff.lines.length || renderWidth < SPLIT_MIN_WIDTH) return false;
  const half = Math.floor((renderWidth - 1) / 2);
  const codeWidth = Math.max(
    12,
    half - (Math.max(2, String(maxLineNumber(diff.lines)).length) + 5),
  );
  if (codeWidth < SPLIT_MIN_CODE_WIDTH) return false;
  let contentLines = 0;
  let wrapCandidates = 0;
  for (const line of diff.lines.slice(0, maxRows)) {
    if (line.type === "sep") continue;
    contentLines++;
    if (expandTabs(line.content).length > codeWidth) wrapCandidates++;
  }
  if (contentLines === 0) return true;
  return (
    wrapCandidates < SPLIT_MAX_WRAP_LINES &&
    wrapCandidates / contentLines < SPLIT_MAX_WRAP_RATIO
  );
}
function splitDiffRowCount(diff: ParsedDiff): number {
  let rows = 0;
  let index = 0;
  while (index < diff.lines.length) {
    if (diff.lines[index].type === "sep" || diff.lines[index].type === "ctx") {
      rows++;
      index++;
      continue;
    }
    let deleted = 0;
    let added = 0;
    while (index < diff.lines.length && diff.lines[index].type === "del") {
      deleted++;
      index++;
    }
    while (index < diff.lines.length && diff.lines[index].type === "add") {
      added++;
      index++;
    }
    rows += Math.max(deleted, added);
  }
  return rows;
}
function diffFitsRenderLimit(
  diff: ParsedDiff,
  renderWidth: number,
  maxRows: number,
): boolean {
  return shouldUseSplit(diff, renderWidth, maxRows)
    ? splitDiffRowCount(diff) <= maxRows
    : diff.lines.length <= maxRows;
}
function maxLineNumber(lines: readonly DiffLine[]): number {
  let max = 0;
  for (const line of lines)
    max = Math.max(max, line.oldNum ?? line.newNum ?? 0);
  return max;
}
function lang(filePath: string): BundledLanguage | undefined {
  return EXT_LANG[extname(filePath).slice(1).toLowerCase()];
}
function width(view: DiffView): number {
  const raw = Number.isFinite(view.width)
    ? Math.floor(view.width)
    : terminalWidth();
  return Math.max(20, Math.min(raw, MAX_TERM_WIDTH));
}
function terminalWidth(): number {
  const raw =
    process.stdout.columns ||
    process.stderr.columns ||
    Number.parseInt(process.env.COLUMNS ?? "", 10) ||
    DEFAULT_TERM_WIDTH;
  return Math.max(40, Math.min(raw - 4, MAX_TERM_WIDTH));
}
function progressiveBudget(
  normal: number,
  view: DiffView,
  settings: DiffPresentationSettings,
): number {
  if (view.localDetail === 0) return normal;
  const configured =
    view.localDetail >= 2
      ? positiveInteger(settings.extraExpandedPreviewMaxLines, 12_000)
      : positiveInteger(settings.expandedPreviewMaxLines, 4_000);
  return Math.max(normal, configured);
}
function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}
function renderState(view: DiffView): DiffRenderState {
  return {
    toolExpanded: view.expanded,
    localDetailEnabled: view.localDetail < 2,
    progressiveLocalDetail: true,
    view,
  };
}
function adaptiveWrapRows(renderWidth: number): number {
  return renderWidth >= 180
    ? MAX_WRAP_ROWS_WIDE
    : renderWidth >= 120
      ? MAX_WRAP_ROWS_MED
      : MAX_WRAP_ROWS_NARROW;
}

function summarizeDiff(
  added: number,
  removed: number,
  palette: DiffPalette,
): string {
  const parts: string[] = [];
  if (added > 0) parts.push(`${palette.addFg}+${added}${palette.rst}`);
  if (removed > 0) parts.push(`${palette.delFg}-${removed}${palette.rst}`);
  if (parts.length === 0) return `${palette.dimFg}no changes${palette.rst}`;
  const bar = renderDiffStatBar(added, removed, palette);
  return bar ? `${parts.join(" ")} ${bar}` : parts.join(" ");
}
function renderDiffStatBar(
  added: number,
  removed: number,
  palette: DiffPalette,
): string {
  const total = added + removed;
  const summaryWidth = terminalWidth();
  if (total === 0 || summaryWidth < 20) return "";
  const slots = Math.max(8, Math.min(20, Math.floor(summaryWidth / 14)));
  let addSlots = Math.max(
    0,
    Math.min(slots, Math.round((added / total) * slots)),
  );
  if (added > 0 && addSlots === 0) addSlots = 1;
  if (removed > 0 && addSlots >= slots) addSlots = slots - 1;
  const removeSlots = Math.max(0, slots - addSlots);
  return `${palette.dimFg}[${palette.rst}${addSlots > 0 ? `${palette.addFg}${"━".repeat(addSlots)}${palette.rst}` : ""}${removeSlots > 0 ? `${palette.delFg}${"━".repeat(removeSlots)}${palette.rst}` : ""}${palette.dimFg}]${palette.rst}`;
}
function diffSummaryWithMeta(
  added: number,
  removed: number,
  hunks: number,
  mode: string,
  palette: DiffPalette,
): string {
  const base = summarizeDiff(added, removed, palette);
  const extras: string[] = [];
  if (hunks > 0)
    extras.push(
      `${palette.dimFg}${hunks} hunk${hunks === 1 ? "" : "s"}${palette.rst}`,
    );
  if (mode) extras.push(`${palette.dimFg}${mode}${palette.rst}`);
  return extras.length
    ? `${base} ${palette.dimFg}•${palette.rst} ${extras.join(` ${palette.dimFg}•${palette.rst} `)}`
    : base;
}
function collapsedDiffHint(
  remaining: number,
  hiddenHunks: number,
  state: DiffRenderState,
  chrome: DiffPresentationChrome,
  palette: DiffPalette,
): string {
  const hint = chrome.detailHint(state.view, true);
  const candidates = [
    `… (${remaining} more diff lines${hiddenHunks > 0 ? ` • ${hiddenHunks} more hunks` : ""}${hint}${palette.baseBg}${palette.dimFg})`,
    `… (${remaining} more lines${hiddenHunks > 0 ? ` • ${hiddenHunks} hunks` : ""})`,
    `… (+${remaining}${hiddenHunks > 0 ? ` • +${hiddenHunks}h` : ""})`,
    "…",
  ];
  const availableWidth = terminalWidth();
  for (const candidate of candidates)
    if (visibleWidth(candidate) <= availableWidth) return candidate;
  return truncateToWidth("…", availableWidth, "");
}
function formatLineMeta(line: number, theme: DiffTheme): string {
  return line > 0 ? ` ${theme.fg("muted", `at line ${line}`)}` : "";
}

function lineNumber(
  value: number | null,
  cellWidth: number,
  foreground: string,
): string {
  if (value === null) return " ".repeat(cellWidth);
  const text = String(value);
  return `${foreground}${" ".repeat(Math.max(0, cellWidth - text.length))}${text}`;
}
function diffRule(ruleWidth: number, palette: DiffPalette): string {
  return `${palette.baseBg}${palette.ruleFg}${"─".repeat(ruleWidth)}${palette.rst}`;
}
function fit(value: string, cellWidth: number, palette: DiffPalette): string {
  if (cellWidth <= 0) return "";
  const plain = value.replace(ANSI_RE, "");
  if (plain.length <= cellWidth)
    return value + " ".repeat(cellWidth - plain.length);
  const showWidth = cellWidth > 2 ? cellWidth - 1 : cellWidth;
  let visible = 0;
  let index = 0;
  while (index < value.length && visible < showWidth) {
    if (value[index] === "\x1b") {
      const end = value.indexOf("m", index);
      if (end !== -1) {
        index = end + 1;
        continue;
      }
    }
    visible++;
    index++;
  }
  return cellWidth > 2
    ? `${value.slice(0, index)}${palette.rst}${palette.dimFg}›${palette.rst}`
    : `${value.slice(0, index)}${palette.rst}`;
}
function expandTabs(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const segments = line.split("\t");
      let expanded = segments[0];
      for (const segment of segments.slice(1))
        expanded += `${" ".repeat(4 - (visibleWidth(expanded) % 4))}${segment}`;
      return expanded;
    })
    .join("\n");
}
function ansiState(text: string): string {
  let foreground = "";
  let background = "";
  for (const sequence of text.match(ANSI_RE) ?? []) {
    const params = sequence.slice(2, -1);
    if (params === "0") {
      foreground = "";
      background = "";
    } else if (params === "39") foreground = "";
    else if (params.startsWith("38;")) foreground = sequence;
    else if (params.startsWith("48;")) background = sequence;
  }
  return background + foreground;
}
function wrapAnsi(
  text: string,
  cellWidth: number,
  maxRows: number,
  fillBg: string,
  palette: DiffPalette,
): string[] {
  if (cellWidth <= 0) return [""];
  const plain = text.replace(ANSI_RE, "");
  if (plain.length <= cellWidth)
    return [
      text +
        fillBg +
        " ".repeat(cellWidth - plain.length) +
        (fillBg ? palette.rst : ""),
    ];
  const rows: string[] = [];
  let row = "";
  let visible = 0;
  let index = 0;
  let lastRow = false;
  let effectiveWidth = cellWidth;
  while (index < text.length) {
    if (!lastRow && rows.length >= maxRows - 1) {
      lastRow = true;
      effectiveWidth = cellWidth > 2 ? cellWidth - 1 : cellWidth;
    }
    if (text[index] === "\x1b") {
      const end = text.indexOf("m", index);
      if (end !== -1) {
        row += text.slice(index, end + 1);
        index = end + 1;
        continue;
      }
    }
    if (visible >= effectiveWidth) {
      if (lastRow) {
        const hasMore = text.slice(index).replace(ANSI_RE, "").length > 0;
        row +=
          hasMore && cellWidth > 2
            ? `${palette.rst}${palette.dimFg}›${palette.rst}`
            : fillBg +
              " ".repeat(Math.max(0, cellWidth - visible)) +
              palette.rst;
        rows.push(row);
        return rows;
      }
      rows.push(row + palette.rst);
      row = ansiState(row) + fillBg;
      visible = 0;
    }
    row += text[index++];
    visible++;
  }
  rows.push(
    row + fillBg + " ".repeat(Math.max(0, cellWidth - visible)) + palette.rst,
  );
  return rows;
}
function wordDiffAnalysis(
  oldText: string,
  newText: string,
): {
  similarity: number;
  oldRanges: Array<[number, number]>;
  newRanges: Array<[number, number]>;
} {
  const oldRanges: Array<[number, number]> = [];
  const newRanges: Array<[number, number]> = [];
  let oldPosition = 0;
  let newPosition = 0;
  let same = 0;
  for (const part of Diff.diffWords(oldText, newText)) {
    if (part.removed) {
      oldRanges.push([oldPosition, oldPosition + part.value.length]);
      oldPosition += part.value.length;
    } else if (part.added) {
      newRanges.push([newPosition, newPosition + part.value.length]);
      newPosition += part.value.length;
    } else {
      same += part.value.length;
      oldPosition += part.value.length;
      newPosition += part.value.length;
    }
  }
  const max = Math.max(oldText.length, newText.length);
  return { similarity: max > 0 ? same / max : 1, oldRanges, newRanges };
}
function injectBg(
  ansi: string,
  ranges: readonly [number, number][],
  baseBg: string,
  highlightBg: string,
  palette: DiffPalette,
): string {
  if (ranges.length === 0) return baseBg + ansi + palette.rst;
  let output = baseBg;
  let visible = 0;
  let highlighted = false;
  let rangeIndex = 0;
  for (let index = 0; index < ansi.length;) {
    if (ansi[index] === "\x1b") {
      const end = ansi.indexOf("m", index);
      if (end !== -1) {
        const sequence = ansi.slice(index, end + 1);
        output +=
          sequence +
          (sequence === RESET ? (highlighted ? highlightBg : baseBg) : "");
        index = end + 1;
        continue;
      }
    }
    while (rangeIndex < ranges.length && visible >= ranges[rangeIndex][1])
      rangeIndex++;
    const wanted =
      rangeIndex < ranges.length &&
      visible >= ranges[rangeIndex][0] &&
      visible < ranges[rangeIndex][1];
    if (wanted !== highlighted) {
      highlighted = wanted;
      output += highlighted ? highlightBg : baseBg;
    }
    output += ansi[index++];
    visible++;
  }
  return output + palette.rst;
}
function plainWordDiff(
  oldText: string,
  newText: string,
  palette: DiffPalette,
): { old: string; new: string } {
  let oldOutput = "";
  let newOutput = "";
  for (const part of Diff.diffWords(oldText, newText)) {
    if (part.removed)
      oldOutput += `${palette.delWordBg}${part.value}${palette.rst}${palette.delBg}`;
    else if (part.added)
      newOutput += `${palette.addWordBg}${part.value}${palette.rst}${palette.addBg}`;
    else {
      oldOutput += part.value;
      newOutput += part.value;
    }
  }
  return { old: oldOutput, new: newOutput };
}
function normalizeShikiContrast(ansi: string, palette: DiffPalette): string {
  const threshold = palette.light ? 140 : 72;
  return ansi.replace(/\x1b\[([0-9;]*)m/g, (sequence, params: string) => {
    if (["30", "90", "38;5;0", "38;5;8"].includes(params))
      return palette.safeMutedFg;
    if (!params.startsWith("38;2;")) return sequence;
    const values = params.split(";").map(Number);
    if (values.length !== 5 || values.some((value) => !Number.isFinite(value)))
      return sequence;
    const luminance =
      0.2126 * values[2] + 0.7152 * values[3] + 0.0722 * values[4];
    return palette.light
      ? luminance < threshold
        ? sequence
        : palette.safeMutedFg
      : luminance < threshold
        ? palette.safeMutedFg
        : sequence;
  });
}
function touchCache(
  cache: Map<string, string[]>,
  key: string,
  value: string[],
): string[] {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > CACHE_LIMIT) {
    const first = cache.keys().next().value;
    if (first === undefined) break;
    cache.delete(first);
  }
  return value;
}
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from(
      { length: Math.max(1, Math.min(items.length || 1, Math.floor(limit))) },
      async () => {
        while (true) {
          const index = next++;
          if (index >= items.length) return;
          results[index] = await mapper(items[index], index);
        }
      },
    ),
  );
  return results;
}

function hashText(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
function shortPath(cwd: string, path: string): string {
  if (!path) return "";
  const rel = relative(cwd, path);
  if (!rel.startsWith("..") && !rel.startsWith("/")) return rel || ".";
  const home = process.env.HOME ?? "";
  return home ? path.replace(home, "~") : path;
}
function sum<T>(items: readonly T[], value: (item: T) => number): number {
  return items.reduce((total, item) => total + value(item), 0);
}

const plainChrome: DiffPresentationChrome = {
  markResultSummary: (text) => text,
  branch: (content) => content,
  tree(summary, blocks, terminalAction) {
    return [
      summary,
      ...blocks.flatMap((block) => [block.heading ?? "", block.content]),
      terminalAction ?? "",
    ]
      .filter(Boolean)
      .join("\n");
  },
  detailHint: () => "",
  collapseHint: () => "",
};

export const diffRendering = Object.freeze({
  shouldUseSplit,
  diffFitsRenderLimit,
  maxLineNumber,
  lang,
  width,
  progressiveBudget,
  positiveInteger,
  renderState,
  adaptiveWrapRows,
  summarizeDiff,
  diffSummaryWithMeta,
  collapsedDiffHint,
  formatLineMeta,
  lineNumber,
  diffRule,
  fit,
  expandTabs,
  wrapAnsi,
  wordDiffAnalysis,
  injectBg,
  plainWordDiff,
  normalizeShikiContrast,
  touchCache,
  mapWithConcurrency,
  hashText,
  shortPath,
  sum,
  plainChrome,
});
