import { defaultDisabledFamily, fixture } from "../family.ts";

export default defaultDisabledFamily.scenario({
  name: "missing click setting preserves the keyboard hint",
  start: {
    mode: "session",
    session: {
      path: fixture("fullscreen/fullscreen-click-expansion-session.jsonl"),
      replaceCwd: "/tmp/pi-cc-tools-fullscreen-click-e2e",
    },
    keybindings: { "app.tools.expand": ["alt+j"] },
  },
  async run(terminal) {
    await terminal.expect("keyboard-only-guidance", {
      visible: [/option\+j.*to expand/],
      absent: [/click.*to expand/],
    });
  },
});
