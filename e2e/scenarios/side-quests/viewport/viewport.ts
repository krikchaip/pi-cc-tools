import assert from "node:assert/strict";

import type { FrameEvidence, TerminalSession } from "../../../terminal-session.ts";
import {
  assertRowsStayFixed,
  assertSideQuestsRenderer,
  extension,
  findVisibleUp,
  fixture,
  repaint,
  sideQuestsRenderer,
  sideQuestsViewportFamily,
} from "../family.ts";

function start(sessionName: string, groupToolCalls: boolean) {
  return {
    mode: "session" as const,
    session: {
      path: fixture(`viewport/${sessionName.includes("wrap-up") ? "wrap" : "ask"}/${sessionName}`),
      replaceCwd: sessionName.includes("wrap-up")
        ? "/tmp/pi-cc-tools-side-quests-wrap-up-group-viewport"
        : "/tmp/pi-cc-tools-side-quests-ask-parent-viewport",
    },
    extensions: [fixture("viewport/side-quests-ask-parent-session-extension.ts"), extension],
    environment: { SIDE_QUESTS_RENDERER: sideQuestsRenderer },
    settings: {
      quietStartup: true,
      theme: "dark",
      outputPad: 0,
      clickExpansion: true,
      groupToolCalls,
    },
  };
}

export function askParentViewportScenario() {
  return sideQuestsViewportFamily.scenario({
    name: "ASK PARENT collapses without moving surrounding viewport rows",
    start: start("side-quests-ask-parent-viewport-session.jsonl", false),
    async run(terminal) {
      assertSideQuestsRenderer();
      const failures: string[] = [];
      await terminal.expect("ready", { visible: ["ASK_PARENT_VIEWPORT_AFTER_45"] });
      let frame = await positionNearTop(terminal, "find-initial", "ASK PARENT");
      await clickInteriorRow(terminal, frame, "ASK PARENT");
      await terminal.expect("whole-expanded", { visible: ["ASK_PARENT_VIEWPORT_DETAIL_20"] });
      await terminal.perform({ type: "key", key: "page-down" });
      const wholeBefore = await terminal.expect("whole-before", {
        visible: ["ASK_PARENT_VIEWPORT_DETAIL_40", "Jump to latest message"],
        absent: ["ASK_PARENT_VIEWPORT_BEFORE_", "ASK_PARENT_VIEWPORT_AFTER_"],
        stableForMs: 250,
      });
      await clickInteriorRow(terminal, wholeBefore, "ASK_PARENT_VIEWPORT_DETAIL_40");
      const wholeAfter = await terminal.expect("whole-after", {
        visible: ["ASK PARENT"],
        absent: ["ASK_PARENT_VIEWPORT_DETAIL_20"],
        stableForMs: 250,
      });
      if (!wholeAfter.text.includes("ASK_PARENT_VIEWPORT_AFTER_15")) {
        failures.push("whole viewport: collapsed banner omitted ASK_PARENT_VIEWPORT_AFTER_15");
      }

      frame = await positionNearTop(terminal, "find-bottom-reopen", "ASK PARENT");
      await clickInteriorRow(terminal, frame, "ASK PARENT");
      await terminal.expect("bottom-expanded", { visible: ["ASK_PARENT_VIEWPORT_DETAIL_20"] });
      await terminal.perform({ type: "key", key: "page-down" });
      await terminal.expect("bottom-page-one", { visible: ["Jump to latest message"], stableForMs: 250 });
      await terminal.perform({ type: "key", key: "page-down" });
      await terminal.expect("bottom-page-two", { visible: ["Jump to latest message"], stableForMs: 250 });
      const bottomBefore = await findBottomEdge(terminal, "ask-bottom", "ASK_PARENT_VIEWPORT_DETAIL_60", "ASK_PARENT_VIEWPORT_AFTER_03");
      if (bottomBefore.text.includes("Output ends here • click to collapse")) {
        failures.push("bottom edge: expanded ASK PARENT retained its terminal collapse row");
      }
      await clickInteriorRow(terminal, bottomBefore, "ASK_PARENT_VIEWPORT_DETAIL_60");
      const bottomAfter = await terminal.expect("bottom-after", {
        visible: ["ASK_PARENT_VIEWPORT_DETAIL_08…"],
        absent: ["ASK_PARENT_VIEWPORT_DETAIL_60", "Output ends here • click to collapse"],
      });
      collectFixedRowFailure(failures, bottomBefore, bottomAfter, "ASK_PARENT_VIEWPORT_AFTER_", 3, "bottom edge");

      frame = await positionNearTop(terminal, "find-rollback", "ASK PARENT");
      await clickInteriorRow(terminal, frame, "ASK PARENT");
      await terminal.expect("rollback-open", { visible: ["ASK_PARENT_VIEWPORT_DETAIL_07"] });
      await terminal.perform({ type: "key", key: "page-down" });
      const rollbackBefore = await terminal.expect("rollback-before", {
        visible: ["ASK_PARENT_VIEWPORT_DETAIL_25", "Jump to latest message"],
        stableForMs: 250,
      });
      const target = { column: 50, row: rollbackBefore.find("ASK_PARENT_VIEWPORT_DETAIL_25").row };
      await terminal.perform({ type: "click", at: target });
      await terminal.perform({ type: "click", at: target });
      const doubleAfter = await terminal.expect("double-after", {
        visible: ["ASK_PARENT_VIEWPORT_DETAIL_25"],
        stableForMs: 700,
      });
      collectFixedRowFailure(failures, rollbackBefore, doubleAfter, "ASK_PARENT_VIEWPORT_DETAIL_", 20, "double click");
      const tripleTarget = { column: 50, row: doubleAfter.find("ASK_PARENT_VIEWPORT_DETAIL_25").row };
      await terminal.perform({ type: "click", at: tripleTarget });
      await terminal.perform({ type: "click", at: tripleTarget });
      await terminal.perform({ type: "click", at: tripleTarget });
      const tripleAfter = await terminal.expect("triple-after", {
        visible: ["ASK_PARENT_VIEWPORT_DETAIL_25"],
        stableForMs: 250,
      });
      collectFixedRowFailure(failures, rollbackBefore, tripleAfter, "ASK_PARENT_VIEWPORT_DETAIL_", 20, "triple click");

      assert.deepEqual(failures, [], failures.join("\n"));
    },
  });
}

