import { fileURLToPath } from "node:url";

import {
  defineScenarioFamily,
  type JsonValue,
  type TerminalSession,
  type Viewport,
} from "../../terminal-session.ts";

export const mainExtension = fileURLToPath(new URL("../../../extensions/index.ts", import.meta.url));
export const fixture = (name: string): string => fileURLToPath(new URL(name, import.meta.url));

const baseSettings = {
  quietStartup: true,
  theme: "dark",
  outputPad: 0,
} as const;

export function renderingFamily(
  viewport: Viewport,
  settings: Readonly<Record<string, JsonValue>> = {},
) {
  return defineScenarioFamily({
    name: "rendering",
    viewport,
    deadlineMs: 10_000,
    scenarioDeadlineMs: 45_000,
    extensions: [mainExtension],
    settings: { ...baseSettings, ...settings },
  });
}

export async function repaint(terminal: TerminalSession, viewport: Viewport): Promise<void> {
  await terminal.perform({
    type: "resize",
    viewport: { columns: viewport.columns + 1, rows: viewport.rows },
  });
  await terminal.perform({ type: "resize", viewport });
}
