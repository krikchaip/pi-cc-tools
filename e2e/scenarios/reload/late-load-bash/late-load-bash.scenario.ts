import { fixture, reloadFamily, repositoryRoot } from "../family.ts";

const enabledSettings = {
  quietStartup: true,
  theme: "dark",
  outputPad: 0,
  clickExpansion: true,
  groupToolCalls: true,
  packages: [repositoryRoot],
} as const;

export default reloadFamily.scenario({
  name: "first package load installs Bash click anchors",
  start: {
    mode: "session",
    loadExtensionsFromSettings: true,
    session: {
      path: fixture("late-load-bash/bash-command-click-standalone-session.jsonl"),
      replaceCwd: "/tmp/pi-cc-tools-bash-command-click",
    },
    settings: { packages: [] },
  },
  async run(terminal) {
    await terminal.expect("stock-bash", {
      visible: ["STANDALONE_RESULT_10"],
      absent: [/click.*to expand/],
    });
    await terminal.replaceSettings(enabledSettings);
    await terminal.perform({ type: "write", data: "/reload\r" });
    await terminal.expect("reload-complete", {
      visible: ["Reloaded keybindings, extensions, skills, prompts, themes, and context files"],
    });
    const collapsed = await terminal.expect("late-loaded-anchor", {
      visible: [/click.*to expand/],
      absent: ["STANDALONE_COMMAND_CONTINUATION"],
      deadlineMs: 5_000,
    });
    await terminal.perform({ type: "click", at: collapsed.find(/click.*to expand/) });
    await terminal.expect("late-loaded-expanded-command", {
      visible: ["STANDALONE_COMMAND_CONTINUATION"],
      deadlineMs: 5_000,
    });
  },
});
