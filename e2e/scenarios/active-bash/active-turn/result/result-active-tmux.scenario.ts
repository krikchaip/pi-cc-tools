import { activeResultScenario } from "../active-turn.ts";

export default activeResultScenario({
  name: "completed Bash result expands through physical tmux during an active turn",
  transport: "tmux",
  wide: true,
});
