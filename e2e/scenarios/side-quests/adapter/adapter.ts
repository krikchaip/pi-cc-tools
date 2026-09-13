import assert from "node:assert/strict";

import type { FrameEvidence, ScenarioStart } from "../../../terminal-session.ts";
import {
  agentSettings,
  assertSideQuestsRenderer,
  clickPattern,
  extension,
  fixture,
  homeSettings,
  keybindings,
  sideQuestsFamily,
  sideQuestsRenderer,
} from "../family.ts";

export type ExtensionOrder = "baseline" | "producer-first" | "consumer-first";
const producer = fixture("adapter/side-quests-adapter-producer.ts");

function extensionsFor(order: ExtensionOrder): readonly string[] {
  if (order === "baseline") return [producer];
  return order === "producer-first" ? [producer, extension] : [extension, producer];
}

function start(order: ExtensionOrder, mode: string): ScenarioStart {
  return {
    mode: "no-session",
    extensions: extensionsFor(order),
    environment: {
      SIDE_QUESTS_RENDERER: sideQuestsRenderer,
      SIDE_QUEST_E2E_MODE: mode,
    },
    agentSettings,
    homeSettings,
    keybindings,
  };
}

export function keyboardBaselineScenario() {
  return sideQuestsFamily.scenario({
    name: "real renderer remains keyboard-only without cc-tools",
    start: start("baseline", "long"),
    async run(terminal) {
      assertSideQuestsRenderer();
      const compact = await terminal.expect("compact", {
        visible: ["SIDE_QUEST_E2E_READY", "Spawned", /ctrl\+y.*for details/],
        absent: [/click.*to expand/, "SIDE_QUEST_PROMPT_3"],
        stableForMs: 700,
      });
      await clickPattern(terminal, "baseline-click", compact, "Spawned");
      await terminal.expect("mouse-ignored", {
        visible: ["Spawned", /ctrl\+y.*for details/],
        absent: ["SIDE_QUEST_PROMPT_3"],
        stableForMs: 800,
      });
      await terminal.perform({ type: "write", data: "\u0019" });
      await terminal.expect("keyboard-expanded", {
        visible: ["SIDE_QUEST_PROMPT_7"],
        absent: [/click.*to expand/],
      });
    },
  });
}

export function clickAdapterScenario(order: Exclude<ExtensionOrder, "baseline">) {
  return sideQuestsFamily.scenario({
    name: `${label(order)} adapter expands through every detail level`,
    start: start(order, "long"),
    async run(terminal) {
      assertSideQuestsRenderer();
      let frame = await terminal.expect("compact", {
        visible: ["SIDE_QUEST_E2E_READY", "Spawned", /click.*to expand/],
        absent: ["SIDE_QUEST_PROMPT_3", "SYNTHETIC_AGENT_CALL_RENDERER", "SYNTHETIC_AGENT_RESULT_RENDERER"],
        stableForMs: 700,
      });
      await clickPattern(terminal, "summary-click", frame, "Spawned");
      frame = await terminal.expect("level-zero", {
        visible: ["SIDE_QUEST_PROMPT_3", /click.*for more detail/],
        stableForMs: 700,
      });
      await clickPattern(terminal, "detail-one-click", frame, /click.*for more detail/);
      frame = await terminal.expect("level-one", {
        visible: ["SIDE_QUEST_PROMPT_5", /click.*for more detail/],
        stableForMs: 700,
      });
      await clickPattern(terminal, "detail-two-click", frame, /click.*for more detail/);
      frame = await terminal.expect("level-two", {
        visible: [
          "SIDE_QUEST_PROMPT_7",
          "[inherited | interactive]",
          "session path:",
          "Output ends here",
          /click.*to collapse/,
        ],
        absent: ["SYNTHETIC_AGENT_CALL_RENDERER", "SYNTHETIC_AGENT_RESULT_RENDERER"],
        stableForMs: 700,
      });
      assert.ok(frame.lines.filter((row) => /^\s*─{20,}\s*$/.test(row)).length >= 2, "standalone borders are missing");
      await clickPattern(terminal, "collapse-click", frame, "Output ends here");
      await terminal.expect("collapsed-again", {
        visible: ["Spawned", /click.*to expand/],
        absent: ["SIDE_QUEST_PROMPT_7", "Output ends here"],
      });
    },
  });
}

