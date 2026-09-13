import assert from "node:assert/strict";

import { fixture, longCreateFamily, repaint } from "../family.ts";

const viewport = { columns: 140, rows: 25 } as const;

export default longCreateFamily.scenario({
  name: "long Create bottom anchor reveals deeper diff content",
  start: {
    mode: "no-session",
    extensions: [fixture("long-create/long-diff-click-provider.ts")],
    args: [
      "--approve",
      "--provider", "long-diff-click-e2e",
      "--model", "deterministic-long-create",
      "--api-key", "e2e-local",
    ],
    prompt: "Create the deterministic long file.",
  },
  async run(terminal) {
    await terminal.expect("create-complete", {
      visible: ["E2E_LONG_CREATE_COMPLETE"],
      deadlineMs: 15_000,
    });
    const compact = await repaint(
      terminal,
      "settled-compact-preview",
      viewport,
      "156 more diff lines",
    );
    await terminal.perform({ type: "click", at: compact.find("156 more diff lines") });
    const expanded = await terminal.expect("deeper-diff-preview", {
      absent: ["156 more diff lines"],
      deadlineMs: 10_000,
      stableForMs: 150,
    });
    assert.ok(
      ["LONG_CREATE_030", "LONG_CREATE_100", "LONG_CREATE_150"].some((token) => expanded.text.includes(token)),
      `bottom anchor changed state without revealing deeper diff content\n${expanded.text}`,
    );
  },
});
