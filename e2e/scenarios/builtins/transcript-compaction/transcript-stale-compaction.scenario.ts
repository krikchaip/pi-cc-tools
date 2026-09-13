import { extension, fixture, transcriptFamily } from "../family.ts";

export default transcriptFamily.scenario({
  name: "compaction summary replaces stale hint after reload",
  start: {
    mode: "session",
    session: {
      path: fixture("transcript-compaction/builtin-compaction-click-session.jsonl"),
      replaceCwd: "/tmp/pi-cc-tools-builtin-click-e2e",
    },
    extensions: [fixture("transcript-compaction/stale-builtin-summary-wrapper.ts"), extension],
    keybindings: { "app.tools.expand": ["alt+j"] },
  },
  async run(terminal) {
    await terminal.expect("replacement-hint", { visible: [/Compacted from 1,234 tokens .*click.*to expand/] });
    await terminal.perform({ type: "write", data: "/reload\r" });
    await terminal.expect("replacement-hint-after-reload", {
      visible: [/Compacted from 1,234 tokens .*click.*to expand/],
    });
  },
});
