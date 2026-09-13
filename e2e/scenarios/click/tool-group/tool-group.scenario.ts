import assert from "node:assert/strict";

import { delay, fixture, standardFamily } from "../family.ts";

export default standardFamily.scenario({
  name: "grouped executions have inert connectors and independent click state",
  start: {
    mode: "session",
    session: {
      path: fixture("tool-group/tool-group-click-session.jsonl"),
      replaceCwd: "/tmp/pi-cc-tools-click-e2e",
    },
    keybindings: { "app.tools.expand": ["alt+j"] },
  },
  async run(terminal) {
    await terminal.expect("group", { visible: ["first.txt", "second.txt", /click.*any for details/] });
    await terminal.perform({ type: "write", data: "/reload\r" });
    const reloaded = await terminal.expect("reloaded", {
      visible: ["Reloaded keybindings, extensions, skills, prompts, themes, and context files", "first.txt"],
    });

    const first = reloaded.find("first.txt");
    const firstLine = reloaded.lines[first.row - 1]!;
    const connectorOffset = firstLine.search(/[├└│]/);
    assert.notEqual(connectorOffset, -1, "first grouped execution has no branch connector");
    await terminal.perform({ type: "click", at: { column: connectorOffset + 1, row: first.row } });
    await delay(350);
    assert.doesNotMatch((await terminal.evidence("connector-inert")).text, /FIRST_EXECUTION_DETAILS/);

    await terminal.perform({ type: "click", at: reloaded.find("first.txt") });
    let frame = await terminal.expect("first-expanded", {
      visible: ["FIRST_EXECUTION_DETAILS"],
      absent: ["SECOND_EXECUTION_DETAILS"],
    });
    await terminal.perform({ type: "click", at: frame.find("first.txt") });
    frame = await terminal.expect("first-collapsed", {
      visible: ["first.txt", "second.txt"],
      absent: ["FIRST_EXECUTION_DETAILS", "SECOND_EXECUTION_DETAILS"],
    });
    await terminal.perform({ type: "click", at: frame.find("second.txt") });
    frame = await terminal.expect("second-expanded", {
      visible: ["SECOND_EXECUTION_DETAILS"],
      absent: ["FIRST_EXECUTION_DETAILS"],
    });
    await terminal.perform({ type: "click", at: frame.find("second.txt") });
    await terminal.expect("children-collapsed", {
      visible: [/click.*any for details/],
      absent: ["FIRST_EXECUTION_DETAILS", "SECOND_EXECUTION_DETAILS"],
    });

    await terminal.perform({ type: "write", data: "\x1bj" });
    await terminal.expect("global-expanded", {
      visible: [/option\+j.*to collapse/, "FIRST_EXECUTION_DETAILS", "SECOND_EXECUTION_DETAILS"],
    });
    await terminal.perform({ type: "write", data: "\x1bj" });
    await terminal.expect("global-collapsed", { visible: [/click.*any for details/] });

    await terminal.perform({ type: "write", data: "/cc-tools group off\r" });
    await terminal.expect("group-off", { visible: ["Tool grouping: off", /click.*to expand/] });
    await terminal.perform({ type: "write", data: "/cc-tools group on\r" });
    await terminal.expect("group-on", { visible: ["Tool grouping: on"] });
  },
});
