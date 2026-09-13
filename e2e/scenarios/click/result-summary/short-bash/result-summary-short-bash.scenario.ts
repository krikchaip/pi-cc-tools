import assert from "node:assert/strict";

import { clickFamily, fixture, repaint } from "../../family.ts";

const viewport = { columns: 100, rows: 40 } as const;
const family = clickFamily(viewport, {
  previewLines: 3,
  bashCollapsedLines: 3,
  expandedPreviewMaxLines: 50,
  extraExpandedPreviewMaxLines: 100,
  groupToolCalls: true,
});

export default family.scenario({
  name: "short Bash payload is inert and its summary collapses only Bash",
  start: {
    mode: "session",
    session: {
      path: fixture("result-summary/short-bash/short-bash-group-session.jsonl"),
      replaceCwd: "/tmp/pi-cc-tools-result-summary-acceptance",
    },
  },
  async run(terminal) {
    const group = await terminal.expect("group", { visible: ["true", "peer.txt", /click.*any for details/] });
    await terminal.perform({ type: "click", at: group.find(/true/) });
    const expanded = await terminal.expect("bash-expanded", {
      visible: [/Done.*\(1 lines\)/, "(no output)"],
      absent: ["peer detail", /click.*to collapse/],
    });
    await terminal.perform({ type: "click", at: expanded.find("(no output)") });
    const inert = await repaint(terminal, viewport);
    assert.match(inert.text, /Done.*\(1 lines\)/);
    assert.match(inert.text, /\(no output\)/);
    assert.doesNotMatch(inert.text, /peer detail|click.*to collapse/);
    await terminal.perform({ type: "click", at: inert.find(/Done.*\(1 lines\)/) });
    await terminal.expect("bash-collapsed", {
      visible: ["peer.txt", /click.*any for details/],
      absent: [/Done.*\(1 lines\)/, "(no output)", "peer detail", /click.*to collapse/],
    });
  },
});
