import * as Diff from "diff";
import type { BundledLanguage } from "shiki";

import type { DiffSource, EditOperation } from "./types.ts";

export interface PreparedPresentation {
  readonly key: string;
  readonly initial: PresentationFrame;
  readonly render?: () => Promise<PresentationFrame>;
}

export interface PresentationFrame {
  readonly headerSummary?: string;
  readonly body: string;
  readonly affectedPaths: readonly string[];
  readonly suppressCompanionResult: boolean;
}

export interface DiffLine {
  readonly type: "add" | "del" | "ctx" | "sep";
  readonly oldNum: number | null;
  readonly newNum: number | null;
  readonly content: string;
}

export interface ParsedDiff {
  readonly lines: readonly DiffLine[];
  readonly added: number;
  readonly removed: number;
  readonly chars: number;
}

export interface LocalizedEditDiff {
  readonly diff: ParsedDiff;
  readonly line: number;
}

export interface ApplyPatchChangePreview {
  readonly kind: "add" | "update" | "delete";
  readonly path: string;
  readonly displayPath: string;
  readonly moveTo?: string;
  readonly diff: ParsedDiff;
  readonly language: BundledLanguage | undefined;
  readonly hunks: number;
  readonly summary: string;
  readonly line: number;
}

export interface ApplyPatchPreview {
  readonly changes: readonly ApplyPatchChangePreview[];
  readonly totalAdded: number;
  readonly totalRemoved: number;
  readonly totalHunks: number;
  readonly totalLines: number;
  readonly summary: string;
}

export interface EditResultEvidence {
  readonly editCount: number;
  readonly line: number;
  readonly added: number;
  readonly removed: number;
  readonly hunks: number;
  readonly diffLines: number;
}

export interface ApplyPatchFileEvidence {
  readonly path: string;
  readonly content: string | null;
}

export interface EvidencePayload {
  readonly source: DiffSource;
  readonly editResult?: EditResultEvidence;
  readonly applyPatchFiles?: readonly ApplyPatchFileEvidence[];
}

export interface RestoredEvidence {
  readonly source: DiffSource;
  readonly editResult?: EditResultEvidence;
  readonly applyPatchFiles?: readonly ApplyPatchFileEvidence[];
}

function frame(
  body: string,
  affectedPaths: readonly string[],
  suppressCompanionResult = false,
  headerSummary?: string,
): PresentationFrame {
  return { body, affectedPaths, suppressCompanionResult, headerSummary };
}

function surfaceAcceptsSource(
  surface: string,
  kind: DiffSource["kind"],
): boolean {
  return (
    (surface === "write-result" && kind === "write") ||
    ((surface === "edit-call" || surface === "edit-result") &&
      kind === "edit") ||
    ((surface === "apply-call" || surface === "apply-result") &&
      kind === "apply-patch")
  );
}

function cloneSource(source: DiffSource): DiffSource {
  if (source.kind === "write")
    return {
      kind: "write",
      path: source.path,
      before: source.before,
      after: source.after,
    };
  if (source.kind === "edit")
    return {
      kind: "edit",
      path: source.path,
      cwd: source.cwd,
      edits: source.edits.map((edit) => ({
        oldText: edit.oldText,
        newText: edit.newText,
      })),
    };
  return { kind: "apply-patch", patchText: source.patchText, cwd: source.cwd };
}

function isDiffSource(value: unknown): value is DiffSource {
  if (!value || typeof value !== "object") return false;
  const source = value as Record<string, unknown>;
  if (source.kind === "write")
    return (
      typeof source.path === "string" &&
      (source.before === null || typeof source.before === "string") &&
      typeof source.after === "string"
    );
  if (source.kind === "edit")
    return (
      typeof source.path === "string" &&
      typeof source.cwd === "string" &&
      Array.isArray(source.edits) &&
      source.edits.every(
        (edit) =>
          Boolean(edit) &&
          typeof edit === "object" &&
          typeof (edit as EditOperation).oldText === "string" &&
          typeof (edit as EditOperation).newText === "string",
      )
    );
  return (
    source.kind === "apply-patch" &&
    typeof source.patchText === "string" &&
    typeof source.cwd === "string"
  );
}

