import { collapseRowFamily, keybindings } from "../collapse-row.ts";
import { fixture } from "../../family.ts";

export default collapseRowFamily.scenario({
  name: "group guidance dims only its click verb",
  start: {
    mode: "session",
    session: {
      path: fixture("collapse-row/group/collapse-row-review-group-session.jsonl"),
      replaceCwd: "/tmp/pi-cc-tools-collapse-row-review",
    },
    keybindings,
  },
  async run(terminal) {
    await terminal.expect("group-guidance", {
      visible: [/click.*any for details/],
      raw: [/\x1b\[38;2;102;102;102m(?:\x1b\[[0-9;]*m)*click(?:\x1b\[[0-9;]*m)*\x1b\[38;2;128;128;128m(?:\x1b\[[0-9;]*m)* any for details/],
      rawAbsent: [/\x1b\[38;2;128;128;128m • click any for details/],
    });
  },
});
