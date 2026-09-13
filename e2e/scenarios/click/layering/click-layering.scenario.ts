import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { clickFamily, fixture } from "../family.ts";

const family = clickFamily({ columns: 60, rows: 40 }, {
  expandedPreviewMaxLines: 4_000,
  extraExpandedPreviewMaxLines: 12_000,
});

export default family.scenario({
  name: "first semantic click paints one layer within 350ms",
  start: {
    mode: "session",
    session: {
      path: fixture("layering/click-layering-regression-session.jsonl"),
      replaceCwd: "/tmp/pi-cc-tools-click-layering-regression",
    },
    keybindings: { "app.tools.expand": ["alt+j"] },
  },
  async run(terminal) {
    const collapsed = await terminal.expect("collapsed", {
      visible: [/click.*to expand/, /1,?201 lines loaded/],
      absent: ["LAYER_FIRST_MARKER", "LAYER_DEEP_MARKER"],
    });
    const started = performance.now();
    await terminal.perform({ type: "click", at: collapsed.find(/1,?201 lines loaded/) });
    const firstLayer = await terminal.expect("first-layer", {
      visible: [/LAYER_(?:FIRST_MARKER|LINE_[0-9]+)/, /click.*for more detail/],
      absent: ["LAYER_DEEP_MARKER"],
      deadlineMs: 6_000,
      stableForMs: 0,
    });
    const firstPaintMs = performance.now() - started;
    assert.ok(firstPaintMs <= 350, `first expanded layer painted in ${Math.round(firstPaintMs)}ms; required <= 350ms`);
    assert.doesNotMatch(firstLayer.text, /LAYER_DEEP_MARKER/);
  },
});