function isEditResultEvidence(value: unknown): value is EditResultEvidence {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return ["editCount", "line", "added", "removed", "hunks", "diffLines"].every(
    (key) =>
      typeof result[key] === "number" &&
      Number.isFinite(result[key]) &&
      (result[key] as number) >= 0,
  );
}

function isApplyPatchFileEvidenceArray(
  value: unknown,
): value is readonly ApplyPatchFileEvidence[] {
  return (
    Array.isArray(value) &&
    value.every((file) => {
      if (!file || typeof file !== "object") return false;
      const candidate = file as Record<string, unknown>;
      return (
        typeof candidate.path === "string" &&
        (candidate.content === null || typeof candidate.content === "string")
      );
    })
  );
}

function coversApplyPatchUpdateFiles(
  patchText: string,
  files: readonly ApplyPatchFileEvidence[],
): boolean {
  const expected = extractApplyPatchUpdateFiles(patchText);
  const actual = new Set(files.map((file) => file.path));
  return (
    actual.size === files.length &&
    expected.length === actual.size &&
    expected.every((path) => actual.has(path))
  );
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value))
    return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>))
    deepFreeze(child);
  return value;
}

function validEditOperations(edits: readonly EditOperation[]): EditOperation[] {
  return edits
    .filter((edit) => edit.oldText.length > 0 && edit.oldText !== edit.newText)
    .map((edit) => ({ oldText: edit.oldText, newText: edit.newText }));
}

function parseDiff(
  oldContent: string,
  newContent: string,
  contextLines = 3,
): ParsedDiff {
  const patch = Diff.structuredPatch("", "", oldContent, newContent, "", "", {
    context: contextLines,
  });
  const lines: DiffLine[] = [];
  let added = 0;
  let removed = 0;
  for (let hunkIndex = 0; hunkIndex < patch.hunks.length; hunkIndex++) {
    if (hunkIndex > 0) {
      const previous = patch.hunks[hunkIndex - 1];
      const gap =
        patch.hunks[hunkIndex].oldStart -
        (previous.oldStart + previous.oldLines);
      lines.push({
        type: "sep",
        oldNum: null,
        newNum: gap > 0 ? gap : null,
        content: "",
      });
    }
    const hunk = patch.hunks[hunkIndex];
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;
    for (const raw of hunk.lines) {
      if (raw === "\\ No newline at end of file") continue;
      const content = raw.slice(1);
      if (raw[0] === "+") {
        lines.push({ type: "add", oldNum: null, newNum: newLine++, content });
        added++;
      } else if (raw[0] === "-") {
        lines.push({ type: "del", oldNum: oldLine++, newNum: null, content });
        removed++;
      } else
        lines.push({
          type: "ctx",
          oldNum: oldLine++,
          newNum: newLine++,
          content,
        });
    }
  }
  return {
    lines,
    added,
    removed,
    chars: oldContent.length + newContent.length,
  };
}

function parseApplyPatchUpdateDiff(
  lines: readonly string[],
  sourceContent?: string,
): ParsedDiff {
  const diffLines: DiffLine[] = [];
  let added = 0;
  let removed = 0;
  let chars = 0;
  let oldLine: number | null = null;
  let newLine: number | null = null;
  let inHunk = false;
  const inferred = sourceContent
    ? inferApplyPatchHunkStarts(lines, sourceContent)
    : [];
  let hunkIndex = 0;
  for (const raw of lines) {
    if (raw.startsWith("*** Move to: ")) continue;
    if (raw.startsWith("@@")) {
      if (diffLines.length > 0 && diffLines.at(-1)?.type !== "sep")
        diffLines.push({
          type: "sep",
          oldNum: null,
          newNum: null,
          content: "",
        });
      const match = raw.match(/^@@\s*-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s*@@/);
      const inferredStart = inferred[hunkIndex++] ?? {
        oldStart: null,
        newStart: null,
      };
      oldLine = match ? Number.parseInt(match[1], 10) : inferredStart.oldStart;
      newLine = match ? Number.parseInt(match[2], 10) : inferredStart.newStart;
      inHunk = true;
      continue;
    }
    if (raw === "\\ No newline at end of file") continue;
    if (!inHunk) {
      const inferredStart = inferred[hunkIndex++] ?? {
        oldStart: null,
        newStart: null,
      };
      oldLine = inferredStart.oldStart;
      newLine = inferredStart.newStart;
      inHunk = true;
    }
    const parsed = parsePatchBodyLine(raw);
    chars += parsed.content.length;
    if (parsed.marker === "+") {
      diffLines.push({
        type: "add",
        oldNum: null,
        newNum: newLine,
        content: parsed.content,
      });
      added++;
      if (newLine !== null) newLine++;
    } else if (parsed.marker === "-") {
      diffLines.push({
        type: "del",
        oldNum: oldLine,
        newNum: null,
        content: parsed.content,
      });
      removed++;
      if (oldLine !== null) oldLine++;
    } else {
      diffLines.push({
        type: "ctx",
        oldNum: oldLine,
        newNum: newLine,
        content: parsed.content,
      });
      if (oldLine !== null) oldLine++;
      if (newLine !== null) newLine++;
    }
  }
  while (diffLines[0]?.type === "sep") diffLines.shift();
  while (diffLines.at(-1)?.type === "sep") diffLines.pop();
  return { lines: diffLines, added, removed, chars };
}

