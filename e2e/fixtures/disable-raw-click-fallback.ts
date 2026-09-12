import * as PiTui from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const TOOL_GROUP_MOUSE_PATCH_FLAG = Symbol.for("pi-claude-style-tools:tool-group-mouse-patch");
function disableRawClickFallback(): boolean {
  const prototype = (PiTui as any).TuiAltScreen?.prototype;
  const state = prototype?.[TOOL_GROUP_MOUSE_PATCH_FLAG];
  if (!state) return false;

  state.targetAt = () => undefined;
  return true;
}

export default function fixture(pi: ExtensionAPI): void {
  pi.on("turn_start", () => {
    const timer = setInterval(disableRawClickFallback, 10);
    timer.unref?.();
  });
}
