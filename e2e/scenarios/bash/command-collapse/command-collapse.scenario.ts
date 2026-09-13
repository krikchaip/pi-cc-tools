import { bashFamily, fixture } from "../family.ts";

export default bashFamily.scenario({
  name: "expanded standalone command collapses its execution",
  start: {
    mode: "session",
    session: {
      path: fixture("command-collapse/bash-command-click-standalone-session.jsonl"),
      replaceCwd: "/tmp/pi-cc-tools-bash-command-click",
    },
    settings: { groupToolCalls: true },
  },
  async run(terminal) {
    const collapsed = await terminal.expect("collapsed", {
      visible: [/click.*to expand/],
      absent: ["STANDALONE_COMMAND_CONTINUATION"],
    });
    const summary = collapsed.find(/click.*to expand/);
    await terminal.perform({ type: "click", at: summary });

    const expanded = await terminal.expect("expanded", {
      visible: ["STANDALONE_COMMAND_SOURCE", "STANDALONE_COMMAND_CONTINUATION"],
    });
    const command = expanded.find("STANDALONE_COMMAND_SOURCE");
    await terminal.perform({ type: "click", at: command });
    await terminal.expect("collapsed-again", {
      visible: [/click.*to expand/],
      absent: ["STANDALONE_COMMAND_CONTINUATION"],
    });
  },
});
