import {
  ToolExecutionComponent,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

const ACTIVE_TOOL_GROUPS_KEY = Symbol.for("pi-claude-style-tools:active-tool-groups");

function poisonMouseHandlers(): number {
  (ToolExecutionComponent.prototype as any).handleMouse = () => undefined;
  const groups = (globalThis as any)[ACTIVE_TOOL_GROUPS_KEY];
  let poisonedGroups = 0;
  for (const group of groups ?? []) {
    Object.getPrototypeOf(group).handleMouse = () => undefined;
    poisonedGroups++;
  }
  return poisonedGroups;
}

export default function fixture(pi: ExtensionAPI): void {
  pi.registerCommand("e2e-poison-tool-mouse", {
    description: "Replace the retained tool mouse handler with a stale implementation",
    handler: async (_args, ctx) => {
      poisonMouseHandlers();
      ctx.ui.notify("E2E_STALE_TOOL_MOUSE_HANDLER", "info");
    },
  });

  if (process.env.E2E_POISON_TOOL_MOUSE_ON_TURN_START === "1") {
    pi.on("turn_start", (_event, ctx) => {
      const timer = setInterval(() => {
        if (poisonMouseHandlers() === 0) return;
        clearInterval(timer);
        ctx.ui.notify("E2E_STALE_TOOL_MOUSE_HANDLER", "info");
      }, 10);
      timer.unref?.();
    });
  }
}
