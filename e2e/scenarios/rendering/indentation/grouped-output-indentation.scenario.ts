import assert from "node:assert/strict";

import type { FrameEvidence } from "../../../terminal-session.ts";
import { assertRelativeColumns, assertStableColumns, tokenRow } from "./assertions.ts";
import { fixture, repaint, renderingFamily } from "../family.ts";

const viewport = { columns: 64, rows: 40 } as const;
const family = renderingFamily(viewport, {
  clickExpansion: true,
  previewLines: 6,
  expandedPreviewMaxLines: 8,
  extraExpandedPreviewMaxLines: 12,
});
const indentationTokens = [
  "GROUP_INDENT_ROOT",
  "GROUP_INDENT_TWO_SPACES",
  "GROUP_INDENT_FOUR_SPACES",
  "GROUP_INDENT_SEVEN_SPACES",
  "GROUP_INDENT_TAB",
  "GROUP_INDENT_MIXED",
] as const;

export default family.scenario({
  name: "grouped expanded output preserves payload indentation",
  start: {
    mode: "session",
    session: {
      path: fixture("indentation/grouped-output-indentation-session.jsonl"),
      replaceCwd: "/tmp/pi-cc-tools-grouped-output-indentation",
    },
  },
  async run(terminal) {
    const collapsed = await terminal.expect("collapsed", {
      visible: [/click.*any for details/],
    });
    await terminal.perform({ type: "click", at: collapsed.find("group-indent.txt") });
    await terminal.expect("level-zero-ready", {
      visible: ["GROUP_INDENT_ROOT", "GROUP_INDENT_MIXED"],
    });
    await repaint(terminal, viewport);
    const level0 = await terminal.expect("level-zero", {
      visible: ["GROUP_INDENT_ROOT", "GROUP_INDENT_MIXED", "peer.txt"],
    });

    await terminal.perform({ type: "click", at: level0.find("click for more detail") });
    await terminal.expect("level-one-ready", {
      visible: ["GROUP_INDENT_L1_END"],
    });
    await repaint(terminal, viewport);
    const level1 = await terminal.expect("level-one", {
      visible: ["GROUP_INDENT_ROOT", "GROUP_INDENT_L1_END", "peer.txt"],
    });

    await terminal.perform({ type: "click", at: level1.find("click for more detail") });
    await terminal.expect("level-two-ready", {
      visible: ["GROUP_INDENT_L2_END"],
    });
    await repaint(terminal, viewport);
    const level2 = await terminal.expect("level-two", {
      visible: ["GROUP_INDENT_ROOT", "GROUP_INDENT_L2_END", "peer.txt"],
    });

    assertGroupedGeometry([level0, level1, level2]);
  },
});

function assertGroupedGeometry(frames: readonly FrameEvidence[]): void {
  for (const frame of frames) {
    const peerRow = tokenRow(frame, "peer.txt");
    const childRows = frame.lines.slice(0, peerRow);
    assert.ok(
      childRows.every((row) => !row.includes("────────")),
      `${frame.name}: grouped child embedded standalone divider chrome`,
    );
    const header = childRows.find((row) => row.includes("group-indent.txt")) ?? "";
    assert.ok(!header.includes("Read"), `${frame.name}: grouped child embedded a duplicate Read label: ${header}`);
  }

  const columns = assertStableColumns(frames, indentationTokens, "grouped output");
  assert.ok(new Set(Object.values(columns)).size >= 4, "fixture did not exercise varied payload indentation");
  assertRelativeColumns(columns, "GROUP_INDENT_ROOT", {
    GROUP_INDENT_TWO_SPACES: 2,
    GROUP_INDENT_FOUR_SPACES: 4,
    GROUP_INDENT_SEVEN_SPACES: 7,
    GROUP_INDENT_TAB: 4,
    GROUP_INDENT_MIXED: 6,
  }, "grouped output");
}
