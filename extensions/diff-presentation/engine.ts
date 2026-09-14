import { readFileSync as nodeReadFileSync } from "node:fs";
import { readFile as nodeReadFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import * as Diff from "diff";
import type { BundledLanguage, BundledTheme } from "shiki";

import type {
  DiffEvidence,
  DiffPresentationChrome,
  DiffPresentationDependencies,
  DiffPresentationRequest,
  DiffPresentationSettings,
  DiffSharedForegrounds,
  DiffSource,
  DiffTheme,
  DiffView,
  EditOperation,
} from "./types.ts";

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const RESET = "\x1b[0m";
const TRANSPARENT_BG = "\x1b[49m";
const TRANSPARENT_RESET = `${RESET}${TRANSPARENT_BG}`;
const D_BOLD = "\x1b[1m";
const D_DIM = "\x1b[2m";
const MAX_PREVIEW_LINES = 60;
const MAX_RENDER_LINES = 150;
const MAX_HL_CHARS = 32_000;
const CACHE_LIMIT = 48;
const DIFF_RENDER_CONCURRENCY = 2;
const WORD_DIFF_MIN_SIM = 0.15;
const SPLIT_MIN_WIDTH = 150;
const SPLIT_MIN_CODE_WIDTH = 60;
const SPLIT_MAX_WRAP_RATIO = 0.2;
const SPLIT_MAX_WRAP_LINES = 8;
const MAX_TERM_WIDTH = 210;
const DEFAULT_TERM_WIDTH = 200;
const MAX_WRAP_ROWS_WIDE = 3;
const MAX_WRAP_ROWS_MED = 2;
const MAX_WRAP_ROWS_NARROW = 1;

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

interface DiffLine {
  readonly type: "add" | "del" | "ctx" | "sep";
  readonly oldNum: number | null;
  readonly newNum: number | null;
  readonly content: string;
}

interface ParsedDiff {
  readonly lines: readonly DiffLine[];
  readonly added: number;
  readonly removed: number;
  readonly chars: number;
}

interface DiffColors {
  readonly fgAdd: string;
  readonly fgDel: string;
  readonly fgCtx: string;
}

interface LocalizedEditDiff {
  readonly diff: ParsedDiff;
  readonly line: number;
}

interface ApplyPatchChangePreview {
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

interface ApplyPatchPreview {
  readonly changes: readonly ApplyPatchChangePreview[];
  readonly totalAdded: number;
  readonly totalRemoved: number;
  readonly totalHunks: number;
  readonly totalLines: number;
  readonly summary: string;
}

interface DiffRenderState {
  readonly toolExpanded: boolean;
  readonly localDetailEnabled: boolean;
  readonly progressiveLocalDetail: true;
  readonly view: DiffView;
}

interface EditResultEvidence {
  readonly editCount: number;
  readonly line: number;
  readonly added: number;
  readonly removed: number;
  readonly hunks: number;
  readonly diffLines: number;
}

interface ApplyPatchFileEvidence {
  readonly path: string;
  readonly content: string | null;
}

interface EvidencePayload {
  readonly source: DiffSource;
  readonly editResult?: EditResultEvidence;
  readonly applyPatchFiles?: readonly ApplyPatchFileEvidence[];
}

interface RestoredEvidence {
  readonly source: DiffSource;
  readonly editResult?: EditResultEvidence;
  readonly applyPatchFiles?: readonly ApplyPatchFileEvidence[];
}

interface DiffPreset {
  readonly shikiTheme?: string;
  readonly bgAdd?: string;
  readonly bgDel?: string;
  readonly bgAddHighlight?: string;
  readonly bgDelHighlight?: string;
  readonly bgGutterAdd?: string;
  readonly bgGutterDel?: string;
  readonly bgEmpty?: string;
  readonly fgAdd?: string;
  readonly fgDel?: string;
  readonly fgDim?: string;
  readonly fgLnum?: string;
  readonly fgRule?: string;
  readonly fgStripe?: string;
  readonly fgSafeMuted?: string;
}

const DIFF_PRESETS: Readonly<Record<string, DiffPreset>> = {
  default: {
    bgAdd: "#162620",
    bgDel: "#2d1919",
    bgAddHighlight: "#234b32",
    bgDelHighlight: "#502323",
    bgGutterAdd: "#12201a",
    bgGutterDel: "#261616",
    bgEmpty: "#121212",
    fgDim: "#505050",
    fgLnum: "#646464",
    fgRule: "#323232",
    fgStripe: "#282828",
    fgSafeMuted: "#8b949e",
  },
  midnight: {
    bgAdd: "#0d1a12",
    bgDel: "#1a0d0d",
    bgAddHighlight: "#1a3825",
    bgDelHighlight: "#381a1a",
    bgGutterAdd: "#091208",
    bgGutterDel: "#120908",
    bgEmpty: "#080808",
    fgDim: "#404040",
    fgLnum: "#505050",
    fgRule: "#282828",
    fgStripe: "#1e1e1e",
    fgSafeMuted: "#8b949e",
  },
  neon: {
    bgAdd: "#1a3320",
    bgDel: "#331a16",
    bgAddHighlight: "#2d5c3a",
    bgDelHighlight: "#5c2d2d",
    bgGutterAdd: "#142818",
    bgGutterDel: "#28120e",
    bgEmpty: "#141414",
    fgDim: "#606060",
    fgLnum: "#787878",
    fgRule: "#404040",
    fgStripe: "#303030",
    fgSafeMuted: "#9da5ae",
  },
};

interface ResolvedDiffConfiguration {
  readonly hasThemeSelection: boolean;
  readonly explicitBackground: boolean;
  color(name: keyof DiffPreset): string | undefined;
}

function resolveDiffConfiguration(
  settings: DiffPresentationSettings,
): ResolvedDiffConfiguration {
  const preset = settings.diffTheme
    ? DIFF_PRESETS[settings.diffTheme]
    : undefined;
  const overrides = settings.diffColors ?? {};
  return {
    hasThemeSelection: Boolean(settings.diffTheme),
    explicitBackground: Boolean(preset) || Object.keys(overrides).length > 0,
    color(name) {
      return overrides[name] ?? preset?.[name];
    },
  };
}

function configuredSharedForegrounds(
  settings: DiffPresentationSettings,
): DiffSharedForegrounds {
  const configuration = resolveDiffConfiguration(settings);
  const dim = hexToFgAnsi(configuration.color("fgDim") ?? "") || undefined;
  const rule = hexToFgAnsi(configuration.color("fgRule") ?? "") || undefined;
  return { dim, rule };
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

const CUBE_VALUES = [0, 95, 135, 175, 215, 255];
const UNIVERSAL_DIFF_ADD_FG = { r: 110, g: 210, b: 130 };
const UNIVERSAL_DIFF_DEL_FG = { r: 225, g: 110, b: 110 };
const ADDITION_TINT_TARGET = { r: 84, g: 190, b: 118 };
const DELETION_TINT_TARGET = { r: 232, g: 95, b: 122 };
const FALLBACK_BASE_BG_DARK = { r: 32, g: 35, b: 42 };
const FALLBACK_BASE_BG_LIGHT = { r: 232, g: 233, b: 236 };

type Rgb = { r: number; g: number; b: number };

class DiffPalette {
  private key = "";
  private onLight = false;
  private shikiTheme: BundledTheme =
    (process.env.DIFF_THEME as BundledTheme | undefined) ?? "github-dark";
  private resetAnsi = RESET;
  private bgAdd = TRANSPARENT_BG;
  private bgDel = TRANSPARENT_BG;
  private bgAddWord = TRANSPARENT_BG;
  private bgDelWord = TRANSPARENT_BG;
  private bgGutterAdd = TRANSPARENT_BG;
  private bgGutterDel = TRANSPARENT_BG;
  private bgEmpty = TRANSPARENT_BG;
  private bgBase = TRANSPARENT_BG;
  private fgAdd = "\x1b[38;2;100;180;120m";
  private fgDel = "\x1b[38;2;200;100;100m";
  private fgDim = "\x1b[38;2;80;80;80m";
  private fgLnum = "\x1b[38;2;100;100;100m";
  private fgRule = "\x1b[38;2;50;50;50m";
  private fgStripe = "\x1b[38;2;40;40;40m";
  private fgSafeMuted = "\x1b[38;2;139;148;158m";
  private readonly clearHighlights: () => void;
  private readonly isLightTheme: (theme: DiffTheme) => boolean;
  private readonly resolveRuleAnsi?: (theme: DiffTheme) => string | undefined;

  constructor(
    clearHighlights: () => void,
    isLightTheme: (theme: DiffTheme) => boolean,
    resolveRuleAnsi?: (theme: DiffTheme) => string | undefined,
  ) {
    this.clearHighlights = clearHighlights;
    this.isLightTheme = isLightTheme;
    this.resolveRuleAnsi = resolveRuleAnsi;
  }

  apply(theme: DiffTheme, settings: DiffPresentationSettings): void {
    const key = JSON.stringify([
      settings.diffTheme,
      settings.diffColors,
      settings.themeAdaptive,
      theme.name ?? "",
      themeFingerprint(theme),
      this.resolveRuleAnsi?.(theme) ?? "",
    ]);
    if (key === this.key) return;
    this.key = key;
    this.resetValues();

    const configuration = resolveDiffConfiguration(settings);
    const explicitForeground = new Set<keyof DiffPreset>();
    const applyBg = (
      name: keyof DiffPreset,
      set: (ansi: string) => void,
    ): void => {
      const ansi = hexToBgAnsi(configuration.color(name) ?? "");
      if (ansi) set(ansi);
    };
    const applyFg = (
      name: keyof DiffPreset,
      set: (ansi: string) => void,
    ): void => {
      const ansi = hexToFgAnsi(configuration.color(name) ?? "");
      if (!ansi) return;
      set(ansi);
      explicitForeground.add(name);
    };
    applyBg("bgAdd", (v) => {
      this.bgAdd = v;
    });
    applyBg("bgDel", (v) => {
      this.bgDel = v;
    });
    applyBg("bgAddHighlight", (v) => {
      this.bgAddWord = v;
    });
    applyBg("bgDelHighlight", (v) => {
      this.bgDelWord = v;
    });
    applyBg("bgGutterAdd", (v) => {
      this.bgGutterAdd = v;
    });
    applyBg("bgGutterDel", (v) => {
      this.bgGutterDel = v;
    });
    applyBg("bgEmpty", (v) => {
      this.bgEmpty = v;
    });
    applyFg("fgAdd", (v) => {
      this.fgAdd = v;
    });
    applyFg("fgDel", (v) => {
      this.fgDel = v;
    });
    applyFg("fgDim", (v) => {
      this.fgDim = v;
    });
    applyFg("fgLnum", (v) => {
      this.fgLnum = v;
    });
    applyFg("fgRule", (v) => {
      this.fgRule = v;
    });
    applyFg("fgStripe", (v) => {
      this.fgStripe = v;
    });
    applyFg("fgSafeMuted", (v) => {
      this.fgSafeMuted = v;
    });

    const adaptive = settings.themeAdaptive !== false;
    this.onLight = adaptive && this.isLightTheme(theme);
    if (adaptive) {
      const muted = safeFgAnsi(theme, "muted");
      const rule =
        this.resolveRuleAnsi?.(theme) ?? safeFgAnsi(theme, "borderMuted");
      if (!explicitForeground.has("fgDim") && muted) this.fgDim = muted;
      if (!explicitForeground.has("fgLnum") && muted) this.fgLnum = muted;
      if (!explicitForeground.has("fgRule") && rule) this.fgRule = rule;
      if (!explicitForeground.has("fgStripe") && rule) this.fgStripe = rule;
      if (!explicitForeground.has("fgSafeMuted") && muted)
        this.fgSafeMuted = muted;
      if (!configuration.explicitBackground) this.deriveBackgrounds(theme);
    }
    const selectedShiki = configuration.color("shikiTheme");
    if (selectedShiki) this.shikiTheme = selectedShiki as BundledTheme;
    else if (!process.env.DIFF_THEME && !configuration.hasThemeSelection)
      this.shikiTheme = this.onLight ? "github-light" : "github-dark";
    this.clearHighlights();
  }

  reset(): void {
    this.key = "";
    this.resetValues();
  }

  colors(): DiffColors {
    return { fgAdd: this.fgAdd, fgDel: this.fgDel, fgCtx: this.fgDim };
  }
  get theme(): BundledTheme {
    return this.shikiTheme;
  }
  get light(): boolean {
    return this.onLight;
  }
  get rst(): string {
    return this.resetAnsi;
  }
  get addBg(): string {
    return this.bgAdd;
  }
  get delBg(): string {
    return this.bgDel;
  }
  get addWordBg(): string {
    return this.bgAddWord;
  }
  get delWordBg(): string {
    return this.bgDelWord;
  }
  get addGutterBg(): string {
    return this.bgGutterAdd;
  }
  get delGutterBg(): string {
    return this.bgGutterDel;
  }
  get emptyBg(): string {
    return this.bgEmpty;
  }
  get baseBg(): string {
    return this.bgBase;
  }
  get addFg(): string {
    return this.fgAdd;
  }
  get delFg(): string {
    return this.fgDel;
  }
  get dimFg(): string {
    return this.fgDim;
  }
  get lineNumberFg(): string {
    return this.fgLnum;
  }
  get ruleFg(): string {
    return this.fgRule;
  }
  get stripeFg(): string {
    return this.fgStripe;
  }
  get safeMutedFg(): string {
    return this.fgSafeMuted;
  }
  get divider(): string {
    return `${this.fgRule}│${this.resetAnsi}`;
  }

  private resetValues(): void {
    this.onLight = false;
    this.shikiTheme =
      (process.env.DIFF_THEME as BundledTheme | undefined) ?? "github-dark";
    this.resetAnsi = RESET;
    this.bgAdd = this.bgDel = this.bgAddWord = this.bgDelWord = TRANSPARENT_BG;
    this.bgGutterAdd =
      this.bgGutterDel =
      this.bgEmpty =
      this.bgBase =
        TRANSPARENT_BG;
    this.fgAdd = "\x1b[38;2;100;180;120m";
    this.fgDel = "\x1b[38;2;200;100;100m";
    this.fgDim = "\x1b[38;2;80;80;80m";
    this.fgLnum = "\x1b[38;2;100;100;100m";
    this.fgRule = "\x1b[38;2;50;50;50m";
    this.fgStripe = "\x1b[38;2;40;40;40m";
    this.fgSafeMuted = "\x1b[38;2;139;148;158m";
  }

  private deriveBackgrounds(theme: DiffTheme): void {
    const addFg = themeFgRgb(theme, "toolDiffAdded") ?? UNIVERSAL_DIFF_ADD_FG;
    const delFg = themeFgRgb(theme, "toolDiffRemoved") ?? UNIVERSAL_DIFF_DEL_FG;
    const base =
      themeBgRgb(theme, "toolSuccessBg") ??
      themeBgRgb(theme, "userMessageBg") ??
      (this.onLight ? FALLBACK_BASE_BG_LIGHT : FALLBACK_BASE_BG_DARK);
    const addTint = mixRgb(addFg, ADDITION_TINT_TARGET, 0.35);
    const delTint = mixRgb(delFg, DELETION_TINT_TARGET, 0.65);
    this.fgAdd = rgbToFgAnsi(addFg);
    this.fgDel = rgbToFgAnsi(delFg);
    this.bgAdd = rgbToBgAnsi(mixRgb(base, addTint, 0.24));
    this.bgDel = rgbToBgAnsi(mixRgb(base, delTint, 0.12));
    this.bgAddWord = rgbToBgAnsi(mixRgb(base, addTint, 0.44));
    this.bgDelWord = rgbToBgAnsi(mixRgb(base, delTint, 0.26));
    this.bgGutterAdd = rgbToBgAnsi(mixRgb(base, addTint, 0.14));
    this.bgGutterDel = rgbToBgAnsi(mixRgb(base, delTint, 0.08));
    this.bgEmpty = TRANSPARENT_BG;
    this.bgBase = TRANSPARENT_BG;
    this.resetAnsi = TRANSPARENT_RESET;
  }
}

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
    this.chrome = dependencies.chrome ?? plainChrome;
    this.displayPath = dependencies.displayPath ?? shortPath;
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
    if (!isDiffSource(source)) return undefined;
    const cloned = cloneSource(source);
    let editResult: EditResultEvidence | undefined;
    if (cloned.kind === "edit") {
      const operations = validEditOperations(cloned.edits);
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
          operations.map((edit) => parseDiff(edit.oldText, edit.newText));
        editResult = {
          editCount: operations.length,
          line: localized?.[0]?.line ?? getFirstChangedNewLine(diffs[0]),
          added: sum(diffs, (diff) => diff.added),
          removed: sum(diffs, (diff) => diff.removed),
          hunks: sum(diffs, countDiffHunks),
          diffLines: sum(diffs, (diff) => diff.lines.length),
        };
      }
    }
    const applyPatchFiles =
      cloned.kind === "apply-patch"
        ? await Promise.all(
            extractApplyPatchUpdateFiles(cloned.patchText).map(
              async (path): Promise<ApplyPatchFileEvidence> => {
                try {
                  return {
                    path,
                    content: await this.readFile(resolve(cloned.cwd, path)),
                  };
                } catch {
                  return { path, content: null };
                }
              },
            ),
          )
        : undefined;
    const payload: EvidencePayload =
      applyPatchFiles === undefined
        ? { source: cloned, editResult }
        : { source: cloned, editResult, applyPatchFiles };
    return deepFreeze({ version: 1, payload }) as DiffEvidence;
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
    if (!isDiffSource(payload.source)) return undefined;
    const hasApplyPatchFiles = Object.prototype.hasOwnProperty.call(
      payload,
      "applyPatchFiles",
    );
    if (
      hasApplyPatchFiles &&
      !isApplyPatchFileEvidenceArray(payload.applyPatchFiles)
    )
      return undefined;
    if (
      hasApplyPatchFiles &&
      payload.source.kind === "apply-patch" &&
      !coversApplyPatchUpdateFiles(
        payload.source.patchText,
        payload.applyPatchFiles as readonly ApplyPatchFileEvidence[],
      )
    )
      return undefined;
    return {
      source: cloneSource(payload.source),
      editResult: isEditResultEvidence(payload.editResult)
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
      (isDiffSource(request.source) ? cloneSource(request.source) : undefined);
    if (!source || !surfaceAcceptsSource(request.surface, source.kind))
      return undefined;
    const settings = this.dependencies.readSettings();
    this.palette.apply(request.view.theme, settings);
    const key = JSON.stringify([
      request.surface,
      hashText(JSON.stringify(source)),
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
      return { key, initial: frame(body, affectedPaths) };
    }
    const diff = parseDiff(source.before ?? "", source.after);
    const isNew = source.before === null;
    const collapsedLimit = positiveInteger(settings.diffCollapsedLines, 24);
    const previewLines = view.expanded
      ? progressiveBudget(MAX_RENDER_LINES, view, settings)
      : collapsedLimit;
    const hidden = isNew
      ? diff.lines.length > collapsedLimit
      : !diffFitsRenderLimit(diff, width(view), collapsedLimit);
    const finalCollapse =
      view.localClickControls &&
      hidden &&
      view.expanded &&
      (view.localDetail >= 2 ||
        (isNew
          ? diff.lines.length <= previewLines
          : diffFitsRenderLimit(diff, width(view), previewLines)));
    const hunks = countDiffHunks(diff);
    const mode = isNew
      ? "new file"
      : shouldUseSplit(diff, width(view), previewLines)
        ? "split"
        : "unified";
    const summary = diffSummaryWithMeta(
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
      initial: frame(rendering, affectedPaths),
      render: async () => {
        const body = isNew
          ? await this.renderUnified(
              diff,
              lang(source.path),
              renderState(view),
              previewLines,
              width(view),
            )
          : await this.renderSplit(
              diff,
              lang(source.path),
              renderState(view),
              previewLines,
              width(view),
            );
        const content = finalCollapse
          ? `${body}\n${this.chrome.collapseHint(view)}`
          : body;
        return frame(
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
    const operations = validEditOperations(source.edits);
    const affectedPaths = [this.displayPath(source.cwd, source.path)];
    if (operations.length === 0)
      return { key, initial: frame("", affectedPaths) };
    const initial = frame(
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
          operations.map((edit) => parseDiff(edit.oldText, edit.newText));
        const lines =
          localized?.map((entry) => entry.line) ??
          diffs.map(getFirstChangedNewLine);
        return frame(
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
    const operations = validEditOperations(source.edits);
    const affectedPaths = [this.displayPath(source.cwd, source.path)];
    if (operations.length === 0) {
      const body = this.chrome.branch(
        this.chrome.markResultSummary(view.theme.fg("success", "Applied")),
        view,
        { final: false },
      );
      return { key, initial: frame(body, affectedPaths) };
    }
    const diffs = operations.map((edit) =>
      parseDiff(edit.oldText, edit.newText),
    );
    const result = captured ?? {
      editCount: operations.length,
      line: getFirstChangedNewLine(diffs[0]),
      added: sum(diffs, (diff) => diff.added),
      removed: sum(diffs, (diff) => diff.removed),
      hunks: sum(diffs, countDiffHunks),
      diffLines: sum(diffs, (diff) => diff.lines.length),
    };
    const base =
      operations.length === 1
        ? `${diffSummaryWithMeta(result.added, result.removed, result.hunks, "", this.palette)}${formatLineMeta(result.line, view.theme)}`
        : `${result.editCount} edits ${diffSummaryWithMeta(result.added, result.removed, result.hunks, "", this.palette)}${result.diffLines ? ` ${view.theme.fg("muted", `(${result.diffLines} diff lines)`)}` : ""}`;
    const body = companionReady
      ? ""
      : this.chrome.branch(this.chrome.markResultSummary(base), view, {
          final: false,
        });
    return { key, initial: frame(body, affectedPaths, companionReady) };
  }

  private prepareApplyCall(
    key: string,
    source: Extract<DiffSource, { kind: "apply-patch" }>,
    capturedFiles: readonly ApplyPatchFileEvidence[] | undefined,
    view: DiffView,
    sourceComplete: boolean,
    settings: DiffPresentationSettings,
  ): PreparedPresentation {
    const files = extractApplyPatchFiles(source.patchText);
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
      return { key, initial: frame("", displayFiles, false, headerSummary) };
    let preview: ApplyPatchPreview;
    try {
      preview = this.parseApplyPatchPreview(
        source.patchText,
        source.cwd,
        view,
        capturedFiles,
      );
    } catch {
      return { key, initial: frame("", displayFiles, false, headerSummary) };
    }
    if (preview.changes.length === 0)
      return { key, initial: frame("", displayFiles, false, headerSummary) };
    const initialBody = this.chrome.branch(
      view.theme.fg("muted", "(rendering…)"),
      view,
      { final: false, continued: true },
    );
    return {
      key,
      initial: frame(
        initialBody,
        preview.changes.map((change) => change.displayPath),
        false,
        headerSummary,
      ),
      render: async () =>
        frame(
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
      return { key, initial: frame(body, [], false) };
    }
    const affectedPaths = preview.changes.map((change) => change.displayPath);
    if (companionReady) return { key, initial: frame("", affectedPaths, true) };
    if (preview.changes.length === 0) {
      const body = this.chrome.branch(
        this.chrome.markResultSummary(view.theme.fg("success", "Applied")),
        view,
        { final: false },
      );
      return { key, initial: frame(body, affectedPaths) };
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
      const summary = diffSummaryWithMeta(
        change.diff.added,
        change.diff.removed,
        change.hunks,
        mode,
        this.palette,
      );
      text = `${view.theme.fg("success", "Applied")} ${view.theme.fg("muted", change.displayPath)} ${summary}${formatLineMeta(change.line, view.theme)}`;
    } else {
      const summary = diffSummaryWithMeta(
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
      initial: frame(
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
    const branchWidth = width(view);
    const normalBudget =
      operations.length === 1 ? MAX_PREVIEW_LINES : MAX_RENDER_LINES;
    const totalBudget = view.expanded
      ? progressiveBudget(normalBudget, view, settings)
      : normalBudget;
    const totalAdded = sum(diffs, (diff) => diff.added);
    const totalRemoved = sum(diffs, (diff) => diff.removed);
    const totalHunks = sum(diffs, countDiffHunks);
    const totalLines = sum(diffs, (diff) => diff.lines.length);
    if (operations.length === 1) {
      const diff = diffs[0];
      const hidden = !diffFitsRenderLimit(diff, branchWidth, 32);
      const summary = `${diffSummaryWithMeta(diff.added, diff.removed, countDiffHunks(diff), "", this.palette)}${formatLineMeta(lines[0] ?? getFirstChangedNewLine(diff), view.theme)}`;
      const rich = hidden ? this.chrome.markResultSummary(summary) : summary;
      const previewLines = view.expanded ? totalBudget : 32;
      const finalCollapse =
        view.localClickControls &&
        hidden &&
        view.expanded &&
        (view.localDetail >= 2 ||
          diffFitsRenderLimit(diff, branchWidth, previewLines));
      const rendered = await this.renderSplit(
        diff,
        lang(filePath),
        renderState(view),
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
            !diffFitsRenderLimit(diff, branchWidth, collapsedPreviewLines),
        );
    const aggregate = `${operations.length} edits ${diffSummaryWithMeta(totalAdded, totalRemoved, totalHunks, "", this.palette)}${totalLines ? ` ${view.theme.fg("muted", `(${totalLines} diff lines)`)}` : ""}`;
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
            diffFitsRenderLimit(diff, branchWidth, previewLines),
          )));
    const blocks = await mapWithConcurrency(
      diffs.slice(0, maxShown),
      DIFF_RENDER_CONCURRENCY,
      async (diff, index) => ({
        heading: `Edit ${index + 1}/${operations.length}${formatLineMeta(lines[index] ?? getFirstChangedNewLine(diff), view.theme)}`,
        content: await this.renderSplit(
          diff,
          lang(filePath),
          renderState(view),
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
    const branchWidth = width(view);
    const normalBudget =
      preview.changes.length === 1 ? MAX_PREVIEW_LINES : MAX_RENDER_LINES;
    const totalBudget = view.expanded
      ? progressiveBudget(normalBudget, view, settings)
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
            !diffFitsRenderLimit(
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
            diffFitsRenderLimit(change.diff, branchWidth, previewLines),
          )));
    if (preview.changes.length === 1) {
      const change = preview.changes[0];
      const mode =
        change.kind === "add"
          ? "new file"
          : change.kind === "delete"
            ? "delete"
            : "";
      const summary = `${describeApplyPatchChange(change)} ${diffSummaryWithMeta(change.diff.added, change.diff.removed, change.hunks, mode, this.palette)}${formatLineMeta(change.line, view.theme)}`;
      const rich = hidden ? this.chrome.markResultSummary(summary) : summary;
      const rendered = await this.renderSplit(
        change.diff,
        change.language,
        renderState(view),
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
    const blocks = await mapWithConcurrency(
      preview.changes.slice(0, maxShown),
      DIFF_RENDER_CONCURRENCY,
      async (change) => ({
        heading: `${describeApplyPatchChange(change)} ${change.summary}${formatLineMeta(change.line, view.theme)}`,
        content: await this.renderSplit(
          change.diff,
          change.language,
          renderState(view),
          previewLines,
          branchWidth,
        ),
      }),
    );
    const aggregate = `${preview.changes.length} files ${diffSummaryWithMeta(preview.totalAdded, preview.totalRemoved, preview.totalHunks, "", this.palette)}${preview.totalLines ? ` ${view.theme.fg("muted", `(${preview.totalLines} diff lines)`)}` : ""}`;
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
          ? parseDiff(
              "",
              body.map((entry) => stripPatchLinePrefix(entry, "+")).join("\n"),
            )
          : kind === "delete"
            ? parseDiff(
                body
                  .map((entry) => stripPatchLinePrefix(entry, "-"))
                  .join("\n"),
                "",
              )
            : parseApplyPatchUpdateDiff(body, sourceContent);
      changes.push({
        kind,
        path,
        displayPath,
        moveTo,
        diff,
        language: lang(moveTo || path),
        hunks: countDiffHunks(diff),
        summary: summarizeDiff(diff.added, diff.removed, this.palette),
        line: getApplyPatchLine(diff, kind),
      });
    }
    const totalAdded = sum(changes, (change) => change.diff.added);
    const totalRemoved = sum(changes, (change) => change.diff.removed);
    const totalHunks = sum(changes, (change) => change.hunks);
    const totalLines = sum(changes, (change) => change.diff.lines.length);
    return {
      changes,
      totalAdded,
      totalRemoved,
      totalHunks,
      totalLines,
      summary: summarizeDiff(totalAdded, totalRemoved, this.palette),
    };
  }

  private async computeLocalizedEditDiffs(
    filePath: string,
    operations: readonly EditOperation[],
    cwd: string,
  ): Promise<LocalizedEditDiff[] | null> {
    if (!filePath || operations.length === 0) return null;
    try {
      const normalizedContent = normalizeToLf(
        stripBomText(await this.readFile(resolve(cwd, filePath))),
      );
      const normalizedOps = operations.map((edit) => ({
        oldText: normalizeToLf(edit.oldText),
        newText: normalizeToLf(edit.newText),
      }));
      const localize = (
        state: "before" | "after",
      ): LocalizedEditDiff[] | null => {
        const chunks = normalizedOps.map((edit) =>
          state === "before" ? edit.oldText : edit.newText,
        );
        if (chunks.some((chunk) => chunk.length === 0)) return null;
        const baseContent = chunks.some(
          (chunk) => findEditMatch(normalizedContent, chunk).usedFuzzyMatch,
        )
          ? normalizeTextForFuzzyMatch(normalizedContent)
          : normalizedContent;
        const matches = chunks.map((chunk, editIndex) => {
          const match = findEditMatch(baseContent, chunk);
          if (!match.found || countFuzzyOccurrences(baseContent, chunk) !== 1)
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
          const matchedStartLine = lineNumberAtIndex(
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
          const diff = offsetParsedDiff(
            parseDiff(oldChunk, newChunk),
            oldStartLine - 1,
            newStartLine - 1,
          );
          localized[match.editIndex] = {
            diff,
            line: getFirstChangedNewLine(diff),
          };
          lineDelta += countLineBreaks(newChunk) - countLineBreaks(oldChunk);
        }
        return localized.every(Boolean)
          ? (localized as LocalizedEditDiff[])
          : null;
      };
      const before = localize("before");
      const after = localize("after");
      if (!before) return after;
      if (!after) return before;
      const beforeLength = sum(normalizedOps, (edit) => edit.oldText.length);
      const afterLength = sum(normalizedOps, (edit) => edit.newText.length);
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
    const nw = Math.max(2, String(maxLineNumber(vis)).length);
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
    const out: string[] = [diffRule(renderWidth, p)];
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
      const gutter = `${border}${gutterBg}${lineNumber(num, nw, numFg)}${signFg}${sign} ${p.rst}${p.divider} `;
      const continuation = `${border}${gutterBg}${" ".repeat(nw + 2)}${p.rst}${p.divider} `;
      const rows = wrapAnsi(
        expandTabs(body),
        cw,
        adaptiveWrapRows(renderWidth),
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
        ? wordDiffAnalysis(deletions[0].line.content, additions[0].line.content)
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
          injectBg(
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
          injectBg(
            additions[0].highlight,
            words.newRanges,
            p.addBg,
            p.addWordBg,
            p,
          ),
          p.addBg,
        );
      } else if (paired && words && words.similarity >= WORD_DIFF_MIN_SIM) {
        const plain = plainWordDiff(
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
    out.push(diffRule(renderWidth, p));
    if (diff.lines.length > vis.length)
      out.push(
        `${p.baseBg}${p.dimFg}${collapsedDiffHint(diff.lines.length - vis.length, 0, state, this.chrome, p)}${p.rst}`,
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
    if (!shouldUseSplit(diff, renderWidth, max))
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
    const nw = Math.max(2, String(maxLineNumber(diff.lines)).length);
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
        const gutter = `${p.baseBg} ${p.dimFg}${fit("", nw + 2, p)}${p.rst}${p.ruleFg}│${p.rst} `;
        return {
          gutter,
          continuation: gutter,
          bodyRows: [`${p.baseBg}${p.dimFg}${fit(label, cw, p)}${p.rst}`],
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
          ? injectBg(
              highlight,
              ranges,
              contentBg,
              isDeletion ? p.delWordBg : p.addWordBg,
              p,
            )
          : isDeletion || isAddition
            ? `${contentBg}${highlight}`
            : `${p.baseBg}${D_DIM}${highlight}`;
      const gutter = `${border}${gutterBg}${lineNumber(num, nw, borderFg || p.lineNumberFg)}${signFg}${D_BOLD}${sign} ${p.rst}${p.ruleFg}│${p.rst} `;
      const continuation = `${border}${gutterBg}${" ".repeat(nw + 2)}${p.rst}${p.ruleFg}│${p.rst} `;
      return {
        gutter,
        continuation,
        bodyRows: wrapAnsi(
          expandTabs(body),
          cw,
          adaptiveWrapRows(renderWidth),
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
    out.push(`${diffRule(half, p)}${p.ruleFg}┊${p.rst}${diffRule(half, p)}`);
    for (const row of vis) {
      const paired = Boolean(
        row.left &&
        row.right &&
        row.left.type === "del" &&
        row.right.type === "add",
      );
      const words =
        paired && row.left && row.right
          ? wordDiffAnalysis(row.left.content, row.right.content)
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
        const plain = plainWordDiff(row.left.content, row.right.content, p);
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
    out.push(`${diffRule(half, p)}${p.ruleFg}┊${p.rst}${diffRule(half, p)}`);
    if (rows.length > vis.length)
      out.push(
        `${p.baseBg}${p.dimFg}${collapsedDiffHint(rows.length - vis.length, 0, state, this.chrome, p)}${p.rst}`,
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
    if (cached) return touchCache(this.highlights, key, cached);
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
      const ansi = normalizeShikiContrast(
        await codeToAnsi(code, language, this.palette.theme),
        this.palette,
      );
      const lines = (ansi.endsWith("\n") ? ansi.slice(0, -1) : ansi).split(
        "\n",
      );
      return touchCache(this.highlights, key, lines);
    } catch {
      return code.split("\n");
    }
  }
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

function safeFgAnsi(theme: DiffTheme, key: string): string | undefined {
  try {
    return theme.getFgAnsi?.(key) || undefined;
  } catch {
    return undefined;
  }
}
function safeBgAnsi(theme: DiffTheme, key: string): string | undefined {
  try {
    return theme.getBgAnsi?.(key) || undefined;
  } catch {
    return undefined;
  }
}
function themeFgRgb(theme: DiffTheme, key: string): Rgb | undefined {
  const ansi = safeFgAnsi(theme, key);
  return ansi ? parseAnsiRgb(ansi) : undefined;
}
function themeBgRgb(theme: DiffTheme, key: string): Rgb | undefined {
  const ansi = safeBgAnsi(theme, key);
  return ansi ? parseAnsiRgb(ansi) : undefined;
}
function themeFingerprint(theme: DiffTheme): string {
  return [
    "success",
    "error",
    "borderMuted",
    "accent",
    "muted",
    "toolDiffAdded",
    "toolDiffRemoved",
  ]
    .map((key) => safeFgAnsi(theme, key) ?? "")
    .join("\u001f");
}
function parseAnsiRgb(ansi: string): Rgb | undefined {
  const trueColor = ansi.match(/\u001b\[(?:38|48);2;(\d+);(\d+);(\d+)m/);
  if (trueColor)
    return { r: +trueColor[1], g: +trueColor[2], b: +trueColor[3] };
  const indexed = ansi.match(/\u001b\[(?:38|48);5;(\d+)m/);
  return indexed ? xterm256ToRgb(+indexed[1]) : undefined;
}
function xterm256ToRgb(index: number): Rgb | undefined {
  if (!Number.isInteger(index) || index < 0 || index > 255) return undefined;
  const basic: Array<[number, number, number]> = [
    [0, 0, 0],
    [128, 0, 0],
    [0, 128, 0],
    [128, 128, 0],
    [0, 0, 128],
    [128, 0, 128],
    [0, 128, 128],
    [192, 192, 192],
    [128, 128, 128],
    [255, 0, 0],
    [0, 255, 0],
    [255, 255, 0],
    [0, 0, 255],
    [255, 0, 255],
    [0, 255, 255],
    [255, 255, 255],
  ];
  if (index < 16) {
    const [r, g, b] = basic[index];
    return { r, g, b };
  }
  if (index < 232) {
    const value = index - 16;
    return {
      r: CUBE_VALUES[Math.floor(value / 36) % 6],
      g: CUBE_VALUES[Math.floor(value / 6) % 6],
      b: CUBE_VALUES[value % 6],
    };
  }
  const level = 8 + (index - 232) * 10;
  return { r: level, g: level, b: level };
}
function hexToBgAnsi(hex: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(hex)
    ? `\x1b[48;2;${parseInt(hex.slice(1, 3), 16)};${parseInt(hex.slice(3, 5), 16)};${parseInt(hex.slice(5, 7), 16)}m`
    : "";
}
function hexToFgAnsi(hex: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(hex)
    ? `\x1b[38;2;${parseInt(hex.slice(1, 3), 16)};${parseInt(hex.slice(3, 5), 16)};${parseInt(hex.slice(5, 7), 16)}m`
    : "";
}
function rgbToBgAnsi(rgb: Rgb): string {
  return `\x1b[48;2;${Math.round(rgb.r)};${Math.round(rgb.g)};${Math.round(rgb.b)}m`;
}
function rgbToFgAnsi(rgb: Rgb): string {
  return `\x1b[38;2;${Math.round(rgb.r)};${Math.round(rgb.g)};${Math.round(rgb.b)}m`;
}
function mixRgb(from: Rgb, to: Rgb, ratio: number): Rgb {
  return {
    r: from.r + (to.r - from.r) * ratio,
    g: from.g + (to.g - from.g) * ratio,
    b: from.b + (to.b - from.b) * ratio,
  };
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
