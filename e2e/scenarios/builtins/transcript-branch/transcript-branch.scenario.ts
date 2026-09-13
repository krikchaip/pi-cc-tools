import { exerciseTranscriptSummary, extension, fixture, transcriptFamily } from "../family.ts";

export default transcriptFamily.scenario({
  name: "branch summary supports full-width click and configured keyboard hint",
  start: {
    mode: "session",
    session: {
      path: fixture("transcript-branch/builtin-branch-click-session.jsonl"),
      replaceCwd: "/tmp/pi-cc-tools-builtin-click-e2e",
    },
    extensions: [extension],
    keybindings: { "app.tools.expand": ["alt+j"] },
  },
  async run(terminal) {
    await exerciseTranscriptSummary(terminal, {
      collapsed: /Branch summary .*click.*to expand/,
      keyboard: /Branch summary .*option\+j.*to expand/,
      expanded: "BRANCH_EXPANDED_DETAIL",
      paintedBackground: true,
    });
  },
});
