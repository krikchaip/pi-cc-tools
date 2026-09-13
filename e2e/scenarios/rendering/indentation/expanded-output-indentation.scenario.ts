import assert from "node:assert/strict";

import type { FrameEvidence } from "../../../terminal-session.ts";
import { assertRelativeColumns, assertStableColumns, tokenColumn, tokenRow } from "./assertions.ts";
import { fixture, repaint, renderingFamily } from "../family.ts";

const viewport = { columns: 64, rows: 40 } as const;
const family = renderingFamily(viewport, {
  outputPad: 1,
  clickExpansion: true,
  previewLines: 6,
  expandedPreviewMaxLines: 9,
  extraExpandedPreviewMaxLines: 12,
});

const indentationTokens = [
  "STANDALONE_INDENT_ROOT",
  "STANDALONE_INDENT_TWO_SPACES",
  "STANDALONE_INDENT_FOUR_SPACES",
  "STANDALONE_INDENT_SEVEN_SPACES",
  "STANDALONE_INDENT_TAB",
  "STANDALONE_INDENT_MIXED",
] as const;

export default family.scenario({
  name: "standalone expanded output preserves payload indentation",
  start: {
    mode: "session",
    session: {
      path: fixture("indentation/expanded-output-indentation-session.jsonl"),
      replaceCwd: "/tmp/pi-cc-tools-expanded-output-indentation",
    },
  },
  async run(terminal) {
    const collapsed = await terminal.expect("collapsed", {
      visible: [/click.*to expand/],
    });
    await terminal.perform({ type: "click", at: collapsed.find(/click.*to expand/) });
    await terminal.expect("level-zero-ready", {
      visible: ["STANDALONE_INDENT_ROOT", "STANDALONE_INDENT_MIXED"],
    });
    await repaint(terminal, viewport);
    const level0 = await terminal.expect("level-zero", {
      visible: ["STANDALONE_INDENT_ROOT", "STANDALONE_INDENT_MIXED"],
    });

    const level0Action = level0.find("click for more detail");
    await terminal.perform({ type: "click", at: level0Action });
    await terminal.expect("level-one-ready", {
      visible: ["INDENT_ANSI_L1", "INDENT_WRAP_L1"],
    });
    await repaint(terminal, viewport);
    const level1 = await terminal.expect("level-one", {
      visible: ["STANDALONE_INDENT_ROOT", "INDENT_ANSI_L1", "INDENT_WRAP_L1"],
    });

    const level1Action = level1.find("click for more detail");
    await terminal.perform({ type: "click", at: level1Action });
    await terminal.expect("level-two-ready", {
      visible: ["INDENT_BRANCH_L2", "INDENT_FINAL_L2"],
    });
    await repaint(terminal, viewport);
    const level2 = await terminal.expect("level-two", {
      visible: ["STANDALONE_INDENT_ROOT", "INDENT_BRANCH_L2", "INDENT_FINAL_L2"],
      raw: ["\u001b[31m  INDENT_ANSI_L1"],
    });

    assertStandaloneGeometry([level0, level1, level2]);
  },
});

function assertStandaloneGeometry(frames: readonly [FrameEvidence, FrameEvidence, FrameEvidence]): void {
  const [level0, level1, level2] = frames;
  const columns = assertStableColumns(frames, indentationTokens, "standalone output");
  assert.ok(new Set(Object.values(columns)).size >= 4, "fixture did not exercise varied payload indentation");
  assertRelativeColumns(columns, "STANDALONE_INDENT_ROOT", {
    STANDALONE_INDENT_TWO_SPACES: 2,
    STANDALONE_INDENT_FOUR_SPACES: 4,
    STANDALONE_INDENT_SEVEN_SPACES: 7,
    STANDALONE_INDENT_TAB: 4,
    STANDALONE_INDENT_MIXED: 6,
  }, "standalone output");

  for (const frame of [level1, level2]) {
    const mixedRow = tokenRow(frame, "STANDALONE_INDENT_MIXED");
    assert.equal(
      frame.lines[mixedRow + 1]?.trim(),
      "│",
      `${frame.name}: indented blank row changed payload geometry`,
    );
  }

  assert.equal(
    tokenColumn(level2, "INDENT_ANSI_L1"),
    tokenColumn(level1, "INDENT_ANSI_L1"),
    "ANSI payload indentation changed across detail levels",
  );
  assertWrappedPayload(level1);
  assertWrappedPayload(level2);
  tokenColumn(level2, "INDENT_BRANCH_L2");
  tokenColumn(level2, "INDENT_DEEP_L2");
}

function assertWrappedPayload(frame: FrameEvidence): void {
  const wrappedToken = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const row = tokenRow(frame, "INDENT_WRAP_L1");
  const column = tokenColumn(frame, "INDENT_WRAP_L1");
  const continuations = frame.lines.slice(row + 1, row + 3);
  assert.equal(continuations.length, 2, `${frame.name}: wrapped line lacks two continuation rows`);
  for (const continuation of continuations) {
    assert.ok(
      continuation.length > column && continuation[column]!.trim() !== "",
      `${frame.name}: wrapped continuation changed derived payload column ${column}: ${JSON.stringify(continuation)}`,
    );
  }
  assert.equal(
    continuations.map((line) => line.slice(column)).join(""),
    wrappedToken,
    `${frame.name}: wrapped payload bytes changed`,
  );
}
