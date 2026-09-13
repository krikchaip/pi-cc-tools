import { fileURLToPath } from "node:url";

import { defineScenarioFamily, type FramePattern, type TerminalSession } from "../../terminal-session.ts";

export const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
export const extension = fileURLToPath(new URL("../../../extensions/index.ts", import.meta.url));
export const fixture = (name: string): string => fileURLToPath(new URL(name, import.meta.url));

const settings = {
  quietStartup: true,
  theme: "dark",
  outputPad: 0,
  clickExpansion: true,
  groupToolCalls: true,
} as const;

export const reloadFamily = defineScenarioFamily({
  name: "reload",
  viewport: { columns: 100, rows: 40 },
  deadlineMs: 10_000,
  scenarioDeadlineMs: 45_000,
  settings,
});

export const reloadBackgroundFamily = defineScenarioFamily({
  name: "reload",
  viewport: { columns: 100, rows: 34 },
  deadlineMs: 10_000,
  scenarioDeadlineMs: 30_000,
  settings,
});

export async function repaint(
  terminal: TerminalSession,
  label: string,
  columns: number,
  rows: number,
  anchor: FramePattern,
): Promise<void> {
  await terminal.perform({ type: "resize", viewport: { columns: columns + 1, rows } });
  await terminal.expect(`${label}-widened`, { visible: [anchor], stableForMs: 300 });
  await terminal.perform({ type: "resize", viewport: { columns, rows } });
  await terminal.expect(`${label}-restored`, { visible: [anchor], stableForMs: 300 });
}
