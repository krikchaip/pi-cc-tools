import { clickFamily, fixture } from "../family.ts";

const family = clickFamily({ columns: 60, rows: 40 }, {
  previewLines: 3,
  expandedPreviewMaxLines: 6,
  extraExpandedPreviewMaxLines: 10,
});

export default family.scenario({
  name: "standalone click expansion advances one local layer at a time",
  start: {
    mode: "session",
    session: {
      path: fixture("fullscreen/fullscreen-click-expansion-session.jsonl"),
      replaceCwd: "/tmp/pi-cc-tools-fullscreen-click-e2e",
    },
    keybindings: { "app.tools.expand": ["alt+j"] },
  },
  async run(terminal) {
    let collapsed = await terminal.expect("collapsed", {
      visible: [/click.*to expand/, /12 lines loaded/],
      absent: [/option\+j.*to expand/, "standalone detail 03"],
      raw: [/\x1b\[38;2;102;102;102m(?:\x1b\[[0-9;]*m)*click/],
    });
    await terminal.perform({ type: "click", at: collapsed.find(/12 lines loaded/) });

    let expanded = await terminal.expect("normal-preview", {
      visible: ["standalone detail 03", /click.*for more detail/],
      absent: ["standalone detail 06"],
    });
    await terminal.perform({ type: "click", at: expanded.find(/click.*for more detail/) });
    expanded = await terminal.expect("standard-detail", {
      visible: ["standalone detail 06", /click.*for more detail/],
      absent: ["standalone detail 07"],
    });
    await terminal.perform({ type: "click", at: expanded.find(/click.*for more detail/) });
    await terminal.expect("extra-detail", {
      visible: ["standalone detail 10"],
      absent: ["standalone detail 11"],
    });

    await terminal.perform({ type: "write", data: "/cc-tools click off\r" });
    await terminal.expect("disabled-live", {
      visible: ["Click expansion: off", /option\+j.*to expand/],
      absent: ["standalone detail 03"],
    });
    await terminal.perform({ type: "write", data: "/cc-tools click on\r" });
    collapsed = await terminal.expect("enabled-live", {
      visible: ["Click expansion: on", /click.*to expand/],
      absent: [/option\+j.*to expand/],
    });
    await terminal.perform({ type: "click", at: collapsed.find(/12 lines loaded/) });
    expanded = await terminal.expect("reexpanded", { visible: ["standalone detail 03"] });
    await terminal.perform({ type: "click", at: expanded.find("to-wrap.txt") });
    await terminal.expect("collapsed-from-wrapped-header", {
      visible: [/click.*to expand/],
      absent: ["standalone detail 03"],
    });
  },
});
