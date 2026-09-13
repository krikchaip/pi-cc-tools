import { bashFamily, fixture } from "../family.ts";

export default bashFamily.scenario({
  name: "expanded grouped command collapses its execution",
  start: {
    mode: "session",
    session: {
      path: fixture("group-collapse/bash-command-click-grouped-session.jsonl"),
      replaceCwd: "/tmp/pi-cc-tools-bash-command-click",
    },
    settings: { groupToolCalls: true },
  },
  async run(terminal) {
    const collapsed = await terminal.expect("collapsed-group", {
      visible: [/click.*any for details/],
      absent: ["GROUPED_COMMAND_CONTINUATION"],
    });
    await terminal.perform({ type: "click", at: collapsed.find("GROUPED_COMMAND_SOURCE") });

    const expanded = await terminal.expect("expanded-command", {
      visible: ["GROUPED_COMMAND_SOURCE", "GROUPED_COMMAND_CONTINUATION"],
    });
    await terminal.perform({ type: "click", at: expanded.find("GROUPED_COMMAND_SOURCE") });
    await terminal.expect("collapsed-again", {
      visible: [/click.*any for details/],
      absent: ["GROUPED_COMMAND_CONTINUATION"],
    });
  },
});
