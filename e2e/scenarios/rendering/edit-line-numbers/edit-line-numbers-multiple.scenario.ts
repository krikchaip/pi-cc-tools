import {
  assertLineNumberPair,
  captureEditLineFrames,
  editLineFamily,
  editLineProvider,
  editLineWorkspace,
} from "./edit-line-numbers.ts";

export default editLineFamily.scenario({
  name: "multiple Edit line numbers survive expansion",
  start: {
    mode: "no-session",
    workspace: editLineWorkspace,
    extensions: [editLineProvider],
    args: [
      "--approve",
      "--provider", "edit-line-number-e2e",
      "--model", "multi-edit-lines",
      "--api-key", "e2e-local",
    ],
    prompt: "Run the deterministic multiple Edit.",
  },
  async run(terminal) {
    const { collapsed, expanded } = await captureEditLineFrames(terminal, "4 edits +26 -4");
    assertLineNumberPair(collapsed, expanded, "ORIGINAL_027", [27, 27]);
    assertLineNumberPair(collapsed, expanded, "ORIGINAL_083", [83, 88]);
    assertLineNumberPair(collapsed, expanded, "ORIGINAL_119", [119, 130]);
  },
});
