import assert from "node:assert/strict";

import { bashFamily, fixture, requireRow } from "../family.ts";

export default bashFamily.scenario({
  name: "live Bash output becomes one-hint preserved completion",
  start: {
    mode: "no-session",
    extensions: [fixture("preserved-completion/preserved-bash-completion-provider.ts")],
    args: [
      "--approve",
      "--provider", "preserved-bash-completion-e2e",
      "--model", "deterministic-bash",
      "--api-key", "e2e-local",
    ],
    prompt: "Run the deterministic Bash fixture.",
    settings: {
      clickExpansion: false,
      groupToolCalls: false,
      liveToolPreview: true,
      liveToolPreviewLines: 3,
    },
  },
  async run(terminal) {
    const partial = await terminal.expect("partial-live-output", {
      visible: ["BASH_PRESERVED_03", /Bash.*for i in/],
      absent: [/Done.*24 lines/, "E2E_BASH_PRESERVED_COMPLETE"],
      deadlineMs: 12_000,
      stableForMs: 0,
    });
    assert.ok(!partial.text.includes("Done (24 lines)"), "partial frame was captured after Bash completed");

    const finished = await terminal.expect("preserved-completion", {
      visible: [
        "Done",
        "(24 lines)",
        "… (21 earlier lines)",
        "BASH_PRESERVED_22",
        "BASH_PRESERVED_23",
        "BASH_PRESERVED_24",
      ],
      absent: ["E2E_BASH_PRESERVED_COMPLETE"],
      deadlineMs: 12_000,
      stableForMs: 0,
    });
    const hints = [...finished.text.matchAll(/(?:ctrl\+o|click) to expand/g)];
    assert.equal(hints.length, 1, `finished Bash frame must contain one expand hint, found ${hints.length}`);
    const earlierRow = requireRow(finished, "earlier lines");
    assert.doesNotMatch(finished.lines[earlierRow]!, /ctrl\+o|click/, "earlier-lines row contains a duplicate hint");

    await terminal.expect("provider-complete", {
      visible: ["E2E_BASH_PRESERVED_COMPLETE"],
      deadlineMs: 10_000,
    });
  },
});
