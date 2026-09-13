import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import {
  defineScenarioFamily,
  type FrameEvidence,
  type FramePattern,
  type TerminalPoint,
  type TerminalSession,
  type Viewport,
} from "../../terminal-session.ts";

export const fixture = (name: string): string => fileURLToPath(new URL(name, import.meta.url));
export const extension = fileURLToPath(new URL("../../../extensions/index.ts", import.meta.url));

const settings = {
  quietStartup: true,
  theme: "dark",
  outputPad: 0,
  clickExpansion: true,
} as const;

export const asyncDiffFamily = defineScenarioFamily({
  name: "diff",
  viewport: { columns: 100, rows: 40 },
  deadlineMs: 10_000,
  scenarioDeadlineMs: 45_000,
  extensions: [extension],
  settings: {
    ...settings,
    previewLines: 3,
    expandedPreviewMaxLines: 100,
    extraExpandedPreviewMaxLines: 200,
    groupToolCalls: false,
  },
});

export const longCreateFamily = defineScenarioFamily({
  name: "diff",
  viewport: { columns: 140, rows: 25 },
  deadlineMs: 15_000,
  scenarioDeadlineMs: 30_000,
  extensions: [extension],
  settings: {
    ...settings,
    outputPad: 1,
    toolBackground: "outlines",
    extraToolOutputExpanded: false,
  },
});

export async function settle(terminal: TerminalSession, name: string): Promise<FrameEvidence> {
  return terminal.expect(name, { visible: [/\S/], stableForMs: 150 });
}

export async function clickReady(
  terminal: TerminalSession,
  name: string,
  anchor: FramePattern,
): Promise<FrameEvidence> {
  return terminal.expect(name, { visible: [anchor], stableForMs: 700 });
}

export async function repaint(
  terminal: TerminalSession,
  name: string,
  viewport: Viewport,
  anchor: FramePattern = /\S/,
): Promise<FrameEvidence> {
  await terminal.perform({
    type: "resize",
    viewport: { columns: viewport.columns + 1, rows: viewport.rows },
  });
  await terminal.expect(`${name}-widened`, { visible: [anchor], stableForMs: 150 });
  await terminal.perform({ type: "resize", viewport });
  return terminal.expect(`${name}-restored`, { visible: [anchor], stableForMs: 150 });
}

export async function findAfterPaging(
  terminal: TerminalSession,
  name: string,
  pattern: FramePattern,
  direction: "page-up" | "page-down",
  maximumPages: number,
): Promise<{ readonly frame: FrameEvidence; readonly point: TerminalPoint }> {
  for (let attempt = 0; attempt <= maximumPages; attempt += 1) {
    const frame = await terminal.evidence(`${name}-${attempt}`);
    try {
      return { frame, point: frame.find(pattern) };
    } catch (error) {
      if (attempt === maximumPages) throw error;
      await terminal.perform({ type: "key", key: direction });
      await settle(terminal, `${name}-${attempt}-settled`);
    }
  }
  throw new Error(`could not find ${String(pattern)}`);
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
  assert.ok(
    common.length >= minimum,
    `${label}: need ${minimum} shared markers, got ${JSON.stringify(common)}; before=${JSON.stringify(Object.fromEntries(beforeRows))}; after=${JSON.stringify(Object.fromEntries(afterRows))}`,
  );
  for (const token of common) {
    assert.equal(afterRows.get(token), beforeRows.get(token), `${label}: frozen row moved for ${token}`);
  }
}

export function assertCleanTransition(label: string, raw: string, stableTop = false): void {
  for (const token of ["rendering diff", "(rendering", "calculating localized diff"]) {
    assert.ok(!stripAnsi(raw).includes(token), `${label}: visible async placeholder caused flicker: ${token}`);
  }
  if (!stableTop) return;
  const stableRepaints = raw
    .split("\u001b[?2026h")
    .slice(1)
    .filter((batch) => batch.includes("BEFORE_CREATE_") || batch.includes("powerline-narrow.expect"))
    .length;
  assert.ok(stableRepaints <= 1, `${label}: repainted stable top-anchor rows ${stableRepaints} times`);
}

function tokenRows(frame: FrameEvidence, pattern: RegExp): Map<string, number> {
  const result = new Map<string, number>();
  for (let row = 0; row < frame.lines.length; row += 1) {
    const regex = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    for (const match of frame.lines[row]!.matchAll(regex)) result.set(match[0], row + 1);
  }
  return result;
}

function stripAnsi(value: string): string {
  return value
    .replace(/\u001b\].*?(?:\u0007|\u001b\\)/gs, "")
    .replace(/\u001b\[[?0-9;:>]*[ -/]*[@-~]/g, "");
}
