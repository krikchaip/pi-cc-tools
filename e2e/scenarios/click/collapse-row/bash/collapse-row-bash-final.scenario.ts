import assert from "node:assert/strict";

import { collapseRowFamily, keybindings } from "../collapse-row.ts";
import { fixture } from "../../family.ts";

export default collapseRowFamily.scenario({
  name: "Bash final layer uses the canonical terminal collapse row",
  start: {
    mode: "session",
    session: {
      path: fixture("collapse-row/bash/collapse-row-review-bash-session.jsonl"),
      replaceCwd: "/tmp/pi-cc-tools-collapse-row-review",
    },
    keybindings,
  },
  async run(terminal) {
    let frame = await terminal.expect("collapsed", { visible: ["printf review", /click.*to expand/] });
    await terminal.perform({ type: "click", at: frame.find(/Done.*7 lines/) });
    frame = await terminal.expect("normal", { visible: ["REVIEW_BASH_03", /click.*for more detail/] });
    await terminal.perform({ type: "click", at: frame.find(/click.*for more detail/) });
    frame = await terminal.expect("standard", { visible: ["REVIEW_BASH_05", /click.*for more detail/] });
    await terminal.perform({ type: "click", at: frame.find(/click.*for more detail/) });
    frame = await terminal.expect("final", {
      visible: ["REVIEW_BASH_FINAL", "Output ends here • click to collapse"],
      absent: [/click.*for more detail/],
      raw: [/\x1b\[38;2;128;128;128m(?:\x1b\[[0-9;]*m)*Output ends here • (?:\x1b\[[0-9;]*m)*\x1b\[38;2;102;102;102m(?:\x1b\[[0-9;]*m)*click(?:\x1b\[[0-9;]*m)*\x1b\[38;2;128;128;128m(?:\x1b\[[0-9;]*m)* to collapse/],
    });
    assert.match(frame.lines.find((line) => /Done.*7 lines/.test(line)) ?? "", /^\s*├/);
    assert.match(frame.lines.find((line) => line.includes("REVIEW_BASH_01")) ?? "", /^\s*│/);
    assert.match(frame.lines.find((line) => line.includes("Output ends here")) ?? "", /^\s*└/);
    await terminal.perform({ type: "click", at: frame.find("Output ends here") });
    await terminal.expect("collapsed-from-final", {
      visible: [/click.*to expand/],
      absent: ["REVIEW_BASH_01", /click.*to collapse/],
    });
  },
});
