import { bashFamily, fixture } from "../family.ts";

export default bashFamily.scenario({
  name: "collapsed command header expands the full command",
  start: {
    mode: "session",
    session: {
      path: fixture(
        "command-remainder/bash-command-remainder-click-session.jsonl",
      ),
      replaceCwd: "/tmp/pi-cc-tools-bash-command-remainder-click",
    },
    settings: { groupToolCalls: false },
  },
  async run(terminal) {
    const collapsed = await terminal.expect("collapsed", {
      visible: ["for i in 1 2 3; do"],
      absent: [
        "BASH_COLLAPSED_CONTINUATION_TARGET",
        "... 2 more lines",
        "BASH_COMMAND_HIDDEN_FINAL",
      ],
    });
    await terminal.perform({
      type: "click",
      at: collapsed.find("for i in 1 2 3; do"),
    });
    await terminal.expect("expanded", {
      visible: [
        "BASH_COLLAPSED_CONTINUATION_TARGET",
        "BASH_COMMAND_HIDDEN_FINAL",
      ],
    });
  },
});
