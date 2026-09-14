const COMPONENT_PARENT = Symbol.for("pi-claude-style-tools:component-parent");
const CLICK_RUNTIME_KEY = Symbol.for("pi-claude-style-tools:click-runtime");
const TOOL_COLLAPSE_PENDING_VIEWPORT = Symbol.for("pi-claude-style-tools:tool-collapse-pending-viewport");

export type ToolGroupScrollView = {
    readonly scrollTop: number;
    readonly isFollowingEnd: boolean;
    readonly viewportHeight?: number;
    scrollTo(scrollTop: number, options?: { disableFollow?: boolean }): void;
};

export type ToolGroupLayoutBox = {
    component: unknown;
    rect: { x: number; y: number; width: number; height: number };
    clip: { x: number; y: number; width: number; height: number };
    children: ToolGroupLayoutBox[];
    lines?: string[];
    lineOffset?: number;
    scrollView?: ToolGroupScrollView;
};

export type ToolGroupFullscreenRenderer = {
    currentLayout?: { root: ToolGroupLayoutBox; primaryScrollView?: ToolGroupScrollView };
    hasOverlay?: () => boolean;
    hasOverlayEntries?: boolean;
    handleViewportInput(data: string): unknown;
    requestRender(): void;
    renderNow?: () => void;
    doRender?: () => void;
    selectionAnchor?: unknown;
    selectionFocus?: unknown;
    selectionGranularity?: string;
    lastClick?: { row?: number; wordStart?: number; wordEnd?: number };
    selectionInitialRange?: unknown;
    selectionPressActive?: boolean;
    selectionDragged?: boolean;
    pressedUrl?: string;
    stopSelectionAutoScroll?: () => void;
};

export type ToolGroupInteractiveMode = {
    renderer: ToolGroupFullscreenRenderer;
    ui: Record<PropertyKey, unknown>;
    toolOutputExpanded?: boolean;
    documentContainer: { render(width: number): string[] };
    headerContainer: { render(width: number): string[] };
    loadedResourcesContainer: { render(width: number): string[] };
    chatContainer: { children: any[] };
    renderInitialMessages(): void;
    setToolsExpanded(expanded: boolean): void;
    switchTuiMode(mode: "regular" | "fullscreen", restoreProgress?: boolean, startRenderer?: boolean): boolean;
};

export type ToolCollapseViewportAnchor = "top" | "bottom" | "component-top";
export type RequestedToolCollapseViewportAnchor = ToolCollapseViewportAnchor | "adaptive";

type ToolCollapseViewportSnapshot = {
    renderer: ToolGroupFullscreenRenderer;
    mode: ToolGroupInteractiveMode;
    scrollView: ToolGroupScrollView;
    anchorComponent: { render(width: number): string[] };
    viewportAnchor: ToolCollapseViewportAnchor;
    componentTop?: number;
    scrollTop: number;
    contentHeight: number;
    contentWidth: number;
    wasFollowingEnd: boolean;
};

type PendingToolCollapseViewport = {
    snapshot: ToolCollapseViewportSnapshot;
    claimed: boolean;
    postCollapse?: {
        scrollTop: number;
        isFollowingEnd: boolean;
        componentHeight: number;
    };
};

export type ToolCollapseViewportSettlement = object;

export interface ToolCollapseViewportTransaction {
    complete(): void;
    rollback(): void;
}

type RetainedClickRuntime = {
    activeInteractiveMode?: ToolGroupInteractiveMode;
};

const PENDING_TOOL_COLLAPSE_VIEWPORTS = new Set<PendingToolCollapseViewport>();
const MIN_EXPANSION_VISIBLE_ROWS = 8;

function clickRuntime(): RetainedClickRuntime {
    return ((globalThis as any)[CLICK_RUNTIME_KEY] ??= {});
}

export function toolGroupBoxContains(
    box: ToolGroupLayoutBox["rect"],
    x: number,
    y: number,
): boolean {
    return x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height;
}

export function findToolGroupLayoutBox(
    box: ToolGroupLayoutBox,
    component: unknown,
): ToolGroupLayoutBox | undefined {
    if (box.component === component) return box;
    for (const child of box.children ?? []) {
        const match = findToolGroupLayoutBox(child, component);
        if (match) return match;
    }
    return undefined;
}

function isToolGroupScrollView(value: unknown): value is ToolGroupScrollView {
    const candidate = value as Partial<ToolGroupScrollView> | undefined;
    return Boolean(candidate)
        && Number.isFinite(candidate?.scrollTop)
        && typeof candidate?.isFollowingEnd === "boolean"
        && typeof candidate?.scrollTo === "function";
}

