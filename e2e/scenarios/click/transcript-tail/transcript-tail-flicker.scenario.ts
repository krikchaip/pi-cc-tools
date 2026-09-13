import assert from "node:assert/strict";

import { replaySynchronizedFrames } from "./ansi-frames.ts";
import { clickFamily, fixture, repaint } from "../family.ts";

const viewport = { columns: 100, rows: 40 } as const;
const family = clickFamily(viewport, {
  previewLines: 3,
  expandedPreviewMaxLines: 100,
  extraExpandedPreviewMaxLines: 200,
  groupToolCalls: false,
});

export default family.scenario({
  name: "newest tool expansion never paints a shifted transcript tail",
  start: {
    mode: "session",
    session: {
      path: fixture("transcript-tail/transcript-tail-click-session.jsonl"),
      replaceCwd: "/tmp/pi-cc-tools-transcript-tail-click",
    },
  },
  async run(terminal) {
    await terminal.expect("collapsed", { visible: [/70 lines loaded.*click.*to expand/] });
    const before = await repaint(terminal, viewport);
    const headerRow = before.find("transcript-tail.txt").row;
    await terminal.perform({ type: "click", at: before.find(/70 lines loaded/) });
    const expanded = await terminal.expect("expanded", { visible: ["TAIL_PAYLOAD_03"] });
    const transition = expanded.raw.slice(before.raw.length);
    const frames = await replaySynchronizedFrames(before.lines, transition, viewport.columns, viewport.rows);
    const observedRows = frames.flatMap((frame) => {
      const row = frame.findIndex((line) => line.includes("transcript-tail.txt"));
      return row === -1 ? [] : [row + 1];
    });
    assert.ok(frames.some((frame) => frame.some((line) => line.includes("TAIL_PAYLOAD_03"))), "expansion transition was not captured");
    assert.ok(observedRows.length > 0, "tool header was absent from every expansion frame");
    assert.deepEqual([...new Set(observedRows)], [headerRow], `tool header shifted during repaint: ${observedRows.join(", ")}`);
  },
});
