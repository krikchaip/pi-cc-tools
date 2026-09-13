import { assertFrozenRows, clickFamily, fixture, repaint } from "../family.ts";

const viewport = { columns: 100, rows: 40 } as const;
const family = clickFamily(viewport, {
  previewLines: 3,
  expandedPreviewMaxLines: 100,
  extraExpandedPreviewMaxLines: 200,
  groupToolCalls: false,
});

export default family.scenario({
  name: "semantic top and bottom click anchors preserve transcript rows",
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
    await terminal.expect("collapsed-visible", { visible: ["collapse-scroll-position.txt", /click.*to expand/] });
    const topBefore = await repaint(terminal, viewport, "top-before");

    await terminal.perform({ type: "click", at: topBefore.find(/70 lines loaded/) });
    await terminal.expect("top-expanded-visible", { visible: [/click.*for more detail/] });
    const topExpanded = await repaint(terminal, viewport, "top-expanded");
    assertFrozenRows("top-anchor expansion", topBefore, topExpanded, /collapse-scroll-position\.txt|UNRELATED_BEFORE_[0-9]+/);

    await terminal.perform({ type: "click", at: topExpanded.find(/70 lines loaded/) });
    await terminal.expect("top-collapsed-visible", { visible: [/click.*to expand/] });
    const topCollapsed = await repaint(terminal, viewport, "top-collapsed");
    assertFrozenRows("top-anchor collapse", topExpanded, topCollapsed, /collapse-scroll-position\.txt|UNRELATED_BEFORE_[0-9]+/);

    await terminal.perform({ type: "click", at: topCollapsed.find(/click.*to expand/) });
    let frame = await terminal.expect("normal-reopened", { visible: [/click.*for more detail/] });
    await terminal.perform({ type: "click", at: frame.find(/click.*for more detail/) });
    await terminal.expect("final-detail", { visible: ["COLLAPSE_SCROLL_PAYLOAD_04"] });
    await terminal.perform({ type: "key", key: "page-down" });
    await terminal.perform({ type: "key", key: "page-down" });
    await terminal.expect("bottom-anchor-visible", { visible: [/click.*to collapse/, /UNRELATED_AFTER_[0-9]+/] });
    const bottomBefore = await repaint(terminal, viewport, "bottom-before");
    await terminal.perform({ type: "click", at: bottomBefore.find(/click.*to collapse/) });
    await terminal.expect("bottom-collapsed-visible", { visible: [/click.*to expand/, /UNRELATED_AFTER_[0-9]+/] });
    const bottomAfter = await repaint(terminal, viewport, "bottom-after");
    assertFrozenRows("bottom-anchor collapse", bottomBefore, bottomAfter, /UNRELATED_AFTER_(?:[0-9]+|FINAL)/, 2);
  },
});
