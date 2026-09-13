import { activeResultScenario } from "../active-turn/active-turn.ts";
import { fixture } from "../family.ts";

export default activeResultScenario({
  name: "raw fallback expands after retained native mouse rejection",
  extraExtensions: [fixture("native-fallback/stale-tool-mouse-handler.ts")],
  environment: { E2E_POISON_TOOL_MOUSE_ON_TURN_START: "1" },
  scroll: true,
});
