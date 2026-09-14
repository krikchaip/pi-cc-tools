import { visibleWidth } from "@earendil-works/pi-tui";

import { handlePublishedMouse, installMouseAdapter } from "./mouse.ts";

export type LocalDetailLevel = 0 | 1 | 2;

export type ExpansionTarget =
    | Readonly<{ kind: "tool-execution"; execution: object }>
    | Readonly<{ kind: "pi-owned-transcript"; transcript: object }>;

export interface ExpansionState {
    readonly active: boolean;
    readonly localExpansion: "collapsed" | "expanded";
    readonly localDetail: LocalDetailLevel;
}

export type ExpansionBehavior = "toggle" | "next-detail" | "toggle-max-detail";
export type ExpansionSpan = "content" | Readonly<{ text: string }>;
export type ExpansionViewport = "top" | "bottom" | "adaptive";

export type ExpansionCopy = string | Readonly<{
    active: string;
    inactive: string;
}>;

export interface ExpansionDeclaration {
    readonly behavior?: ExpansionBehavior;
    readonly span?: ExpansionSpan;
    readonly viewport?: ExpansionViewport;
}

export interface ClickExpansionRuntime {
    state(target: ExpansionTarget): ExpansionState;
    declare(
        target: ExpansionTarget,
        copy: ExpansionCopy,
        declaration?: ExpansionDeclaration,
    ): string;
    publish(owner: object, finalRows: readonly string[]): readonly string[];
}

export interface ClickExpansionInstallation {
    readonly enabled: boolean;
}

interface TargetState {
    localExpansion: "collapsed" | "expanded";
    localDetail: LocalDetailLevel;
}

type CompatibilityAction = "header" | "expand" | "detail" | "detail-extra";
type InternalExpansionDeclaration = ExpansionDeclaration & Readonly<{
    compatibilityAction?: CompatibilityAction;
}>;

interface PendingDeclaration {
    readonly target: ExpansionTarget;
    readonly active: boolean;
    readonly behavior: ExpansionBehavior;
    readonly span: ExpansionSpan;
    readonly viewport: ExpansionViewport;
    readonly compatibilityAction?: CompatibilityAction;
}

interface PublishedAnchor {
    readonly target: ExpansionTarget;
    readonly line: number;
    readonly start: number;
    readonly end: number;
    readonly behavior: ExpansionBehavior;
    readonly viewport: ExpansionViewport;
    readonly compatibilityAction?: OwnerHitAnchor["action"];
}

interface OwnerHitAnchor {
    readonly line: number;
    readonly start: number;
    readonly end: number;
    readonly tool: object;
    readonly action: CompatibilityAction;
    readonly viewportAnchor: "top" | "bottom";
}

interface ActivationTransaction {
    complete?(): void;
    rollback?(): void;
}

type ActivationHost = (
    behavior: ExpansionBehavior,
    viewport: ExpansionViewport,
    compatibilityAction?: OwnerHitAnchor["action"],
) => false | ActivationTransaction | undefined;

type RollbackHost = (
    behavior: ExpansionBehavior,
    viewport: ExpansionViewport,
    compatibilityAction?: OwnerHitAnchor["action"],
) => (() => void) | undefined;

interface RuntimeImplementation {
    state(target: ExpansionTarget): ExpansionState;
    declare(target: ExpansionTarget, copy: ExpansionCopy, declaration?: ExpansionDeclaration): string;
    anchorAtPoint(owner: object, x: number, y: number): OwnerHitAnchor | undefined;
    activateTarget(
        target: ExpansionTarget,
        behavior: ExpansionBehavior,
        viewport: ExpansionViewport,
        compatibilityAction?: OwnerHitAnchor["action"],
        sourceOwner?: object,
    ): boolean;
    activateAtPoint(owner: object, x: number, y: number): boolean;
    captureTargetRollback(
        target: ExpansionTarget,
        behavior: ExpansionBehavior,
        viewport: ExpansionViewport,
        compatibilityAction?: OwnerHitAnchor["action"],
    ): () => void;
    captureAtPoint(owner: object, x: number, y: number): () => void;
    publish(owner: object, finalRows: readonly string[]): readonly string[];
}

