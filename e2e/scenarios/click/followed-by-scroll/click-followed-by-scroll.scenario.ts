import { delay, fixture, standardFamily } from "../family.ts";

export default standardFamily.scenario({
  name: "wheel-up immediately after an anchor click does not reactivate it",
  start: {
    mode: "session",
    session: {
      path: fixture("followed-by-scroll/bash-command-click-standalone-session.jsonl"),
      replaceCwd: "/tmp/pi-cc-tools-bash-command-click",
    },
    settings: { groupToolCalls: true },
  },
  async run(terminal) {
    const collapsed = await terminal.expect("collapsed", {
      visible: [/Done.*click.*to expand/],
      absent: ["STANDALONE_RESULT_10"],
    });
    const target = collapsed.find(/Done.*click.*to expand/);
    await terminal.perform({ type: "click", at: target });
    await delay(20);
    await terminal.perform({ type: "wheel", at: target, direction: "up" });
    await terminal.expect("expanded-after-wheel", { visible: ["STANDALONE_RESULT_10"] });
  },
});
