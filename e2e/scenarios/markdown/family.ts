import { fileURLToPath } from "node:url";

import {
  defineScenarioFamily,
  type JsonValue,
  type Viewport,
} from "../../terminal-session.ts";

export const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
export const fixture = (name: string): string => fileURLToPath(new URL(name, import.meta.url));

export function markdownFamily(
  viewport: Viewport,
  settings: Readonly<Record<string, JsonValue>> = {},
) {
  return defineScenarioFamily({
    name: "markdown",
    viewport,
    deadlineMs: 10_000,
    scenarioDeadlineMs: 45_000,
    settings: {
      quietStartup: true,
      defaultProjectTrust: "always",
      theme: "dark",
      outputPad: 0,
      packages: [repositoryRoot],
      ...settings,
    },
  });
}

export const restoredSession = (name: string) => ({
  mode: "session" as const,
  transport: "tmux" as const,
  loadExtensionsFromSettings: true,
  session: {
    path: fixture(name),
    replacements: { __CWD__: { workspacePath: "." } },
  },
});
