import {
  assertOpeningAdjacent,
  captureSingleEdit,
  singleEditFamily,
  singleEditProvider,
  singleEditWorkspace,
} from "./single-edit-gap.ts";

const viewport = { columns: 100, rows: 40 } as const;
const family = singleEditFamily(viewport);

export default family.scenario({
  name: "unified single Edit opens directly after its summary",
  start: {
    mode: "no-session",
    workspace: singleEditWorkspace,
    extensions: [singleEditProvider],
    args: [
      "--approve",
      "--provider", "single-edit-gap-e2e",
      "--model", "deterministic-edit",
      "--api-key", "e2e-local",
    ],
    prompt: "Run the deterministic single Edit.",
  },
  async run(terminal) {
    assertOpeningAdjacent(await captureSingleEdit(terminal, viewport), "unified");
  },
});
