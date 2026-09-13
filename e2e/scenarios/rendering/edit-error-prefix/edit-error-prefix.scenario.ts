import assert from "node:assert/strict";

import { fixture, repaint, renderingFamily } from "../family.ts";

const viewport = { columns: 88, rows: 32 } as const;
const errorToken = "EDIT_ERROR_PREFIX_SENTINEL";
const family = renderingFamily(viewport, {
  clickExpansion: true,
  groupToolCalls: false,
});

export default family.scenario({
  name: "completed Edit errors use connector-free indentation",
  start: {
    mode: "session",
    session: {
      path: fixture("edit-error-prefix/edit-error-prefix-session.jsonl"),
      replaceCwd: "/tmp/pi-cc-tools-edit-error-prefix",
    },
  },
  async run(terminal) {
    await terminal.expect("edit-error-ready", {
      visible: ["EDIT_ERROR_PREFIX_READY", errorToken],
    });
    await repaint(terminal, viewport);
    const frame = await terminal.expect("edit-error-repaint", {
      visible: ["EDIT_ERROR_PREFIX_READY", errorToken],
    });

    const rows = frame.lines.filter((line) => line.includes(errorToken));
    assert.equal(rows.length, 1, `expected one Edit error row, found ${rows.length}\n${frame.text}`);
    assert.ok(
      rows[0]!.startsWith(`  ${errorToken}`),
      `Edit error is not aligned with exactly two leading spaces: ${JSON.stringify(rows[0])}`,
    );
    assert.doesNotMatch(rows[0]!, /^\s*[├│└] /, "Edit error retained a branch connector");
  },
});
