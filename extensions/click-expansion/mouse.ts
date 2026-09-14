import { InteractiveMode } from "@earendil-works/pi-coding-agent";
import * as PiTui from "@earendil-works/pi-tui";

import type { ToolGroupFullscreenRenderer, ToolGroupInteractiveMode } from "./viewport";

export type MouseTarget = {
    component: any;
    action: string;
    viewportAnchor: string;
    activate(): boolean;
    captureRollback(): () => void;
};

type ReversibleNativeClick = {
    timer: ReturnType<typeof setTimeout>;
    owner: object;
    rollback(): void;
    state?: MousePatchState;
    renderer?: ToolGroupFullscreenRenderer;
    x?: number;
    y?: number;
    wordStartX?: number;
    wordEndX?: number;
};

type MousePatchState = {
    modes: WeakMap<object, ToolGroupInteractiveMode>;
    nativePendingClick?: ReversibleNativeClick;
    press?: {
        x: number;
        y: number;
        clickCount: number;
        wordStartX?: number;
        wordEndX?: number;
        target?: MouseTarget;
        moved: boolean;
        blocked: boolean;
    };
    lastPress?: {
        renderer: ToolGroupFullscreenRenderer;
        x: number;
        y: number;
        at: number;
        clickCount: number;
        wordStartX?: number;
        wordEndX?: number;
    };
    pendingClick?: {
        timer: ReturnType<typeof setTimeout>;
        target: MouseTarget;
        renderer: ToolGroupFullscreenRenderer;
        x: number;
        y: number;
        wordStartX?: number;
        wordEndX?: number;
        rollback(): void;
    };
    targetAt?: (
        renderer: ToolGroupFullscreenRenderer,
        mode: ToolGroupInteractiveMode,
        x: number,
        y: number,
    ) => MouseTarget | undefined;
};

type ActiveNativeMouseDispatch = {
    state: MousePatchState;
    renderer: ToolGroupFullscreenRenderer;
    handled: boolean;
};

export type MouseHostAdapter = {
    targetAt(
        renderer: ToolGroupFullscreenRenderer,
        mode: ToolGroupInteractiveMode,
        x: number,
        y: number,
    ): MouseTarget | undefined;
    resetLocalClickStates(mode: ToolGroupInteractiveMode, collapseLocal: boolean): void;
};

const CLICK_RUNTIME_KEY = Symbol.for("pi-claude-style-tools:click-runtime");
const TOOL_GLOBAL_EXPANSION = Symbol.for("pi-claude-style-tools:tool-click-global-expanded");
const MOUSE_HOST_KEY = Symbol.for("pi-claude-style-tools:click-expansion-mouse-host:v1");
const MOUSE_PATCH_FLAG = Symbol.for("pi-claude-style-tools:tool-group-mouse-patch");
const MODE_PATCH_FLAG = Symbol.for("pi-claude-style-tools:tool-group-mode-patch");
const ACTIVE_NATIVE_MOUSE_DISPATCH_KEY = Symbol.for("pi-claude-style-tools:active-native-mouse-dispatch");
const NATIVE_CLICK_TIMERS = new WeakMap<object, ReversibleNativeClick>();

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
    (timer as any).unref?.();
}

function clickRuntime(): { activeInteractiveMode?: ToolGroupInteractiveMode; visualEpoch: number } {
    return ((globalThis as any)[CLICK_RUNTIME_KEY] ??= { visualEpoch: 0 });
}

function hostAdapter(): MouseHostAdapter | undefined {
    return (globalThis as any)[MOUSE_HOST_KEY];
}

export function registerMouseHostAdapter(adapter: MouseHostAdapter): void {
    (globalThis as any)[MOUSE_HOST_KEY] = adapter;
}

export function hasNativeMouseDispatch(): boolean {
    return "MouseRegion" in PiTui;
}

