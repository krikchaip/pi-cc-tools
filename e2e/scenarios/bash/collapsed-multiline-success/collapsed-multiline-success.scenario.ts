import assert from "node:assert/strict";

import { bashFamily, fixture } from "../family.ts";

const summaryCommand = `tmux -L "$socket" send-keys -t "$session" C-o`;
const hiddenPrelude = "set -euo pipefail";
const hiddenTail = `printf '%s\\n' "$pane"`;

export default bashFamily.scenario({
  name: "collapsed multiline Bash successes hide script rows",
  start: {
    mode: "session",
    session: {
      path: fixture(
        "collapsed-multiline-success/bash-collapsed-multiline-success-session.jsonl",
      ),
      replaceCwd: "/tmp/pi-cc-tools-bash-collapsed-multiline-success",
    },
    settings: { groupToolCalls: false },
  },
  async run(terminal) {
    const collapsed = await terminal.expect("collapsed-success", {
      visible: [summaryCommand, /Done \(1 lines\)/],
      absent: [hiddenPrelude, hiddenTail, "BASH_SUCCESS_OUTPUT"],
    });
    const collapsedOccurrences = collapsed.lines.filter((line) =>
      line.includes(summaryCommand),
    ).length;

    await terminal.perform({
      type: "click",
      at: collapsed.find(summaryCommand),
    });
    const expanded = await terminal.expect("expanded-success", {
      visible: [
        "Bash script",
        hiddenPrelude,
        summaryCommand,
        hiddenTail,
        "BASH_SUCCESS_OUTPUT",
      ],
    });
    const expandedOccurrences = expanded.lines.filter((line) =>
      line.includes(summaryCommand),
    ).length;
    assert.equal(
      expandedOccurrences,
      1,
      `expanded Bash success summary command appeared ${expandedOccurrences} times\n${expanded.text}`,
    );
    assert.equal(
      collapsedOccurrences,
      1,
      `collapsed Bash success summary command appeared ${collapsedOccurrences} times\n${collapsed.text}`,
    );
  },
});
