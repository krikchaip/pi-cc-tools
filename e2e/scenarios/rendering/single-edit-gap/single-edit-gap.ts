import assert from "node:assert/strict";

import type { TerminalSession, Viewport } from "../../../terminal-session.ts";
import { fixture, renderingFamily } from "../family.ts";

const summary = /\+1\s+-1.*1 hunk/;
export const singleEditProvider = fixture("single-edit-gap/single-edit-gap-provider.ts");
export const singleEditWorkspace = {
  files: [{ path: "single-edit-gap.ts", content: "export const value = 'before';\n" }],
} as const;

export function singleEditFamily(viewport: Viewport) {
  return renderingFamily(viewport, {
    clickExpansion: false,
    groupToolCalls: false,
  });
}

export async function captureSingleEdit(terminal: TerminalSession, viewport: Viewport) {
  await terminal.expect("provider-complete", {
    visible: ["E2E_SINGLE_EDIT_COMPLETE", summary],
    stableForMs: 750,
  });
  await terminal.perform({
    type: "resize",
    viewport: { columns: viewport.columns + 1, rows: viewport.rows },
  });
  await delay(250);
  await terminal.perform({ type: "resize", viewport });
  await delay(500);
  await terminal.perform({ type: "key", key: "ctrl-c" });
  await terminal.perform({ type: "key", key: "ctrl-c" });
  await delay(100);
  return terminal.evidence("settled-edit");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function assertOpeningAdjacent(
  frame: Awaited<ReturnType<typeof captureSingleEdit>>,
  layout: "unified" | "split",
): void {
  const summaryRows = frame.lines
    .map((row, index) => summary.test(row) ? index : -1)
    .filter((index) => index >= 0);
  assert.equal(summaryRows.length, 1, `${layout}: expected one live Edit summary, found ${summaryRows.length}\n${frame.text}`);
  const summaryRow = summaryRows[0]!;
  const adjacent = frame.lines[summaryRow + 1];
  assert.notEqual(adjacent, undefined, `${layout}: summary is too close to terminal bottom`);

  if (layout === "unified") {
    assert.ok(adjacent!.includes("────"), `unified: top diff border is not directly after summary: ${JSON.stringify(adjacent)}`);
  } else {
    assert.ok(
      adjacent!.includes("old") && adjacent!.includes("new") && adjacent!.includes("┊"),
      `split: old ┊ new header is not directly after summary: ${JSON.stringify(adjacent)}`,
    );
  }
}
