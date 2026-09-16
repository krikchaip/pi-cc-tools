import { readFileSync as nodeReadFileSync } from "node:fs";
import { readFile as nodeReadFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { BundledLanguage, BundledTheme } from "shiki";

import { diffModel } from "./model.ts";
import type {
  ApplyPatchChangePreview,
  ApplyPatchFileEvidence,
  ApplyPatchPreview,
  DiffLine,
  EditResultEvidence,
  EvidencePayload,
  LocalizedEditDiff,
  ParsedDiff,
  PreparedPresentation,
  RestoredEvidence,
} from "./model.ts";
import {
  DiffPalette,
  configuredSharedForegrounds,
  themeFingerprint,
} from "./palette.ts";
import {
  DIFF_RENDER_CONCURRENCY,
  MAX_HL_CHARS,
  MAX_PREVIEW_LINES,
  MAX_RENDER_LINES,
  WORD_DIFF_MIN_SIM,
  diffRendering,
} from "./rendering.ts";
import type { DiffRenderState } from "./rendering.ts";
import type {
  DiffEvidence,
  DiffPresentationChrome,
  DiffPresentationDependencies,
  DiffPresentationRequest,
  DiffPresentationSettings,
  DiffSharedForegrounds,
  DiffSource,
  DiffView,
  EditOperation,
} from "./types.ts";

export type { PreparedPresentation, PresentationFrame } from "./model.ts";

const D_BOLD = "\x1b[1m";
const D_DIM = "\x1b[2m";

export class DiffPresentationEngine {
  private readonly highlights = new Map<string, string[]>();
  private codeToAnsiLoader: Promise<
    (
      code: string,
      language: BundledLanguage,
      theme: BundledTheme,
    ) => Promise<string>
  > | null = null;
  private readonly palette: DiffPalette;
  private readonly chrome: DiffPresentationChrome;
  private readonly displayPath: (cwd: string, path: string) => string;
  private readonly moveArrow: (view: DiffView) => string;
  private readonly readFile: (path: string) => Promise<string>;
  private readonly readFileSync: (path: string) => string;
  private readonly dependencies: DiffPresentationDependencies;

  constructor(dependencies: DiffPresentationDependencies) {
    this.dependencies = dependencies;
    this.chrome = dependencies.chrome ?? diffRendering.plainChrome;
    this.displayPath = dependencies.displayPath ?? diffRendering.shortPath;
    this.moveArrow = dependencies.moveArrow ?? (() => "→");
    this.readFile =
      dependencies.readFile ?? ((path) => nodeReadFile(path, "utf8"));
    this.readFileSync =
      dependencies.readFileSync ?? ((path) => nodeReadFileSync(path, "utf8"));
    this.palette = new DiffPalette(
      () => this.highlights.clear(),
      dependencies.isLightTheme,
      dependencies.resolveRuleAnsi,
    );
  }

  configuredForegrounds(): DiffSharedForegrounds {
    return configuredSharedForegrounds(this.dependencies.readSettings());
  }

  async capture(source: DiffSource): Promise<DiffEvidence | undefined> {
    if (!diffModel.isDiffSource(source)) return undefined;
    const cloned = diffModel.cloneSource(source);
    let editResult: EditResultEvidence | undefined;
    if (cloned.kind === "edit") {
      const operations = diffModel.validEditOperations(cloned.edits);
      if (operations.length > 0) {
        const localized =
          operations.length === 1
            ? await this.computeLocalizedEditDiffs(
                cloned.path,
                operations,
                cloned.cwd,
              )
            : null;
        const diffs =
          localized?.map((entry) => entry.diff) ??
          operations.map((edit) =>
            diffModel.parseDiff(edit.oldText, edit.newText),
          );
        editResult = {
          editCount: operations.length,
          line:
            localized?.[0]?.line ?? diffModel.getFirstChangedNewLine(diffs[0]),
          added: diffRendering.sum(diffs, (diff) => diff.added),
          removed: diffRendering.sum(diffs, (diff) => diff.removed),
          hunks: diffRendering.sum(diffs, diffModel.countDiffHunks),
          diffLines: diffRendering.sum(diffs, (diff) => diff.lines.length),
        };
      }
    }
    const applyPatchFiles =
      cloned.kind === "apply-patch"
        ? await Promise.all(
            diffModel
              .extractApplyPatchUpdateFiles(cloned.patchText)
              .map(async (path): Promise<ApplyPatchFileEvidence> => {
                try {
                  return {
                    path,
                    content: await this.readFile(resolve(cloned.cwd, path)),
                  };
                } catch {
                  return { path, content: null };
                }
              }),
          )
        : undefined;
    const payload: EvidencePayload =
      applyPatchFiles === undefined
        ? { source: cloned, editResult }
        : { source: cloned, editResult, applyPatchFiles };
    return diffModel.deepFreeze({ version: 1, payload }) as DiffEvidence;
  }

  restore(value: unknown): RestoredEvidence | undefined {
    if (!value || typeof value !== "object") return undefined;
    const envelope = value as {
      version?: unknown;
      payload?: unknown;
      source?: unknown;
    };
    if (envelope.version !== 1) return undefined;
    // Accept the green-tracer envelope during the host migration.
    const payload: {
      source?: unknown;
      editResult?: unknown;
      applyPatchFiles?: unknown;
    } =
      envelope.payload && typeof envelope.payload === "object"
        ? (envelope.payload as {
            source?: unknown;
            editResult?: unknown;
            applyPatchFiles?: unknown;
          })
        : envelope;
    if (!diffModel.isDiffSource(payload.source)) return undefined;
    const hasApplyPatchFiles = Object.prototype.hasOwnProperty.call(
      payload,
      "applyPatchFiles",
    );
    if (
      hasApplyPatchFiles &&
      !diffModel.isApplyPatchFileEvidenceArray(payload.applyPatchFiles)
    )
      return undefined;
    if (
      hasApplyPatchFiles &&
      payload.source.kind === "apply-patch" &&
      !diffModel.coversApplyPatchUpdateFiles(
        payload.source.patchText,
        payload.applyPatchFiles as readonly ApplyPatchFileEvidence[],
      )
    )
      return undefined;
    return {
      source: diffModel.cloneSource(payload.source),
      editResult: diffModel.isEditResultEvidence(payload.editResult)
        ? { ...payload.editResult }
        : undefined,
      applyPatchFiles: hasApplyPatchFiles
        ? (payload.applyPatchFiles as readonly ApplyPatchFileEvidence[]).map(
            (file) => ({ ...file }),
          )
        : undefined,
    };
  }

  prepare(
    request: DiffPresentationRequest,
    companionReady: boolean,
  ): PreparedPresentation | undefined {
    const restored = this.restore(request.evidence);
    const source =
      restored?.source ??
      (diffModel.isDiffSource(request.source)
        ? diffModel.cloneSource(request.source)
        : undefined);
    if (
      !source ||
      !diffModel.surfaceAcceptsSource(request.surface, source.kind)
    )
      return undefined;
    const settings = this.dependencies.readSettings();
    this.palette.apply(request.view.theme, settings);
    const key = JSON.stringify([
      request.surface,
      diffRendering.hashText(JSON.stringify(source)),
      restored?.editResult,
      restored?.applyPatchFiles,
      request.sourceComplete !== false,
      request.view.width,
      request.view.expanded,
      request.view.localDetail,
      request.view.localClickControls,
      settings,
      companionReady,
      themeFingerprint(request.view.theme),
      this.palette.theme,
    ]);

    if (request.surface === "write-result" && source.kind === "write")
      return this.prepareWrite(key, source, request.view, settings);
    if (request.surface === "edit-call" && source.kind === "edit")
      return this.prepareEditCall(key, source, request.view, settings);
    if (request.surface === "edit-result" && source.kind === "edit")
      return this.prepareEditResult(
        key,
        source,
        restored?.editResult,
        request.view,
        companionReady,
      );
    if (request.surface === "apply-call" && source.kind === "apply-patch")
      return this.prepareApplyCall(
        key,
        source,
        restored?.applyPatchFiles,
        request.view,
        request.sourceComplete !== false,
        settings,
      );
    if (request.surface === "apply-result" && source.kind === "apply-patch")
      return this.prepareApplyResult(
        key,
        source,
        restored?.applyPatchFiles,
        request.view,
        companionReady,
      );
    return undefined;
  }

  reset(): void {
    this.highlights.clear();
    this.codeToAnsiLoader = null;
    this.palette.reset();
  }

  private prepareWrite(
    key: string,
    source: Extract<DiffSource, { kind: "write" }>,
    view: DiffView,
    settings: DiffPresentationSettings,
  ): PreparedPresentation {
    const affectedPaths = [source.path];
    if (source.before === source.after) {
      const body = this.chrome.branch(
        this.chrome.markResultSummary(view.theme.fg("muted", "✓ no changes")),
        view,
        { final: false },
      );
      return { key, initial: diffModel.frame(body, affectedPaths) };
    }
    const diff = diffModel.parseDiff(source.before ?? "", source.after);
    const isNew = source.before === null;
    const collapsedLimit = diffRendering.positiveInteger(
      settings.diffCollapsedLines,
      24,
    );
    const previewLines = view.expanded
      ? diffRendering.progressiveBudget(MAX_RENDER_LINES, view, settings)
      : collapsedLimit;
    const hidden = isNew
      ? diff.lines.length > collapsedLimit
      : !diffRendering.diffFitsRenderLimit(
          diff,
          diffRendering.width(view),
          collapsedLimit,
        );
    const finalCollapse =
      view.localClickControls &&
      hidden &&
      view.expanded &&
      (view.localDetail >= 2 ||
        (isNew
          ? diff.lines.length <= previewLines
          : diffRendering.diffFitsRenderLimit(
              diff,
              diffRendering.width(view),
              previewLines,
            )));
    const hunks = diffModel.countDiffHunks(diff);
    const mode = isNew
      ? "new file"
      : diffRendering.shouldUseSplit(
            diff,
            diffRendering.width(view),
            previewLines,
          )
        ? "split"
        : "unified";
    const summary = diffRendering.diffSummaryWithMeta(
      diff.added,
      diff.removed,
      isNew ? 1 : hunks,
      mode,
      this.palette,
    );
    const richSummary = hidden
      ? this.chrome.markResultSummary(summary)
      : summary;
    const rendering = this.chrome.branch(
      `${richSummary}\n${view.theme.fg("muted", "rendering diff…")}`,
      view,
      { final: true },
    );
    return {
      key,
      initial: diffModel.frame(rendering, affectedPaths),
      render: async () => {
        const body = isNew
          ? await this.renderUnified(
              diff,
              diffRendering.lang(source.path),
              diffRendering.renderState(view),
              previewLines,
              diffRendering.width(view),
            )
          : await this.renderSplit(
              diff,
              diffRendering.lang(source.path),
              diffRendering.renderState(view),
              previewLines,
              diffRendering.width(view),
            );
        const content = finalCollapse
          ? `${body}\n${this.chrome.collapseHint(view)}`
          : body;
        return diffModel.frame(
          this.chrome.branch(`${richSummary}\n${content}`, view, {
            final: true,
          }),
          affectedPaths,
        );
      },
    };
  }

  private prepareEditCall(
    key: string,
    source: Extract<DiffSource, { kind: "edit" }>,
    view: DiffView,
    settings: DiffPresentationSettings,
  ): PreparedPresentation {
    const operations = diffModel.validEditOperations(source.edits);
    const affectedPaths = [this.displayPath(source.cwd, source.path)];
    if (operations.length === 0)
      return { key, initial: diffModel.frame("", affectedPaths) };
    const initial = diffModel.frame(
      this.chrome.branch(view.theme.fg("muted", "(rendering…)"), view, {
        final: false,
        continued: true,
      }),
      affectedPaths,
    );
    return {
      key,
      initial,
      render: async () => {
        const localized = await this.computeLocalizedEditDiffs(
          source.path,
          operations,
          source.cwd,
        );
        const diffs =
          localized?.map((entry) => entry.diff) ??
          operations.map((edit) =>
            diffModel.parseDiff(edit.oldText, edit.newText),
          );
        const lines =
          localized?.map((entry) => entry.line) ??
          diffs.map(diffModel.getFirstChangedNewLine);
        return diffModel.frame(
          await this.renderEditTree(
            source.path,
            operations,
            diffs,
            lines,
            view,
            settings,
          ),
          affectedPaths,
        );
      },
    };
  }

  private prepareEditResult(
    key: string,
    source: Extract<DiffSource, { kind: "edit" }>,
    captured: EditResultEvidence | undefined,
    view: DiffView,
    companionReady: boolean,
  ): PreparedPresentation {
    const operations = diffModel.validEditOperations(source.edits);
    const affectedPaths = [this.displayPath(source.cwd, source.path)];
    if (operations.length === 0) {
      const body = this.chrome.branch(
        this.chrome.markResultSummary(view.theme.fg("success", "Applied")),
        view,
        { final: false },
      );
      return { key, initial: diffModel.frame(body, affectedPaths) };
    }
    const diffs = operations.map((edit) =>
      diffModel.parseDiff(edit.oldText, edit.newText),
    );
    const result = captured ?? {
      editCount: operations.length,
      line: diffModel.getFirstChangedNewLine(diffs[0]),
      added: diffRendering.sum(diffs, (diff) => diff.added),
      removed: diffRendering.sum(diffs, (diff) => diff.removed),
      hunks: diffRendering.sum(diffs, diffModel.countDiffHunks),
      diffLines: diffRendering.sum(diffs, (diff) => diff.lines.length),
    };
    const base =
      operations.length === 1
        ? `${diffRendering.diffSummaryWithMeta(result.added, result.removed, result.hunks, "", this.palette)}${diffRendering.formatLineMeta(result.line, view.theme)}`
        : `${result.editCount} edits ${diffRendering.diffSummaryWithMeta(result.added, result.removed, result.hunks, "", this.palette)}${result.diffLines ? ` ${view.theme.fg("muted", `(${result.diffLines} diff lines)`)}` : ""}`;
    const body = companionReady
      ? ""
      : this.chrome.branch(this.chrome.markResultSummary(base), view, {
          final: false,
        });
    return {
      key,
      initial: diffModel.frame(body, affectedPaths, companionReady),
    };
  }

  private prepareApplyCall(
    key: string,
    source: Extract<DiffSource, { kind: "apply-patch" }>,
    capturedFiles: readonly ApplyPatchFileEvidence[] | undefined,
    view: DiffView,
    sourceComplete: boolean,
    settings: DiffPresentationSettings,
  ): PreparedPresentation {
    const files = diffModel.extractApplyPatchFiles(source.patchText);
    const displayFiles = files.map((path) =>
      this.displayPath(source.cwd, path),
    );
    const headerSummary =
      displayFiles.length === 0
        ? view.theme.fg("muted", "patch")
        : displayFiles.length === 1
          ? displayFiles[0]
          : `${displayFiles[0]} ${view.theme.fg("muted", `(+${displayFiles.length - 1} files)`)}`;
    if (!sourceComplete)
      return {
        key,
        initial: diffModel.frame("", displayFiles, false, headerSummary),
      };
    let preview: ApplyPatchPreview;
    try {
      preview = this.parseApplyPatchPreview(
        source.patchText,
        source.cwd,
        view,
        capturedFiles,
      );
    } catch {
      return {
        key,
        initial: diffModel.frame("", displayFiles, false, headerSummary),
      };
    }
    if (preview.changes.length === 0)
      return {
        key,
        initial: diffModel.frame("", displayFiles, false, headerSummary),
      };
    const initialBody = this.chrome.branch(
      view.theme.fg("muted", "(rendering…)"),
      view,
      { final: false, continued: true },
    );
    return {
      key,
      initial: diffModel.frame(
        initialBody,
        preview.changes.map((change) => change.displayPath),
        false,
        headerSummary,
      ),
      render: async () =>
        diffModel.frame(
          await this.renderApplyTree(preview, view, settings),
          preview.changes.map((change) => change.displayPath),
          false,
          headerSummary,
        ),
    };
  }

  private prepareApplyResult(
    key: string,
    source: Extract<DiffSource, { kind: "apply-patch" }>,
    capturedFiles: readonly ApplyPatchFileEvidence[] | undefined,
    view: DiffView,
    companionReady: boolean,
  ): PreparedPresentation {
    let preview: ApplyPatchPreview;
    try {
      preview = this.parseApplyPatchPreview(
        source.patchText,
        source.cwd,
        view,
        capturedFiles,
      );
    } catch {
      const body = this.chrome.branch(
        this.chrome.markResultSummary(view.theme.fg("success", "Applied")),
        view,
        { final: false },
      );
      return { key, initial: diffModel.frame(body, [], false) };
    }
    const affectedPaths = preview.changes.map((change) => change.displayPath);
    if (companionReady)
      return { key, initial: diffModel.frame("", affectedPaths, true) };
    if (preview.changes.length === 0) {
      const body = this.chrome.branch(
        this.chrome.markResultSummary(view.theme.fg("success", "Applied")),
        view,
        { final: false },
      );
      return { key, initial: diffModel.frame(body, affectedPaths) };
    }
    let text: string;
    if (preview.changes.length === 1) {
      const change = preview.changes[0];
      const mode =
        change.kind === "add"
          ? "new file"
          : change.kind === "delete"
            ? "delete"
            : "";
      const summary = diffRendering.diffSummaryWithMeta(
        change.diff.added,
        change.diff.removed,
        change.hunks,
        mode,
        this.palette,
      );
      text = `${view.theme.fg("success", "Applied")} ${view.theme.fg("muted", change.displayPath)} ${summary}${diffRendering.formatLineMeta(change.line, view.theme)}`;
    } else {
      const summary = diffRendering.diffSummaryWithMeta(
        preview.totalAdded,
        preview.totalRemoved,
        preview.totalHunks,
        "",
        this.palette,
      );
      text = `${view.theme.fg("success", "Applied")} ${preview.changes.length} files ${summary}${preview.totalLines ? ` ${view.theme.fg("muted", `(${preview.totalLines} diff lines)`)}` : ""}`;
    }
    return {
      key,
      initial: diffModel.frame(
        this.chrome.branch(this.chrome.markResultSummary(text), view, {
          final: false,
        }),
        affectedPaths,
      ),
    };
  }

  private async renderEditTree(
    filePath: string,
    operations: readonly EditOperation[],
    diffs: readonly ParsedDiff[],
    lines: readonly number[],
    view: DiffView,
    settings: DiffPresentationSettings,
  ): Promise<string> {
    const branchWidth = diffRendering.width(view);
    const normalBudget =
      operations.length === 1 ? MAX_PREVIEW_LINES : MAX_RENDER_LINES;
    const totalBudget = view.expanded
      ? diffRendering.progressiveBudget(normalBudget, view, settings)
      : normalBudget;
    const totalAdded = diffRendering.sum(diffs, (diff) => diff.added);
    const totalRemoved = diffRendering.sum(diffs, (diff) => diff.removed);
    const totalHunks = diffRendering.sum(diffs, diffModel.countDiffHunks);
    const totalLines = diffRendering.sum(diffs, (diff) => diff.lines.length);
    if (operations.length === 1) {
      const diff = diffs[0];
      const hidden = !diffRendering.diffFitsRenderLimit(diff, branchWidth, 32);
      const summary = `${diffRendering.diffSummaryWithMeta(diff.added, diff.removed, diffModel.countDiffHunks(diff), "", this.palette)}${diffRendering.formatLineMeta(lines[0] ?? diffModel.getFirstChangedNewLine(diff), view.theme)}`;
      const rich = hidden ? this.chrome.markResultSummary(summary) : summary;
      const previewLines = view.expanded ? totalBudget : 32;
      const finalCollapse =
        view.localClickControls &&
        hidden &&
        view.expanded &&
        (view.localDetail >= 2 ||
          diffRendering.diffFitsRenderLimit(diff, branchWidth, previewLines));
      const rendered = await this.renderSplit(
        diff,
        diffRendering.lang(filePath),
        diffRendering.renderState(view),
        previewLines,
        branchWidth,
      );
      return this.chrome.tree(
        rich,
        [{ content: rendered }],
        finalCollapse ? this.chrome.collapseHint(view) : undefined,
        view,
      );
    }
    const collapsedMaxShown = Math.min(operations.length, 3);
    const collapsedPreviewLines = Math.max(
      8,
      Math.floor(MAX_PREVIEW_LINES / Math.max(1, collapsedMaxShown)),
    );
    const hidden =
      collapsedMaxShown < operations.length ||
      diffs
        .slice(0, collapsedMaxShown)
        .some(
          (diff) =>
            !diffRendering.diffFitsRenderLimit(
              diff,
              branchWidth,
              collapsedPreviewLines,
            ),
        );
    const aggregate = `${operations.length} edits ${diffRendering.diffSummaryWithMeta(totalAdded, totalRemoved, totalHunks, "", this.palette)}${totalLines ? ` ${view.theme.fg("muted", `(${totalLines} diff lines)`)}` : ""}`;
    const rich = hidden ? this.chrome.markResultSummary(aggregate) : aggregate;
    const maxShown = view.expanded ? operations.length : collapsedMaxShown;
    const previewLines = view.expanded
      ? Math.max(6, Math.floor(totalBudget / Math.max(1, maxShown)))
      : collapsedPreviewLines;
    const finalCollapse =
      view.localClickControls &&
      hidden &&
      view.expanded &&
      (view.localDetail >= 2 ||
        (maxShown === operations.length &&
          diffs.every((diff) =>
            diffRendering.diffFitsRenderLimit(diff, branchWidth, previewLines),
          )));
    const blocks = await diffRendering.mapWithConcurrency(
      diffs.slice(0, maxShown),
      DIFF_RENDER_CONCURRENCY,
      async (diff, index) => ({
        heading: `Edit ${index + 1}/${operations.length}${diffRendering.formatLineMeta(lines[index] ?? diffModel.getFirstChangedNewLine(diff), view.theme)}`,
        content: await this.renderSplit(
          diff,
          diffRendering.lang(filePath),
          diffRendering.renderState(view),
          previewLines,
          branchWidth,
        ),
      }),
    );
    const remainder = operations.length - maxShown;
    const terminalAction =
      remainder > 0
        ? `${view.theme.fg("muted", `… ${remainder} more edit block${remainder === 1 ? "" : "s"}`)}${this.chrome.detailHint(view, true)}`
        : finalCollapse
          ? this.chrome.collapseHint(view)
          : undefined;
    return this.chrome.tree(rich, blocks, terminalAction, view);
  }

  private async renderApplyTree(
    preview: ApplyPatchPreview,
    view: DiffView,
    settings: DiffPresentationSettings,
  ): Promise<string> {
    const branchWidth = diffRendering.width(view);
    const normalBudget =
      preview.changes.length === 1 ? MAX_PREVIEW_LINES : MAX_RENDER_LINES;
    const totalBudget = view.expanded
      ? diffRendering.progressiveBudget(normalBudget, view, settings)
      : normalBudget;
    const collapsedMaxShown = Math.min(preview.changes.length, 3);
    const collapsedPreviewLines =
      preview.changes.length === 1
        ? 32
        : Math.max(
            8,
            Math.floor(MAX_PREVIEW_LINES / Math.max(1, collapsedMaxShown)),
          );
    const hidden =
      collapsedMaxShown < preview.changes.length ||
      preview.changes
        .slice(0, collapsedMaxShown)
        .some(
          (change) =>
            !diffRendering.diffFitsRenderLimit(
              change.diff,
              branchWidth,
              collapsedPreviewLines,
            ),
        );
    const maxShown = view.expanded ? preview.changes.length : collapsedMaxShown;
    const previewLines = view.expanded
      ? preview.changes.length === 1
        ? totalBudget
        : Math.max(6, Math.floor(totalBudget / Math.max(1, maxShown)))
      : collapsedPreviewLines;
    const finalCollapse =
      view.localClickControls &&
      hidden &&
      view.expanded &&
      (view.localDetail >= 2 ||
        (maxShown === preview.changes.length &&
          preview.changes.every((change) =>
            diffRendering.diffFitsRenderLimit(
              change.diff,
              branchWidth,
              previewLines,
            ),
          )));
    if (preview.changes.length === 1) {
      const change = preview.changes[0];
      const mode =
        change.kind === "add"
          ? "new file"
          : change.kind === "delete"
            ? "delete"
            : "";
      const summary = `${diffModel.describeApplyPatchChange(change)} ${diffRendering.diffSummaryWithMeta(change.diff.added, change.diff.removed, change.hunks, mode, this.palette)}${diffRendering.formatLineMeta(change.line, view.theme)}`;
      const rich = hidden ? this.chrome.markResultSummary(summary) : summary;
      const rendered = await this.renderSplit(
        change.diff,
        change.language,
        diffRendering.renderState(view),
        previewLines,
        branchWidth,
      );
      return this.chrome.tree(
        rich,
        [{ content: rendered }],
        finalCollapse ? this.chrome.collapseHint(view) : undefined,
        view,
      );
    }
    const blocks = await diffRendering.mapWithConcurrency(
      preview.changes.slice(0, maxShown),
      DIFF_RENDER_CONCURRENCY,
      async (change) => ({
        heading: `${diffModel.describeApplyPatchChange(change)} ${change.summary}${diffRendering.formatLineMeta(change.line, view.theme)}`,
        content: await this.renderSplit(
          change.diff,
          change.language,
          diffRendering.renderState(view),
          previewLines,
          branchWidth,
        ),
      }),
    );
    const aggregate = `${preview.changes.length} files ${diffRendering.diffSummaryWithMeta(preview.totalAdded, preview.totalRemoved, preview.totalHunks, "", this.palette)}${preview.totalLines ? ` ${view.theme.fg("muted", `(${preview.totalLines} diff lines)`)}` : ""}`;
    const rich = hidden ? this.chrome.markResultSummary(aggregate) : aggregate;
    const remainder = preview.changes.length - maxShown;
    const terminalAction =
      remainder > 0
        ? `${view.theme.fg("muted", `… ${remainder} more file patch${remainder === 1 ? "" : "es"}`)}${this.chrome.detailHint(view, true)}`
        : finalCollapse
          ? this.chrome.collapseHint(view)
          : undefined;
    return this.chrome.tree(rich, blocks, terminalAction, view);
  }

  private parseApplyPatchPreview(
    patchText: string,
    cwd: string,
    view: DiffView,
    capturedFiles?: readonly ApplyPatchFileEvidence[],
  ): ApplyPatchPreview {
    const lines = patchText.replace(/\r\n/g, "\n").split("\n");
    const changes: ApplyPatchChangePreview[] = [];
    const capturedContent = capturedFiles
      ? new Map(capturedFiles.map((file) => [file.path, file.content] as const))
      : undefined;
    const fileHeader = /^\*\*\* (Add|Update|Delete) File: (.+)$/;
    const endHeader = /^\*\*\* End Patch$/;
    let index = 0;
    while (index < lines.length) {
      const line = lines[index];
      if (!line || line === "*** Begin Patch") {
        index++;
        continue;
      }
      if (endHeader.test(line)) break;
      const header = line.match(fileHeader);
      if (!header) {
        index++;
        continue;
      }
      const kind = header[1].toLowerCase() as ApplyPatchChangePreview["kind"];
      const path = header[2].trim();
      index++;
      let moveTo: string | undefined;
      const body: string[] = [];
      while (
        index < lines.length &&
        !fileHeader.test(lines[index]) &&
        !endHeader.test(lines[index])
      ) {
        if (lines[index].startsWith("*** Move to: ")) {
          moveTo = lines[index].slice("*** Move to: ".length).trim();
          index++;
          continue;
        }
        body.push(lines[index++]);
      }
      const from = this.displayPath(cwd, path);
      const displayPath = moveTo
        ? `${from} ${this.moveArrow(view)} ${this.displayPath(cwd, moveTo)}`
        : from;
      let sourceContent: string | undefined;
      if (kind === "update") {
        if (capturedContent?.has(path)) {
          sourceContent = capturedContent.get(path) ?? undefined;
        } else {
          try {
            sourceContent = this.readFileSync(resolve(cwd, path));
          } catch {
            sourceContent = undefined;
          }
        }
      }
      const diff =
        kind === "add"
          ? diffModel.parseDiff(
              "",
              body
                .map((entry) => diffModel.stripPatchLinePrefix(entry, "+"))
                .join("\n"),
            )
          : kind === "delete"
            ? diffModel.parseDiff(
                body
                  .map((entry) => diffModel.stripPatchLinePrefix(entry, "-"))
                  .join("\n"),
                "",
              )
            : diffModel.parseApplyPatchUpdateDiff(body, sourceContent);
      changes.push({
        kind,
        path,
        displayPath,
        moveTo,
        diff,
        language: diffRendering.lang(moveTo || path),
        hunks: diffModel.countDiffHunks(diff),
        summary: diffRendering.summarizeDiff(
          diff.added,
          diff.removed,
          this.palette,
        ),
        line: diffModel.getApplyPatchLine(diff, kind),
      });
    }
    const totalAdded = diffRendering.sum(
      changes,
      (change) => change.diff.added,
    );
    const totalRemoved = diffRendering.sum(
      changes,
      (change) => change.diff.removed,
    );
    const totalHunks = diffRendering.sum(changes, (change) => change.hunks);
    const totalLines = diffRendering.sum(
      changes,
      (change) => change.diff.lines.length,
    );
    return {
      changes,
      totalAdded,
      totalRemoved,
      totalHunks,
      totalLines,
      summary: diffRendering.summarizeDiff(
        totalAdded,
        totalRemoved,
        this.palette,
      ),
    };
  }

  private async computeLocalizedEditDiffs(
    filePath: string,
    operations: readonly EditOperation[],
    cwd: string,
  ): Promise<LocalizedEditDiff[] | null> {
    if (!filePath || operations.length === 0) return null;
    try {
      const normalizedContent = diffModel.normalizeToLf(
        diffModel.stripBomText(await this.readFile(resolve(cwd, filePath))),
      );
      const normalizedOps = operations.map((edit) => ({
        oldText: diffModel.normalizeToLf(edit.oldText),
        newText: diffModel.normalizeToLf(edit.newText),
      }));
      const localize = (
        state: "before" | "after",
      ): LocalizedEditDiff[] | null => {
        const chunks = normalizedOps.map((edit) =>
          state === "before" ? edit.oldText : edit.newText,
        );
        if (chunks.some((chunk) => chunk.length === 0)) return null;
        const baseContent = chunks.some(
          (chunk) =>
            diffModel.findEditMatch(normalizedContent, chunk).usedFuzzyMatch,
        )
          ? diffModel.normalizeTextForFuzzyMatch(normalizedContent)
          : normalizedContent;
        const matches = chunks.map((chunk, editIndex) => {
          const match = diffModel.findEditMatch(baseContent, chunk);
          if (
            !match.found ||
            diffModel.countFuzzyOccurrences(baseContent, chunk) !== 1
          )
            return null;
          return {
            editIndex,
            matchIndex: match.index,
            matchLength: match.matchLength,
          };
        });
        if (matches.some((match) => match === null)) return null;
        const ordered = [
          ...(matches as Array<{
            editIndex: number;
            matchIndex: number;
            matchLength: number;
          }>),
        ].sort((a, b) => a.matchIndex - b.matchIndex);
        for (let i = 1; i < ordered.length; i++) {
          if (
            ordered[i - 1].matchIndex + ordered[i - 1].matchLength >
            ordered[i].matchIndex
          )
            return null;
        }
        const localized: Array<LocalizedEditDiff | null> = Array(
          operations.length,
        ).fill(null);
        let lineDelta = 0;
        for (const match of ordered) {
          const operation = normalizedOps[match.editIndex];
          const matchedChunk = baseContent.slice(
            match.matchIndex,
            match.matchIndex + match.matchLength,
          );
          const oldChunk =
            state === "before" ? matchedChunk : operation.oldText;
          const newChunk =
            state === "before" ? operation.newText : matchedChunk;
          const matchedStartLine = diffModel.lineNumberAtIndex(
            baseContent,
            match.matchIndex,
          );
          const oldStartLine =
            state === "before"
              ? matchedStartLine
              : matchedStartLine - lineDelta;
          const newStartLine =
            state === "before"
              ? matchedStartLine + lineDelta
              : matchedStartLine;
          const diff = diffModel.offsetParsedDiff(
            diffModel.parseDiff(oldChunk, newChunk),
            oldStartLine - 1,
            newStartLine - 1,
          );
          localized[match.editIndex] = {
            diff,
            line: diffModel.getFirstChangedNewLine(diff),
          };
          lineDelta +=
            diffModel.countLineBreaks(newChunk) -
            diffModel.countLineBreaks(oldChunk);
        }
        return localized.every(Boolean)
          ? (localized as LocalizedEditDiff[])
          : null;
      };
      const before = localize("before");
      const after = localize("after");
      if (!before) return after;
      if (!after) return before;
      const beforeLength = diffRendering.sum(
        normalizedOps,
        (edit) => edit.oldText.length,
      );
      const afterLength = diffRendering.sum(
        normalizedOps,
        (edit) => edit.newText.length,
      );
      return afterLength > beforeLength ? after : before;
    } catch {
      return null;
    }
  }

  private async renderUnified(
    diff: ParsedDiff,
    language: BundledLanguage | undefined,
    state: DiffRenderState,
    max: number,
    renderWidth: number,
  ): Promise<string> {
    if (!diff.lines.length) return "";
    const p = this.palette;
    const dc = p.colors();
    const vis = diff.lines.slice(0, max);
    const nw = Math.max(2, String(diffRendering.maxLineNumber(vis)).length);
    const cw = Math.max(20, renderWidth - (nw + 5));
    const canHighlight = diff.chars <= MAX_HL_CHARS;
    const oldSource: string[] = [];
    const newSource: string[] = [];
    for (const line of vis) {
      if (line.type === "ctx" || line.type === "del")
        oldSource.push(line.content);
      if (line.type === "ctx" || line.type === "add")
        newSource.push(line.content);
    }
    const [oldHighlight, newHighlight] = canHighlight
      ? await Promise.all([
          this.highlightBlock(oldSource.join("\n"), language),
          this.highlightBlock(newSource.join("\n"), language),
        ])
      : [oldSource, newSource];
    let oldIndex = 0;
    let newIndex = 0;
    let index = 0;
    const out: string[] = [diffRendering.diffRule(renderWidth, p)];
    const emitRow = (
      num: number | null,
      sign: string,
      gutterBg: string,
      signFg: string,
      body: string,
      bodyBg = "",
    ): void => {
      const borderFg = sign === "-" ? dc.fgDel : sign === "+" ? dc.fgAdd : "";
      const border = borderFg ? `${borderFg}▌${p.rst}` : `${p.baseBg} `;
      const numFg = borderFg || p.lineNumberFg;
      const gutter = `${border}${gutterBg}${diffRendering.lineNumber(num, nw, numFg)}${signFg}${sign} ${p.rst}${p.divider} `;
      const continuation = `${border}${gutterBg}${" ".repeat(nw + 2)}${p.rst}${p.divider} `;
      const rows = diffRendering.wrapAnsi(
        diffRendering.expandTabs(body),
        cw,
        diffRendering.adaptiveWrapRows(renderWidth),
        bodyBg,
        p,
      );
      out.push(`${gutter}${rows[0]}${p.rst}`);
      for (let row = 1; row < rows.length; row++)
        out.push(`${continuation}${rows[row]}${p.rst}`);
    };
    while (index < vis.length) {
      const line = vis[index];
      if (line.type === "sep") {
        const label =
          line.newNum && line.newNum > 0
            ? ` ${line.newNum} unmodified lines `
            : "···";
        const pad = Math.max(0, Math.min(renderWidth, 72) - label.length - 2);
        out.push(
          `${p.baseBg}${p.dimFg}${"─".repeat(Math.floor(pad / 2))}${label}${"─".repeat(Math.ceil(pad / 2))}${p.rst}`,
        );
        index++;
        continue;
      }
      if (line.type === "ctx") {
        emitRow(
          line.newNum,
          " ",
          p.baseBg,
          dc.fgCtx,
          `${p.baseBg}${D_DIM}${oldHighlight[oldIndex] ?? line.content}`,
          p.baseBg,
        );
        oldIndex++;
        newIndex++;
        index++;
        continue;
      }
      const deletions: Array<{ line: DiffLine; highlight: string }> = [];
      while (index < vis.length && vis[index].type === "del") {
        deletions.push({
          line: vis[index],
          highlight: oldHighlight[oldIndex] ?? vis[index].content,
        });
        oldIndex++;
        index++;
      }
      const additions: Array<{ line: DiffLine; highlight: string }> = [];
      while (index < vis.length && vis[index].type === "add") {
        additions.push({
          line: vis[index],
          highlight: newHighlight[newIndex] ?? vis[index].content,
        });
        newIndex++;
        index++;
      }
      const paired = deletions.length === 1 && additions.length === 1;
      const words = paired
        ? diffRendering.wordDiffAnalysis(
            deletions[0].line.content,
            additions[0].line.content,
          )
        : undefined;
      if (
        paired &&
        words &&
        words.similarity >= WORD_DIFF_MIN_SIM &&
        canHighlight
      ) {
        emitRow(
          deletions[0].line.oldNum,
          "-",
          p.delGutterBg,
          `${dc.fgDel}${D_BOLD}`,
          diffRendering.injectBg(
            deletions[0].highlight,
            words.oldRanges,
            p.delBg,
            p.delWordBg,
            p,
          ),
          p.delBg,
        );
        emitRow(
          additions[0].line.newNum,
          "+",
          p.addGutterBg,
          `${dc.fgAdd}${D_BOLD}`,
          diffRendering.injectBg(
            additions[0].highlight,
            words.newRanges,
            p.addBg,
            p.addWordBg,
            p,
          ),
          p.addBg,
        );
      } else if (paired && words && words.similarity >= WORD_DIFF_MIN_SIM) {
        const plain = diffRendering.plainWordDiff(
          deletions[0].line.content,
          additions[0].line.content,
          p,
        );
        emitRow(
          deletions[0].line.oldNum,
          "-",
          p.delGutterBg,
          `${dc.fgDel}${D_BOLD}`,
          `${p.delBg}${plain.old}`,
          p.delBg,
        );
        emitRow(
          additions[0].line.newNum,
          "+",
          p.addGutterBg,
          `${dc.fgAdd}${D_BOLD}`,
          `${p.addBg}${plain.new}`,
          p.addBg,
        );
      } else {
        for (const deletion of deletions)
          emitRow(
            deletion.line.oldNum,
            "-",
            p.delGutterBg,
            `${dc.fgDel}${D_BOLD}`,
            `${p.delBg}${canHighlight ? deletion.highlight : deletion.line.content}`,
            p.delBg,
          );
        for (const addition of additions)
          emitRow(
            addition.line.newNum,
            "+",
            p.addGutterBg,
            `${dc.fgAdd}${D_BOLD}`,
            `${p.addBg}${canHighlight ? addition.highlight : addition.line.content}`,
            p.addBg,
          );
      }
    }
    out.push(diffRendering.diffRule(renderWidth, p));
    if (diff.lines.length > vis.length)
      out.push(
        `${p.baseBg}${p.dimFg}${diffRendering.collapsedDiffHint(diff.lines.length - vis.length, 0, state, this.chrome, p)}${p.rst}`,
      );
    return out.join("\n");
  }

  private async renderSplit(
    diff: ParsedDiff,
    language: BundledLanguage | undefined,
    state: DiffRenderState,
    max: number,
    renderWidth: number,
  ): Promise<string> {
    if (!diffRendering.shouldUseSplit(diff, renderWidth, max))
      return this.renderUnified(diff, language, state, max, renderWidth);
    if (!diff.lines.length) return "";
    const p = this.palette;
    const dc = p.colors();
    type Row = { left: DiffLine | null; right: DiffLine | null };
    const rows: Row[] = [];
    let index = 0;
    while (index < diff.lines.length) {
      const line = diff.lines[index];
      if (line.type === "sep" || line.type === "ctx") {
        rows.push({ left: line, right: line });
        index++;
        continue;
      }
      const deletions: DiffLine[] = [];
      const additions: DiffLine[] = [];
      while (index < diff.lines.length && diff.lines[index].type === "del")
        deletions.push(diff.lines[index++]);
      while (index < diff.lines.length && diff.lines[index].type === "add")
        additions.push(diff.lines[index++]);
      for (
        let row = 0;
        row < Math.max(deletions.length, additions.length);
        row++
      )
        rows.push({
          left: deletions[row] ?? null,
          right: additions[row] ?? null,
        });
    }
    const vis = rows.slice(0, max);
    const half = Math.floor((renderWidth - 1) / 2);
    const nw = Math.max(
      2,
      String(diffRendering.maxLineNumber(diff.lines)).length,
    );
    const cw = Math.max(12, half - (nw + 5));
    const canHighlight = diff.chars <= MAX_HL_CHARS;
    const leftSource: string[] = [];
    const rightSource: string[] = [];
    for (const row of vis) {
      if (row.left && row.left.type !== "sep")
        leftSource.push(row.left.content);
      if (row.right && row.right.type !== "sep")
        rightSource.push(row.right.content);
    }
    const [leftHighlight, rightHighlight] = canHighlight
      ? await Promise.all([
          this.highlightBlock(leftSource.join("\n"), language),
          this.highlightBlock(rightSource.join("\n"), language),
        ])
      : [leftSource, rightSource];
    let leftIndex = 0;
    let rightIndex = 0;
    type HalfResult = {
      gutter: string;
      continuation: string;
      bodyRows: string[];
    };
    const halfBuild = (
      line: DiffLine | null,
      highlight: string,
      ranges: Array<[number, number]> | null,
      side: "left" | "right",
    ): HalfResult => {
      if (!line) {
        const gutter = ` ${p.stripeFg}${"╱".repeat(nw + 2)}${p.rst}${p.ruleFg}│${p.rst} `;
        return {
          gutter,
          continuation: gutter,
          bodyRows: [`${p.baseBg}${p.stripeFg}${"╱".repeat(cw)}${p.rst}`],
        };
      }
      if (line.type === "sep") {
        const label =
          line.newNum && line.newNum > 0
            ? `··· ${line.newNum} lines ···`
            : "···";
        const gutter = `${p.baseBg} ${p.dimFg}${diffRendering.fit("", nw + 2, p)}${p.rst}${p.ruleFg}│${p.rst} `;
        return {
          gutter,
          continuation: gutter,
          bodyRows: [
            `${p.baseBg}${p.dimFg}${diffRendering.fit(label, cw, p)}${p.rst}`,
          ],
        };
      }
      const isDeletion = line.type === "del";
      const isAddition = line.type === "add";
      const gutterBg = isDeletion
        ? p.delGutterBg
        : isAddition
          ? p.addGutterBg
          : p.baseBg;
      const contentBg = isDeletion ? p.delBg : isAddition ? p.addBg : p.baseBg;
      const signFg = isDeletion ? dc.fgDel : isAddition ? dc.fgAdd : dc.fgCtx;
      const sign = isDeletion ? "-" : isAddition ? "+" : " ";
      const num = isDeletion
        ? line.oldNum
        : isAddition
          ? line.newNum
          : side === "left"
            ? line.oldNum
            : line.newNum;
      const borderFg = isDeletion ? dc.fgDel : isAddition ? dc.fgAdd : "";
      const border = borderFg ? `${borderFg}▌${p.rst}` : ` ${p.baseBg}`;
      const body =
        ranges && ranges.length > 0
          ? diffRendering.injectBg(
              highlight,
              ranges,
              contentBg,
              isDeletion ? p.delWordBg : p.addWordBg,
              p,
            )
          : isDeletion || isAddition
            ? `${contentBg}${highlight}`
            : `${p.baseBg}${D_DIM}${highlight}`;
      const gutter = `${border}${gutterBg}${diffRendering.lineNumber(num, nw, borderFg || p.lineNumberFg)}${signFg}${D_BOLD}${sign} ${p.rst}${p.ruleFg}│${p.rst} `;
      const continuation = `${border}${gutterBg}${" ".repeat(nw + 2)}${p.rst}${p.ruleFg}│${p.rst} `;
      return {
        gutter,
        continuation,
        bodyRows: diffRendering.wrapAnsi(
          diffRendering.expandTabs(body),
          cw,
          diffRendering.adaptiveWrapRows(renderWidth),
          contentBg,
          p,
        ),
      };
    };
    const out: string[] = [];
    const oldHeader = `${p.baseBg}${" ".repeat(Math.max(0, nw - 2))}${dc.fgDel}${D_DIM}old${p.rst}`;
    const newHeader = `${p.baseBg}${" ".repeat(Math.max(0, nw - 2))}${dc.fgAdd}${D_DIM}new${p.rst}`;
    out.push(
      `${p.baseBg}${oldHeader}${" ".repeat(Math.max(0, half - nw - 1))}${p.ruleFg}┊${p.rst}${newHeader}`,
    );
    out.push(
      `${diffRendering.diffRule(half, p)}${p.ruleFg}┊${p.rst}${diffRendering.diffRule(half, p)}`,
    );
    for (const row of vis) {
      const paired = Boolean(
        row.left &&
        row.right &&
        row.left.type === "del" &&
        row.right.type === "add",
      );
      const words =
        paired && row.left && row.right
          ? diffRendering.wordDiffAnalysis(row.left.content, row.right.content)
          : undefined;
      let left: HalfResult;
      let right: HalfResult;
      if (
        paired &&
        words &&
        row.left &&
        row.right &&
        words.similarity >= WORD_DIFF_MIN_SIM &&
        canHighlight
      ) {
        left = halfBuild(
          row.left,
          leftHighlight[leftIndex++] ?? row.left.content,
          words.oldRanges,
          "left",
        );
        right = halfBuild(
          row.right,
          rightHighlight[rightIndex++] ?? row.right.content,
          words.newRanges,
          "right",
        );
      } else if (
        paired &&
        words &&
        row.left &&
        row.right &&
        words.similarity >= WORD_DIFF_MIN_SIM
      ) {
        const plain = diffRendering.plainWordDiff(
          row.left.content,
          row.right.content,
          p,
        );
        leftIndex++;
        rightIndex++;
        left = halfBuild(row.left, plain.old, null, "left");
        right = halfBuild(row.right, plain.new, null, "right");
      } else {
        left = halfBuild(
          row.left,
          row.left && row.left.type !== "sep"
            ? (leftHighlight[leftIndex++] ?? row.left.content)
            : "",
          null,
          "left",
        );
        right = halfBuild(
          row.right,
          row.right && row.right.type !== "sep"
            ? (rightHighlight[rightIndex++] ?? row.right.content)
            : "",
          null,
          "right",
        );
      }
      const count = Math.max(left.bodyRows.length, right.bodyRows.length);
      for (let bodyIndex = 0; bodyIndex < count; bodyIndex++) {
        const leftGutter = bodyIndex === 0 ? left.gutter : left.continuation;
        const rightGutter = bodyIndex === 0 ? right.gutter : right.continuation;
        const leftBody =
          left.bodyRows[bodyIndex] ??
          (!row.left
            ? `${p.baseBg}${p.stripeFg}${"╱".repeat(cw)}${p.rst}`
            : `${p.emptyBg}${" ".repeat(cw)}${p.rst}`);
        const rightBody =
          right.bodyRows[bodyIndex] ??
          (!row.right
            ? `${p.baseBg}${p.stripeFg}${"╱".repeat(cw)}${p.rst}`
            : `${p.emptyBg}${" ".repeat(cw)}${p.rst}`);
        out.push(
          `${leftGutter}${leftBody}${p.divider}${rightGutter}${rightBody}`,
        );
      }
    }
    out.push(
      `${diffRendering.diffRule(half, p)}${p.ruleFg}┊${p.rst}${diffRendering.diffRule(half, p)}`,
    );
    if (rows.length > vis.length)
      out.push(
        `${p.baseBg}${p.dimFg}${diffRendering.collapsedDiffHint(rows.length - vis.length, 0, state, this.chrome, p)}${p.rst}`,
      );
    return out.join("\n");
  }

  private async highlightBlock(
    code: string,
    language: BundledLanguage | undefined,
  ): Promise<string[]> {
    if (!code) return [""];
    if (!language || code.length > MAX_HL_CHARS) return code.split("\n");
    const key = `${this.palette.theme}\0${language}\0${code}`;
    const cached = this.highlights.get(key);
    if (cached) return diffRendering.touchCache(this.highlights, key, cached);
    try {
      if (!this.codeToAnsiLoader) {
        this.codeToAnsiLoader = import("@shikijs/cli").then(
          (module) => module.codeToANSI,
          (error) => {
            this.codeToAnsiLoader = null;
            throw error;
          },
        );
      }
      const codeToAnsi = await this.codeToAnsiLoader;
      const ansi = diffRendering.normalizeShikiContrast(
        await codeToAnsi(code, language, this.palette.theme),
        this.palette,
      );
      const lines = (ansi.endsWith("\n") ? ansi.slice(0, -1) : ansi).split(
        "\n",
      );
      return diffRendering.touchCache(this.highlights, key, lines);
    } catch {
      return code.split("\n");
    }
  }
}
