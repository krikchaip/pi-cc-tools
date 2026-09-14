import assert from "node:assert/strict";
import test from "node:test";

import { wrapTextWithAnsi } from "@earendil-works/pi-tui";

import { installClickExpansion } from "../../extensions/click-expansion/index.ts";
import { shouldDispatchRawMouseFallback } from "../../extensions/click-expansion/mouse.ts";

test("raw mouse fallback runs only when native dispatch did not handle the click", () => {
    assert.equal(shouldDispatchRawMouseFallback(false, false), true);
    assert.equal(shouldDispatchRawMouseFallback(true, false), true);
    assert.equal(shouldDispatchRawMouseFallback(true, true), false);
});

test("publishes inactive expansion copy without leaking semantic markers", () => {
    const runtime = installClickExpansion({ enabled: false });
    const execution = {};
    const target = { kind: "tool-execution", execution } as const;

    const declared = runtime.declare(
        target,
        { active: "8 lines loaded • click to expand", inactive: "8 lines loaded • ctrl+o to expand" },
    );

    assert.deepEqual(runtime.publish({}, [`├─ ${declared}   `]), [
        "├─ 8 lines loaded • ctrl+o to expand   ",
    ]);
    assert.deepEqual(runtime.state(target), {
        active: false,
        localExpansion: "collapsed",
        localDetail: 0,
    });
});

test("uses active expansion copy only in fullscreen collapsed mode", () => {
    const runtime = installClickExpansion({ enabled: true });
    const globalExpansion = Symbol.for("pi-claude-style-tools:tool-click-global-expanded");
    const execution: { ui: Record<PropertyKey, unknown> } = { ui: { mode: "fullscreen" } };
    const target = { kind: "tool-execution", execution } as const;
    const copy = { active: "click to expand", inactive: "ctrl+o to expand" };

    const publishCopy = (): string => {
        const [row] = runtime.publish({}, [runtime.declare(target, copy)]);
        return row;
    };

    assert.equal(publishCopy(), "click to expand");
    execution.ui[globalExpansion] = true;
    assert.equal(publishCopy(), "ctrl+o to expand");
    execution.ui[globalExpansion] = false;
    execution.ui.mode = "regular";
    assert.equal(publishCopy(), "ctrl+o to expand");
});

test("projects retained local expansion and detail state", () => {
    const runtime = installClickExpansion({ enabled: true });
    const localExpansion = Symbol.for("pi-claude-style-tools:tool-click-local-expanded");
    const detailLevel = Symbol.for("pi-claude-style-tools:tool-click-detail-level");
    const execution: Record<PropertyKey, unknown> = {
        ui: { mode: "fullscreen" },
        rendererState: { [detailLevel]: 2 },
        [localExpansion]: true,
    };

    assert.deepEqual(runtime.state({ kind: "tool-execution", execution }), {
        active: true,
        localExpansion: "expanded",
        localDetail: 2,
    });
});

test("declared content wraps by visible text width and publishes marker-free rows", () => {
    const runtime = installClickExpansion({ enabled: true });
    const execution = { ui: { mode: "fullscreen" } };
    const target = { kind: "tool-execution", execution } as const;

    const marked = runtime.declare(target, "abcdefghij");
    const wrapped = wrapTextWithAnsi(marked, 5);

    assert.deepEqual(runtime.publish({}, wrapped), ["abcde", "fghij"]);
});

test("publishes final visible anchor spans through runtime-owned hit testing", () => {
    const runtime = installClickExpansion({ enabled: true });
    const execution: Record<PropertyKey, unknown> = { ui: { mode: "fullscreen" } };
    const target = { kind: "tool-execution", execution } as const;

    const declared = runtime.declare(target, "click to expand");
    assert.deepEqual(runtime.publish(execution, [`├─ ${declared}   `]), [
        "├─ click to expand   ",
    ]);
    const hitTest = execution.clickAnchorAtPoint as ((x: number, y: number) => unknown) | undefined;
    assert.deepEqual(hitTest?.(3, 0), {
        line: 0,
        start: 3,
        end: 18,
        tool: execution,
        action: "expand",
        viewportAnchor: "top",
    });
    assert.equal(hitTest?.(18, 0), undefined);
});

