import assert from "node:assert/strict";

import type { FrameEvidence } from "../../../terminal-session.ts";
import { extension, fixture, reloadBackgroundFamily, repaint } from "../family.ts";

const backgroundSgr = /^(?:49|4[0-7]|10[0-7]|48;(?:5;\d+|2;\d+;\d+;\d+))$/;
const toolSuccessBackground = "\u001b[48;2;40;50;40m";

export function backgroundScenario(mode: "outlines" | "transparent") {
  return reloadBackgroundFamily.scenario({
    name: `${mode} tool rows keep clean backgrounds across reload`,
    start: {
      mode: "session",
      loadExtensionsFromSettings: true,
      session: {
        path: fixture("background/effective-final-level-one-session.jsonl"),
        replaceCwd: "/tmp/pi-cc-tools-result-summary-acceptance",
      },
      settings: {
        toolBackground: mode,
        previewLines: 3,
        extensions: [extension],
      },
    },
    async run(terminal) {
      await terminal.expect("ready-before-reload", { visible: ["6 lines loaded"] });
      await repaint(terminal, "before-reload-repaint", 100, 34, "6 lines loaded");
      assertCleanOuterBackground(await terminal.evidence("before-reload"));

      await terminal.perform({ type: "write", data: "/reload\r" });
      await terminal.expect("reload-complete", {
        visible: ["Reloaded keybindings, extensions, skills, prompts, themes, and context files"],
      });
      await repaint(terminal, "after-reload-repaint", 100, 34, "6 lines loaded");
      assertCleanOuterBackground(await terminal.evidence("after-reload"));
    },
  });
}

function assertCleanOuterBackground(frame: FrameEvidence): void {
  const chunks = frame.raw.split(/\r?\n|\u001b\]8;;(?:\u0007|\u001b\\)/);
  const matching = chunks.filter((chunk) => chunk.includes("6 lines loaded"));
  assert.ok(matching.length > 0, `${frame.name}: no physical result row contains 6 lines loaded`);
  const chunk = matching.at(-1)!;
  const firstSgr = /\u001b\[([0-9;]*)m/.exec(chunk);
  assert.ok(firstSgr, `${frame.name}: result row has no ANSI styling`);
  assert.doesNotMatch(firstSgr[1]!, backgroundSgr, `${frame.name}: result row starts with an outer background`);
  assert.ok(!chunk.includes(toolSuccessBackground), `${frame.name}: result row contains toolSuccessBg fill`);
}
