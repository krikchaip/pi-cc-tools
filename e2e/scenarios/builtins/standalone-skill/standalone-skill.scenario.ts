import { builtinsFamily, fixture } from "../family.ts";

export default builtinsFamily.scenario({
  name: "standalone skill header expands its result",
  start: {
    mode: "session",
    session: {
      path: fixture("standalone-skill/standalone-skill-anchor-session.jsonl"),
      replaceCwd: "/tmp/pi-cc-tools-standalone-skill-anchor",
    },
    settings: {
      previewLines: 3,
      expandedPreviewMaxLines: 50,
      extraExpandedPreviewMaxLines: 100,
      groupToolCalls: true,
    },
  },
  async run(terminal) {
    const collapsed = await terminal.expect("collapsed-skill", {
      visible: ["[skill] grilling", /click.*to expand/],
      absent: ["skill anchor payload 03"],
    });
    await terminal.perform({ type: "click", at: collapsed.find("[skill] grilling") });
    await terminal.expect("expanded-skill", { visible: ["skill anchor payload 03"] });
  },
});
