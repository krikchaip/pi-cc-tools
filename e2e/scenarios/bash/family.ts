import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { defineScenarioFamily, type FrameEvidence } from "../../terminal-session.ts";

export const fixture = (name: string): string => fileURLToPath(new URL(name, import.meta.url));
const extension = fileURLToPath(new URL("../../../extensions/index.ts", import.meta.url));

const shared = {
  name: "bash",
  deadlineMs: 10_000,
  extensions: [extension],
  settings: {
    quietStartup: true,
    theme: "dark",
    outputPad: 0,
    clickExpansion: true,
  },
} as const;

export const bashFamily = defineScenarioFamily({
  ...shared,
  viewport: { columns: 100, rows: 40 },
});

export const bashShapeFamily = defineScenarioFamily({
  ...shared,
  viewport: { columns: 64, rows: 40 },
});

export function requireRow(frame: FrameEvidence, token: string): number {
  const row = frame.lines.findIndex((line) => line.includes(token));
  assert.notEqual(row, -1, `${frame.name}: missing ${JSON.stringify(token)}\n${frame.text}`);
  return row;
}

export function requireTokenColumn(frame: FrameEvidence, token: string): number {
  const row = requireRow(frame, token);
  return frame.lines[row]!.indexOf(token);
}
