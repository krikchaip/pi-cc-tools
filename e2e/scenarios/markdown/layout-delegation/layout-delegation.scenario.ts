import assert from "node:assert/strict";

import { markdownFamily, restoredSession } from "../family.ts";

const family = markdownFamily(
  { columns: 100, rows: 36 },
  { markdown: { mermaid: "final" } },
);

function rowContaining(lines: readonly string[], token: string): number {
  const row = lines.findIndex((line) => line.includes(token));
  assert.notEqual(row, -1, `rendered frame is missing ${JSON.stringify(token)}`);
  return row;
}

export default family.scenario({
  name: "assistant Markdown delegates Mermaid and LaTeX layout to Pi",
  start: restoredSession("layout-delegation/markdown-layout-delegation-session.jsonl"),
  async run(terminal) {
    const frame = await terminal.expect("delegated-layout", {
      visible: [
        "● Markdown delegation fixture",
        "Start",
        "Finish",
        "a+b",
        "───",
        "c+d",
        "⎡ 1 │ 2 ⎤",
        "⎣ 3 │ 4 ⎦",
      ],
      absent: [
        "graph LR",
        "Start --> Finish",
        "```mermaid",
        "```latex",
        "\\frac",
        "\\begin{bmatrix}",
      ],
    });

    const numerator = rowContaining(frame.lines, "a+b");
    const bar = frame.lines.findIndex((line) => line.trim() === "───");
    const denominator = rowContaining(frame.lines, "c+d");
    assert.deepEqual(
      [bar, denominator],
      [numerator + 1, numerator + 2],
      "Pi's stacked fraction layout was flattened",
    );

    const matrixTop = rowContaining(frame.lines, "⎡ 1 │ 2 ⎤");
    const matrixBottom = rowContaining(frame.lines, "⎣ 3 │ 4 ⎦");
    assert.equal(matrixBottom, matrixTop + 1, "Pi's matrix layout was flattened");
  },
});