function inferApplyPatchHunkStarts(
  lines: readonly string[],
  sourceContent: string,
): Array<{ oldStart: number | null; newStart: number | null }> {
  const sourceLines = normalizeToLf(sourceContent).split("\n");
  const hunks: string[][] = [];
  let current: string[] | undefined;
  for (const raw of lines) {
    if (raw.startsWith("*** Move to: ")) continue;
    if (raw.startsWith("@@")) {
      if (current) hunks.push(current);
      current = [];
      continue;
    }
    (current ??= []).push(raw);
  }
  if (current) hunks.push(current);
  const starts: Array<{ oldStart: number | null; newStart: number | null }> =
    [];
  let searchFrom = 0;
  let lineDelta = 0;
  for (const hunk of hunks) {
    const oldLines = hunk
      .map(parsePatchBodyLine)
      .filter((line) => line.marker !== "+")
      .map((line) => line.content);
    let matchIndex = findLineSequence(sourceLines, oldLines, searchFrom);
    if (matchIndex === -1)
      matchIndex = findLineSequence(sourceLines, oldLines, 0);
    const oldStart = matchIndex === -1 ? null : matchIndex + 1;
    starts.push({
      oldStart,
      newStart: oldStart === null ? null : oldStart + lineDelta,
    });
    if (matchIndex === -1) continue;
    searchFrom = matchIndex + oldLines.length;
    lineDelta +=
      hunk.filter((raw) => parsePatchBodyLine(raw).marker === "+").length -
      hunk.filter((raw) => parsePatchBodyLine(raw).marker === "-").length;
  }
  return starts;
}

function parsePatchBodyLine(raw: string): {
  marker: "+" | "-" | " ";
  content: string;
} {
  const marker = raw[0];
  return marker === "+" || marker === "-" || marker === " "
    ? { marker, content: raw.slice(1) }
    : { marker: " ", content: raw };
}

