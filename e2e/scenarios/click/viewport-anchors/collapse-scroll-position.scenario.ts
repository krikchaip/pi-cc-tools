import assert from "node:assert/strict";

import { clickFamily, fixture, repaint } from "../family.ts";

const viewport = { columns: 100, rows: 40 } as const;
const family = clickFamily(viewport, {
  previewLines: 3,
  expandedPreviewMaxLines: 100,
  extraExpandedPreviewMaxLines: 200,
  groupToolCalls: false,
});

export default family.scenario({
  name: "bottom collapse preserves later transcript content",
  start: {
    mode: "session",
    session: {
      path: fixture("viewport-anchors/collapse-scroll-position-session.jsonl"),
      replaceCwd: "/tmp/pi-cc-tools-collapse-scroll-position",
    },
  },
  async run(terminal) {
    await terminal.expect("ready", { visible: ["UNRELATED_AFTER_FINAL"] });
    await terminal.perform({ type: "key", key: "page-up" });
    let frame = await terminal.expect("collapsed", { visible: [/70 lines loaded.*click.*to expand/] });
    await terminal.perform({ type: "click", at: frame.find(/70 lines loaded/) });
    frame = await terminal.expect("normal", { visible: [/click.*for more detail/] });
    await terminal.perform({ type: "click", at: frame.find(/click.*for more detail/) });
    await terminal.expect("final", { visible: ["COLLAPSE_SCROLL_PAYLOAD_01"] });
    await terminal.perform({ type: "key", key: "page-down" });
    await terminal.perform({ type: "key", key: "page-down" });
    frame = await terminal.expect("bottom-collapse", { visible: [/click.*to collapse/, /UNRELATED_AFTER_[0-9]+/] });
    await terminal.perform({ type: "click", at: frame.find(/click.*to collapse/) });
    await terminal.expect("collapsed-again", { visible: [/click.*to expand/] });
    const after = await repaint(terminal, viewport);
    assert.match(after.text, /UNRELATED_AFTER_01/);
    assert.doesNotMatch(after.text, /COLLAPSE_SCROLL_PAYLOAD/);
  },
});
