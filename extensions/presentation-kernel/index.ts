import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export type PresentationTone =
  | "branch"
  | "muted"
  | "dim"
  | "warning"
  | "success"
  | "error"
  | "accent"
  | "title"
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
}

export type SemanticText = readonly Readonly<{
  text: string;
  tone: PresentationTone;
}>[];

export interface SemanticCallPresentation {
  readonly surface: "call";
  readonly title: string;
  readonly subject?: SemanticText;
  readonly status: "pending" | "success" | "error" | "idle";
  readonly activity?: Readonly<
    | { kind: "blink"; visible: boolean }
    | { kind: "breathe"; frame: number; active?: boolean }
  >;
}

export interface SemanticResultPresentation {
  readonly surface: "result";
  readonly summary: Readonly<{
    count: number;
    unit: string | Readonly<{ one: string; other: string }>;
    label: string;
    expandable: boolean;
  }>;
  readonly detail?: Readonly<{
    rows: readonly SemanticText[];
    totalRows: number;
  }>;
}

export type SemanticPresentation =
  SemanticCallPresentation | SemanticResultPresentation;

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
  readonly behavior: "toggle" | "next-detail";
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
    if (tone === "branch") {
      return palette.branch
        ? `${palette.branch}${text}${view.theme.control.branchReset}`
        : text;
    }
    const foreground =
      tone === "dim"
        ? palette.semanticDim
        : tone === "status-success"
          ? palette.statusSuccess
          : tone === "status-error"
            ? palette.statusError
            : tone === "status-pending" || tone === "status-idle"
              ? palette.statusPending
              : palette[tone];
    const bold =
      tone === "title" ||
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
    paint("title", presentation.title),
    presentation.subject ? " " : "",
  ].join("");
  const subject =
    presentation.subject
      ?.map((segment) => paint(segment.tone, segment.text))
      .join("") ?? "";
  const horizontalPadding = " ".repeat(view.padding);
  const contentWidth = Math.max(1, view.width - view.padding * 2);
  const prefixWidth = visibleWidth(prefix);
  const bodies =
    !subject || prefixWidth >= contentWidth
      ? wrapTextWithAnsi(expandTabStops(`${prefix}${subject}`), contentWidth)
      : wrapTextWithAnsi(
          expandTabStops(subject),
          Math.max(1, contentWidth - prefixWidth),
        ).map(
          (subjectRow, index) =>
            `${index === 0 ? prefix : " ".repeat(prefixWidth)}${subjectRow}`,
        );
  return {
    rows: bodies.map((body) => ({
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
    })),
  };
}

function presentExpanded(
  presentation: SemanticResultPresentation,
  view: PresentationView,
  summaryText: string,
): PresentedFrame {
  const detail = presentation.detail!;
  const level = view.detail ?? 0;
  const limit = selectedPreviewLimit(view);
  const paint = makePaint(view);
  const visibleRows = detail.rows.slice(0, limit);
  const remaining = Math.max(0, detail.totalRows - visibleRows.length);
  const finalCollapse =
    view.clickActions && level > 0 && (level >= 2 || detail.totalRows <= limit);
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
    remaining > 0 || finalCollapse ? "├" : "└",
    paint("muted", summaryText),
    presentation.summary.expandable
      ? [
          {
            behavior: "toggle",
            origin: "result-summary",
            viewport: "top",
          },
        ]
      : [],
  );
  for (const semanticRow of visibleRows) {
    rows.push(
      ...makeRows(
        remaining > 0 || finalCollapse ? "│" : undefined,
        semanticRow
          .map((segment) => paint(segment.tone, segment.text))
          .join(""),
      ),
    );
  }
  if (remaining > 0 && !finalCollapse) {
    const showCap = level > 0;
    const indicatorText = [
      paint("muted", `… (${remaining} more lines`),
      paint("muted", " • "),
      paint("dim", "click"),
      paint("muted", " for more detail"),
      paint("muted", ")"),
    ].join("");
    rows.push(
      ...makeRows(showCap ? "│" : "└", indicatorText, [
        {
          behavior: "next-detail",
          origin: "result-detail",
          viewport: "top",
        },
      ]),
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

function present(
  presentation: SemanticPresentation,
  view: PresentationView,
): PresentedFrame {
  if (presentation.surface === "call") return presentCall(presentation, view);
  const { summary } = presentation;
  const unit =
    typeof summary.unit === "string"
      ? summary.count === 1
        ? summary.unit
        : `${summary.unit}s`
      : summary.count === 1
        ? summary.unit.one
        : summary.unit.other;
  const summaryText = `${summary.count} ${unit} ${summary.label}`;
  if (view.expansion === "expanded" && presentation.detail) {
    return presentExpanded(presentation, view, summaryText);
  }
  const paint = makePaint(view);
  const body = summary.expandable
    ? [
        paint("muted", summaryText),
        paint("muted", " • "),
        view.clickActions
          ? `${paint("dim", "click")}${paint("muted", " to expand")}`
          : view.theme.expandHint,
      ].join("")
    : paint("muted", summaryText);
  const contentWidth = Math.max(1, view.width - view.padding * 2);
  const bodyWidth = Math.max(1, contentWidth - 2);
  const horizontalPadding = " ".repeat(view.padding);
  const bodyRows = wrapTextWithAnsi(body, bodyWidth);

  return {
    rows: bodyRows.map((bodyRow, index) => {
      const prefix = index === 0 ? `${paint("branch", "└")} ` : "  ";
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
    }),
  };
}

export const presentationKernel: PresentationKernel = Object.freeze({
  present,
  resolvePalette,
  resetPalette,
});
