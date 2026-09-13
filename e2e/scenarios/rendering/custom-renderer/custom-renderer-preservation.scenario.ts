import assert from "node:assert/strict";

import { fixture, renderingFamily } from "../family.ts";

const family = renderingFamily(
  { columns: 72, rows: 32 },
  { groupToolCalls: false },
);

export default family.scenario({
  name: "custom renderers survive generic fallback wrapping",
  start: {
    mode: "no-session",
    extensions: [fixture("custom-renderer/custom-renderer-preservation.ts")],
  },
  async run(terminal) {
    const frame = await terminal.expect("custom-renderers", {
      visible: [
        "CUSTOM RENDERER PRESERVATION E2E",
        "CUSTOM_CALL_RENDERER_OK",
        "CALL_WRAP_END",
        "CUSTOM_RESULT_RENDERER_OK",
        "RESULT_WRAP_END",
      ],
      absent: [
        "GENERIC_CALL_FALLBACK_SHOULD_NOT_RENDER",
        "GENERIC_RESULT_FALLBACK_SHOULD_NOT_RENDER",
        "legacy-call",
        "zero-width-result",
      ],
      rawAbsent: ["\uE000", "\u200B"],
    });

    const callRows = frame.lines
      .map((line, index) => line.includes("CUSTOM_CALL_RENDERER_OK") || line.includes("CALL_WRAP_END") ? index : -1)
      .filter((index) => index >= 0);
    const resultRows = frame.lines
      .map((line, index) => line.includes("CUSTOM_RESULT_RENDERER_OK") || line.includes("RESULT_WRAP_END") ? index : -1)
      .filter((index) => index >= 0);
    assert.ok(new Set(callRows).size >= 2, "custom renderCall output did not wrap onto a later physical row");
    assert.ok(new Set(resultRows).size >= 2, "custom renderResult output did not wrap onto a later physical row");
  },
});
