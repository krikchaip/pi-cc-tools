import { bashShapeFamily, fixture } from "../family.ts";

export default bashShapeFamily.scenario({
  name: "narrow collapsed command header expands the full command",
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
    const collapsed = await terminal.expect("narrow-collapsed", {
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
    await terminal.expect("narrow-expanded", {
      visible: ["BASH_COMMAND_HIDDEN_FINAL"],
    });
  },
});
