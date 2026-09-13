import assert from "node:assert/strict";

import type { FrameEvidence } from "../../../terminal-session.ts";
import { builtinsFamily, fixture } from "../family.ts";

const settings = {
  outputPad: 1,
  previewLines: 8,
  expandedPreviewMaxLines: 10,
  extraExpandedPreviewMaxLines: 15,
  groupToolCalls: true,
} as const;

export function outputShapeScenario(options: {
  name: string;
  grouped: boolean;
  skill: boolean;
}) {
  const skillPath = "skills/shape/SKILL.md";
  return builtinsFamily.scenario({
    name: options.name,
    start: {
      mode: "session",
      session: {
        path: fixture(options.grouped
          ? "output-shape/grouped/read-skill-output-shape-grouped-session.jsonl"
          : "output-shape/standalone/read-skill-output-shape-standalone-session.jsonl"),
        replacements: {
          __FIXTURE_CWD__: { workspacePath: "." },
          __TARGET_PATH__: options.skill ? { workspacePath: skillPath } : "target.txt",
        },
      },
      settings,
    },
    async run(terminal) {
      const header = options.skill ? "[skill] shape" : "target.txt";
      const collapsed = await terminal.expect("collapsed", {
        visible: [header, /click.*(to expand|any for details)/],
        absent: ["READ_SHAPE_FILLER_2"],
      });
      await terminal.perform({ type: "click", at: collapsed.find(header) });

      const level0 = await terminal.expect("level-0", {
        visible: [header, "15 lines loaded", "READ_SHAPE_ROOT", "READ_SHAPE_FILLER_2", /click for more detail/],
      });
      await terminal.perform({ type: "click", at: level0.find(/click for more detail/) });

      const level1 = await terminal.expect("level-1", {
        visible: [header, "15 lines loaded", "READ_SHAPE_ROOT", "READ_SHAPE_FILLER_4", /click for more detail/],
      });
      await terminal.perform({ type: "click", at: level1.find(/click for more detail/) });

      const level2 = await terminal.expect("level-2", {
        visible: [header, "15 lines loaded", "READ_SHAPE_ROOT", "READ_SHAPE_END", /click to collapse/],
      });
      assertReadSkillShape([level0, level1, level2], options.name);
    },
  });
}

function assertReadSkillShape(frames: readonly [FrameEvidence, FrameEvidence, FrameEvidence], label: string): void {
  for (const [index, frame] of frames.entries()) {
    const layer = `L${index}`;
    if (index < 2) assertProgressiveBranch(frame, `${label} ${layer}`);
    const summary = tokenRow(frame, "15 lines loaded");
    const root = tokenRow(frame, "READ_SHAPE_ROOT");
    const child = tokenRow(frame, "READ_SHAPE_CHILD");
    const mixed = tokenRow(frame, "READ_SHAPE_MIXED");
    assert.equal(root, summary + 2, `${label} ${layer}: leading output-owned blank line changed`);
    assert.equal(child, root + 1, `${label} ${layer}: child row moved`);
    assert.equal(mixed, child + 3, `${label} ${layer}: internal output-owned blank lines changed`);
    for (const row of [summary + 1, child + 1, child + 2]) {
      assert.ok(isOutputBlank(frame.lines[row] ?? ""), `${label} ${layer}: output-owned blank row ${row + 1} changed`);
    }
  }

  for (const token of ["READ_SHAPE_ROOT", "READ_SHAPE_CHILD", "READ_SHAPE_MIXED"]) {
    const columns = frames.map((frame) => tokenColumn(frame, token));
    assert.ok(columns.every((column) => column === columns[0]), `${label}: ${token} changed columns: ${columns}`);
  }

  const final = frames[2];
  const end = tokenRow(final, "READ_SHAPE_END");
  const collapse = tokenRow(final, "click to collapse");
  assert.equal(collapse, end + 3, `${label}: trailing output-owned blank lines changed`);
  assert.ok(isOutputBlank(final.lines[end + 1] ?? ""), `${label}: first trailing blank row changed`);
  assert.ok(isOutputBlank(final.lines[end + 2] ?? ""), `${label}: second trailing blank row changed`);
}

function assertProgressiveBranch(frame: FrameEvidence, label: string): void {
  const summary = tokenRow(frame, "15 lines loaded");
  let action = -1;
  for (let row = frame.lines.length - 1; row >= 0; row -= 1) {
    if (frame.lines[row]!.includes("click for more detail")) {
      action = row;
      break;
    }
  }
  assert.ok(action > summary, `${label}: missing progressive action after summary`);
  const summaryText = frame.lines[summary]!.indexOf("15 lines loaded");
  const summaryBranch = Math.max(
    frame.lines[summary]!.lastIndexOf("├", summaryText),
    frame.lines[summary]!.lastIndexOf("└", summaryText),
  );
  const actionText = frame.lines[action]!.indexOf("click for more detail");
  const actionBranch = Math.max(
    frame.lines[action]!.lastIndexOf("├", actionText),
    frame.lines[action]!.lastIndexOf("└", actionText),
  );
  assert.equal(frame.lines[summary]![summaryBranch], "├", `${label}: summary does not open a branch`);
  assert.equal(actionBranch, summaryBranch, `${label}: action branch column changed`);
  assert.equal(frame.lines[action]![actionBranch], "└", `${label}: action does not close the branch`);
  for (let row = summary + 1; row < action; row += 1) {
    assert.equal(frame.lines[row]?.[summaryBranch], "│", `${label}: payload row ${row + 1} breaks the branch`);
  }
}

function tokenRow(frame: FrameEvidence, token: string): number {
  const row = frame.lines.findIndex((line) => line.includes(token));
  assert.notEqual(row, -1, `${frame.name}: missing ${token}\n${frame.text}`);
  return row;
}

function tokenColumn(frame: FrameEvidence, token: string): number {
  const row = tokenRow(frame, token);
  return frame.lines[row]!.indexOf(token);
}

function isOutputBlank(row: string): boolean {
  return !row.replaceAll("│", "").trim();
}
