import { fileURLToPath } from "node:url";

import { defineScenarioFamily, type ScenarioStart } from "../../terminal-session.ts";

export const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
export const extension = fileURLToPath(new URL("../../../extensions/index.ts", import.meta.url));
export const fixture = (name: string): string => fileURLToPath(new URL(name, import.meta.url));

const settings = {
  quietStartup: true,
  theme: "dark",
  outputPad: 1,
  toolBackground: "outlines",
  clickExpansion: true,
  groupToolCalls: true,
  liveToolPreview: true,
  liveToolPreviewLines: 3,
  thinkingMode: "full",
  hideThinkingBlock: false,
  packages: [repositoryRoot],
} as const;

const shared = {
  name: "active-bash",
  deadlineMs: 12_000,
  scenarioDeadlineMs: 35_000,
  settings,
} as const;

export const activeBashFamily = defineScenarioFamily({
  ...shared,
  viewport: { columns: 100, rows: 40 },
});

export const wideActiveBashFamily = defineScenarioFamily({
  ...shared,
  viewport: { columns: 282, rows: 79 },
});

export function crossContextStart(options: {
  readonly transport?: "pty" | "tmux";
  readonly restoredTarget?: string;
} = {}): ScenarioStart {
  return {
    mode: "session",
    transport: options.transport,
    loadExtensionsFromSettings: true,
    session: {
      path: fixture("cross-context/bash-command-click-standalone-session.jsonl"),
      replaceCwd: "/tmp/pi-cc-tools-bash-command-click",
    },
    settings: {
      outputPad: 0,
      groupToolCalls: false,
      packages: [],
      extensions: [extension, fixture("cross-context/cross-context-bash-component.ts")],
    },
    environment: options.restoredTarget
      ? { E2E_RESTORED_TARGET_PATH: options.restoredTarget }
      : undefined,
  };
}

export function activeStart(options: {
  readonly transport?: "pty" | "tmux";
  readonly extraExtensions?: readonly string[];
  readonly longTranscript?: boolean;
  readonly emptyOutput?: boolean;
} = {}): ScenarioStart {
  const extensions = [
    ...(options.transport === "tmux" ? [fixture("active-turn/passive-overlay.ts")] : []),
    ...(options.extraExtensions ?? []),
    fixture("active-turn/preserved-bash-completion-provider.ts"),
  ];
  return {
    mode: "no-session",
    transport: options.transport,
    loadExtensionsFromSettings: true,
    extensions,
    args: [
      "--approve",
      "--provider", "preserved-bash-completion-e2e",
      "--model", "deterministic-bash",
      "--api-key", "e2e-local",
    ],
    prompt: "Run the deterministic Bash fixture.",
    environment: {
      ACTIVE_BASH_THINKING_STREAM: "1",
      ...(options.longTranscript ? { ACTIVE_BASH_LONG_TRANSCRIPT: "1" } : {}),
      ...(options.emptyOutput ? { ACTIVE_BASH_EMPTY_OUTPUT: "1" } : {}),
    },
  };
}
