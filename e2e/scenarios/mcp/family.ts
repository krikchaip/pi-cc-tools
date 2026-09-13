import { fileURLToPath } from "node:url";

import { defineScenarioFamily } from "../../terminal-session.ts";

export const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
export const fixture = (name: string): string => fileURLToPath(new URL(name, import.meta.url));

export const mcpFamily = defineScenarioFamily({
  name: "mcp",
  viewport: { columns: 100, rows: 40 },
  deadlineMs: 10_000,
  extensions: [fileURLToPath(new URL("../../../extensions/index.ts", import.meta.url))],
  settings: {
    quietStartup: true,
    theme: "dark",
    outputPad: 0,
  },
});

export const clickSettings = {
  clickExpansion: true,
  groupToolCalls: true,
  mcpOutputMode: "preview",
  previewLines: 8,
  expandedPreviewMaxLines: 4_000,
  extraExpandedPreviewMaxLines: 12_000,
} as const;
