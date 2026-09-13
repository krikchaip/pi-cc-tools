import assert from "node:assert/strict";

import type { FrameEvidence, TerminalSession } from "../../../terminal-session.ts";
import { activeBashFamily, crossContextStart } from "../family.ts";

export const staleBuiltinResultScenario = activeBashFamily.scenario({
  name: "cross-context Bash result expands through raw fallback",
  start: crossContextStart(),
  async run(terminal) {
    await arm(terminal, "/e2e-detach-tool-identity", "E2E_CROSS_CONTEXT_TOOL_ARMED");
    const compact = await compactFrame(terminal, "result-compact");
    await terminal.perform({ type: "click", at: compact.find("Done") });
    await terminal.expect("result-expanded", { visible: ["STANDALONE_RESULT_01"] });
  },
});

export const staleExecutionTmuxScenario = activeBashFamily.scenario({
  name: "stale Bash execution and result remain clickable through physical tmux",
  start: crossContextStart({ transport: "tmux" }),
  async run(terminal) {
    await arm(terminal, "/e2e-detach-tool-identity", "E2E_CROSS_CONTEXT_TOOL_ARMED");
    let frame = await compactFrame(terminal, "execution-compact");
    await terminal.perform({ type: "click", at: physicalHeaderAnchor(frame) });
    frame = await terminal.expect("execution-expanded", { visible: ["STANDALONE_RESULT_01", /● Bash/] });
    await terminal.perform({ type: "click", at: physicalHeaderAnchor(frame) });
    frame = await terminal.expect("execution-recollapsed", {
      visible: [/Done.*10 lines.*click.*to expand/],
      absent: ["STANDALONE_RESULT_01"],
    });
    await terminal.perform({ type: "click", at: frame.find("Done") });
    await terminal.expect("result-expanded-after-stale-execution", { visible: ["STANDALONE_RESULT_01"] });
  },
});

export const restoredExecutionTmuxScenario = activeBashFamily.scenario({
  name: "restored Bash execution gets a header anchor before result initialization",
  start: crossContextStart({ transport: "tmux", restoredTarget: "press-target.txt" }),
  async run(terminal) {
    await arm(terminal, "/e2e-hide-restored-tool-semantics", "E2E_RESTORED_BASH_SEMANTICS_ARMED");
    const compact = await compactFrame(terminal, "restored-compact");
    await terminal.perform({ type: "click", at: physicalHeaderAnchor(compact) });
    await terminal.expect("restored-expanded-on-first-click", { visible: ["STANDALONE_RESULT_01"] });

    await terminal.perform({ type: "write", data: "!cat press-target.txt\r" });
    const shell = await terminal.expect("target-command-started", {
      visible: ["$ cat press-target.txt", "Jump to latest message"],
    });
    await terminal.perform({ type: "click", at: shell.find("Jump to latest message") });
    const target = await terminal.expect("restored-target", { visible: ["header"] });
    assert.ok(target.lines.some((line) => /^\s*header(?:\s|$)/.test(line)), `target resolver did not record a header anchor\n${target.text}`);
  },
});

async function arm(terminal: TerminalSession, command: string, marker: string): Promise<void> {
  await terminal.expect("initial-click-anchor", { visible: [/Done.*10 lines.*click.*to expand/] });
  await terminal.perform({ type: "write", data: `${command}\r` });
  await terminal.expect("cross-context-armed", { visible: [marker] });
}

function physicalHeaderAnchor(frame: FrameEvidence) {
  const header = frame.find(/● Bash/);
  const label = frame.find("Bash");
  return { column: label.column, row: header.row };
}

function compactFrame(terminal: TerminalSession, name: string): Promise<FrameEvidence> {
  return terminal.expect(name, {
    visible: [/Done.*10 lines.*click.*to expand/, /● Bash/],
    absent: ["STANDALONE_RESULT_01"],
  });
}
