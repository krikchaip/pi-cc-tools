import { DiffPresentationEngine, type PresentationFrame } from "./engine.ts";

export type {
    DiffDetailLevel,
    DiffEvidence,
    DiffOutputTreeBlock,
    DiffPresentationChrome,
    DiffPresentationDependencies,
    DiffPresentationModule,
    DiffPresentationRequest,
    DiffPresentationSettings,
    DiffPresentationSnapshot,
    DiffPresentationSurface,
    DiffRenderSettlement,
    DiffSource,
    DiffTheme,
    DiffView,
    EditOperation,
} from "./types.ts";

import type {
    DiffPresentationDependencies,
    DiffPresentationModule,
    DiffPresentationRequest,
    DiffPresentationSnapshot,
    DiffPresentationSurface,
} from "./types.ts";

const RUNTIME_KEY = Symbol.for("pi-cc-tools:diff-presentation-runtime:v1");
const RUNTIME_VERSION = 1;

interface PresentationSlot {
    key?: string;
    frame?: PresentationFrame;
    pending?: Promise<void>;
    generation: number;
    ready: boolean;
}

interface OwnerPresentation {
    readonly slots: Map<DiffPresentationSurface, PresentationSlot>;
}

interface DiffPresentationRuntime {
    readonly version: typeof RUNTIME_VERSION;
    owners: WeakMap<object, OwnerPresentation>;
}

type RuntimeGlobal = typeof globalThis & { [RUNTIME_KEY]?: DiffPresentationRuntime };

export function createDiffPresentationModule(
    dependencies: DiffPresentationDependencies,
): DiffPresentationModule {
    const engine = new DiffPresentationEngine(dependencies);
    const runtime = getRuntime();

    return {
        capture(source) {
            return engine.capture(source);
        },

        present(request) {
            const owner = getOwner(runtime, request.owner);
            const companionReady = hasReadyCompanion(owner, request.surface);
            const prepared = engine.prepare(request, companionReady);
            if (!prepared) return emptySnapshot();

            const slot = getSlot(owner, request.surface);
            if (slot.key !== prepared.key) {
                slot.key = prepared.key;
                slot.generation++;
                slot.ready = prepared.render === undefined;
                slot.frame = prepared.render
                    ? retainStableBody(slot.frame, prepared.initial)
                    : prepared.initial;
                slot.pending = undefined;

                if (prepared.render) {
                    const generation = slot.generation;
                    const transaction = beginSettlement(request);
                    const pending = Promise.resolve()
                        .then(prepared.render)
                        .then((rendered) => {
                            if (slot.key !== prepared.key || slot.generation !== generation) return;
                            slot.frame = rendered;
                            slot.ready = true;
                        })
                        .catch(() => {
                            if (slot.key !== prepared.key || slot.generation !== generation) return;
                            slot.frame = prepared.initial;
                            slot.ready = true;
                        })
                        .finally(() => {
                            try { transaction.complete(); } catch { /* host settlement is best effort */ }
                            if (slot.key === prepared.key && slot.generation === generation) slot.pending = undefined;
                        });
                    // The chain catches rendering failures. This extra guard also contains a host-finalizer failure.
                    slot.pending = pending.catch(() => undefined);
                }
            }

            return snapshot(slot);
        },

        isPending(ownerKey) {
            const owner = runtime.owners.get(ownerKey);
            if (!owner) return false;
            return [...owner.slots.values()].some((slot) => slot.pending !== undefined);
        },

        reset() {
            runtime.owners = new WeakMap<object, OwnerPresentation>();
            engine.reset();
        },
    };
}

function getRuntime(): DiffPresentationRuntime {
    const root = globalThis as RuntimeGlobal;
    const current = root[RUNTIME_KEY];
    if (current?.version === RUNTIME_VERSION && current.owners instanceof WeakMap) return current;
    const created: DiffPresentationRuntime = {
        version: RUNTIME_VERSION,
        owners: new WeakMap<object, OwnerPresentation>(),
    };
    root[RUNTIME_KEY] = created;
    return created;
}

function getOwner(runtime: DiffPresentationRuntime, ownerKey: object): OwnerPresentation {
    let owner = runtime.owners.get(ownerKey);
    if (!owner) {
        owner = { slots: new Map<DiffPresentationSurface, PresentationSlot>() };
        runtime.owners.set(ownerKey, owner);
    }
    return owner;
}

function getSlot(owner: OwnerPresentation, surface: DiffPresentationSurface): PresentationSlot {
    let slot = owner.slots.get(surface);
    if (!slot) {
        slot = { generation: 0, ready: false };
        owner.slots.set(surface, slot);
    }
    return slot;
}

function hasReadyCompanion(owner: OwnerPresentation, surface: DiffPresentationSurface): boolean {
    const companion = surface === "edit-result"
        ? owner.slots.get("edit-call")
        : surface === "apply-result"
            ? owner.slots.get("apply-call")
            : undefined;
    return companion?.ready === true && Boolean(companion.frame?.body);
}

function retainStableBody(previous: PresentationFrame | undefined, initial: PresentationFrame): PresentationFrame {
    if (!previous?.body || previous.body.includes("rendering")) return initial;
    return { ...initial, body: previous.body };
}

function beginSettlement(request: DiffPresentationRequest): { complete(): void } {
    try {
        const transaction = request.settlement.begin();
        if (transaction && typeof transaction.complete === "function") return transaction;
    } catch { /* use no-op host below */ }
    return { complete() {} };
}

function snapshot(slot: PresentationSlot): DiffPresentationSnapshot {
    const current = slot.frame;
    return {
        headerSummary: current?.headerSummary,
        body: current?.body ?? "",
        affectedPaths: current?.affectedPaths ?? [],
        suppressCompanionResult: current?.suppressCompanionResult ?? false,
        pending: slot.pending !== undefined,
        settled: slot.pending ?? Promise.resolve(),
    };
}

function emptySnapshot(): DiffPresentationSnapshot {
    return {
        body: "",
        affectedPaths: [],
        suppressCompanionResult: false,
        pending: false,
        settled: Promise.resolve(),
    };
}