test("repeated exact text keeps each declaration's final coordinates", () => {
    const runtime = installClickExpansion({ enabled: true });
    const firstExecution = { id: "first", ui: { mode: "fullscreen" } };
    const secondExecution = { id: "second", ui: { mode: "fullscreen" } };
    const owner: Record<PropertyKey, unknown> = {};
    const first = runtime.declare(
        { kind: "tool-execution", execution: firstExecution },
        "same",
        { span: { text: "same" } },
    );
    const second = runtime.declare(
        { kind: "tool-execution", execution: secondExecution },
        "same",
        { span: { text: "same" } },
    );

    assert.deepEqual(runtime.publish(owner, [`${first} / ${second}`]), ["same / same"]);
    const hitTest = owner.clickAnchorAtPoint as ((x: number, y: number) => any) | undefined;
    assert.equal(hitTest?.(0, 0)?.tool, firstExecution);
    assert.equal(hitTest?.(7, 0)?.tool, secondExecution);
});

test("group owners hit-test final anchors against the declared execution", () => {
    const runtime = installClickExpansion({ enabled: true });
    const execution = { ui: { mode: "fullscreen" } };
    const owner: Record<PropertyKey, unknown> = {};
    const declared = runtime.declare(
        { kind: "tool-execution", execution },
        "Read package.json",
    );

    runtime.publish(owner, ["├─ ok  " + declared]);

    const hitTest = owner.clickAnchorAtPoint as ((x: number, y: number) => unknown) | undefined;
    assert.equal(typeof hitTest, "function");
    assert.deepEqual(hitTest?.(8, 0), {
        line: 0,
        start: 3,
        end: 24,
        tool: execution,
        action: "header",
        viewportAnchor: "top",
    });
    assert.equal(hitTest?.(24, 0), undefined);
});

test("group declarations preserve header and Agent lifecycle expand routing", () => {
    const runtime = installClickExpansion({ enabled: true });
    const execution = { ui: { mode: "fullscreen" } };
    const owner: Record<PropertyKey, unknown> = {};
    type InternalDeclaration = NonNullable<Parameters<typeof runtime.declare>[2]> & {
        compatibilityAction?: "header" | "expand";
    };
    const header = runtime.declare(
        { kind: "tool-execution", execution },
        "general-purpose :: Agent fixture",
        { behavior: "toggle", compatibilityAction: "header" } as InternalDeclaration,
    );
    const lifecycle = runtime.declare(
        { kind: "tool-execution", execution },
        "Spawned [inherited | interactive]",
        { behavior: "toggle", viewport: "adaptive", compatibilityAction: "expand" } as InternalDeclaration,
    );

    runtime.publish(owner, [`├─ ${header}`, `│ ├ ${lifecycle}`]);

    const hitTest = owner.clickAnchorAtPoint as ((x: number, y: number) => any) | undefined;
    assert.equal(hitTest?.(4, 0)?.action, "header");
    assert.equal(hitTest?.(5, 1)?.action, "expand");
});

