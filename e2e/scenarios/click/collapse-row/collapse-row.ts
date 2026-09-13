import assert from "node:assert/strict";

import type { FrameEvidence, TerminalPoint, TerminalSession } from "../../../terminal-session.ts";
import { clickFamily, delay, fixture } from "../family.ts";

export const collapseRowFamily = clickFamily({ columns: 100, rows: 40 }, {
  previewLines: 3,
  bashCollapsedLines: 3,
  expandedPreviewMaxLines: 5,
  extraExpandedPreviewMaxLines: 10,
  groupToolCalls: true,
});

export const keybindings = { "app.tools.expand": ["alt+j"] } as const;
export const readStart = {
  mode: "session" as const,
  session: {
    path: fixture("collapse-row/collapse-row-review-read-session.jsonl"),
    replaceCwd: "/tmp/pi-cc-tools-collapse-row-review",
  },
  keybindings,
};

const collapseStyle = /\x1b\[38;2;128;128;128m(?:\x1b\[[0-9;]*m)*Output ends here • (?:\x1b\[[0-9;]*m)*\x1b\[38;2;102;102;102m(?:\x1b\[[0-9;]*m)*click(?:\x1b\[[0-9;]*m)*\x1b\[38;2;128;128;128m(?:\x1b\[[0-9;]*m)* to collapse/;

export async function expandReadNormal(terminal: TerminalSession): Promise<FrameEvidence> {
  const collapsed = await terminal.expect("collapsed", { visible: ["review-read.txt", /click.*to expand/] });
  await terminal.perform({ type: "click", at: collapsed.find(/7 lines loaded/) });
  return terminal.expect("normal", {
    visible: ["REVIEW_READ_03", "… (4 more lines • click for more detail)"],
    absent: [/click.*to collapse/],
  });
}

export function actionPoint(frame: FrameEvidence, target: "left" | "right" | "connector" | "padding"): TerminalPoint {
  const action = frame.find("… (4 more lines • click for more detail)");
  if (target === "left") return action;
  if (target === "right") return frame.find("for more detail");
  const line = frame.lines[action.row - 1]!;
  if (target === "connector") {
    const connector = line.search(/[│├└]/);
    assert.notEqual(connector, -1);
    return { column: connector + 1, row: action.row };
  }
  return { column: Math.min(100, line.length + 2), row: action.row };
}

export function readAnchorScenario(name: string, target: "left" | "right" | "connector" | "padding", activates: boolean) {
  return collapseRowFamily.scenario({
    name,
    start: readStart,
    async run(terminal) {
      const normal = await expandReadNormal(terminal);
      await terminal.perform({ type: "click", at: actionPoint(normal, target) });
      if (activates) {
        await terminal.expect("activated", { visible: ["REVIEW_READ_05"] });
      } else {
        await delay(350);
        const inert = await terminal.evidence("inert");
        assert.doesNotMatch(inert.text, /REVIEW_READ_05/);
        assert.match(inert.text, /… \(4 more lines • click for more detail\)/);
      }
    },
  });
}

export function readFinalScenario(name: string, segment: "output" | "bullet" | "click" | "trailing-e") {
  return collapseRowFamily.scenario({
    name,
    start: readStart,
    async run(terminal) {
      let frame = await expandReadNormal(terminal);
      await terminal.perform({ type: "click", at: frame.find(/click.*for more detail/) });
      frame = await terminal.expect("standard-detail", { visible: ["REVIEW_READ_05", /click.*for more detail/] });
      await terminal.perform({ type: "click", at: frame.find(/click.*for more detail/) });
      const final = await terminal.expect("final-detail", {
        visible: ["REVIEW_READ_FINAL", "Output ends here • click to collapse"],
        absent: [/click.*for more detail/],
        raw: [collapseStyle],
      });
      assert.match(final.lines.find((line) => line.includes("7 lines loaded")) ?? "", /^\s*├/);
      assert.match(final.lines.find((line) => line.includes("REVIEW_READ_01")) ?? "", /^\s*│/);
      assert.match(final.lines.find((line) => line.includes("Output ends here")) ?? "", /^\s*└/);
      let point: TerminalPoint;
      if (segment === "output") point = final.find("Output ends here");
      else if (segment === "bullet") point = final.find("• click to collapse");
      else if (segment === "click") point = final.find("click to collapse");
      else {
        const start = final.find("to collapse");
        point = { column: start.column + "to collapse".length - 1, row: start.row };
      }
      await terminal.perform({ type: "click", at: point });
      await terminal.expect("collapsed-from-segment", {
        visible: [/click.*to expand/],
        absent: ["REVIEW_READ_01", /click.*to collapse/],
      });
    },
  });
}
