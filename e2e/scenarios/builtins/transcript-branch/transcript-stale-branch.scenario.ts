import { extension, fixture, transcriptFamily } from "../family.ts";

export default transcriptFamily.scenario({
  name: "branch summary replaces stale hint after reload",
  start: {
    mode: "session",
    session: {
      path: fixture("transcript-branch/builtin-branch-click-session.jsonl"),
      replaceCwd: "/tmp/pi-cc-tools-builtin-click-e2e",
    },
    extensions: [fixture("transcript-branch/stale-builtin-summary-wrapper.ts"), extension],
    keybindings: { "app.tools.expand": ["alt+j"] },
  },
  async run(terminal) {
    await terminal.expect("replacement-hint", { visible: [/Branch summary .*click.*to expand/] });
    await terminal.perform({ type: "write", data: "/reload\r" });
    await terminal.expect("replacement-hint-after-reload", { visible: [/Branch summary .*click.*to expand/] });
  },
});