export function shouldDispatchRawMouseFallback(
    nativeDispatchAvailable: boolean,
    nativeDispatchHandled: boolean,
): boolean {
    return !nativeDispatchAvailable || !nativeDispatchHandled;
}

function activeNativeMouseDispatch(): ActiveNativeMouseDispatch | undefined {
    return (globalThis as any)[ACTIVE_NATIVE_MOUSE_DISPATCH_KEY];
}

function setActiveNativeMouseDispatch(dispatch: ActiveNativeMouseDispatch | undefined): void {
    if (dispatch) (globalThis as any)[ACTIVE_NATIVE_MOUSE_DISPATCH_KEY] = dispatch;
    else delete (globalThis as any)[ACTIVE_NATIVE_MOUSE_DISPATCH_KEY];
}

function clearReversibleNativeClick(entry: ReversibleNativeClick): void {
    clearTimeout(entry.timer);
    if (NATIVE_CLICK_TIMERS.get(entry.owner) === entry) NATIVE_CLICK_TIMERS.delete(entry.owner);
    if (entry.state?.nativePendingClick === entry) delete entry.state.nativePendingClick;
}

function scheduleNativeSingleClick(
    owner: object,
    clickCount: number,
    activate: () => boolean,
    rollback: () => void,
): any {
    const dispatch = activeNativeMouseDispatch();
    if (dispatch) dispatch.handled = true;
    const effectiveClickCount = Math.max(clickCount, dispatch?.state.press?.clickCount ?? 1);
    const pending = NATIVE_CLICK_TIMERS.get(owner);
    if (pending) {
        clearReversibleNativeClick(pending);
        if (effectiveClickCount > 1) pending.rollback();
    }
    if (effectiveClickCount > 1 || !activate()) return undefined;
    const press = dispatch?.state.press;
    const entry: ReversibleNativeClick = {
        timer: undefined as unknown as ReturnType<typeof setTimeout>,
        owner,
        rollback,
        ...(dispatch && press ? {
            state: dispatch.state,
            renderer: dispatch.renderer,
            x: press.x,
            y: press.y,
            wordStartX: press.wordStartX,
            wordEndX: press.wordEndX,
        } : {}),
    };
    entry.timer = setTimeout(() => clearReversibleNativeClick(entry), 510);
    unrefTimer(entry.timer);
    NATIVE_CLICK_TIMERS.set(owner, entry);
    if (entry.state) entry.state.nativePendingClick = entry;
    return { handled: true };
}

export function handlePublishedMouse(
    owner: object,
    event: any,
    hasTargetAtPoint: (x: number, y: number) => boolean,
    activateAtPoint: (x: number, y: number) => boolean,
    captureRollbackAtPoint: (x: number, y: number) => () => void,
): any {
    if (
        !hasNativeMouseDispatch()
        || event?.type !== "click"
        || event?.button !== "left"
        || event?.dragged === true
        || Boolean(event?.url)
        || !hasTargetAtPoint(event.x, event.y)
    ) return undefined;
    const rollback = captureRollbackAtPoint(event.x, event.y);
    return scheduleNativeSingleClick(
        owner,
        Number(event.clickCount ?? 1),
        () => activateAtPoint(event.x, event.y),
        rollback,
    );
}

type SgrMouseEvent = {
    button: number;
    x: number;
    y: number;
    release: boolean;
};

function parseSgrMouseEvent(data: string): SgrMouseEvent | undefined {
    const match = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/.exec(data);
    if (!match) return undefined;
    return {
        button: Number.parseInt(match[1], 10),
        x: Number.parseInt(match[2], 10) - 1,
        y: Number.parseInt(match[3], 10) - 1,
        release: match[4] === "m",
    };
}

function clearMouseSelection(renderer: ToolGroupFullscreenRenderer): void {
    renderer.stopSelectionAutoScroll?.();
    renderer.selectionPressActive = false;
    renderer.selectionAnchor = undefined;
    renderer.selectionFocus = undefined;
    renderer.selectionGranularity = "character";
    renderer.selectionInitialRange = undefined;
    renderer.selectionDragged = false;
    renderer.pressedUrl = undefined;
}

