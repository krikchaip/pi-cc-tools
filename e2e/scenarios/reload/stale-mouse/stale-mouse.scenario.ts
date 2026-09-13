import { extension, fixture, reloadFamily } from "../family.ts";

export default reloadFamily.scenario({
  name: "reload repairs a retained stale Bash mouse handler",
  start: {
    mode: "session",
    loadExtensionsFromSettings: true,
    session: {
      path: fixture("stale-mouse/bash-command-click-standalone-session.jsonl"),
      replaceCwd: "/tmp/pi-cc-tools-bash-command-click",
    },
    settings: {
      groupToolCalls: false,
      extensions: [extension, fixture("stale-mouse/stale-tool-mouse-handler.ts")],
    },
  },
  async run(terminal) {
    await terminal.expect("click-anchor", {
      visible: [/Done.*10 lines.*click.*to expand/],
      absent: ["STANDALONE_RESULT_01"],
    });
    await terminal.perform({ type: "write", data: "/e2e-poison-tool-mouse\r" });
    await terminal.expect("poisoned", { visible: ["E2E_STALE_TOOL_MOUSE_HANDLER"] });
    await terminal.perform({ type: "write", data: "/reload\r" });
    await terminal.expect("reload-complete", {
      visible: ["Reloaded keybindings, extensions, skills, prompts, themes, and context files"],
    });
    const repaired = await terminal.expect("repaired-anchor", {
      visible: [/Done.*10 lines.*click.*to expand/],
      absent: ["STANDALONE_RESULT_01"],
    });
    await terminal.perform({ type: "click", at: repaired.find(/Done.*10 lines/) });
    await terminal.expect("repaired-expansion", { visible: ["STANDALONE_RESULT_01"] });
  },
});