interface RuntimeRoot {
    readonly version: 1;
    enabled: boolean;
    fullscreen: boolean;
    globalExpansion: "collapsed" | "expanded";
    nextDeclarationId: number;
    readonly declarations: Map<string, PendingDeclaration>;
    readonly anchorsByOwner: WeakMap<object, readonly PublishedAnchor[]>;
    readonly targetStates: WeakMap<object, TargetState>;
    implementation: RuntimeImplementation;
    runtime: ClickExpansionRuntime;
}

const RUNTIME_KEY = Symbol.for("pi-claude-style-tools:click-expansion-runtime:v1");
const LEGACY_CLICK_RUNTIME = Symbol.for("pi-claude-style-tools:click-runtime");
const TOOL_GLOBAL_EXPANSION = Symbol.for("pi-claude-style-tools:tool-click-global-expanded");
const TOOL_LOCAL_EXPANSION = Symbol.for("pi-claude-style-tools:tool-click-local-expanded");
const TOOL_DETAIL_LEVEL = Symbol.for("pi-claude-style-tools:tool-click-detail-level");
const TOOL_RENDER_CACHE = Symbol.for("pi-claude-style-tools:tool-render-cache");
const COMPONENT_PARENT = Symbol.for("pi-claude-style-tools:component-parent");
const ACTIVATION_HOST = Symbol.for("pi-claude-style-tools:click-expansion-activation-host:v1");
const TARGET_ACTIVATE = Symbol.for("pi-claude-style-tools:click-expansion-target-activate:v1");
const ACTIVATE_TARGET_BRIDGE = Symbol.for("pi-claude-style-tools:click-expansion-activate-target:v1");
const ROLLBACK_HOST = Symbol.for("pi-claude-style-tools:click-expansion-rollback-host:v1");
const ANSI_STYLE = /\x1b\[[0-9;]*m/g;
const DECLARATION_OPEN = "\u2060";
const DECLARATION_ID_ZERO = "\u2061";
const DECLARATION_ID_ONE = "\u2062";
const DECLARATION_SEPARATOR = "\u2063";
const DECLARATION_CLOSE = "\u2064";

function encodeDeclarationId(id: number): string {
    return id.toString(2).replaceAll("0", DECLARATION_ID_ZERO).replaceAll("1", DECLARATION_ID_ONE);
}

function stripAnsiStyle(text: string): string {
    return text.replace(ANSI_STYLE, "");
}

function clickAnchorStart(line: string): number {
    const plain = stripAnsiStyle(line);
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

function lineAtOffset(text: string, offset: number): number {
    let line = 0;
    for (let index = 0; index < offset; index++) {
        if (text[index] === "\n") line++;
    }
    return line;
}

function defaultCompatibilityAction(behavior: ExpansionBehavior): CompatibilityAction {
    if (behavior === "next-detail") return "detail";
    if (behavior === "toggle-max-detail") return "detail-extra";
    return "expand";
}

function expansionBehavior(action: CompatibilityAction): ExpansionBehavior {
    if (action === "detail") return "next-detail";
    if (action === "detail-extra") return "toggle-max-detail";
    return "toggle";
}

function publishedAction(owner: object, anchor: PublishedAnchor): CompatibilityAction {
    if (anchor.compatibilityAction) return anchor.compatibilityAction;
    if (anchor.behavior === "next-detail") return "detail";
    if (anchor.behavior === "toggle-max-detail") return "detail-extra";
    return targetIdentity(anchor.target) !== owner && anchor.viewport !== "adaptive" ? "header" : "expand";
}

function targetIdentity(target: ExpansionTarget): object {
    return target.kind === "tool-execution" ? target.execution : target.transcript;
}

function initialTargetState(): TargetState {
    return { localExpansion: "collapsed", localDetail: 0 };
}

function retainedTargetState(target: ExpansionTarget): TargetState {
    if (target.kind !== "tool-execution") return initialTargetState();
    const execution = target.execution as Record<PropertyKey, unknown>;
    const rendererState = execution.rendererState as Record<PropertyKey, unknown> | undefined;
    const detail = rendererState?.[TOOL_DETAIL_LEVEL];
    return {
        localExpansion: execution[TOOL_LOCAL_EXPANSION] === true ? "expanded" : "collapsed",
        localDetail: detail === 1 || detail === 2 ? detail : 0,
    };
}

function targetInteractionContext(
    root: RuntimeRoot,
    target: ExpansionTarget,
): { fullscreen: boolean; globalExpansion: "collapsed" | "expanded" } {
    if (target.kind !== "tool-execution") {
        const bridge = (globalThis as typeof globalThis & {
            [LEGACY_CLICK_RUNTIME]?: {
                activeInteractiveMode?: {
                    toolOutputExpanded?: boolean;
                    ui?: Record<PropertyKey, unknown>;
                };
            };
        })[LEGACY_CLICK_RUNTIME];
        const mode = bridge?.activeInteractiveMode;
        return {
            // Pi-owned transcript components can render before InteractiveMode
            // publishes itself. Preserve the retained adapter's active fallback.
            fullscreen: true,
            globalExpansion: mode?.toolOutputExpanded === true
                || mode?.ui?.[TOOL_GLOBAL_EXPANSION] === true
                || root.globalExpansion === "expanded"
                ? "expanded"
                : "collapsed",
        };
    }
    const ui = (target.execution as { ui?: Record<PropertyKey, unknown> }).ui;
    return {
        fullscreen: ui?.mode === "fullscreen",
        globalExpansion: ui?.[TOOL_GLOBAL_EXPANSION] === true ? "expanded" : "collapsed",
    };
}

function createImplementation(root: RuntimeRoot): RuntimeImplementation {
    return {
        state(target) {
            const local = root.targetStates.get(targetIdentity(target)) ?? retainedTargetState(target);
            const interaction = targetInteractionContext(root, target);
            return {
                active: root.enabled && interaction.fullscreen && interaction.globalExpansion === "collapsed",
                localExpansion: local.localExpansion,
                localDetail: local.localDetail,
            };
        },

        declare(target, copy, declaration = {}) {
            const state = this.state(target);
            const text = typeof copy === "string"
                ? copy
                : state.active ? copy.active : copy.inactive;
            const internal = declaration as InternalExpansionDeclaration;
            const behavior = declaration.behavior ?? "toggle";
            const compatibilityAction = internal.compatibilityAction;
            const id = encodeDeclarationId(root.nextDeclarationId++);
            root.declarations.set(id, {
                target,
                active: state.active,
                behavior,
                span: declaration.span ?? "content",
                viewport: declaration.viewport ?? "top",
                ...(compatibilityAction !== undefined && expansionBehavior(compatibilityAction) === behavior
                    ? { compatibilityAction }
                    : {}),
            });
            return `${DECLARATION_OPEN}${id}${DECLARATION_SEPARATOR}${text}${DECLARATION_CLOSE}`;
        },

        anchorAtPoint(owner, x, y) {
            const anchor = root.anchorsByOwner.get(owner)?.find((candidate) => (
                candidate.line === y
                && x >= candidate.start
                && x < candidate.end
                && this.state(candidate.target).active
            ));
            if (!anchor) return undefined;
            return {
                line: anchor.line,
                start: anchor.start,
                end: anchor.end,
                tool: targetIdentity(anchor.target),
                action: publishedAction(owner, anchor),
                viewportAnchor: anchor.viewport === "bottom" ? "bottom" : "top",
            };
        },

        activateTarget(target, behavior, viewport, compatibilityAction, sourceOwner) {
            if (!this.state(target).active) return false;
            const identity = targetIdentity(target);
            const action = compatibilityAction ?? defaultCompatibilityAction(behavior);
            const owner = sourceOwner ?? identity;
            const published = root.anchorsByOwner.get(owner)?.some((anchor) => (
                targetIdentity(anchor.target) === identity
                && anchor.behavior === behavior
                && publishedAction(owner, anchor) === action
            )) === true;
            if (!published) return false;
            const value = identity as Record<PropertyKey, any>;
            if (value.rendererState?._ptAsyncRenderPending === true) return false;
            const current = root.targetStates.get(identity) ?? retainedTargetState(target);
            if (behavior === "next-detail" && current.localDetail === 2) return false;

            const host = value[ACTIVATION_HOST] as ActivationHost | undefined;
            const transaction = typeof host === "function"
                ? host.call(identity, behavior, viewport, compatibilityAction)
                : undefined;
            if (transaction === false) return false;
            try {
                if (target.kind === "pi-owned-transcript") {
                    const expanded = value.expanded === true || value._expanded === true;
                    value.setExpanded?.(!expanded);
                    root.targetStates.set(identity, {
                        localExpansion: expanded ? "collapsed" : "expanded",
                        localDetail: 0,
                    });
                } else if (behavior === "toggle") {
                    const nextExpanded = value.expanded !== true;
                    if (nextExpanded) value[TOOL_LOCAL_EXPANSION] = true;
                    else {
                        delete value[TOOL_LOCAL_EXPANSION];
                        if (value.rendererState) delete value.rendererState[TOOL_DETAIL_LEVEL];
                    }
                    root.targetStates.set(identity, {
                        localExpansion: nextExpanded ? "expanded" : "collapsed",
                        localDetail: nextExpanded ? current.localDetail : 0,
                    });
                    delete value[TOOL_RENDER_CACHE];
                    value[COMPONENT_PARENT]?.invalidate?.();
                    value.setExpanded?.(nextExpanded);
                } else {
                    const nextDetail = behavior === "toggle-max-detail"
                        ? current.localDetail === 2 ? 0 : 2
                        : current.localDetail === 0 ? 1 : 2;
                    value[TOOL_LOCAL_EXPANSION] = true;
                    if (value.rendererState) {
                        if (nextDetail === 0) delete value.rendererState[TOOL_DETAIL_LEVEL];
                        else value.rendererState[TOOL_DETAIL_LEVEL] = nextDetail;
                    }
                    root.targetStates.set(identity, {
                        localExpansion: "expanded",
                        localDetail: nextDetail,
                    });
                    delete value[TOOL_RENDER_CACHE];
                    value[COMPONENT_PARENT]?.invalidate?.();
                    value.updateDisplay?.();
                }
                value.ui?.requestRender?.();
                transaction?.complete?.();
                return true;
            } catch {
                transaction?.rollback?.();
                return false;
            }
        },

        activateAtPoint(owner, x, y) {
            const anchor = root.anchorsByOwner.get(owner)?.find((candidate) => (
                candidate.line === y
                && x >= candidate.start
                && x < candidate.end
            ));
            if (!anchor) return false;
            return this.activateTarget(
                anchor.target,
                anchor.behavior,
                anchor.viewport,
                publishedAction(owner, anchor),
                owner,
            );
        },

        captureTargetRollback(target, behavior, viewport, compatibilityAction) {
            const identity = targetIdentity(target);
            const value = identity as Record<PropertyKey, any>;
            const current = root.targetStates.get(identity) ?? retainedTargetState(target);
            const expanded = value.expanded === true || value._expanded === true;
            const host = value[ROLLBACK_HOST] as RollbackHost | undefined;
            const rollbackHost = typeof host === "function"
                ? host.call(identity, behavior, viewport, compatibilityAction)
                : undefined;
            return () => {
                root.targetStates.set(identity, { ...current });
                if (target.kind === "pi-owned-transcript") {
                    value.setExpanded?.(expanded);
                } else {
                    if (current.localExpansion === "expanded") value[TOOL_LOCAL_EXPANSION] = true;
                    else delete value[TOOL_LOCAL_EXPANSION];
                    if (value.rendererState) {
                        if (current.localDetail === 0) delete value.rendererState[TOOL_DETAIL_LEVEL];
                        else value.rendererState[TOOL_DETAIL_LEVEL] = current.localDetail;
                    }
                    delete value[TOOL_RENDER_CACHE];
                    value[COMPONENT_PARENT]?.invalidate?.();
                    if (value.expanded !== expanded) value.setExpanded?.(expanded);
                    else value.updateDisplay?.();
                }
                value.ui?.requestRender?.();
                rollbackHost?.();
            };
        },

        captureAtPoint(owner, x, y) {
            const anchor = root.anchorsByOwner.get(owner)?.find((candidate) => (
                candidate.line === y
                && x >= candidate.start
                && x < candidate.end
            ));
            if (!anchor) return () => {};
            return this.captureTargetRollback(anchor.target, anchor.behavior, anchor.viewport, publishedAction(owner, anchor));
        },

        publish(owner, finalRows) {
            const consumed = new Set<string>();
            const occurrences: Array<{
                declaration: PendingDeclaration;
                startOffset: number;
                endOffset: number;
            }> = [];
            const text = finalRows.join("\n");
            let output = "";
            let cursor = 0;
            while (cursor < text.length) {
                const open = text.indexOf(DECLARATION_OPEN, cursor);
                if (open < 0) {
                    output += text.slice(cursor);
                    break;
                }
                output += text.slice(cursor, open);
                const separator = text.indexOf(DECLARATION_SEPARATOR, open + DECLARATION_OPEN.length);
                const close = separator < 0
                    ? -1
                    : text.indexOf(DECLARATION_CLOSE, separator + DECLARATION_SEPARATOR.length);
                if (separator < 0 || close < 0) {
                    output += text.slice(open);
                    break;
                }
                const id = text.slice(open + DECLARATION_OPEN.length, separator);
                const declaration = root.declarations.get(id);
                const declaredText = text.slice(separator + DECLARATION_SEPARATOR.length, close);
                const startOffset = output.length;
                output += declaredText;
                if (declaration?.active && declaredText.length > 0) {
                    occurrences.push({ declaration, startOffset, endOffset: output.length });
                }
                if (declaration) consumed.add(id);
                cursor = close + DECLARATION_CLOSE.length;
            }
            for (const id of consumed) root.declarations.delete(id);

            const rows = finalRows.length === 0 ? [] : output.split("\n");
            const rowOffsets: number[] = [];
            let rowOffset = 0;
            for (const row of rows) {
                rowOffsets.push(rowOffset);
                rowOffset += row.length + 1;
            }
            const ownerRecord = owner as Record<PropertyKey, unknown>;
            const anchors: PublishedAnchor[] = [];
            for (const occurrence of occurrences) {
                const startLine = lineAtOffset(output, occurrence.startOffset);
                const endLine = lineAtOffset(output, Math.max(occurrence.startOffset, occurrence.endOffset - 1));
                for (let line = startLine; line <= endLine; line++) {
                    const rendered = rows[line] ?? "";
                    const plain = stripAnsiStyle(rendered);
                    let start: number;
                    let end: number;
                    if (occurrence.declaration.span === "content") {
                        start = clickAnchorStart(rendered);
                        end = visibleWidth(plain.trimEnd());
                    } else {
                        const rawStart = Math.max(0, occurrence.startOffset - (rowOffsets[line] ?? 0));
                        const rawEnd = Math.min(rendered.length, occurrence.endOffset - (rowOffsets[line] ?? 0));
                        const occurrenceText = stripAnsiStyle(rendered.slice(rawStart, rawEnd));
                        const index = occurrenceText.indexOf(occurrence.declaration.span.text);
                        if (index < 0) continue;
                        start = visibleWidth(stripAnsiStyle(rendered.slice(0, rawStart)))
                            + visibleWidth(occurrenceText.slice(0, index));
                        end = start + visibleWidth(occurrence.declaration.span.text);
                    }
                    if (end > start) anchors.push({
                        target: occurrence.declaration.target,
                        line,
                        start,
                        end,
                        behavior: occurrence.declaration.behavior,
                        viewport: occurrence.declaration.viewport,
                        compatibilityAction: occurrence.declaration.compatibilityAction,
                    });
                }
            }
            root.anchorsByOwner.set(owner, anchors);

            ownerRecord.clickAnchorAtPoint = (x: number, y: number) => (
                root.implementation.anchorAtPoint(owner, x, y)
            );
            ownerRecord.clickActionAtPoint = (x: number, y: number) => (
                root.implementation.anchorAtPoint(owner, x, y)?.action
            );
            const ownedTarget = anchors.find((anchor) => targetIdentity(anchor.target) === owner)?.target;
            if (ownedTarget) {
                ownerRecord[TARGET_ACTIVATE] = (
                    action: OwnerHitAnchor["action"],
                    viewportAnchor: "top" | "bottom" = "top",
                ) => root.implementation.activateTarget(
                    ownedTarget,
                    expansionBehavior(action),
                    viewportAnchor,
                    action,
                    owner,
                );
                ownerRecord.activateClickAction = (
                    action: OwnerHitAnchor["action"],
                    viewportAnchor: "top" | "bottom" = "top",
                ) => (ownerRecord[TARGET_ACTIVATE] as (...args: any[]) => boolean)(action, viewportAnchor);
            }
            if (ownedTarget) {
                ownerRecord.captureClickRollback = (
                    action: OwnerHitAnchor["action"],
                    viewportAnchor: "top" | "bottom" = "top",
                ) => root.implementation.captureTargetRollback(
                    ownedTarget,
                    expansionBehavior(action),
                    viewportAnchor,
                    action,
                );
            }
            if (anchors.some((anchor) => targetIdentity(anchor.target) !== owner)) {
                ownerRecord.toggleToolAtPoint = (x: number, y: number) => (
                    root.implementation.activateAtPoint(owner, x, y)
                );
            }
            ownerRecord.captureClickRollbackAtPoint = (x: number, y: number) => (
                root.implementation.captureAtPoint(owner, x, y)
            );
            ownerRecord.handleMouse = (event: any) => handlePublishedMouse(
                owner,
                event,
                (x, y) => root.implementation.anchorAtPoint(owner, x, y) !== undefined,
                (x, y) => root.implementation.activateAtPoint(owner, x, y),
                (x, y) => root.implementation.captureAtPoint(owner, x, y),
            );
            return rows;
        },
    };
}

function createRoot(): RuntimeRoot {
    const root = {
        version: 1,
        enabled: false,
        fullscreen: false,
        globalExpansion: "collapsed" as const,
        nextDeclarationId: 0,
        declarations: new Map<string, PendingDeclaration>(),
        anchorsByOwner: new WeakMap<object, readonly PublishedAnchor[]>(),
        targetStates: new WeakMap<object, TargetState>(),
    } as Omit<RuntimeRoot, "implementation" | "runtime"> as RuntimeRoot;
    root.implementation = createImplementation(root);
    root.runtime = {
        state: (target: ExpansionTarget) => root.implementation.state(target),
        declare: (
            target: ExpansionTarget,
            copy: ExpansionCopy,
            declaration?: ExpansionDeclaration,
        ) => root.implementation.declare(target, copy, declaration),
        publish: (owner: object, finalRows: readonly string[]) => (
            root.implementation.publish(owner, finalRows)
        ),
    };
    return root;
}

function runtimeRoot(): RuntimeRoot {
    const globalRecord = globalThis as typeof globalThis & { [RUNTIME_KEY]?: RuntimeRoot };
    return globalRecord[RUNTIME_KEY] ??= createRoot();
}

export function installClickExpansion(installation: ClickExpansionInstallation): ClickExpansionRuntime {
    if (typeof installation?.enabled !== "boolean") {
        throw new TypeError("click expansion installation requires a boolean enabled value");
    }
    const root = runtimeRoot();
    delete (root as RuntimeRoot & { actionsByTarget?: unknown }).actionsByTarget;
    installMouseAdapter();
    root.implementation = createImplementation(root);
    root.runtime.state = (target: ExpansionTarget) => root.implementation.state(target);
    root.runtime.declare = (
        target: ExpansionTarget,
        copy: ExpansionCopy,
        declaration?: ExpansionDeclaration,
    ) => root.implementation.declare(target, copy, declaration);
    root.runtime.publish = (owner: object, finalRows: readonly string[]) => (
        root.implementation.publish(owner, finalRows)
    );
    root.enabled = installation.enabled;
    (globalThis as any)[ACTIVATE_TARGET_BRIDGE] = (
        target: ExpansionTarget,
        behavior: ExpansionBehavior,
        viewport: ExpansionViewport,
        compatibilityAction?: OwnerHitAnchor["action"],
    ) => root.implementation.activateTarget(target, behavior, viewport, compatibilityAction);
    return root.runtime;
}
