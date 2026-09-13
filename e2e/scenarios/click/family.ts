import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import {
  defineScenarioFamily,
  type FrameEvidence,
  type FramePattern,
  type JsonValue,
  type TerminalSession,
  type Viewport,
} from "../../terminal-session.ts";

export const extension = fileURLToPath(new URL("../../../extensions/index.ts", import.meta.url));
export const fixture = (name: string): string => fileURLToPath(new URL(name, import.meta.url));

const baseSettings = {
  quietStartup: true,
  theme: "dark",
  outputPad: 0,
  clickExpansion: true,
} as const;

export function clickFamily(viewport: Viewport, settings: Readonly<Record<string, JsonValue>> = {}) {
  return defineScenarioFamily({
    name: "click",
    viewport,
    deadlineMs: 10_000,
    scenarioDeadlineMs: 60_000,
    extensions: [extension],
    settings: { ...baseSettings, ...settings },
  });
}

export const standardFamily = clickFamily({ columns: 100, rows: 40 });

export const defaultDisabledFamily = defineScenarioFamily({
  name: "click",
  viewport: { columns: 60, rows: 40 },
  deadlineMs: 10_000,
  extensions: [extension],
  settings: { quietStartup: true, theme: "dark", outputPad: 0 },
});

export async function repaint(terminal: TerminalSession, viewport: Viewport, name = "repaint"): Promise<FrameEvidence> {
  await terminal.perform({ type: "resize", viewport: { columns: viewport.columns + 1, rows: viewport.rows } });
  await delay(120);
  await terminal.perform({ type: "resize", viewport });
  await delay(180);
  return terminal.evidence(name);
}

export async function findAfterActions(
  terminal: TerminalSession,
  name: string,
  pattern: FramePattern,
  action: "page-up" | "page-down" | "wheel-down",
  attempts: number,
): Promise<FrameEvidence> {
  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    const frame = await terminal.evidence(`${name}-${attempt}`);
    if (matches(frame.text, pattern)) return frame;
    if (attempt === attempts) break;
    if (action === "wheel-down") {
      await terminal.perform({ type: "wheel", at: { column: 50, row: 20 }, direction: "down" });
    } else {
      await terminal.perform({ type: "key", key: action });
    }
    await delay(120);
  }
  throw new Error(`${name}: ${String(pattern)} was not visible after ${attempts} ${action} actions`);
}

export function assertFrozenRows(
  label: string,
  before: FrameEvidence,
  after: FrameEvidence,
  pattern: RegExp,
  minimum = 1,
): void {
  const beforeRows = tokenRows(before, pattern);
  const afterRows = tokenRows(after, pattern);
  const common = [...beforeRows.keys()].filter((token) => afterRows.has(token)).sort();
  assert.ok(common.length >= minimum, `${label}: need ${minimum} shared markers, got ${common.join(", ")}`);
  for (const token of common) {
    assert.equal(afterRows.get(token), beforeRows.get(token), `${label}: ${token} moved rows`);
  }
}

export function tokenRows(frame: FrameEvidence, pattern: RegExp): Map<string, number> {
  const found = new Map<string, number>();
  for (const [row, line] of frame.lines.entries()) {
    const regex = new RegExp(pattern.source, pattern.flags.replace("g", "") + "g");
    for (const match of line.matchAll(regex)) found.set(match[0], row + 1);
  }
  return found;
}

export function rowWith(frame: FrameEvidence, pattern: FramePattern): string {
  const row = frame.find(pattern).row;
  return frame.lines[row - 1]!;
}

export function matches(text: string, pattern: FramePattern): boolean {
  if (typeof pattern === "string") return text.includes(pattern);
  pattern.lastIndex = 0;
  return pattern.test(text);
}

export const delay = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));
