import assert from "node:assert/strict";

import { clickFamily, fixture, repaint } from "../../family.ts";

const viewport = { columns: 100, rows: 40 } as const;
const family = clickFamily(viewport, {
  previewLines: 3,
  bashCollapsedLines: 3,
  expandedPreviewMaxLines: 50,
  extraExpandedPreviewMaxLines: 100,
  groupToolCalls: true,
});

export default family.scenario({
  name: "effective final level one has one terminal collapse action",
  start: {
    mode: "session",
    session: {
      path: fixture("result-summary/level-one/effective-final-level-one-session.jsonl"),
      replaceCwd: "/tmp/pi-cc-tools-result-summary-acceptance",
    },
  },
  async run(terminal) {
    const collapsed = await terminal.expect("collapsed", { visible: [/6 lines loaded.*click.*to expand/] });
    await terminal.perform({ type: "click", at: collapsed.find(/6 lines loaded/) });
    const normal = await terminal.expect("normal-preview", {
      visible: ["image4 payload 03", /click.*for more detail/],
    });
    await terminal.perform({ type: "click", at: normal.find(/click.*for more detail/) });
    await terminal.expect("effective-final", {
      visible: [
        "image4 payload 05",
        "[23 more lines in file. Use offset=230 to continue.]",
        /click.*to collapse/,
      ],
      absent: [/click.*for more detail/],
    });
    const final = await repaint(terminal, viewport);
    assert.match(final.lines.find((line) => line.includes("6 lines loaded")) ?? "", /^\s*├/);
    for (const token of ["image4 payload 01", "image4 payload 02", "image4 payload 03", "image4 payload 04", "image4 payload 05", "[23 more lines in file. Use offset=230 to continue.]"]) {
      assert.match(final.lines.find((line) => line.includes(token)) ?? "", /^\s*│/, `${token} must continue the branch`);
    }
    const collapseRow = final.lines.find((line) => /click.*to collapse/.test(line)) ?? "";
    assert.match(collapseRow, /^\s*└/);
    await terminal.perform({ type: "click", at: final.find(/click.*to collapse/) });
    await terminal.expect("recollapsed", {
      visible: [/click.*to expand/],
      absent: ["image4 payload", /click.*(?:for more detail|to collapse)/],
    });
  },
});
