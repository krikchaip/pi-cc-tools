import { activeExecutionScenario } from "../active-turn.ts";

export default activeExecutionScenario({
  name: "no-output Bash execution expands and collapses through physical tmux",
  emptyOutput: true,
});
