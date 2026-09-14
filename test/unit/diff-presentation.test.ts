import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createDiffPresentationModule } from "../../extensions/diff-presentation/index.ts";

const theme = {
    fg(_color: string, text: string) {
        return text;
    },
} as any;

function plain(text: string): string {
    return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function assertDeepFrozen(value: unknown): void {
    if (!value || typeof value !== "object") return;
    assert.equal(Object.isFrozen(value), true);
    for (const child of Object.values(value)) assertDeepFrozen(child);
}

test("captures serializable Write evidence and presents it through one settled seam", async () => {
    const presentation = createDiffPresentationModule({
        readSettings: () => ({
            diffCollapsedLines: 24,
            expandedPreviewMaxLines: 150,
            extraExpandedPreviewMaxLines: 240,
        }),
    });
    const evidence = await presentation.capture({
        kind: "write",
        path: "fixture.ts",
        before: "const value = 1;\n",
        after: "const value = 2;\n",
    });

    assert.ok(evidence);
    const restoredEvidence: unknown = JSON.parse(JSON.stringify(evidence));
    let settlements = 0;
    const request = {
        owner: {},
        surface: "write-result" as const,
        evidence: restoredEvidence,
        view: {
            width: 120,
            expanded: false,
            localDetail: 0 as const,
            localClickControls: false,
            theme,
        },
        settlement: {
            begin() {
                return { complete() { settlements += 1; } };
            },
        },
    };

    const first = presentation.present(request);
    await first.settled;
    const settled = presentation.present(request);
    const output = plain(settled.body);

    assert.equal(settled.pending, false);
    assert.match(output, /\+1/);
    assert.match(output, /-1/);
    assert.match(output, /const value = 1;/);
    assert.match(output, /const value = 2;/);
    assert.equal(settlements, 1);
});

test("owns incomplete Apply Patch headers without starting body presentation", async () => {
    const presentation = createDiffPresentationModule({ readSettings: () => ({}) });
    const owner = {};
    let settlements = 0;
    const base = {
        owner,
        surface: "apply-call" as const,
        source: {
            kind: "apply-patch" as const,
            cwd: "/tmp",
            patchText: [
                "*** Begin Patch",
                "*** Add File: first.ts",
                "+const first = true;",
                "*** Add File: second.ts",
                "+const second = true;",
                "*** End Patch",
            ].join("\n"),
        },
        view: {
            width: 120,
            expanded: false,
            localDetail: 0 as const,
            localClickControls: false,
            theme,
        },
        settlement: {
            begin() {
                settlements += 1;
                return { complete() {} };
            },
        },
    };
    const snapshot = presentation.present({ ...base, sourceComplete: false });

    assert.equal(plain(snapshot.headerSummary ?? ""), "first.ts (+1 files)");
    assert.equal(snapshot.body, "");
    assert.equal(snapshot.pending, false);
    assert.equal(settlements, 0);

    const complete = presentation.present({ ...base, sourceComplete: true });
    await complete.settled;
    const expanded = presentation.present({
        ...base,
        sourceComplete: true,
        view: { ...base.view, expanded: true },
    });
    await expanded.settled;
    assert.match(plain(presentation.present({
        ...base,
        sourceComplete: true,
        view: { ...base.view, expanded: true },
    }).body), /const second = true;/);
});

test("Apply Patch evidence preserves Update inference after the source file changes", async (t) => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-cc-diff-evidence-"));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    const filePath = join(cwd, "fixture.ts");
    await writeFile(filePath, [
        "const one = 1;",
        "const two = 2;",
        "const three = 3;",
        "const value = 1;",
        "const tail = true;",
        "",
    ].join("\n"));
    const patchText = [
        "*** Begin Patch",
        "*** Update File: fixture.ts",
        "@@",
        " const three = 3;",
        "-const value = 1;",
        "+const value = 2;",
        " const tail = true;",
        "*** End Patch",
    ].join("\n");
    const presentation = createDiffPresentationModule({ readSettings: () => ({}) });
    const evidence = await presentation.capture({ kind: "apply-patch", patchText, cwd });
    assert.ok(evidence);
    assertDeepFrozen(evidence);
    const restoredEvidence: unknown = JSON.parse(JSON.stringify(evidence));

    const present = async (owner: object): Promise<string> => {
        const request = {
            owner,
            surface: "apply-call" as const,
            evidence: restoredEvidence,
            view: {
                width: 120,
                expanded: false,
                localDetail: 0 as const,
                localClickControls: false,
                theme,
            },
            settlement: { begin: () => ({ complete() {} }) },
        };
        const first = presentation.present(request);
        await first.settled;
        return plain(presentation.present(request).body);
    };

    const beforeMutation = await present({});
    await writeFile(filePath, "const unrelated = true;\n");
    const afterMutation = await present({});
    await rm(filePath);
    const afterRemoval = await present({});

    assert.match(beforeMutation, /at line 4/);
    assert.match(beforeMutation, /const value = 1;/);
    assert.match(beforeMutation, /const value = 2;/);
    assert.equal(afterMutation, beforeMutation);
    assert.equal(afterRemoval, beforeMutation);
});

test("result suppression updates after its async call presentation settles", async () => {
    const presentation = createDiffPresentationModule({
        readSettings: () => ({}),
        readFile: async () => "const value = 1;\n",
    });
    const owner = {};
    const source = {
        kind: "edit" as const,
        path: "fixture.ts",
        cwd: "/tmp",
        edits: [{ oldText: "const value = 1;", newText: "const value = 2;" }],
    };
    const base = {
        owner,
        source,
        view: {
            width: 120,
            expanded: false,
            localDetail: 0 as const,
            localClickControls: false,
            theme,
        },
        settlement: { begin: () => ({ complete() {} }) },
    };

    const call = presentation.present({ ...base, surface: "edit-call" });
    const resultBeforeCallSettles = presentation.present({ ...base, surface: "edit-result" });
    assert.notEqual(resultBeforeCallSettles.body, "");

    await call.settled;
    const resultAfterCallSettles = presentation.present({ ...base, surface: "edit-result" });
    assert.equal(resultAfterCallSettles.body, "");
    assert.equal(resultAfterCallSettles.suppressCompanionResult, true);
});