export function wrapUpViewportScenario() {
  return sideQuestsViewportFamily.scenario({
    name: "WRAP UP collapses without moving following grouped transcript rows",
    start: start("side-quests-wrap-up-group-viewport-session.jsonl", true),
    async run(terminal) {
      assertSideQuestsRenderer();
      const failures: string[] = [];
      await terminal.expect("ready", { visible: ["WRAP_UP_VIEWPORT_AFTER_45"] });
      let frame = await findVisibleUp(terminal, "find-initial", /WRAP UP|subagent_done/);
      if (frame.text.includes("Tools:")) failures.push("grouping: WRAP UP was grouped with the preceding Read tool");
      frame = await positionNearTop(terminal, "position-initial", /WRAP UP|subagent_done/);
      await terminal.perform({ type: "click", at: { column: 50, row: findEither(frame, "WRAP UP", "subagent_done").row } });
      await terminal.expect("whole-expanded", { visible: ["WRAP_UP_VIEWPORT_DETAIL_10"] });
      await terminal.perform({ type: "key", key: "page-down" });
      const wholeBefore = await terminal.expect("whole-before", {
        visible: ["WRAP_UP_VIEWPORT_DETAIL_40", "Jump to latest message"],
        absent: ["WRAP_UP_VIEWPORT_BEFORE_", "WRAP_UP_VIEWPORT_AFTER_"],
        stableForMs: 250,
      });
      await clickInteriorRow(terminal, wholeBefore, "WRAP_UP_VIEWPORT_DETAIL_40");
      const wholeAfter = await terminal.expect("whole-after", {
        visible: ["WRAP UP"],
        absent: ["WRAP_UP_VIEWPORT_DETAIL_25"],
        stableForMs: 250,
      });
      if (!wholeAfter.text.includes("WRAP_UP_VIEWPORT_AFTER_15")) {
        failures.push("whole viewport: collapsed banner omitted WRAP_UP_VIEWPORT_AFTER_15");
      }

      frame = await positionNearTop(terminal, "find-bottom-reopen", /WRAP UP|subagent_done/);
      await terminal.perform({ type: "click", at: { column: 50, row: findEither(frame, "WRAP UP", "subagent_done").row } });
      await terminal.expect("bottom-expanded", { visible: ["WRAP_UP_VIEWPORT_DETAIL_10"] });
      await terminal.perform({ type: "key", key: "page-down" });
      await terminal.expect("bottom-page-one", { visible: ["Jump to latest message"], stableForMs: 250 });
      await terminal.perform({ type: "key", key: "page-down" });
      await terminal.expect("bottom-page-two", { visible: ["Jump to latest message"], stableForMs: 250 });
      const bottomBefore = await findBottomEdge(terminal, "wrap-bottom", "WRAP_UP_VIEWPORT_DETAIL_60", "WRAP_UP_VIEWPORT_AFTER_03");
      if (bottomBefore.text.includes("Output ends here • click to collapse")) {
        failures.push("bottom edge: expanded WRAP UP retained its terminal collapse row");
      }
      await clickInteriorRow(terminal, bottomBefore, "WRAP_UP_VIEWPORT_DETAIL_60");
      const bottomAfter = await terminal.expect("bottom-after", {
        visible: ["WRAP_UP_VIEWPORT_DETAIL_…"],
        absent: ["WRAP_UP_VIEWPORT_DETAIL_60", "Output ends here • click to collapse"],
      });
      collectFixedRowFailure(failures, bottomBefore, bottomAfter, "WRAP_UP_VIEWPORT_AFTER_", 3, "bottom edge");
      assert.deepEqual(failures, [], failures.join("\n"));
    },
  });
}

