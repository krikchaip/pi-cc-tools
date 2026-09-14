import assert from "node:assert/strict";

import type { FrameEvidence, TerminalSession } from "../../../terminal-session.ts";
import { fixture, repaint, renderingFamily } from "../family.ts";

export const editLineViewport = { columns: 180, rows: 80 } as const;
export const editLineFamily = renderingFamily(editLineViewport, {
  clickExpansion: true,
  expandedPreviewMaxLines: 100,
  extraExpandedPreviewMaxLines: 200,
  groupToolCalls: false,
});
export const editLineProvider = fixture("edit-line-numbers/edit-line-number-provider.ts");
export const editLineWorkspace = {
  files: [{
    path: "edit-line-numbers.txt",
    content: `${Array.from({ length: 420 }, (_, index) => `ORIGINAL_${String(index + 1).padStart(3, "0")}`).join("\n")}\n`,
  }],
} as const;

export async function captureEditLineFrames(
  terminal: TerminalSession,
  summary: string,
): Promise<{ collapsed: FrameEvidence; expanded: readonly FrameEvidence[] }> {
  await terminal.expect("provider-complete", {
    visible: ["E2E_EDIT_LINE_NUMBERS_COMPLETE"],
    stableForMs: 750,
  });
  await repaint(terminal, editLineViewport);
  await findVisibleFrame(terminal, "collapsed-summary", summary, "page-up", 4);
  const collapsed = await terminal.expect("collapsed-click-ready", {
    visible: [summary],
    stableForMs: 500,
  });
  await terminal.perform({ type: "click", at: collapsed.find(summary) });
  await terminal.expect("expanded-ready", {
    visible: [/click to collapse|more diff lines/],
    stableForMs: 500,
  });
  await repaint(terminal, editLineViewport);

  const expanded: FrameEvidence[] = [await terminal.evidence("expanded-page-0")];
  for (let page = 1; page <= 2; page += 1) {
    await terminal.perform({ type: "key", key: "page-down" });
    await delay(100);
    await repaint(terminal, editLineViewport);
    expanded.push(await terminal.evidence(`expanded-page-${page}`));
  }
  return { collapsed, expanded };
}

export function assertLastLineNumber(
  collapsed: FrameEvidence,
  expanded: readonly FrameEvidence[],
  token: string,
  expected: number,
): void {
  const collapsedNumbers = lineNumbers([collapsed], token);
  const expandedNumbers = lineNumbers(expanded, token);
  assert.equal(collapsedNumbers.at(-1)?.number, expected, `${token}: wrong collapsed line number`);
  assert.equal(expandedNumbers.at(-1)?.number, expected, `${token}: line number changed after expansion`);
}

export function assertLineNumberPair(
  collapsed: FrameEvidence,
  expanded: readonly FrameEvidence[],
  token: string,
  expected: readonly [number, number],
): void {
  const wanted = [
    { number: expected[0], sign: "-" },
    { number: expected[1], sign: "+" },
  ];
  assert.deepEqual(lineNumbers([collapsed], token), wanted, `${token}: wrong collapsed line-number pair`);
  assert.deepEqual(lineNumbers(expanded, token), wanted, `${token}: pair changed after expansion`);
}

async function findVisibleFrame(
  terminal: TerminalSession,
  evidencePrefix: string,
  token: string,
  direction: "page-up" | "page-down",
  pages: number,
): Promise<FrameEvidence> {
  for (let page = 0; page < pages; page += 1) {
    const frame = await terminal.evidence(`${evidencePrefix}-${page}`);
    if (frame.text.includes(token)) return frame;
    await terminal.perform({ type: "key", key: direction });
    await delay(100);
    await repaint(terminal, editLineViewport);
  }
  throw new Error(`could not locate ${JSON.stringify(token)} within ${pages} terminal pages`);
}

function lineNumbers(frames: readonly FrameEvidence[], token: string): Array<{ number: number; sign: string }> {
  const frame = [...frames].reverse().find((candidate) => candidate.lines.some((row) => row.includes(token)));
  assert.ok(frame, `no captured frame contains ${JSON.stringify(token)}`);
  const rows = frame.lines.filter((row) => row.includes(token));
  assert.equal(rows.length, 1, `${token}: expected one matching row, found ${rows.length}`);
  const numbers = [...rows[0]!.matchAll(/\b(\d+)\s*([-+])/g)].map((match) => ({
    number: Number(match[1]),
    sign: match[2]!,
  }));
  assert.ok(numbers.length > 0, `${token}: no diff line number found in ${JSON.stringify(rows[0])}`);
  return numbers;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