function chatComponentTop(
    mode: ToolGroupInteractiveMode,
    component: unknown,
    width: number,
): number | undefined {
    let top = mode.headerContainer.render(width).length
        + mode.loadedResourcesContainer.render(width).length;
    for (const child of mode.chatContainer.children) {
        if (child === component) return top;
        const rows = child?.render?.(width);
        if (!Array.isArray(rows)) return undefined;
        top += rows.length;
    }
    return undefined;
}

function resolveToolCollapseViewportAnchor(
    requested: RequestedToolCollapseViewportAnchor,
    componentTop: number | undefined,
    componentHeight: number,
    scrollView: ToolGroupScrollView,
): ToolCollapseViewportAnchor {
    if (requested !== "adaptive") return requested;
    const viewportHeight = scrollView.viewportHeight;
    if (
        componentTop === undefined
        || !Number.isFinite(viewportHeight)
        || viewportHeight! <= 0
    ) return "top";

    const viewportTop = scrollView.scrollTop;
    const viewportBottom = viewportTop + viewportHeight!;
    const componentBottom = componentTop + componentHeight;
    if (componentTop > viewportTop) return "top";
    if (componentBottom <= viewportBottom) return "bottom";
    return "component-top";
}

function captureToolCollapseViewport(
    tool: any,
    requestedViewportAnchor: RequestedToolCollapseViewportAnchor,
): ToolCollapseViewportSnapshot | undefined {
    const mode = clickRuntime().activeInteractiveMode;
    const renderer = mode?.renderer;
    const frame = renderer?.currentLayout;
    const scrollView = frame?.primaryScrollView;
    if (!mode || !renderer || !frame?.root || !isToolGroupScrollView(scrollView)) return undefined;
    try {
        const documentBox = findToolGroupLayoutBox(frame.root, mode.documentContainer);
        const contentWidth = documentBox?.rect?.width;
        const parent = tool?.[COMPONENT_PARENT];
        const anchorComponent = parent
            && typeof parent.render === "function"
            && typeof parent.forEachTool === "function"
            ? parent
            : tool;
        if (
            !documentBox
            || !Number.isFinite(contentWidth)
            || contentWidth! <= 0
            || typeof anchorComponent?.render !== "function"
        ) return undefined;
        const content = mode.documentContainer.render(contentWidth!);
        const componentRows = anchorComponent.render(contentWidth!);
        if (!Array.isArray(content) || !Array.isArray(componentRows)) return undefined;
        const componentTop = chatComponentTop(mode, anchorComponent, contentWidth!);
        const viewportAnchor = resolveToolCollapseViewportAnchor(
            requestedViewportAnchor,
            componentTop,
            componentRows.length,
            scrollView,
        );
        return {
            renderer,
            mode,
            scrollView,
            anchorComponent,
            viewportAnchor,
            componentTop,
            scrollTop: scrollView.scrollTop,
            contentHeight: content.length,
            contentWidth: contentWidth!,
            wasFollowingEnd: scrollView.isFollowingEnd,
        };
    } catch {
        return undefined;
    }
}

function growingTopViewportTarget(
    snapshot: ToolCollapseViewportSnapshot,
    baselineScrollTop: number,
    componentHeight: number,
): number {
    const componentTop = snapshot.componentTop;
    const viewportHeight = snapshot.scrollView.viewportHeight;
    if (
        componentTop === undefined
        || !Number.isFinite(viewportHeight)
        || viewportHeight! <= 0
    ) return baselineScrollTop;
    const wantedVisibleRows = Math.min(MIN_EXPANSION_VISIBLE_ROWS, componentHeight, viewportHeight!);
    return Math.max(baselineScrollTop, componentTop + wantedVisibleRows - viewportHeight!);
}

function collapseViewportTarget(snapshot: ToolCollapseViewportSnapshot): number | undefined {
    if (snapshot.viewportAnchor === "component-top") return snapshot.componentTop;
    const nextContent = snapshot.mode.documentContainer.render(snapshot.contentWidth);
    if (!Array.isArray(nextContent)) return undefined;
    if (snapshot.viewportAnchor === "top") {
        if (nextContent.length <= snapshot.contentHeight) return snapshot.scrollTop;
        const componentRows = snapshot.anchorComponent.render(snapshot.contentWidth);
        return Array.isArray(componentRows)
            ? growingTopViewportTarget(snapshot, snapshot.scrollTop, componentRows.length)
            : snapshot.scrollTop;
    }
    return Math.max(0, snapshot.scrollTop - (snapshot.contentHeight - nextContent.length));
}