export function statusScenario(
  order: ExtensionOrder,
  status: "resumed" | "answered" | "steered",
) {
  return sideQuestsFamily.scenario({
    name: `${label(order)} renders ${status} in result summary only`,
    start: start(order, `${status}-status`),
    async run(terminal) {
      assertSideQuestsRenderer();
      const frame = await terminal.expect("status", {
        visible: ["SIDE_QUEST_STATUS_E2E_READY", "AGENT_HEADER_STATUS_CLEAR", title(status)],
        absent: ["AGENT_HEADER_STATUS_LEAKED", new RegExp(`\\(${status}\\)`, "i")],
      });
      const row = frame.lines.find((line) => line.includes(title(status)));
      assert.ok(row, `${status} result summary is missing`);
    },
  });
}

export function regressionScenario(order: Exclude<ExtensionOrder, "baseline">) {
  return sideQuestsFamily.scenario({
    name: `${label(order)} preserves banner padding and short output`,
    start: start(order, "regressions"),
    async run(terminal) {
      assertSideQuestsRenderer();
      const frame = await terminal.expect("regression-snapshot", {
        visible: [
          "SIDE_QUEST_REGRESSION_E2E_READY",
          "FINAL_BANNER_SNAPSHOT_BEGIN",
          "EVENT_PADDING_CONFIRMED",
          "CONTINUATION_PADDING_CONFIRMED",
          "ASK_PARENT_PADDING_CONFIRMED",
          "WRAP_UP_PADDING_CONFIRMED",
          "FINAL_BANNER_SNAPSHOT_END",
        ],
        absent: ["PADDING_MISSING"],
      });
      for (const [sectionName, required] of [
        ["EVENT_BANNER", "SUBAGENT COMPLETED"],
        ["CONTINUATION_BANNER", "FROM PARENT"],
        ["ASK_PARENT_BANNER", "ASK PARENT"],
        ["WRAP_UP_BANNER", "WRAP UP"],
      ] as const) {
        const value = section(frame, sectionName);
        assert.ok(value.includes(required), `${sectionName} omitted ${required}`);
        assert.doesNotMatch(value, /^\s*─{20,}\s*$/m, `${sectionName} retained a standalone border`);
      }
      for (const sectionName of ["SHORT_STANDALONE", "SHORT_GROUPED"] as const) {
        const value = section(frame, sectionName);
        assert.ok(value.includes("SHORT_AGENT_PROMPT_2"), `${sectionName} truncated short detail`);
        assert.ok(!value.includes("Output ends here") && !value.includes("click to collapse"), `${sectionName} has a no-op collapse action`);
        if (sectionName === "SHORT_GROUPED") {
          assert.ok(value.includes("SHORT_GROUP_CONFIRMED"), "short group did not use a real two-Agent group");
          assert.ok(value.split("Spawned").length - 1 >= 2, "short group omitted an Agent result");
          assert.doesNotMatch(value, /^\s*─{20,}\s*$/m, "short group retained standalone borders");
        }
      }
    },
  });
}

export function paddingClickScenario(
  order: Exclude<ExtensionOrder, "baseline">,
  kind: "ask" | "wrap",
) {
  const heading = kind === "ask" ? "ASK PARENT" : "WRAP UP";
  const expanded = kind === "ask" ? "ASK_PARENT_PROMPT_30" : "WRAP_UP_RESULT_30";
  return sideQuestsFamily.scenario({
    name: `${label(order)} keeps ${heading} painted top padding clickable`,
    start: start(order, `${kind}-click`),
    async run(terminal) {
      assertSideQuestsRenderer();
      const frame = await terminal.expect("banner", {
        visible: [heading],
        absent: [expanded],
        stableForMs: 700,
      });
      await clickPattern(terminal, "painted-padding-click", frame, heading, -1);
      await terminal.expect("expanded", { visible: [expanded] });
    },
  });
}

function section(frame: FrameEvidence, label: string): string {
  const startIndex = frame.lines.findIndex((line) => line.includes(`${label}_BEGIN`));
  const endIndex = frame.lines.findIndex((line, index) => index > startIndex && line.includes(`${label}_END`));
  assert.ok(startIndex >= 0 && endIndex > startIndex, `missing complete ${label} section`);
  return frame.lines.slice(startIndex + 1, endIndex).join("\n");
}

function label(order: ExtensionOrder): string {
  if (order === "baseline") return "Side Quests only";
  return order === "producer-first" ? "Side Quests then cc-tools" : "cc-tools then Side Quests";
}

function title(value: string): string {
  return `${value[0]!.toUpperCase()}${value.slice(1)}`;
}
