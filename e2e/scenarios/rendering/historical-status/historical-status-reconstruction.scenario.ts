import assert from "node:assert/strict";

import type { FrameEvidence } from "../../../terminal-session.ts";
import { fixture, repaint, renderingFamily } from "../family.ts";

const viewport = { columns: 88, rows: 32 } as const;
const tokens = ["COMPLETED_HISTORY_STATUS.txt", "SETTLED_PARTIAL_TREE_LEAF.txt"] as const;
const successSgr = "\u001b[38;2;181;189;104m";
const family = renderingFamily(viewport, { groupToolCalls: false });

export default family.scenario({
  name: "historical completed tools remain solid success rows",
  start: {
    mode: "session",
    session: {
      path: fixture("historical-status/historical-status-reconstruction-session.jsonl"),
      replaceCwd: "/tmp/pi-cc-tools-historical-status",
    },
  },
  async run(terminal) {
    await terminal.expect("historical-ready", { visible: [...tokens] });
    await repaint(terminal, viewport);
    const frames: FrameEvidence[] = [
      await terminal.expect("initial", { visible: [...tokens] }),
    ];

    for (let phase = 1; phase <= 4; phase += 1) {
      await delay(300);
      await repaint(terminal, viewport);
      frames.push(await terminal.expect(`phase-${phase}`, { visible: [...tokens] }));
    }

    const reference = successfulRows(frames[0]!);
    assertInitialSuccessAnsi(frames[0]!);
    for (const frame of frames.slice(1)) {
      assert.deepEqual(
        successfulRows(frame),
        reference,
        `${frame.name}: historical success rows changed across the blink cycle`,
      );
    }
  },
});

function successfulRows(frame: FrameEvidence): Readonly<Record<string, string>> {
  const rows: Record<string, string> = {};
  for (const token of tokens) {
    const matches = frame.lines.filter((row) => row.includes(token));
    assert.equal(matches.length, 1, `${frame.name}: expected one row for ${token}, found ${matches.length}\n${frame.text}`);
    const row = matches[0]!;
    assert.match(row, new RegExp(`^\\s*●\\s+Read\\s+.*${escapeRegExp(token)}`));
    assert.ok(!row.includes("○"), `${frame.name}: ${token} retained an idle hollow dot`);
    rows[token] = row;
  }
  return rows;
}

function assertInitialSuccessAnsi(frame: FrameEvidence): void {
  for (const token of tokens) {
    const tokenIndex = frame.raw.lastIndexOf(token);
    assert.notEqual(tokenIndex, -1, `initial raw capture lacks ${token}`);
    const sgrIndex = frame.raw.lastIndexOf(successSgr, tokenIndex);
    assert.ok(sgrIndex >= Math.max(0, tokenIndex - 1_000), `${token} lacks nearby success ANSI ${JSON.stringify(successSgr)}`);
    assert.ok(frame.raw.slice(sgrIndex, tokenIndex).includes("●"), `${token} lacks a solid success status dot`);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