export function installMouseAdapter(): void {
    const nativeMouseDispatch = hasNativeMouseDispatch();
    const fullscreenPrototype = (PiTui as any).TuiAltScreen?.prototype as (
        ToolGroupFullscreenRenderer & { [MOUSE_PATCH_FLAG]?: MousePatchState }
    ) | undefined;
    if (!fullscreenPrototype) return;

    let state = fullscreenPrototype[MOUSE_PATCH_FLAG];
    if (!state) {
        state = { modes: new WeakMap() };
        fullscreenPrototype[MOUSE_PATCH_FLAG] = state;
        const originalHandleViewportInput = fullscreenPrototype.handleViewportInput;
        fullscreenPrototype.handleViewportInput = function (this: ToolGroupFullscreenRenderer, data: string) {
            const event = parseSgrMouseEvent(data);
            const runtime = clickRuntime();
            const registeredMode = state!.modes.get(this);
            const activeMode = runtime.activeInteractiveMode;
            const mode = registeredMode ?? (activeMode?.renderer === this ? activeMode : undefined);
            if (!registeredMode && mode) state!.modes.set(this, mode);
            const isLeftButton = event !== undefined
                && (event.button & 64) === 0
                && (event.button & 3) === 0;
            if (event && isLeftButton && !event.release && (event.button & 32) === 0) {
                const now = Date.now();
                const lastPress = state!.lastPress;
                const repeatedPress = lastPress
                    && lastPress.renderer === this
                    && now - lastPress.at <= 510
                    && lastPress.y === event.y
                    && (lastPress.wordStartX === undefined || lastPress.wordEndX === undefined
                        ? lastPress.x === event.x
                        : event.x >= lastPress.wordStartX && event.x < lastPress.wordEndX);
                const clickCount = repeatedPress ? lastPress.clickCount + 1 : 1;
                state!.lastPress = { renderer: this, x: event.x, y: event.y, at: now, clickCount };
                const pending = nativeMouseDispatch ? state!.nativePendingClick : state!.pendingClick;
                const sameWord = pending
                    && pending.renderer === this
                    && pending.y === event.y
                    && (pending.wordStartX === undefined || pending.wordEndX === undefined
                        ? pending.x === event.x
                        : event.x >= pending.wordStartX && event.x < pending.wordEndX);
                if (pending && sameWord) {
                    if (nativeMouseDispatch) clearReversibleNativeClick(pending as ReversibleNativeClick);
                    else {
                        clearTimeout(pending.timer);
                        state!.pendingClick = undefined;
                    }
                    pending.rollback();
                    if (typeof this.renderNow === "function") this.renderNow();
                    else this.doRender?.();
                }
                state!.press = {
                    x: event.x,
                    y: event.y,
                    clickCount,
                    target: mode ? state!.targetAt?.(this, mode, event.x, event.y) : undefined,
                    moved: false,
                    blocked: false,
                };
            } else if (event && (event.button & 32) !== 0 && state!.press) {
                if (event.x !== state!.press.x || event.y !== state!.press.y) state!.press.moved = true;
            }

            const previousNativeDispatch = activeNativeMouseDispatch();
            const nativeDispatch = nativeMouseDispatch
                ? { state: state!, renderer: this, handled: false }
                : undefined;
            if (nativeDispatch) setActiveNativeMouseDispatch(nativeDispatch);
            let result: unknown;
            try {
                result = originalHandleViewportInput.call(this, data);
            } finally {
                setActiveNativeMouseDispatch(previousNativeDispatch);
            }
            if (event && isLeftButton && !event.release && (event.button & 32) === 0 && state!.press) {
                state!.press.blocked = this.selectionGranularity !== "character" || Boolean(this.pressedUrl);
                const anchor = this.selectionAnchor as { row?: number; col?: number } | undefined;
                const click = this.lastClick;
                if (
                    anchor
                    && click
                    && anchor.row === click.row
                    && typeof anchor.col === "number"
                    && typeof click.wordStart === "number"
                    && typeof click.wordEnd === "number"
                ) {
                    state!.press.wordStartX = event.x - (anchor.col - click.wordStart);
                    state!.press.wordEndX = event.x + (click.wordEnd - anchor.col);
                    if (state!.lastPress?.renderer === this && state!.lastPress.at + 510 >= Date.now()) {
                        state!.lastPress.wordStartX = state!.press.wordStartX;
                        state!.lastPress.wordEndX = state!.press.wordEndX;
                    }
                }
            }
            if (event?.release) {
                const press = state!.press;
                state!.press = undefined;
                const target = mode ? state!.targetAt?.(this, mode, event.x, event.y) : undefined;
                if (
                    shouldDispatchRawMouseFallback(nativeMouseDispatch, nativeDispatch?.handled === true)
                    && isLeftButton
                    && press
                    && press.clickCount === 1
                    && !press.moved
                    && !press.blocked
                    && this.selectionGranularity === "character"
                    && press.x === event.x
                    && press.y === event.y
                    && press.target?.component === target?.component
                    && press.target?.action === target?.action
                    && press.target?.viewportAnchor === target?.viewportAnchor
                    && target
                ) {
                    const rollback = target.captureRollback();
                    clearMouseSelection(this);
                    if (target.activate()) {
                        this.requestRender();
                        const pending = {
                            timer: undefined as unknown as ReturnType<typeof setTimeout>,
                            target,
                            renderer: this,
                            x: event.x,
                            y: event.y,
                            wordStartX: press.wordStartX,
                            wordEndX: press.wordEndX,
                            rollback,
                        };
                        pending.timer = setTimeout(() => {
                            if (state!.pendingClick !== pending) return;
                            state!.pendingClick = undefined;
                        }, 510);
                        unrefTimer(pending.timer);
                        state!.pendingClick = pending;
                    }
                }
            }
            return result;
        };
    }
    state.targetAt = (...args) => hostAdapter()?.targetAt(...args);

    const interactivePrototype = InteractiveMode.prototype as any;
    if (interactivePrototype[MODE_PATCH_FLAG]) return;
    interactivePrototype[MODE_PATCH_FLAG] = state;
    const originalRenderInitialMessages = interactivePrototype.renderInitialMessages;
    interactivePrototype.renderInitialMessages = function (this: ToolGroupInteractiveMode) {
        this.ui[TOOL_GLOBAL_EXPANSION] = this.toolOutputExpanded === true;
        clickRuntime().activeInteractiveMode = this;
        state!.modes.set(this.renderer, this);
        return originalRenderInitialMessages.apply(this, arguments as any);
    };
    const originalSetToolsExpanded = interactivePrototype.setToolsExpanded;
    interactivePrototype.setToolsExpanded = function (this: ToolGroupInteractiveMode, expanded: boolean) {
        const changed = this.toolOutputExpanded !== expanded;
        this.ui[TOOL_GLOBAL_EXPANSION] = expanded;
        const result = originalSetToolsExpanded.apply(this, arguments as any);
        if (changed) hostAdapter()?.resetLocalClickStates(this, false);
        else clickRuntime().visualEpoch++;
        return result;
    };
    const originalSwitchTuiMode = interactivePrototype.switchTuiMode;
    interactivePrototype.switchTuiMode = function (this: ToolGroupInteractiveMode) {
        const switched = originalSwitchTuiMode.apply(this, arguments as any);
        if (switched) {
            clickRuntime().activeInteractiveMode = this;
            this.ui[TOOL_GLOBAL_EXPANSION] = this.toolOutputExpanded === true;
            state!.modes.set(this.renderer, this);
        }
        return switched;
    };
}