async function clickInteriorRow(terminal: TerminalSession, frame: FrameEvidence, pattern: string): Promise<void> {
  await terminal.perform({ type: "click", at: { column: 50, row: frame.find(pattern).row } });
}

async function positionNearTop(
  terminal: TerminalSession,
  label: string,
  pattern: string | RegExp,
): Promise<FrameEvidence> {
  let frame = await findVisibleUp(terminal, label, pattern);
  for (let wheel = 0; frame.find(pattern).row > 12 && wheel < 30; wheel += 1) {
    await terminal.perform({ type: "wheel", at: { column: 50, row: 20 }, direction: "down" });
    frame = await terminal.expect(`${label}-near-top-${wheel}`, {
      visible: [pattern, "Jump to latest message"],
      stableForMs: 100,
    });
  }
  assert.ok(frame.find(pattern).row <= 12, `${label}: target did not reach the safe top click region`);
  return repaint(terminal, `${label}-repaint`, pattern);
}

async function findBottomEdge(
  terminal: TerminalSession,
  label: string,
  detail: string,
  following: string,
): Promise<FrameEvidence> {
  for (let wheel = 0; wheel <= 40; wheel += 1) {
    const frame = await terminal.evidence(`${label}-${wheel}`);
    if (frame.text.includes(detail) && frame.text.includes(following)) return frame;
    await terminal.perform({ type: "wheel", at: { column: 50, row: 20 }, direction: "down" });
    await terminal.expect(`${label}-scroll-${wheel}`, { visible: ["Jump to latest message"], stableForMs: 100 });
  }
  throw new Error(`${label}: expanded bottom edge was not positioned`);
}

function collectFixedRowFailure(
  failures: string[],
  before: FrameEvidence,
  after: FrameEvidence,
  prefix: string,
  minimum: number,
  label: string,
): void {
  try {
    assertRowsStayFixed(before, after, prefix, minimum);
  } catch (error) {
    failures.push(`${label}: ${(error as Error).message}`);
  }
}

function findEither(frame: FrameEvidence, primary: string, fallback: string) {
  try {
    return frame.find(primary);
  } catch {
    return frame.find(fallback);
  }
}
