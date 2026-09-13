import assert from "node:assert/strict";

import { bashFamily, fixture, requireRow } from "../family.ts";

export default bashFamily.scenario({
  name: "command omission row expands the full command",
  start: {
    mode: "session",
    session: {
      path: fixture("command-remainder/bash-command-remainder-click-session.jsonl"),
      replaceCwd: "/tmp/pi-cc-tools-bash-command-remainder-click",
    },
    settings: { groupToolCalls: false, bashCommandPreviewLines: 8 },
  },
  async run(terminal) {
    const collapsed = await terminal.expect("truncated-command", {
      visible: ["... 2 more lines"],
      absent: ["BASH_COMMAND_HIDDEN_FINAL"],
    });
    const omissionRow = requireRow(collapsed, "... 2 more lines");
    assert.doesNotMatch(collapsed.lines[omissionRow]!, /click to expand/);
    await terminal.perform({ type: "click", at: collapsed.find("... 2 more lines") });
    await terminal.expect("expanded-command", { visible: ["BASH_COMMAND_HIDDEN_FINAL"] });
  },
});
