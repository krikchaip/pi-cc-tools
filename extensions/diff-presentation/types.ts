export type DiffDetailLevel = 0 | 1 | 2;

export interface DiffPresentationSettings {
    readonly diffCollapsedLines?: number;
    readonly expandedPreviewMaxLines?: number;
    readonly extraExpandedPreviewMaxLines?: number;
    readonly diffTheme?: string;
    readonly diffColors?: Readonly<Record<string, string>>;
    readonly themeAdaptive?: boolean;
}

export interface EditOperation {
    readonly oldText: string;
    readonly newText: string;
}

export type DiffSource =
    | Readonly<{ kind: "write"; path: string; before: string | null; after: string }>
    | Readonly<{ kind: "edit"; path: string; edits: readonly EditOperation[]; cwd: string }>
    | Readonly<{ kind: "apply-patch"; patchText: string; cwd: string }>;

export interface DiffTheme {
    readonly name?: string;
    fg(color: string, text: string): string;
    getFgAnsi?(color: string): string;
    getBgAnsi?(color: string): string;
}

export interface DiffView {
    /** Width available to the diff itself, after host branch chrome. */
    readonly width: number;
    readonly expanded: boolean;
    readonly localDetail: DiffDetailLevel;
    readonly localClickControls: boolean;
    readonly theme: DiffTheme;
}

export interface DiffRenderSettlement {
    begin(): { complete(): void };
}

export type DiffPresentationSurface =
    | "write-result"
    | "edit-call"
    | "edit-result"
    | "apply-call"
    | "apply-result";

export interface DiffPresentationRequest {
    readonly owner: object;
    readonly surface: DiffPresentationSurface;
    readonly source?: DiffSource;
    readonly evidence?: unknown;
    /** False while the host is still assembling source input. Defaults to true. */
    readonly sourceComplete?: boolean;
    readonly view: DiffView;
    readonly settlement: DiffRenderSettlement;
}

export interface DiffPresentationSnapshot {
    readonly headerSummary?: string;
    readonly body: string;
    readonly affectedPaths: readonly string[];
    readonly suppressCompanionResult: boolean;
    readonly pending: boolean;
    /** Resolves after the current presentation attempt. It never rejects. */
    readonly settled: Promise<void>;
}

export interface DiffOutputTreeBlock {
    readonly heading?: string;
    readonly content: string;
}

export interface DiffPresentationChrome {
    markResultSummary(text: string): string;
    branch(content: string, view: DiffView, options: Readonly<{ final: boolean; continued?: boolean }>): string;
    tree(
        summary: string,
        blocks: readonly DiffOutputTreeBlock[],
        terminalAction: string | undefined,
        view: DiffView,
    ): string;
    detailHint(view: DiffView, hasMore: boolean): string;
    collapseHint(view: DiffView): string;
}

export interface DiffPresentationDependencies {
    readonly readSettings: () => DiffPresentationSettings;
    readonly chrome?: DiffPresentationChrome;
    readonly displayPath?: (cwd: string, path: string) => string;
    readonly moveArrow?: (view: DiffView) => string;
    readonly readFile?: (path: string) => Promise<string>;
    readonly readFileSync?: (path: string) => string;
    /** Supplies the host's generic light/dark classification policy. */
    readonly isLightTheme: (theme: DiffTheme) => boolean;
    /** Supplies the host's resolved outline/rule ANSI so diff rules match tool chrome. */
    readonly resolveRuleAnsi?: (theme: DiffTheme) => string | undefined;
}

/** Opaque, versioned, immutable, JSON-serializable data. Only this module interprets payload. */
declare const DIFF_EVIDENCE: unique symbol;
export type DiffEvidence = Readonly<{
    readonly version: 1;
    readonly payload: unknown;
    readonly [DIFF_EVIDENCE]: true;
}>;

export interface DiffSharedForegrounds {
    readonly dim?: string;
    readonly rule?: string;
}

/** Preserves legacy host surfaces that intentionally share configured diff foregrounds. */
export interface DiffPresentationCompatibility {
    configuredForegrounds(): DiffSharedForegrounds;
}

export interface DiffPresentationModule {
    readonly compatibility: DiffPresentationCompatibility;
    capture(source: DiffSource): Promise<DiffEvidence | undefined>;
    present(request: DiffPresentationRequest): DiffPresentationSnapshot;
    isPending(owner: object): boolean;
    reset(): void;
}
