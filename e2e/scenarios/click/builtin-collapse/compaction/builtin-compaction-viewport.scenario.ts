import { builtinCollapseScenario } from "../builtin-collapse.ts";

export default builtinCollapseScenario({
  name: "compaction collapse preserves whole and bottom-edge viewport context",
  fixture: "compaction/builtin-compaction-viewport-session.jsonl",
  collapsed: /Compacted from 1,234 tokens/,
  detailPrefix: "COMPACTION_VIEWPORT_DETAIL",
});