function findLineSequence(
  haystack: readonly string[],
  needle: readonly string[],
  fromIndex = 0,
): number {
  if (needle.length === 0) return Math.max(0, fromIndex);
  outer: for (
    let i = Math.max(0, fromIndex);
    i <= haystack.length - needle.length;
    i++
  ) {
    for (let j = 0; j < needle.length; j++)
      if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

function stripPatchLinePrefix(line: string, prefix: "+" | "-"): string {
  return line.startsWith(prefix) ? line.slice(1) : line;
}
function extractApplyPatchFiles(patchText: string): string[] {
  const files = new Set<string>();
  for (const match of patchText.matchAll(
    /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm,
  ))
    if (match[1]?.trim()) files.add(match[1].trim());
  return [...files];
}
function extractApplyPatchUpdateFiles(patchText: string): string[] {
  const files = new Set<string>();
  for (const match of patchText.matchAll(/^\*\*\* Update File: (.+)$/gm))
    if (match[1]?.trim()) files.add(match[1].trim());
  return [...files];
}
function getApplyPatchLine(
  diff: ParsedDiff,
  kind: ApplyPatchChangePreview["kind"],
): number {
  if (kind === "add")
    return (
      diff.lines.find((line) => line.type === "add" && line.newNum !== null)
        ?.newNum ?? 1
    );
  if (kind === "delete")
    return (
      diff.lines.find((line) => line.type === "del" && line.oldNum !== null)
        ?.oldNum ?? 1
    );
  for (const line of diff.lines) {
    if (line.type === "add" && line.newNum !== null) return line.newNum;
    if (line.type === "del" && line.oldNum !== null) return line.oldNum;
  }
  return 0;
}
function describeApplyPatchChange(change: ApplyPatchChangePreview): string {
  if (change.moveTo) return `Rename ${change.displayPath}`;
  if (change.kind === "add") return `Create ${change.displayPath}`;
  if (change.kind === "delete") return `Delete ${change.displayPath}`;
  return `Update ${change.displayPath}`;
}

function countDiffHunks(diff: ParsedDiff): number {
  return diff.lines.length === 0
    ? 0
    : diff.lines.filter((line) => line.type === "sep").length + 1;
}
function getFirstChangedNewLine(diff: ParsedDiff): number {
  let current = 0;
  for (let index = 0; index < diff.lines.length; index++) {
    const line = diff.lines[index];
    if (line.type === "sep") {
      current = 0;
      continue;
    }
    if (line.type === "ctx") {
      current = (line.newNum ?? current) + 1;
      continue;
    }
    if (line.type === "add") return line.newNum ?? current;
    if (current > 0) return current;
    const next = diff.lines
      .slice(index + 1)
      .find((entry) => entry.type !== "sep" && entry.newNum !== null);
    return next?.newNum ?? line.oldNum ?? 0;
  }
  return 0;
}
function offsetParsedDiff(
  diff: ParsedDiff,
  oldOffset: number,
  newOffset = oldOffset,
): ParsedDiff {
  return {
    ...diff,
    lines: diff.lines.map((line) =>
      line.type === "sep"
        ? line
        : {
            ...line,
            oldNum: line.oldNum === null ? null : line.oldNum + oldOffset,
            newNum: line.newNum === null ? null : line.newNum + newOffset,
          },
    ),
  };
}
function normalizeToLf(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}
function stripBomText(text: string): string {
  return text.startsWith("\uFEFF") ? text.slice(1) : text;
}
function normalizeTextForFuzzyMatch(text: string): string {
  return text
    .normalize("NFKC")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ");
}
function findEditMatch(
  content: string,
  oldText: string,
): {
  found: boolean;
  index: number;
  matchLength: number;
  usedFuzzyMatch: boolean;
} {
  const exact = content.indexOf(oldText);
  if (exact !== -1)
    return {
      found: true,
      index: exact,
      matchLength: oldText.length,
      usedFuzzyMatch: false,
    };
  const normalizedContent = normalizeTextForFuzzyMatch(content);
  const normalizedOld = normalizeTextForFuzzyMatch(oldText);
  const index = normalizedContent.indexOf(normalizedOld);
  return index === -1
    ? { found: false, index: -1, matchLength: 0, usedFuzzyMatch: false }
    : {
        found: true,
        index,
        matchLength: normalizedOld.length,
        usedFuzzyMatch: true,
      };
}
function countFuzzyOccurrences(content: string, oldText: string): number {
  return (
    normalizeTextForFuzzyMatch(content).split(
      normalizeTextForFuzzyMatch(oldText),
    ).length - 1
  );
}
function lineNumberAtIndex(text: string, index: number): number {
  return text.slice(0, Math.max(0, index)).split("\n").length;
}
function countLineBreaks(text: string): number {
  return (text.match(/\n/g) ?? []).length;
}

export const diffModel = Object.freeze({
  frame,
  surfaceAcceptsSource,
  cloneSource,
  isDiffSource,
  isEditResultEvidence,
  isApplyPatchFileEvidenceArray,
  coversApplyPatchUpdateFiles,
  deepFreeze,
  validEditOperations,
  parseDiff,
  parseApplyPatchUpdateDiff,
  stripPatchLinePrefix,
  extractApplyPatchFiles,
  extractApplyPatchUpdateFiles,
  getApplyPatchLine,
  describeApplyPatchChange,
  countDiffHunks,
  getFirstChangedNewLine,
  offsetParsedDiff,
  normalizeToLf,
  stripBomText,
  normalizeTextForFuzzyMatch,
  findEditMatch,
  countFuzzyOccurrences,
  lineNumberAtIndex,
  countLineBreaks,
});