function scrollToToolViewportTarget(
    snapshot: ToolCollapseViewportSnapshot,
    target: number,
    wasFollowingEnd: boolean,
): void {
    const preserveFollowingEnd = snapshot.viewportAnchor === "bottom" && wasFollowingEnd;
    snapshot.scrollView.scrollTo(target, { disableFollow: !preserveFollowingEnd });
    if (
        snapshot.viewportAnchor === "top"
        && wasFollowingEnd
        && snapshot.scrollView.scrollTop !== target
    ) snapshot.scrollView.scrollTo(target, { disableFollow: false });
}

function shiftPendingToolCollapseViewports(
    scrollView: ToolGroupScrollView,
    beforeScrollTop: number,
    beforeFollowingEnd: boolean,
): void {
    const scrollDelta = scrollView.scrollTop - beforeScrollTop;
    for (const pending of PENDING_TOOL_COLLAPSE_VIEWPORTS) {
        const baseline = pending.postCollapse;
        if (!baseline || pending.snapshot.scrollView !== scrollView) continue;
        baseline.scrollTop += scrollDelta;
        if (baseline.isFollowingEnd === beforeFollowingEnd) {
            baseline.isFollowingEnd = scrollView.isFollowingEnd;
        }
    }
}

function stabilizeToolCollapseViewport(snapshot: ToolCollapseViewportSnapshot): void {
    const beforeScrollTop = snapshot.scrollView.scrollTop;
    const beforeFollowingEnd = snapshot.scrollView.isFollowingEnd;
    try {
        const target = collapseViewportTarget(snapshot);
        if (target === undefined) return;
        scrollToToolViewportTarget(snapshot, target, snapshot.wasFollowingEnd);
        if (renderToolCollapseViewportNow(snapshot)) {
            scrollToToolViewportTarget(snapshot, target, snapshot.wasFollowingEnd);
        } else snapshot.renderer.requestRender();
    } catch {
        // A changed private Pi layout shape disables compensation, not expansion.
    } finally {
        shiftPendingToolCollapseViewports(snapshot.scrollView, beforeScrollTop, beforeFollowingEnd);
    }
}

function queuePendingToolCollapseViewport(
    state: any,
    snapshot: ToolCollapseViewportSnapshot,
): PendingToolCollapseViewport | undefined {
    if (!state || typeof state !== "object") return undefined;
    const pending: PendingToolCollapseViewport = { snapshot, claimed: false };
    state[TOOL_COLLAPSE_PENDING_VIEWPORT] = pending;
    PENDING_TOOL_COLLAPSE_VIEWPORTS.add(pending);
    return pending;
}

function claimPendingToolCollapseViewport(state: any): PendingToolCollapseViewport | undefined {
    const pending = state?.[TOOL_COLLAPSE_PENDING_VIEWPORT] as PendingToolCollapseViewport | undefined;
    if (pending) pending.claimed = true;
    return pending;
}

function rememberPendingToolCollapseViewport(
    state: any,
    pending: PendingToolCollapseViewport | undefined,
): void {
    if (!pending || state?.[TOOL_COLLAPSE_PENDING_VIEWPORT] !== pending) return;
    if (!pending.claimed) {
        delete state[TOOL_COLLAPSE_PENDING_VIEWPORT];
        PENDING_TOOL_COLLAPSE_VIEWPORTS.delete(pending);
        return;
    }
    try {
        const { snapshot } = pending;
        const lines = snapshot.anchorComponent.render(snapshot.contentWidth);
        if (!Array.isArray(lines)) {
            clearPendingToolCollapseViewport(state);
            return;
        }
        pending.postCollapse = {
            scrollTop: snapshot.scrollView.scrollTop,
            isFollowingEnd: snapshot.scrollView.isFollowingEnd,
            componentHeight: lines.length,
        };
    } catch {
        delete state[TOOL_COLLAPSE_PENDING_VIEWPORT];
        PENDING_TOOL_COLLAPSE_VIEWPORTS.delete(pending);
    }
}

function clearPendingToolCollapseViewport(state: any): void {
    if (!state || typeof state !== "object") return;
    const pending = state[TOOL_COLLAPSE_PENDING_VIEWPORT] as PendingToolCollapseViewport | undefined;
    if (pending) PENDING_TOOL_COLLAPSE_VIEWPORTS.delete(pending);
    delete state[TOOL_COLLAPSE_PENDING_VIEWPORT];
}

