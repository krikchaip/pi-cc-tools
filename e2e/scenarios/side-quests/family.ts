import assert from "node:assert/strict";
import { accessSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  defineScenarioFamily,
  type FrameEvidence,
  type FramePattern,
  type TerminalPoint,
  type TerminalSession,
} from "../../terminal-session.ts";

export const extension = fileURLToPath(new URL("../../../extensions/index.ts", import.meta.url));
export const fixture = (name: string): string => fileURLToPath(new URL(name, import.meta.url));
const hostAgentDirectory = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
export const sideQuestsRenderer = process.env.SIDE_QUESTS_RENDERER
  ?? join(hostAgentDirectory, "packages", "side-quests", "renderer", "agent-renderer.ts");

export function assertSideQuestsRenderer(): void {
  try {
    accessSync(sideQuestsRenderer);
  } catch {
    throw new Error(`real Side Quests renderer not found: ${sideQuestsRenderer}`);
  }
}

export const sideQuestsFamily = defineScenarioFamily({
  name: "side-quests",
  viewport: { columns: 100, rows: 120 },
  deadlineMs: 10_000,
  scenarioDeadlineMs: 45_000,
});

export const sideQuestsViewportFamily = defineScenarioFamily({
  name: "side-quests",
  viewport: { columns: 100, rows: 40 },
  deadlineMs: 10_000,
  scenarioDeadlineMs: 60_000,
});

export const agentSettings = {
  quietStartup: true,
  theme: "dark",
  outputPad: 0,
  groupToolCalls: true,
} as const;

export const homeSettings = {
  clickExpansion: true,
  previewLines: 3,
  expandedPreviewMaxLines: 5,
  extraExpandedPreviewMaxLines: 7,
  groupToolCalls: true,
} as const;

export const keybindings = { "app.tools.expand": "ctrl+y" } as const;

export async function clickPattern(
  terminal: TerminalSession,
  evidenceName: string,
  frame: FrameEvidence,
  pattern: FramePattern,
  rowOffset = 0,
): Promise<TerminalPoint> {
  const point = frame.find(pattern);
  const target = { column: point.column, row: point.row + rowOffset };
  assert.ok(target.row >= 1, `${evidenceName}: click target is above the viewport`);
  await terminal.perform({ type: "click", at: target });
  return target;
}

export async function repaint(
  terminal: TerminalSession,
  label: string,
  anchor: FramePattern,
): Promise<FrameEvidence> {
  await terminal.perform({ type: "resize", viewport: { columns: 80, rows: 40 } });
  await terminal.expect(`${label}-narrow`, { visible: [anchor], stableForMs: 250 });
  await terminal.perform({ type: "resize", viewport: { columns: 100, rows: 40 } });
  return terminal.expect(`${label}-restored`, { visible: [anchor], stableForMs: 250 });
}

export function rowsWithPrefix(frame: FrameEvidence, prefix: string): Map<string, number> {
  const result = new Map<string, number>();
  const pattern = new RegExp(`${escapeRegExp(prefix)}[0-9]{2}`, "g");
  frame.lines.forEach((line, index) => {
    if (line.includes("Jump to latest message")) return;
    for (const match of line.matchAll(pattern)) {
      if (!result.has(match[0])) result.set(match[0], index + 1);
    }
  });
  return result;
}

export async function findVisibleUp(
  terminal: TerminalSession,
  label: string,
  pattern: FramePattern,
  maxPages = 8,
): Promise<FrameEvidence> {
  for (let page = 0; page <= maxPages; page += 1) {
    const frame = await terminal.evidence(`${label}-${page}`);
    try {
      frame.find(pattern);
      return frame;
    } catch {}
    await terminal.perform({ type: "key", key: "page-up" });
    await terminal.expect(`${label}-scroll-${page}`, { visible: ["Jump to latest message"], stableForMs: 250 });
  }
  throw new Error(`${label}: ${String(pattern)} was not visible after ${maxPages} page-up actions`);
}

export function assertRowsStayFixed(
  before: FrameEvidence,
  after: FrameEvidence,
  prefix: string,
  minimum: number,
): void {
  const beforeRows = rowsWithPrefix(before, prefix);
  const afterRows = rowsWithPrefix(after, prefix);
  const common = [...beforeRows.keys()].filter((token) => afterRows.has(token)).sort();
  assert.ok(common.length >= minimum, `need ${minimum} shared ${prefix} rows, got ${common.join(", ")}`);
  for (const token of common) assert.equal(afterRows.get(token), beforeRows.get(token), `${token} moved`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
