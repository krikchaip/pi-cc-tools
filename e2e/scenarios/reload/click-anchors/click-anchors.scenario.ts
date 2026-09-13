import { extension, fixture, reloadFamily, repaint } from "../family.ts";

export default reloadFamily.scenario({
  name: "result click anchors and settings survive reload",
  start: {
    mode: "session",
    loadExtensionsFromSettings: true,
    session: {
      path: fixture("click-anchors/effective-final-level-one-session.jsonl"),
      replaceCwd: "/tmp/pi-cc-tools-result-summary-acceptance",
    },
    settings: {
      previewLines: 3,
      expandedPreviewMaxLines: 50,
      extraExpandedPreviewMaxLines: 100,
      extensions: [extension],
    },
  },
  async run(terminal) {
    let compact = await terminal.expect("before-reload", {
      visible: ["6 lines loaded", /click.*to expand/],
      absent: ["image4 payload 03"],
    });
    await terminal.perform({ type: "click", at: compact.find("6 lines loaded") });
    const initiallyExpanded = await terminal.expect("expanded-before-reload", {
      visible: ["image4 payload 03"],
    });
    await terminal.perform({ type: "click", at: initiallyExpanded.find("6 lines loaded") });
    await terminal.expect("compact-before-reload", {
      visible: [/click.*to expand/],
      absent: ["image4 payload 03"],
    });

    await terminal.perform({ type: "write", data: "/reload\r" });
    await terminal.expect("reload-complete", {
      visible: ["Reloaded keybindings, extensions, skills, prompts, themes, and context files"],
    });
    await repaint(terminal, "post-reload-repaint", 100, 40, "6 lines loaded");
    compact = await terminal.expect("after-reload", {
      visible: ["6 lines loaded", /click.*to expand/],
      absent: ["image4 payload 03"],
    });
    await terminal.perform({ type: "click", at: compact.find("6 lines loaded") });
    const normal = await terminal.expect("normal-preview", {
      visible: ["image4 payload 03", /click.*for more detail/],
    });
    await terminal.perform({ type: "click", at: normal.find(/click.*for more detail/) });
    const final = await terminal.expect("effective-final", {
      visible: ["Output ends here", /click.*to collapse/],
    });
    await terminal.perform({ type: "click", at: final.find("Output ends here") });
    await terminal.expect("collapsed-from-bottom", {
      visible: [/click.*to expand/],
      absent: ["image4 payload", /click.*to collapse/],
    });

    await terminal.perform({ type: "write", data: "/cc-tools click off\r" });
    const disabled = await terminal.expect("click-disabled", {
      visible: ["Click expansion: off", /ctrl\+o to expand/],
      absent: [/click to expand/],
    });
    await terminal.perform({ type: "click", at: disabled.find("6 lines loaded") });
    await terminal.expect("disabled-click-ignored", {
      visible: [/ctrl\+o to expand/],
      absent: ["image4 payload 03"],
      stableForMs: 500,
    });

    await terminal.perform({ type: "write", data: "/cc-tools click on\r" });
    const enabled = await terminal.expect("click-reenabled", {
      visible: ["Click expansion: on", /click.*to expand/],
    });
    await terminal.perform({ type: "click", at: enabled.find("6 lines loaded") });
    await terminal.expect("reenabled-click-works", { visible: ["image4 payload 03"] });
  },
});
