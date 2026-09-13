import assert from "node:assert/strict";

import type { FrameEvidence } from "../../../terminal-session.ts";

export function tokenRow(frame: FrameEvidence, token: string): number {
  const row = frame.lines.findIndex((line) => line.includes(token));
  assert.notEqual(row, -1, `${frame.name}: missing ${JSON.stringify(token)}\n${frame.text}`);
  return row;
}

export function tokenColumn(frame: FrameEvidence, token: string): number {
  const row = frame.lines.find((line) => line.includes(token));
  assert.ok(row, `${frame.name}: missing ${JSON.stringify(token)}\n${frame.text}`);
  return row.indexOf(token);
}

export function assertStableColumns(
  frames: readonly FrameEvidence[],
  tokens: readonly string[],
  label: string,
): Readonly<Record<string, number>> {
  const baseline: Record<string, number> = {};
  for (const token of tokens) {
    const columns = frames.map((frame) => tokenColumn(frame, token));
    assert.ok(
      columns.every((column) => column === columns[0]),
      `${label}: ${token} changed columns across frames: ${columns.join(", ")}`,
    );
    baseline[token] = columns[0]!;
  }
  return baseline;
}

export function assertRelativeColumns(
  columns: Readonly<Record<string, number>>,
  rootToken: string,
  offsets: Readonly<Record<string, number>>,
  label: string,
): void {
  const root = columns[rootToken];
  assert.notEqual(root, undefined, `${label}: missing root column for ${rootToken}`);
  for (const [token, offset] of Object.entries(offsets)) {
    assert.equal(
      columns[token],
      root! + offset,
      `${label}: ${token} changed payload offset`,
    );
  }
}
