import assert from "node:assert/strict";

import type { FrameEvidence, ScenarioDefinition, ScenarioStart, TerminalSession } from "../../../terminal-session.ts";
import { activeBashFamily, activeStart, wideActiveBashFamily } from "../family.ts";

interface ActiveResultOptions {
  readonly name: string;
  readonly transport?: "pty" | "tmux";
  readonly extraExtensions?: readonly string[];
  readonly environment?: Readonly<Record<string, string>>;
  readonly wide?: boolean;
  readonly scroll?: boolean;
}

export function activeResultScenario(options: ActiveResultOptions): ScenarioDefinition {
  const family = options.wide ? wideActiveBashFamily : activeBashFamily;
  return family.scenario({
    name: options.name,
    start: mergeEnvironment(activeStart({
      transport: options.transport,
      extraExtensions: options.extraExtensions,
      longTranscript: !options.wide,
    }), options.environment),
    async run(terminal) {
      const compact = await activeCompact(terminal, 24);
      const target = options.scroll ? await scrollFrom(compact, terminal, "Done") : compact.find("Done");
      await terminal.perform({ type: "click", at: target });
      await terminal.expect("expanded-during-active-turn", {
        visible: ["BASH_PRESERVED_01"],
        absent: ["E2E_BASH_PRESERVED_COMPLETE"],
        deadlineMs: 3_000,
        stableForMs: 0,
      });
    },
  });
}

export function activeExecutionScenario(options: {
  readonly name: string;
  readonly emptyOutput?: boolean;
}): ScenarioDefinition {
  const lineCount = options.emptyOutput ? 1 : 24;
  return activeBashFamily.scenario({
    name: options.name,
    start: activeStart({ transport: "tmux", longTranscript: true, emptyOutput: options.emptyOutput }),
    async run(terminal) {
      const compact = await activeCompact(terminal, lineCount);
      const target = await scrollFrom(compact, terminal, "Bash");
      await terminal.perform({ type: "click", at: target });
      const expanded = await terminal.expect("execution-expanded-during-active-turn", {
        visible: [options.emptyOutput ? "(no output)" : "BASH_PRESERVED_01"],
        absent: ["E2E_BASH_PRESERVED_COMPLETE"],
        deadlineMs: 3_000,
        stableForMs: 0,
      });
      const expandedHeader = expanded.find("Bash");
      await terminal.perform({ type: "click", at: expandedHeader });
      await terminal.expect("execution-collapsed-during-active-turn", {
        visible: [new RegExp(`Done.*${lineCount} lines.*click.*to expand`)],
        absent: [options.emptyOutput ? "(no output)" : "BASH_PRESERVED_01", "E2E_BASH_PRESERVED_COMPLETE"],
        deadlineMs: 3_000,
        stableForMs: 0,
      });
    },
  });
}

async function activeCompact(terminal: TerminalSession, lineCount: number): Promise<FrameEvidence> {
  return terminal.expect("active-completed-summary", {
    visible: [new RegExp(`Done.*${lineCount} lines.*click.*to expand`), "ACTIVE_BASH_THINKING_STREAM", /● Bash/],
    absent: ["E2E_BASH_PRESERVED_COMPLETE"],
    deadlineMs: 12_000,
    stableForMs: 0,
  });
}

async function scrollFrom(
  compact: FrameEvidence,
  terminal: TerminalSession,
  target: string | RegExp,
) {
  await terminal.perform({ type: "wheel", at: { column: 5, row: 20 }, direction: "up" });
  const scrolled = await terminal.expect("scrolled-active-turn", {
    visible: ["Jump to latest message", target],
    absent: ["E2E_BASH_PRESERVED_COMPLETE"],
    deadlineMs: 2_000,
    stableForMs: 0,
  });
  assert.notDeepEqual(scrolled.lines, compact.lines, "wheel input did not change the active viewport");
  return scrolled.find(target);
}

function mergeEnvironment(
  start: ScenarioStart,
  environment: Readonly<Record<string, string>> | undefined,
): ScenarioStart {
  return environment ? { ...start, environment: { ...start.environment, ...environment } } : start;
}
