import assert from "node:assert/strict";

import type { FrameEvidence, ScenarioStart } from "../../../terminal-session.ts";
import {
  agentSettings,
  extension,
  fixture,
  keybindings,
  repaint,
  sideQuestsViewportFamily,
} from "../family.ts";

const originalRoot = "/tmp/pi-cc-tools-inherited-agent-group";
const sessionReference = { sessionPath: true } as const;
const workspaceReference = { workspacePath: "." } as const;
const manifest = `${JSON.stringify({
  version: 1,
  childId: "inherited-agent-group-child",
  parentId: "inherited-agent-group-parent",
  ownerId: "inherited-agent-group-owner",
  sessionPath: "__SESSION_PATH__",
  cwd: originalRoot,
  agentName: "general-purpose",
  displayName: "general-purpose",
  description: "Inherited Agent group fixture",
  lifecycle: "interactive",
  inheritContext: true,
  tools: [],
  createdAt: 1789171200000,
}, null, 2)}\n`;

function start(clickExpansion: boolean): ScenarioStart {
  return {
    mode: "session",
    session: {
      path: fixture("inherited-agent/inherited-agent-group-session.jsonl"),
      replaceCwd: originalRoot,
      replacements: {
        [originalRoot]: workspaceReference,
        __SESSION_PATH__: sessionReference,
      },
      files: [{ path: "manifest.json", content: manifest }],
    },
    extensions: [extension, fixture("inherited-agent/inherited-agent-group-extension.ts")],
    environment: {
      TMUX: "/tmp/pi-cc-tools-inherited-agent-group-tmux,0,0",
      TMUX_PANE: "%e2e",
      PI_SIDE_QUESTS_PARENT_ID: "inherited-agent-group-parent",
      PI_SIDE_QUESTS_CHILD_ID: "inherited-agent-group-child",
      PI_SIDE_QUESTS_OWNER_ID: "inherited-agent-group-owner",
      PI_SIDE_QUESTS_SESSION: sessionReference,
    },
    agentSettings,
    homeSettings: {
      clickExpansion,
      groupToolCalls: true,
      toolBackground: "outlines",
    },
    keybindings,
  };
}

export function inheritedAgentScenario(clickExpansion: boolean) {
  return sideQuestsViewportFamily.scenario({
    name: clickExpansion
      ? "inherited Agent groups advertise only actionable click guidance"
      : "inherited Agent groups preserve keyboard-only fallback guidance",
    start: start(clickExpansion),
    async run(terminal) {
      await terminal.expect("ready", { visible: ["Grouped agent 5"] });
      const compact = await repaint(terminal, "compact-repaint", "Grouped agent 5");
      assertSettledResultlessGroup(compact);
      const controlRow = assertResultfulControl(compact, clickExpansion);

      if (clickExpansion) {
        await terminal.perform({ type: "click", at: { column: 6, row: controlRow } });
      } else {
        await terminal.perform({ type: "write", data: "\u0019" });
      }
      const expanded = await terminal.expect("expanded", { visible: ["CONTROL_AGENT_PROMPT_7"] });
      assert.ok(expanded.text.includes("CONTROL_AGENT_PROMPT_7"));
    },
  });
}

function assertSettledResultlessGroup(frame: FrameEvidence): void {
  for (let index = 1; index <= 5; index += 1) {
    assert.ok(frame.text.includes(`Grouped agent ${index}`), `missing Grouped agent ${index}`);
  }
  const headers = frame.lines.filter((row) => row.includes("Agent: 5 done"));
  assert.equal(headers.length, 1, `expected one settled Agent group header, found ${headers.length}`);
  assert.match(headers[0]!, /^\s*●\s+Agent:\s+5 done\s*$/);
  assert.doesNotMatch(headers[0]!, /ctrl\+y|click/, "result-less Agent group retained expansion guidance");
}

function assertResultfulControl(frame: FrameEvidence, clickExpansion: boolean): number {
  const controlHeaders = frame.lines.filter((row) => row.includes("Agent: 2 done"));
  assert.equal(controlHeaders.length, 1, `expected one resultful Agent control header, found ${controlHeaders.length}`);
  const header = controlHeaders[0]!;
  if (clickExpansion) {
    assert.match(header, /click any for details/);
    assert.doesNotMatch(header, /ctrl\+y/);
  } else {
    assert.match(header, /ctrl\+y.*to expand/);
    assert.doesNotMatch(header, /click/);
  }
  assert.ok(!frame.text.includes("CONTROL_AGENT_PROMPT_7"), "resultful Agent control starts expanded");
  const rows = frame.lines
    .map((row, index) => row.includes("Control agent 1") ? index + 1 : 0)
    .filter(Boolean);
  assert.equal(rows.length, 1, `expected one first control Agent row, found ${rows.length}`);
  return rows[0]!;
}
