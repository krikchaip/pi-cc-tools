import {
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

export type PresentationTone =
  | "plain"
  | "branch"
  | "rule"
  | "muted"
  | "dim"
  | "warning"
  | "success"
  | "error"
  | "accent"
  | "title"
  | "message-label"
  | "message-text"
  | "status-success"
  | "status-error"
  | "status-pending"
  | "status-idle";

export interface PresentationThemeSnapshot {
  readonly palette: PresentationPaletteRequest;
  readonly control: Readonly<{
    foregroundReset: string;
    branchReset: string;
    bold: string;
    boldReset: string;
  }>;
  readonly expandHint: string;
  readonly collapseHint?: string;
  readonly extraDetailHint?: string;
}

export type SemanticText = readonly Readonly<{
  text: string;
  tone: PresentationTone;
}>[];

export type SemanticSummary = Readonly<
  | {
      count: number;
      unit: string | Readonly<{ one: string; other: string }>;
      label: string;
      expandable: boolean;
    }
  | {
      text: SemanticText;
      expandable: boolean;
    }
>;

export type SemanticDetailIcon = Readonly<
  { kind: "file"; path: string } | { kind: "directory" }
>;

export type SemanticDetailRow =
  | SemanticText
  | Readonly<{
      content: SemanticText;
      icon?: SemanticDetailIcon;
      tree?: Readonly<{
        depth: number;
        position: "middle" | "last";
        continuations?: readonly boolean[];
        tone?: "branch" | "rule";
        arm?: string;
      }>;
    }>;

export interface SemanticDetail {
  readonly rows: readonly SemanticDetailRow[];
  readonly totalRows: number;
  readonly pinnedRows?: number;
  readonly action?: "progressive" | "max" | "none";
}

const DIRECTORY_ICON = "\x1b[38;2;100;140;220m\ue5ff\x1b[0m";
const DEFAULT_FILE_ICON = "\x1b[38;2;80;80;80m\uf15b\x1b[0m";
const FILE_EXTENSION_ICONS: Readonly<Record<string, string>> = Object.freeze({
  ts: "\x1b[38;2;49;120;198m\ue628\x1b[0m",
  tsx: "\x1b[38;2;49;120;198m\ue7ba\x1b[0m",
  js: "\x1b[38;2;241;224;90m\ue74e\x1b[0m",
  jsx: "\x1b[38;2;97;218;251m\ue7ba\x1b[0m",
  py: "\x1b[38;2;55;118;171m\ue73c\x1b[0m",
  rs: "\x1b[38;2;222;165;132m\ue7a8\x1b[0m",
  go: "\x1b[38;2;0;173;216m\ue724\x1b[0m",
  java: "\x1b[38;2;204;62;68m\ue738\x1b[0m",
  rb: "\x1b[38;2;204;52;45m\ue739\x1b[0m",
  swift: "\x1b[38;2;255;172;77m\ue755\x1b[0m",
  c: "\x1b[38;2;85;154;211m\ue61e\x1b[0m",
  cpp: "\x1b[38;2;85;154;211m\ue61d\x1b[0m",
  html: "\x1b[38;2;228;77;38m\ue736\x1b[0m",
  css: "\x1b[38;2;66;165;245m\ue749\x1b[0m",
  scss: "\x1b[38;2;207;100;154m\ue749\x1b[0m",
  vue: "\x1b[38;2;65;184;131m\ue6a0\x1b[0m",
  svelte: "\x1b[38;2;255;62;0m\ue697\x1b[0m",
  json: "\x1b[38;2;241;224;90m\ue60b\x1b[0m",
  yaml: "\x1b[38;2;160;116;196m\ue6a8\x1b[0m",
  yml: "\x1b[38;2;160;116;196m\ue6a8\x1b[0m",
  toml: "\x1b[38;2;160;116;196m\ue6b2\x1b[0m",
  md: "\x1b[38;2;66;165;245m\ue73e\x1b[0m",
  sh: "\x1b[38;2;137;180;130m\ue795\x1b[0m",
  bash: "\x1b[38;2;137;180;130m\ue795\x1b[0m",
  zsh: "\x1b[38;2;137;180;130m\ue795\x1b[0m",
  lua: "\x1b[38;2;81;160;207m\ue620\x1b[0m",
  php: "\x1b[38;2;137;147;186m\ue73d\x1b[0m",
  sql: "\x1b[38;2;218;218;218m\ue706\x1b[0m",
  xml: "\x1b[38;2;228;77;38m\ue619\x1b[0m",
  graphql: "\x1b[38;2;224;51;144m\ue662\x1b[0m",
  dockerfile: "\x1b[38;2;56;152;236m\ue7b0\x1b[0m",
  lock: "\x1b[38;2;130;130;130m\uf023\x1b[0m",
  png: "\x1b[38;2;160;116;196m\uf1c5\x1b[0m",
  jpg: "\x1b[38;2;160;116;196m\uf1c5\x1b[0m",
  svg: "\x1b[38;2;255;180;50m\uf1c5\x1b[0m",
  gif: "\x1b[38;2;160;116;196m\uf1c5\x1b[0m",
});
const FILE_NAME_ICONS: Readonly<Record<string, string>> = Object.freeze({
  "package.json": "\x1b[38;2;137;180;130m\ue71e\x1b[0m",
  "tsconfig.json": "\x1b[38;2;49;120;198m\ue628\x1b[0m",
  ".gitignore": "\x1b[38;2;222;165;132m\ue702\x1b[0m",
  dockerfile: "\x1b[38;2;56;152;236m\ue7b0\x1b[0m",
  makefile: "\x1b[38;2;130;130;130m\ue615\x1b[0m",
  "readme.md": "\x1b[38;2;66;165;245m\ue73e\x1b[0m",
  license: "\x1b[38;2;218;218;218m\ue60a\x1b[0m",
});

function detailIcon(icon: SemanticDetailIcon): string {
  if (icon.kind === "directory") return `${DIRECTORY_ICON} `;
  const base = icon.path.split("/").at(-1)?.toLowerCase() ?? "";
  const named = FILE_NAME_ICONS[base];
  if (named) return `${named} `;
  const extension = base.includes(".") ? (base.split(".").at(-1) ?? "") : "";
  return `${FILE_EXTENSION_ICONS[extension] ?? DEFAULT_FILE_ICON} `;
}

export interface SemanticCallPresentation {
  readonly surface: "call";
  readonly title: string;
  readonly titleTone?: "title" | "message-label";
  readonly subject?: SemanticText;
  readonly subjectOverflow?: "truncate-end";
  readonly status: "pending" | "success" | "error" | "idle";
  readonly activity?: Readonly<
    | { kind: "blink"; visible: boolean }
    | { kind: "breathe"; frame: number; active?: boolean }
  >;
  readonly detail?: SemanticDetail;
  readonly collapsedDetailPreview?: "head" | "tail";
}

export interface SemanticResultPresentation {
  readonly surface: "result";
  readonly outcome?: "success" | "error" | "neutral";
  readonly layout?: "branch" | "indent";
  readonly summary: SemanticSummary;
  readonly expandedSummary?: SemanticSummary;
  readonly detail?: SemanticDetail;
  readonly collapsedDetailPreview?: "head" | "tail";
  readonly attachment?: Readonly<{ kind: "image" }>;
}

export interface SemanticStreamPresentation {
  readonly surface: "stream";
  readonly detail: SemanticDetail;
  readonly selection?: "head" | "tail";
}

export type SemanticPresentation =
  | SemanticCallPresentation
  | SemanticResultPresentation
  | SemanticStreamPresentation;

export interface PresentationView {
  readonly width: number;
  readonly padding: 0 | 1;
  readonly expansion: "collapsed" | "expanded";
  readonly detail?: 0 | 1 | 2;
  readonly preview?: Readonly<{
    normal?: unknown;
    expanded?: unknown;
    extra?: unknown;
  }>;
  readonly clickActions: boolean;
  readonly theme: PresentationThemeSnapshot;
}

export interface PresentedAction {
  readonly behavior: "toggle" | "next-detail" | "max-detail";
  readonly origin: "execution-header" | "result-summary" | "result-detail";
  readonly viewport: "top" | "bottom";
  readonly span: Readonly<{ start: number; end: number }>;
}

export interface PresentedRow {
  readonly text: string;
  readonly actions: readonly PresentedAction[];
}

export interface PresentedFrame {
  readonly rows: readonly PresentedRow[];
}

export interface PresentationPaletteColors {
  readonly branch: string;
  readonly muted: string;
  readonly dim: string;
  readonly semanticDim: string;
  readonly warning: string;
  readonly success: string;
  readonly error: string;
  readonly accent: string;
  readonly title: string;
  readonly messageLabel: string;
  readonly messageText: string;
  readonly rule: string;
  readonly statusSuccess: string;
  readonly statusError: string;
  readonly statusPending: string;
}

export interface PresentationPaletteRequest {
  readonly cache: Readonly<{
    identity: unknown;
    name: string;
    fingerprint: string;
  }>;
  readonly adaptive: boolean;
  readonly defaults: PresentationPaletteColors;
  readonly adaptiveColors: PresentationPaletteColors;
  readonly overrides: Readonly<{ dim?: string; rule?: string }>;
}

export interface PresentationPaletteResolution {
  readonly colors: PresentationPaletteColors;
  readonly changed: boolean;
}

export interface PresentationKernel {
  present(
    presentation: SemanticPresentation,
    view: PresentationView,
  ): PresentedFrame;
  resolvePalette(
    request: PresentationPaletteRequest,
  ): PresentationPaletteResolution;
  resetPalette(): void;
}

type PaletteCacheEntry = Readonly<{
  identity: unknown;
  key: string;
  colors: PresentationPaletteColors;
}>;

let paletteCache: PaletteCacheEntry | undefined;
let paletteSignature: string | undefined;

function paletteRequestKey(request: PresentationPaletteRequest): string {
  const { defaults, adaptiveColors, overrides } = request;
  return [
    request.cache.name,
    request.cache.fingerprint,
    request.adaptive ? "adaptive" : "fixed",
    defaults.branch,
    defaults.muted,
    defaults.dim,
    defaults.semanticDim,
    defaults.warning,
    defaults.success,
    defaults.error,
    defaults.accent,
    defaults.title,
    defaults.messageLabel,
    defaults.messageText,
    defaults.rule,
    defaults.statusSuccess,
    defaults.statusError,
    defaults.statusPending,
    adaptiveColors.branch,
    adaptiveColors.muted,
    adaptiveColors.dim,
    adaptiveColors.semanticDim,
    adaptiveColors.warning,
    adaptiveColors.success,
    adaptiveColors.error,
    adaptiveColors.accent,
    adaptiveColors.title,
    adaptiveColors.messageLabel,
    adaptiveColors.messageText,
    adaptiveColors.rule,
    adaptiveColors.statusSuccess,
    adaptiveColors.statusError,
    adaptiveColors.statusPending,
    overrides.dim ?? "",
    overrides.rule ?? "",
  ].join("\u001f");
}

function resolvePalette(
  request: PresentationPaletteRequest,
): PresentationPaletteResolution {
  const key = paletteRequestKey(request);
  const cached = paletteCache;
  if (
    cached !== undefined &&
    cached.identity === request.cache.identity &&
    cached.key === key
  ) {
    return { colors: cached.colors, changed: false };
  }
  const base = request.adaptive ? request.adaptiveColors : request.defaults;
  const colors: PresentationPaletteColors = Object.freeze({
    branch: base.branch,
    muted: base.muted,
    dim: request.overrides.dim ?? base.dim,
    semanticDim: base.semanticDim,
    warning: base.warning,
    success: base.success,
    error: base.error,
    accent: base.accent,
    title: base.title,
    messageLabel: base.messageLabel,
    messageText: base.messageText,
    rule: request.overrides.rule ?? base.rule,
    statusSuccess: base.statusSuccess,
    statusError: base.statusError,
    statusPending: base.statusPending,
  });
  const signature = Object.values(colors).join("\u001f");
  const changed = signature !== paletteSignature;
  paletteSignature = signature;
  paletteCache = { identity: request.cache.identity, key, colors };
  return { colors, changed };
}

function resetPalette(): void {
  paletteCache = undefined;
  paletteSignature = undefined;
}

function makePaint(
  view: PresentationView,
): (tone: PresentationTone, text: string) => string {
  const palette = resolvePalette(view.theme.palette).colors;
  return (tone, text) => {
    if (!text) return text;
    if (tone === "plain") return text;
    if (tone === "branch") {
      return palette.branch
        ? `${palette.branch}${text}${view.theme.control.branchReset}`
        : text;
    }
    const foreground =
      tone === "dim"
        ? palette.semanticDim
        : tone === "message-label"
          ? palette.messageLabel
          : tone === "message-text"
            ? palette.messageText
            : tone === "status-success"
              ? palette.statusSuccess
              : tone === "status-error"
                ? palette.statusError
                : tone === "status-pending" || tone === "status-idle"
                  ? palette.statusPending
                  : palette[tone];
    const bold =
      tone === "title" ||
      tone === "message-label" ||
      tone === "status-error" ||
      ((tone === "status-success" ||
        tone === "status-pending" ||
        tone === "status-idle") &&
        text === "●");
    const boldOpen = bold ? view.theme.control.bold : "";
    const boldClose = bold && boldOpen ? view.theme.control.boldReset : "";
    const foregroundClose = foreground
      ? view.theme.control.foregroundReset
      : "";
    return `${foreground}${boldOpen}${text}${boldClose}${foregroundClose}`;
  };
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function selectedPreviewLimit(view: PresentationView): number {
  const level = view.detail ?? 0;
  if (level === 0) return positiveInteger(view.preview?.normal, 8);
  if (level === 1) return positiveInteger(view.preview?.expanded, 4000);
  return positiveInteger(view.preview?.extra, 12000);
}

function expandTabStops(text: string, tabWidth = 4): string {
  const segments = text.split("\t");
  if (segments.length === 1) return text;
  let expanded = segments[0];
  for (const segment of segments.slice(1)) {
    const column = visibleWidth(expanded);
    expanded += `${" ".repeat(tabWidth - (column % tabWidth))}${segment}`;
  }
  return expanded;
}

function presentCall(
  presentation: SemanticCallPresentation,
  view: PresentationView,
): PresentedFrame {
  const paint = makePaint(view);
  const pendingGlyphs = ["●", "•", "·", " ", "·", "•"] as const;
  const glyph =
    presentation.status !== "pending" || !presentation.activity
      ? "●"
      : presentation.activity.kind === "blink"
        ? presentation.activity.visible
          ? "●"
          : " "
        : presentation.activity.active === false
          ? " "
          : pendingGlyphs[
              Math.abs(Math.floor(presentation.activity.frame)) %
                pendingGlyphs.length
            ];
  const statusTone =
    presentation.status === "pending" && glyph !== " "
      ? "status-success"
      : (`status-${presentation.status}` as const);
  const paintedGlyph = glyph === " " ? glyph : paint(statusTone, glyph);
  const prefix = [
    paintedGlyph,
    " ",
    paint(presentation.titleTone ?? "title", presentation.title),
    presentation.subject ? " " : "",
  ].join("");
  const subject =
    presentation.subject
      ?.map((segment) => paint(segment.tone, segment.text))
      .join("") ?? "";
  const horizontalPadding = " ".repeat(view.padding);
  const contentWidth = Math.max(1, view.width - view.padding * 2);
  const prefixWidth = visibleWidth(prefix);
  const fullHeader = expandTabStops(`${prefix}${subject}`);
  const bodies =
    presentation.subjectOverflow === "truncate-end"
      ? [truncateToWidth(fullHeader, contentWidth, "…", false)]
      : !subject || prefixWidth >= contentWidth
        ? wrapTextWithAnsi(fullHeader, contentWidth)
        : wrapTextWithAnsi(
            expandTabStops(subject),
            Math.max(1, contentWidth - prefixWidth),
          ).map(
            (subjectRow, index) =>
              `${index === 0 ? prefix : " ".repeat(prefixWidth)}${subjectRow}`,
          );
  const rows: PresentedRow[] = bodies.map((body) => ({
    text: `${horizontalPadding}${body}${" ".repeat(Math.max(0, contentWidth - visibleWidth(body)))}${horizontalPadding}`,
    actions: [
      {
        behavior: "toggle",
        origin: "execution-header",
        viewport: "top",
        span: {
          start: view.padding,
          end: view.padding + visibleWidth(body),
        },
      },
    ],
  }));
  const detail = presentation.detail;
  const collapsedSelection =
    view.expansion === "collapsed"
      ? presentation.collapsedDetailPreview
      : undefined;
  if (detail && (view.expansion === "expanded" || collapsedSelection)) {
    let semanticRows = [...detail.rows];
    if (collapsedSelection) {
      const configured = view.preview?.normal;
      const limit =
        typeof configured === "number" &&
        Number.isFinite(configured) &&
        configured >= 0
          ? Math.floor(configured)
          : 8;
      const omitted = Math.max(0, detail.totalRows - limit);
      const visibleLimit = omitted > 0 ? Math.max(0, limit - 1) : limit;
      semanticRows =
        limit === 0
          ? []
          : collapsedSelection === "tail"
            ? detail.rows.slice(-visibleLimit)
            : detail.rows.slice(0, visibleLimit);
      if (limit > 0 && omitted > 0) {
        const marker: SemanticDetailRow = [
          {
            text: `... ${omitted + 1} ${collapsedSelection === "tail" ? "earlier" : "more"} lines`,
            tone: "muted",
          },
        ];
        semanticRows =
          collapsedSelection === "tail"
            ? [marker, ...semanticRows]
            : [...semanticRows, marker];
      }
    }
    semanticRows.forEach((semanticRow, rowIndex) => {
      const body = paintSemanticText(detailRowContent(semanticRow), paint);
      const bodyRows = wrapTextWithAnsi(
        expandTabStops(body),
        Math.max(1, contentWidth - 2),
      );
      bodyRows.forEach((bodyRow, partIndex) => {
        const connector = rowIndex === 0 && partIndex === 0 ? "├" : "│";
        const content = `${paint("branch", connector)} ${bodyRow}`;
        rows.push({
          text: `${horizontalPadding}${content}${" ".repeat(Math.max(0, contentWidth - visibleWidth(content)))}${horizontalPadding}`,
          actions: [
            {
              behavior: "toggle",
              origin: "execution-header",
              viewport: "top",
              span: {
                start: view.padding + 2,
                end: view.padding + 2 + visibleWidth(bodyRow),
              },
            },
          ],
        });
      });
    });
  }
  return { rows };
}

function detailRowContent(row: SemanticDetailRow): SemanticText {
  if (!("content" in row)) return row;
  const content: SemanticText = [
    ...(row.icon
      ? [{ text: detailIcon(row.icon), tone: "plain" as const }]
      : []),
    ...row.content,
  ];
  if (!row.tree) return content;
  const continuations = row.tree.continuations ?? [];
  const ancestorGuides = Array.from({ length: row.tree.depth }, (_, depth) =>
    continuations[depth] ? "│ " : "  ",
  ).join("");
  return [
    {
      text: `${ancestorGuides}${row.tree.position === "last" ? "└" : "├"}${row.tree.arm ?? ""}`,
      tone: row.tree.tone ?? "branch",
    },
    { text: " ", tone: "plain" },
    ...content,
  ];
}

function summaryText(summary: SemanticSummary): SemanticText {
  if ("text" in summary) return summary.text;
  const unit =
    typeof summary.unit === "string"
      ? summary.count === 1
        ? summary.unit
        : `${summary.unit}s`
      : summary.count === 1
        ? summary.unit.one
        : summary.unit.other;
  return [
    {
      text: `${summary.count} ${unit}${summary.label ? ` ${summary.label}` : ""}`,
      tone: "muted",
    },
  ];
}

function paintSemanticText(
  text: SemanticText,
  paint: (tone: PresentationTone, text: string) => string,
): string {
  return text.map((segment) => paint(segment.tone, segment.text)).join("");
}

function presentExpanded(
  presentation: SemanticResultPresentation,
  view: PresentationView,
  paintedSummary: string,
): PresentedFrame {
  const detail = presentation.detail!;
  const level = view.detail ?? 0;
  const pinnedCount = Math.min(
    detail.rows.length,
    positiveInteger(detail.pinnedRows, 0),
  );
  const pinnedRows = detail.rows.slice(0, pinnedCount);
  const pageableRows = detail.rows.slice(pinnedCount);
  const pageableTotal = Math.max(0, detail.totalRows - pinnedCount);
  const limit =
    detail.action === "none" ? pageableRows.length : selectedPreviewLimit(view);
  const paint = makePaint(view);
  const visibleRows = [...pinnedRows, ...pageableRows.slice(0, limit)];
  const remaining = Math.max(
    0,
    pageableTotal - Math.min(pageableRows.length, limit),
  );
  const progressiveDetail = detail.action !== "max" && detail.action !== "none";
  const finalCollapse =
    progressiveDetail &&
    view.clickActions &&
    level > 0 &&
    (level >= 2 || pageableTotal <= limit);
  const horizontalPadding = " ".repeat(view.padding);
  const contentWidth = Math.max(1, view.width - view.padding * 2);
  type WrappedAction = Omit<PresentedAction, "span"> &
    Readonly<{
      clickRowOnly?: boolean;
    }>;
  const makeRows = (
    connector: "├" | "│" | "└" | undefined,
    body: string,
    actions: readonly WrappedAction[] = [],
  ): PresentedRow[] => {
    if (presentation.layout === "indent") connector = undefined;
    const expandedBody = expandTabStops(body);
    const leading = /^((?:\x1b\[[0-9;]*m)*)([ \t]+)/.exec(expandedBody);
    const bodyIndent = leading?.[2] ?? "";
    const indentWidth = visibleWidth(bodyIndent);
    const unindentedBody = leading
      ? `${leading[1]}${expandedBody.slice(leading[0].length)}`
      : expandedBody;
    const bodyRows = wrapTextWithAnsi(
      unindentedBody,
      Math.max(1, contentWidth - 2 - indentWidth),
    ).map((bodyRow) => {
      if (!bodyIndent) return bodyRow;
      const leadingAnsi = /^(?:\x1b\[[0-9;]*m)*/.exec(bodyRow)?.[0] ?? "";
      return `${leadingAnsi}${bodyIndent}${bodyRow.slice(leadingAnsi.length)}`;
    });
    return bodyRows.map((bodyRow, index) => {
      const rowConnector =
        index === 0
          ? connector
          : connector === "├" || connector === "│"
            ? "│"
            : undefined;
      const prefix = rowConnector ? `${paint("branch", rowConnector)} ` : "  ";
      const content = `${prefix}${bodyRow}`;
      return {
        text: `${horizontalPadding}${content}${" ".repeat(Math.max(0, contentWidth - visibleWidth(content)))}${horizontalPadding}`,
        actions: actions.flatMap(({ clickRowOnly, ...action }) => {
          if (clickRowOnly && !bodyRow.includes("click")) return [];
          return [
            {
              ...action,
              viewport:
                clickRowOnly && bodyRows.length > 1 ? "top" : action.viewport,
              span: {
                start: view.padding + 2,
                end: view.padding + 2 + visibleWidth(bodyRow),
              },
            },
          ];
        }),
      };
    });
  };
  const rows: PresentedRow[] = makeRows(
    presentation.layout === "branch"
      ? visibleRows.length > 0 || remaining > 0 || finalCollapse
        ? "├"
        : "└"
      : remaining > 0 || finalCollapse
        ? "├"
        : "└",
    paintedSummary,
    (presentation.expandedSummary ?? presentation.summary).expandable
      ? [
          {
            behavior: "toggle",
            origin: "result-summary",
            viewport: "top",
          },
        ]
      : [],
  );
  visibleRows.forEach((semanticRow, index) => {
    const isLastVisibleRow = index === visibleRows.length - 1;
    const connector =
      presentation.layout === "branch"
        ? remaining > 0 || finalCollapse || !isLastVisibleRow
          ? "│"
          : "└"
        : remaining > 0 || finalCollapse
          ? "│"
          : undefined;
    rows.push(
      ...makeRows(
        connector,
        paintSemanticText(detailRowContent(semanticRow), paint),
      ),
    );
  });
  if (remaining > 0 && !finalCollapse) {
    const showCap = progressiveDetail && view.clickActions && level > 0;
    const indicatorText = view.clickActions
      ? [
          paint("muted", `… (${remaining} more lines`),
          paint("muted", " • "),
          paint("dim", "click"),
          paint("muted", " for more detail"),
          paint("muted", ")"),
        ].join("")
      : [
          paint("muted", `… (${remaining} more lines`),
          paint("muted", " • "),
          view.theme.collapseHint ?? "ctrl+o to collapse",
          paint("muted", " • "),
          view.theme.extraDetailHint ?? "ctrl+shift+o more detail",
          paint("muted", ")"),
        ].join("");
    rows.push(
      ...makeRows(
        showCap ? "│" : "└",
        indicatorText,
        view.clickActions
          ? [
              {
                behavior:
                  detail.action === "max" ? "max-detail" : "next-detail",
                origin: "result-detail",
                viewport: "top",
              },
            ]
          : [],
      ),
    );
    if (showCap) {
      const capText = [
        paint("warning", `(display capped at ${limit} lines`),
        paint("muted", " • "),
        paint("dim", "click"),
        paint("muted", " for more detail"),
        paint("warning", ")"),
      ].join("");
      rows.push(
        ...makeRows("└", capText, [
          {
            behavior: "next-detail",
            origin: "result-detail",
            viewport: "top",
          },
        ]),
      );
    }
  } else if (finalCollapse) {
    if (remaining > 0) {
      rows.push(
        ...makeRows("│", paint("muted", `… (${remaining} more lines)`)),
      );
    }
    const collapseText = [
      paint("muted", "Output ends here • "),
      paint("dim", "click"),
      paint("muted", " to collapse"),
    ].join("");
    rows.push(
      ...makeRows("└", collapseText, [
        {
          behavior: "toggle",
          origin: "result-summary",
          viewport: "bottom",
          clickRowOnly: true,
        },
      ]),
    );
  }
  return { rows };
}

function presentStream(
  presentation: SemanticStreamPresentation,
  view: PresentationView,
): PresentedFrame {
  const paint = makePaint(view);
  const sourceRows =
    view.expansion === "expanded"
      ? presentation.detail.rows
      : presentation.detail.rows.filter((row) =>
          detailRowContent(row).some(
            (segment) => segment.text.trim().length > 0,
          ),
        );
  const totalRows =
    view.expansion === "expanded"
      ? presentation.detail.totalRows
      : sourceRows.length;
  const limit =
    view.expansion === "expanded"
      ? sourceRows.length
      : positiveInteger(view.preview?.normal, 5);
  const omitted = Math.max(0, totalRows - limit);
  const visibleRows =
    presentation.selection === "tail" && omitted > 0
      ? sourceRows.slice(-limit)
      : sourceRows.slice(0, limit);
  const omissionRow: SemanticText = [
    {
      text: `… (${omitted} ${presentation.selection === "tail" ? "earlier" : "more"} lines`,
      tone: "muted",
    },
    { text: " • ", tone: "muted" },
    ...(view.clickActions
      ? [
          { text: "click", tone: "dim" as const },
          { text: " to expand", tone: "muted" as const },
        ]
      : [{ text: view.theme.expandHint, tone: "plain" as const }]),
    { text: ")", tone: "muted" },
  ];
  const semanticRows: SemanticText[] = [
    ...(omitted > 0 ? [omissionRow] : []),
    ...visibleRows.map(detailRowContent),
  ];
  const horizontalPadding = " ".repeat(view.padding);
  const contentWidth = Math.max(1, view.width - view.padding * 2);
  const rows: PresentedRow[] = [];
  semanticRows.forEach((row, rowIndex) => {
    const body = paintSemanticText(row, paint);
    const wrapped = wrapTextWithAnsi(body, Math.max(1, contentWidth - 2));
    wrapped.forEach((part, partIndex) => {
      const final = rowIndex === semanticRows.length - 1;
      const connector =
        partIndex === 0 ? (final ? "└" : "│") : final ? undefined : "│";
      const prefix = connector ? `${paint("branch", connector)} ` : "  ";
      const content = `${prefix}${part}`;
      const omissionAction = omitted > 0 && rowIndex === 0 && view.clickActions;
      rows.push({
        text: `${horizontalPadding}${content}${" ".repeat(Math.max(0, contentWidth - visibleWidth(content)))}${horizontalPadding}`,
        actions: omissionAction
          ? [
              {
                behavior: "toggle",
                origin: "result-detail",
                viewport: "top",
                span: {
                  start: view.padding + 2,
                  end: view.padding + visibleWidth(content),
                },
              },
            ]
          : [],
      });
    });
  });
  return { rows };
}

function presentCollapsedResultDetail(
  presentation: SemanticResultPresentation,
  view: PresentationView,
  paint: (tone: PresentationTone, text: string) => string,
): PresentedRow[] {
  const selection = presentation.collapsedDetailPreview;
  const detail = presentation.detail;
  if (!selection || !detail) return [];
  const limit = positiveInteger(view.preview?.normal, 8);
  const selectedRows =
    selection === "tail"
      ? detail.rows.slice(-limit)
      : detail.rows.slice(0, limit);
  const omitted = Math.max(0, detail.totalRows - selectedRows.length);
  const marker: SemanticText = [
    {
      text: `… (${omitted} ${selection === "tail" ? "earlier" : "more"} lines)`,
      tone: "muted",
    },
  ];
  const semanticRows = [
    ...(selection === "tail" && omitted > 0 ? [marker] : []),
    ...selectedRows.map(detailRowContent),
    ...(selection === "head" && omitted > 0 ? [marker] : []),
  ];
  const contentWidth = Math.max(1, view.width - view.padding * 2);
  const horizontalPadding = " ".repeat(view.padding);
  return semanticRows.flatMap((semanticRow) => {
    const body = paintSemanticText(semanticRow, paint);
    return wrapTextWithAnsi(
      expandTabStops(body),
      Math.max(1, contentWidth - 2),
    ).map((bodyRow) => {
      const content = `  ${bodyRow}`;
      return {
        text: `${horizontalPadding}${content}${" ".repeat(Math.max(0, contentWidth - visibleWidth(content)))}${horizontalPadding}`,
        actions: [],
      };
    });
  });
}

function present(
  presentation: SemanticPresentation,
  view: PresentationView,
): PresentedFrame {
  if (presentation.surface === "call") return presentCall(presentation, view);
  if (presentation.surface === "stream")
    return presentStream(presentation, view);
  const summary =
    view.expansion === "expanded" && presentation.expandedSummary
      ? presentation.expandedSummary
      : presentation.summary;
  const paint = makePaint(view);
  const paintedSummary = paintSemanticText(summaryText(summary), paint);
  if (view.expansion === "expanded" && presentation.detail) {
    return presentExpanded(presentation, view, paintedSummary);
  }
  const attachmentExpanded =
    view.expansion === "expanded" && presentation.attachment?.kind === "image";
  const body = summary.expandable
    ? [
        paintedSummary,
        paint("muted", " • "),
        view.clickActions
          ? `${paint("dim", "click")}${paint("muted", attachmentExpanded ? " to collapse" : " to expand")}`
          : attachmentExpanded
            ? (view.theme.collapseHint ?? "ctrl+o to collapse")
            : view.theme.expandHint,
      ].join("")
    : paintedSummary;
  const contentWidth = Math.max(1, view.width - view.padding * 2);
  const bodyWidth = Math.max(1, contentWidth - 2);
  const horizontalPadding = " ".repeat(view.padding);
  const bodyRows = wrapTextWithAnsi(body, bodyWidth);

  const rows: PresentedRow[] = bodyRows.map((bodyRow, index) => {
    const prefix =
      index === 0 && presentation.layout !== "indent"
        ? `${paint("branch", "└")} `
        : "  ";
    const content = `${prefix}${bodyRow}`;
    const text = `${horizontalPadding}${content}${" ".repeat(Math.max(0, contentWidth - visibleWidth(content)))}${horizontalPadding}`;
    return {
      text,
      actions: summary.expandable
        ? [
            {
              behavior: "toggle" as const,
              origin: "result-summary" as const,
              viewport: "top" as const,
              span: {
                start: view.padding + 2,
                end: view.padding + 2 + visibleWidth(bodyRow),
              },
            },
          ]
        : [],
    };
  });
  if (view.expansion === "collapsed") {
    rows.push(...presentCollapsedResultDetail(presentation, view, paint));
  }
  return { rows };
}

export const presentationKernel: PresentationKernel = Object.freeze({
  present,
  resolvePalette,
  resetPalette,
});
