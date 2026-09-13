import { exerciseTranscriptSummary, extension, fixture, transcriptFamily } from "../family.ts";

export default transcriptFamily.scenario({
  name: "compaction summary supports full-width click and configured keyboard hint",
  start: {
    mode: "session",
    session: {
      path: fixture("transcript-compaction/builtin-compaction-click-session.jsonl"),
      replaceCwd: "/tmp/pi-cc-tools-builtin-click-e2e",
    },
    extensions: [extension],
    keybindings: { "app.tools.expand": ["alt+j"] },
  },
  async run(terminal) {
    await exerciseTranscriptSummary(terminal, {
      collapsed: /Compacted from 1,234 tokens .*click.*to expand/,
      keyboard: /Compacted from 1,234 tokens .*option\+j.*to expand/,
      expanded: "COMPACTION_EXPANDED_DETAIL",
    });
  },
});
