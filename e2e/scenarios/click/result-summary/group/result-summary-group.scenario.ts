import { clickFamily, delay, fixture, repaint } from "../../family.ts";

const viewport = { columns: 100, rows: 40 } as const;
const family = clickFamily(viewport, {
  previewLines: 3,
  bashCollapsedLines: 3,
  expandedPreviewMaxLines: 50,
  extraExpandedPreviewMaxLines: 100,
  groupToolCalls: true,
});

export default family.scenario({
  name: "grouped result summary collapses only its child",
  start: {
    mode: "session",
    session: {
      path: fixture("result-summary/group/collapse-row-review-group-session.jsonl"),
      replaceCwd: "/tmp/pi-cc-tools-collapse-row-review",
    },
  },
  async run(terminal) {
    const group = await terminal.expect("group", { visible: ["first.txt", "second.txt", /click.*any for details/] });
    await terminal.perform({ type: "click", at: group.find("first.txt") });
    const first = await terminal.expect("first-expanded", {
      visible: ["group first 03", "second.txt"],
      absent: ["group second 03"],
    });
    await terminal.perform({ type: "click", at: first.find(/5 lines loaded/) });
    const firstCollapsed = await terminal.expect("first-collapsed", {
      visible: ["first.txt", "second.txt"],
      absent: ["group first 03", "group second 03"],
    });
    await delay(300);
    const refreshedGroup = await repaint(terminal, viewport, "first-collapsed-repaint");
    await terminal.perform({ type: "click", at: refreshedGroup.find("second.txt") });
    await terminal.expect("second-expanded", {
      visible: ["group second 03"],
      absent: ["group first 03"],
    });
  },
});
