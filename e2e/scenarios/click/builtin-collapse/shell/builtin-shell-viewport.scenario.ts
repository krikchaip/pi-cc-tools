import { builtinCollapseScenario } from "../builtin-collapse.ts";

export default builtinCollapseScenario({
  name: "shell collapse preserves whole and bottom-edge viewport context",
  fixture: "shell/builtin-shell-viewport-session.jsonl",
  collapsed: /printf builtin-shell-viewport/,
  detailPrefix: "SHELL_VIEWPORT_DETAIL",
});
