import assert from "node:assert/strict";

import { bashShapeFamily, fixture, requireRow, requireTokenColumn } from "../family.ts";

export default bashShapeFamily.scenario({
  name: "standalone output preserves owned blank lines and indentation",
  start: {
    mode: "session",
    session: {
      path: fixture("output-shape/standalone-bash-output-shape-session.jsonl"),
      replaceCwd: "/tmp/pi-cc-tools-standalone-bash-output-shape",
    },
    settings: {
      outputPad: 1,
      bashCollapsedLines: 8,
      expandedPreviewMaxLines: 10,
      extraExpandedPreviewMaxLines: 15,
    },
  },
  async run(terminal) {
    const collapsed = await terminal.expect("collapsed", { visible: [/click.*to expand/] });
    await terminal.perform({ type: "click", at: collapsed.find(/click.*to expand/) });

    const level0 = await terminal.expect("level-0", {
      visible: ["Done (15 lines)", "BASH_NEWLINE_ROOT", "BASH_NEWLINE_FILLER_2", /click for more detail/],
    });
    await terminal.perform({ type: "click", at: level0.find(/click for more detail/) });

    const level1 = await terminal.expect("level-1", {
      visible: ["Done (15 lines)", "BASH_NEWLINE_ROOT", "BASH_NEWLINE_FILLER_4", /click for more detail/],
    });
    await terminal.perform({ type: "click", at: level1.find(/click for more detail/) });

    const level2 = await terminal.expect("level-2", {
      visible: ["Done (15 lines)", "BASH_NEWLINE_ROOT", "BASH_NEWLINE_END", /click to collapse/],
    });

    for (const [layer, frame] of [["L0", level0], ["L1", level1], ["L2", level2]] as const) {
      const summary = requireRow(frame, "Done (15 lines)");
      const root = requireRow(frame, "BASH_NEWLINE_ROOT");
      const child = requireRow(frame, "BASH_NEWLINE_CHILD");
      const mixed = requireRow(frame, "BASH_NEWLINE_MIXED");
      assert.equal(root, summary + 2, `${layer}: leading output-owned blank line changed`);
      assert.equal(child, root + 1, `${layer}: child row moved`);
      assert.equal(mixed, child + 3, `${layer}: internal output-owned blank lines changed`);
    }

    for (const token of ["BASH_NEWLINE_ROOT", "BASH_NEWLINE_CHILD", "BASH_NEWLINE_MIXED"]) {
      const columns = [level0, level1, level2].map((frame) => requireTokenColumn(frame, token));
      assert.ok(columns.every((column) => column === columns[0]), `${token}: indentation changed across layers: ${columns}`);
    }

    const end = requireRow(level2, "BASH_NEWLINE_END");
    const collapse = requireRow(level2, "click to collapse");
    assert.equal(collapse, end + 3, "trailing output-owned blank lines changed");
  },
});
