import { exerciseTranscriptSummary, extension, fixture, transcriptFamily } from "../family.ts";

export default transcriptFamily.scenario({
  name: "shell transcript supports full-width expansion and collapse",
  start: {
    mode: "session",
    session: {
      path: fixture("transcript-shell/builtin-shell-click-session.jsonl"),
      replaceCwd: "/tmp/pi-cc-tools-builtin-click-e2e",
    },
    extensions: [extension],
    keybindings: { "app.tools.expand": ["alt+j"] },
  },
  async run(terminal) {
    await exerciseTranscriptSummary(terminal, {
      collapsed: "... 4 more lines",
      expanded: "SHELL_EXPANDED_DETAIL_01",
      collapseAnchor: /option\+j to collapse/,
    });
  },
});
