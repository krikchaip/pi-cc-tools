import assert from "node:assert/strict";

import { bashFamily, fixture } from "../family.ts";

const command = "printf '%s\\n' success";

export default bashFamily.scenario({
  name: "collapsed Bash errors show the command once",
  start: {
    mode: "session",
    session: {
      path: fixture(
        "error-command-duplicate/bash-error-command-duplicate-session.jsonl",
      ),
      replaceCwd: "/tmp/pi-cc-tools-bash-error-command-duplicate",
    },
    settings: { groupToolCalls: false },
  },
  async run(terminal) {
    const collapsed = await terminal.expect("collapsed-error", {
      visible: [command, /Exit \d+ \(2 lines\)/],
      absent: ["BASH_FAILURE_OUTPUT"],
    });
    const collapsedOccurrences = collapsed.lines.filter((line) =>
      line.includes(command),
    ).length;

    await terminal.perform({ type: "click", at: collapsed.find(command) });
    const expanded = await terminal.expect("expanded-error", {
      visible: [
        "Bash command",
        command,
        "BASH_FAILURE_OUTPUT",
        "Command exited with code 7",
      ],
    });
    const expandedOccurrences = expanded.lines.filter((line) =>
      line.includes(command),
    ).length;
    assert.equal(
      expandedOccurrences,
      1,
      `expanded Bash error command appeared ${expandedOccurrences} times\n${expanded.text}`,
    );
    assert.equal(
      collapsedOccurrences,
      1,
      `collapsed Bash error command appeared ${collapsedOccurrences} times\n${collapsed.text}`,
    );
  },
});