function settlePendingToolCollapseViewport(
    state: any,
    pending: PendingToolCollapseViewport | undefined,
): void {
    if (!pending || state?.[TOOL_COLLAPSE_PENDING_VIEWPORT] !== pending) return;
    clearPendingToolCollapseViewport(state);
    const { snapshot, postCollapse } = pending;
    if (!postCollapse) return;
    const beforeScrollTop = snapshot.scrollView.scrollTop;
    const beforeFollowingEnd = snapshot.scrollView.isFollowingEnd;
    try {
        if (
            snapshot.scrollView.scrollTop !== postCollapse.scrollTop
            || snapshot.scrollView.isFollowingEnd !== postCollapse.isFollowingEnd
        ) return;
        const lines = snapshot.anchorComponent.render(snapshot.contentWidth);
        if (!Array.isArray(lines)) return;
        const heightDelta = lines.length - postCollapse.componentHeight;
        if (heightDelta === 0) return;
        const target = snapshot.viewportAnchor === "bottom"
            ? postCollapse.scrollTop + heightDelta
            : snapshot.viewportAnchor === "top" && heightDelta > 0
                ? growingTopViewportTarget(snapshot, postCollapse.scrollTop, lines.length)
                : postCollapse.scrollTop;
        if (
            snapshot.viewportAnchor === "bottom"
            && heightDelta > 0
            && !renderToolCollapseViewportNow(snapshot)
        ) return;
        scrollToToolViewportTarget(snapshot, target, postCollapse.isFollowingEnd);
    } catch {
        return;
    } finally {
        shiftPendingToolCollapseViewports(snapshot.scrollView, beforeScrollTop, beforeFollowingEnd);
    }
    if (!renderToolCollapseViewportNow(snapshot)) snapshot.renderer.requestRender();
}

function renderToolCollapseViewportNow(snapshot: ToolCollapseViewportSnapshot): boolean {
    const render = typeof snapshot.renderer.renderNow === "function"
        ? snapshot.renderer.renderNow
        : snapshot.renderer.doRender;
    if (typeof render !== "function") return false;
    try {
        render.call(snapshot.renderer);
        return true;
    } catch {
        return false;
    }
}

function restoreToolCollapseViewport(snapshot: ToolCollapseViewportSnapshot): void {
    const beforeScrollTop = snapshot.scrollView.scrollTop;
    const beforeFollowingEnd = snapshot.scrollView.isFollowingEnd;
    try {
        if (!renderToolCollapseViewportNow(snapshot)) {
            snapshot.renderer.requestRender();
            return;
        }
        snapshot.scrollView.scrollTo(snapshot.scrollTop, { disableFollow: !snapshot.wasFollowingEnd });
        if (!renderToolCollapseViewportNow(snapshot)) snapshot.renderer.requestRender();
    } catch {
        return;
    } finally {
        shiftPendingToolCollapseViewports(snapshot.scrollView, beforeScrollTop, beforeFollowingEnd);
    }
}

export function beginToolCollapseViewportTransaction(
    tool: unknown,
    requestedViewportAnchor: RequestedToolCollapseViewportAnchor,
    state?: unknown,
): ToolCollapseViewportTransaction {
    clearPendingToolCollapseViewport(state);
    const snapshot = captureToolCollapseViewport(tool, requestedViewportAnchor);
    const pending = snapshot ? queuePendingToolCollapseViewport(state, snapshot) : undefined;
    return {
        complete() {
            if (snapshot) stabilizeToolCollapseViewport(snapshot);
            rememberPendingToolCollapseViewport(state, pending);
        },
        rollback() {
            clearPendingToolCollapseViewport(state);
            if (snapshot) restoreToolCollapseViewport(snapshot);
        },
    };
}

export function captureToolCollapseViewportRollback(
    tool: unknown,
    requestedViewportAnchor: RequestedToolCollapseViewportAnchor,
    state?: unknown,
): () => void {
    const snapshot = captureToolCollapseViewport(tool, requestedViewportAnchor);
    return () => {
        clearPendingToolCollapseViewport(state);
        if (snapshot) restoreToolCollapseViewport(snapshot);
    };
}

export function claimToolCollapseViewportSettlement(
    state: unknown,
): ToolCollapseViewportSettlement | undefined {
    return claimPendingToolCollapseViewport(state) as ToolCollapseViewportSettlement | undefined;
}

export function settleToolCollapseViewport(
    state: unknown,
    settlement: ToolCollapseViewportSettlement | undefined,
): void {
    settlePendingToolCollapseViewport(state, settlement as PendingToolCollapseViewport | undefined);
}
