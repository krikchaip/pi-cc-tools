import { fileURLToPath } from "node:url";

import { defineScenarioFamily, type FramePattern, type TerminalSession } from "../../terminal-session.ts";

export const fixture = (name: string): string => fileURLToPath(new URL(name, import.meta.url));
export const extension = fileURLToPath(new URL("../../../extensions/index.ts", import.meta.url));

const sharedSettings = {
  quietStartup: true,
  theme: "dark",
  outputPad: 0,
  clickExpansion: true,
} as const;

export const builtinsFamily = defineScenarioFamily({
  name: "builtins",
  viewport: { columns: 100, rows: 40 },
  deadlineMs: 10_000,
  extensions: [extension],
  settings: sharedSettings,
});

export const transcriptFamily = defineScenarioFamily({
  name: "builtins",
  viewport: { columns: 72, rows: 40 },
  deadlineMs: 10_000,
  settings: sharedSettings,
});

export async function exerciseTranscriptSummary(
  terminal: TerminalSession,
  options: {
    collapsed: FramePattern;
    expanded: FramePattern;
    keyboard?: FramePattern;
    collapseAnchor?: FramePattern;
  },
): Promise<void> {
  let collapsed = await terminal.expect("collapsed-summary", {
    visible: [options.collapsed],
    absent: [options.expanded],
  });
  if (options.keyboard) {
    await terminal.perform({ type: "write", data: "/cc-tools click off\r" });
    await terminal.expect("keyboard-hint", { visible: [options.keyboard] });
    await terminal.perform({ type: "write", data: "/cc-tools click on\r" });
    collapsed = await terminal.expect("click-hint-restored", { visible: [options.collapsed] });
  }

  const collapsedRow = collapsed.find(options.collapsed).row;
  await terminal.perform({ type: "click", at: { column: 71, row: collapsedRow } });
  const expanded = await terminal.expect("expanded-summary", { visible: [options.expanded] });
  const expandedRow = expanded.find(options.collapseAnchor ?? options.expanded).row;
  await terminal.perform({ type: "click", at: { column: 71, row: expandedRow } });
  await terminal.expect("collapsed-again", {
    visible: [options.collapsed],
    absent: [options.expanded],
  });
}
