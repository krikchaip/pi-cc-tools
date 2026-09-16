import { mcpFamily, fixture } from "../family.ts";

export default mcpFamily.scenario({
  name: "batch anchor preserves JSON indentation",
  start: {
    mode: "no-session",
    extensions: [fixture("batch-anchor/mcp-batch-anchor.ts")],
  },
  async run(terminal) {
    await terminal.expect("expanded-batch", {
      visible: [
        "BATCH ANCHOR E2E",
        /^ ● Mcp: 1 done • 1 failed/m,
        /^ │ └ Error: missing required parameter: sha/m,
        /^   ├ Responded \[object\] \(2 fields\)/m,
        /^   │ ├ sha {5}254df9c/m,
        /^   │ └ commit {2}object · 2 fields/m,
        /^   │   ├ message {2}anchor response at bullet/m,
        /^   │   └ author {3}object · 2 fields/m,
        /^   │     ├ name {3}Example Author/m,
        /^   └     └ email {2}author@example\.com/m,
      ],
    });
    await terminal.perform({ type: "key", key: "escape" });
  },
});
