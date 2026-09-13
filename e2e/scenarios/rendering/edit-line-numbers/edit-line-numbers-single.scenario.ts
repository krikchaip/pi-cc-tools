import {
  assertLastLineNumber,
  captureEditLineFrames,
  editLineFamily,
  editLineProvider,
  editLineWorkspace,
} from "./edit-line-numbers.ts";

export default editLineFamily.scenario({
  name: "single Edit line numbers survive expansion",
  start: {
    mode: "no-session",
    workspace: editLineWorkspace,
    extensions: [editLineProvider],
    args: [
      "--approve",
      "--provider", "edit-line-number-e2e",
      "--model", "single-edit-lines",
      "--api-key", "e2e-local",
    ],
    prompt: "Run the deterministic single Edit.",
  },
  async run(terminal) {
    const { collapsed, expanded } = await captureEditLineFrames(terminal, "+36 -36");
    assertLastLineNumber(collapsed, expanded, "ORIGINAL_201", 201);
    assertLastLineNumber(collapsed, expanded, "SINGLE_201", 201);
  },
});
