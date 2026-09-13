import { bashFamily, fixture } from "../family.ts";

export default bashFamily.scenario({
  name: "collapsed command continuation expands the full command",
  start: {
    mode: "session",
    session: {
      path: fixture("command-remainder/bash-command-remainder-click-session.jsonl"),
      replaceCwd: "/tmp/pi-cc-tools-bash-command-remainder-click",
    },
    settings: { groupToolCalls: false, bashCommandPreviewLines: 8 },
  },
  async run(terminal) {
    const collapsed = await terminal.expect("collapsed", {
      visible: ["BASH_COLLAPSED_CONTINUATION_TARGET"],
      absent: ["BASH_COMMAND_HIDDEN_FINAL"],
    });
    await terminal.perform({ type: "click", at: collapsed.find("BASH_COLLAPSED_CONTINUATION_TARGET") });
    await terminal.expect("expanded", { visible: ["BASH_COMMAND_HIDDEN_FINAL"] });
  },
});
