import { builtinCollapseScenario } from "../builtin-collapse.ts";

export default builtinCollapseScenario({
  name: "branch collapse preserves whole and bottom-edge viewport context",
  fixture: "branch/builtin-branch-viewport-session.jsonl",
  collapsed: /Branch summary/,
  detailPrefix: "BRANCH_VIEWPORT_DETAIL",
});
