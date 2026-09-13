import { activeResultScenario } from "../active-turn/active-turn.ts";
import { fixture } from "../family.ts";

export default activeResultScenario({
  name: "native component dispatch expands without raw fallback",
  extraExtensions: [fixture("native-dispatch/disable-raw-click-fallback.ts")],
  scroll: true,
});
