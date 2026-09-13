import assert from "node:assert/strict";

import { collapseRowFamily, expandReadNormal, readStart } from "../collapse-row.ts";

export default collapseRowFamily.scenario({
  name: "Read hidden-content row has the exact detail-only shape",
  start: readStart,
  async run(terminal) {
    const normal = await expandReadNormal(terminal);
    assert.match(normal.text, /… \(4 more lines • click for more detail\)/);
    assert.doesNotMatch(normal.text, /click.*to collapse/);
  },
});
