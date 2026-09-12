import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as PiTui from "@earendil-works/pi-tui";

const TOOL_GROUP_MOUSE_PATCH_FLAG = Symbol.for("pi-claude-style-tools:tool-group-mouse-patch");

export default function fixture(pi: ExtensionAPI): void {
  pi.on("turn_start", (_event, ctx) => {
    const prototype = (PiTui as any).TuiAltScreen?.prototype;
    const state = prototype?.[TOOL_GROUP_MOUSE_PATCH_FLAG];
    if (!state) throw new Error("cc-tools mouse adapter was not installed");

    // Reproduce a retained fullscreen renderer whose registration was lost
    // across an extension reload. Visible components and anchors stay intact.
    state.modes = new WeakMap();
    ctx.ui.notify("E2E_STALE_CLICK_MODE_MAP", "info");
  });
}