test("group owner activation mutates only the declared execution", () => {
    const runtime = installClickExpansion({ enabled: true });
    let renders = 0;
    const execution: any = {
        expanded: false,
        rendererState: {},
        ui: { mode: "fullscreen", requestRender: () => renders++ },
        setExpanded(expanded: boolean) {
            this.expanded = expanded;
        },
    };
    const peer: any = { expanded: false };
    const owner: Record<PropertyKey, unknown> = {};
    const declared = runtime.declare(
        { kind: "tool-execution", execution },
        "Read package.json",
    );
    runtime.publish(owner, ["├─ " + declared]);

    const toggle = owner.toggleToolAtPoint as ((x: number, y: number) => boolean) | undefined;
    const captureRollback = owner.captureClickRollbackAtPoint as ((x: number, y: number) => () => void) | undefined;
    assert.equal(typeof toggle, "function");
    assert.equal(typeof captureRollback, "function");
    const rollback = captureRollback?.(4, 0);
    assert.equal(toggle?.(4, 0), true);
    assert.equal(execution.expanded, true);
    assert.equal(peer.expanded, false);
    assert.equal(renders, 1);
    assert.equal(runtime.state({ kind: "tool-execution", execution }).localExpansion, "expanded");

    rollback?.();
    assert.equal(execution.expanded, false);
    assert.equal(peer.expanded, false);
    assert.equal(renders, 2);
    assert.equal(runtime.state({ kind: "tool-execution", execution }).localExpansion, "collapsed");
});

test("reload keeps the runtime root and retained hit-test closures current", () => {
    const runtimeBeforeReload = installClickExpansion({ enabled: true });
    const execution = { ui: { mode: "fullscreen" } };
    const owner: Record<PropertyKey, unknown> = {};
    const before = runtimeBeforeReload.declare(
        { kind: "tool-execution", execution },
        "before reload",
    );
    runtimeBeforeReload.publish(owner, [`├─ ${before}`]);
    const retainedHitTest = owner.clickAnchorAtPoint as (x: number, y: number) => any;
    assert.equal(retainedHitTest(3, 0)?.end, 16);

    const runtimeAfterReload = installClickExpansion({ enabled: true });
    const after = runtimeAfterReload.declare(
        { kind: "tool-execution", execution },
        "after reload",
    );
    runtimeAfterReload.publish(owner, [`├─ ${after}`]);

    assert.equal(runtimeAfterReload, runtimeBeforeReload);
    assert.deepEqual(retainedHitTest(3, 0), {
        line: 0,
        start: 3,
        end: 15,
        tool: execution,
        action: "header",
        viewportAnchor: "top",
    });
    assert.equal(owner[Symbol.for("pi-claude-style-tools:tool-click-anchors")], undefined);
});

test("removed grouped targets cannot activate through the retained bridge", () => {
    const runtime = installClickExpansion({ enabled: true });
    const execution = {
        expanded: false,
        rendererState: {},
        ui: { mode: "fullscreen" },
        setExpanded(expanded: boolean) {
            this.expanded = expanded;
        },
    };
    const target = { kind: "tool-execution", execution } as const;
    const owner = {};
    type InternalDeclaration = NonNullable<Parameters<typeof runtime.declare>[2]> & {
        compatibilityAction?: "header";
    };
    const declared = runtime.declare(
        target,
        "grouped target",
        { compatibilityAction: "header" } as InternalDeclaration,
    );
    runtime.publish(owner, [declared]);
    runtime.publish(owner, []);

    type Target = typeof target;
    const activate = (globalThis as any)[
        Symbol.for("pi-claude-style-tools:click-expansion-activate-target:v1")
    ] as (candidate: Target, behavior: "toggle", viewport: "top", action: "header") => boolean;
    assert.equal(activate(target, "toggle", "top", "header"), false);
    assert.equal(execution.expanded, false);
});

test("Pi-owned transcript targets inherit retained fullscreen interaction state", () => {
    const legacyRuntime = Symbol.for("pi-claude-style-tools:click-runtime");
    const globalRecord = globalThis as typeof globalThis & Record<PropertyKey, unknown>;
    globalRecord[legacyRuntime] = {
        activeInteractiveMode: {
            toolOutputExpanded: false,
            ui: {},
        },
    };
    try {
        const runtime = installClickExpansion({ enabled: true });
        const transcript = {};
        assert.equal(runtime.state({ kind: "pi-owned-transcript", transcript }).active, true);
        (globalRecord[legacyRuntime] as any).activeInteractiveMode.toolOutputExpanded = true;
        assert.equal(runtime.state({ kind: "pi-owned-transcript", transcript }).active, false);
    } finally {
        delete globalRecord[legacyRuntime];
    }
});
