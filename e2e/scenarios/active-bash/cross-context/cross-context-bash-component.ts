import { writeFileSync } from "node:fs";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as PiTui from "@earendil-works/pi-tui";

const TOOL_GROUP_MOUSE_PATCH_FLAG = Symbol.for("pi-claude-style-tools:tool-group-mouse-patch");
const TOOL_CLICK_ANCHORS = Symbol.for("pi-claude-style-tools:tool-click-anchors");
const TOOL_RESULT_GETTER_SEEN = Symbol.for("pi-claude-style-tools:tool-result-getter-seen");
const CLICK_RUNTIME_KEY = Symbol.for("pi-claude-style-tools:click-runtime");
const STALE_LAYOUT_DRIFT = Symbol("e2e-stale-layout-drift");
const DETACHED_TOOL_PROTOTYPE = Symbol("e2e-detached-tool-prototype");
const STRIPS_ANCHORS_AFTER_RENDER = Symbol("e2e-strips-anchors-after-render");

function clearClickSemanticRows(component: any): void {
  Object.defineProperty(component, "getSemanticRows", {
    configurable: true,
    writable: true,
    value: () => [],
  });
}

function detachToolIdentity(component: any): void {
  const current = Object.getPrototypeOf(component);
  if (!current || current[DETACHED_TOOL_PROTOTYPE]) return;
  const detached = Object.create(Object.getPrototypeOf(current));
  Object.defineProperties(detached, Object.getOwnPropertyDescriptors(current));
  Object.defineProperty(detached, DETACHED_TOOL_PROTOTYPE, { value: true });
  for (const method of ["clickAnchorAtPoint", "clickActionAtPoint", "activateClickAction", "handleMouse"]) {
    Object.defineProperty(detached, method, {
      configurable: true,
      writable: true,
      value: undefined,
    });
  }
  Object.setPrototypeOf(component, detached);
  if (!component[STRIPS_ANCHORS_AFTER_RENDER]) {
    const render = component.render.bind(component);
    component.render = (width: number) => {
      const rows = render(width);
      delete component[TOOL_CLICK_ANCHORS];
      return rows;
    };
    component[STRIPS_ANCHORS_AFTER_RENDER] = true;
  }
}

function hideRestoredBashSemantics(mode: any): any {
  const bash = (mode.chatContainer.children ?? []).find(
    (component: any) => component?.constructor?.name === "ToolExecutionComponent"
      && component?.toolName === "bash",
  );
  if (!bash) throw new Error("No standalone Bash component was found");
  bash[TOOL_RESULT_GETTER_SEEN] = bash.getResultRenderer;
  clearClickSemanticRows(bash.callRendererComponent);
  clearClickSemanticRows(bash.resultRendererComponent);
  return bash;
}

function introduceTranscriptHeightDrift(mode: any): void {
  const children = mode.chatContainer.children ?? [];
  const bashIndex = children.findIndex(
    (component: any) => component?.constructor?.name === "ToolExecutionComponent"
      && component?.toolName === "bash",
  );
  const bash = children[bashIndex];
  if (!bash) throw new Error("No standalone Bash component was found");
  detachToolIdentity(bash);
  const earlier = children.slice(0, bashIndex).findLast(
    (component: any) => typeof component?.render === "function" && !component[STALE_LAYOUT_DRIFT],
  );
  if (!earlier) throw new Error("No component before the standalone Bash result was found");
  const render = earlier.render.bind(earlier);
  earlier.render = (width: number) => [
    ...Array.from({ length: 7 }, (_, index) => `E2E_STALE_LAYOUT_ROW_${index + 1}`),
    ...render(width),
  ];
  earlier[STALE_LAYOUT_DRIFT] = true;
}

export default function fixture(pi: ExtensionAPI): void {
  pi.registerCommand("e2e-hide-restored-tool-semantics", {
    description: "Reproduce a restored Bash wrapper without current-context click semantics",
    handler: async (_args, ctx) => {
      const prototype = (PiTui as any).TuiAltScreen?.prototype;
      const state = prototype?.[TOOL_GROUP_MOUSE_PATCH_FLAG];
      if (!state?.targetAt) throw new Error("cc-tools mouse adapter was not installed");
      const mode = (globalThis as any)[CLICK_RUNTIME_KEY]?.activeInteractiveMode;
      if (!mode) throw new Error("cc-tools interactive mode was not active");
      hideRestoredBashSemantics(mode);
      mode.renderer.requestRender();
      const targetPath = process.env.E2E_RESTORED_TARGET_PATH;
      if (!targetPath) throw new Error("E2E_RESTORED_TARGET_PATH was not set");
      const targetAt = state.targetAt;
      let recorded = false;
      state.targetAt = (renderer: any, activeMode: any, x: number, y: number) => {
        const target = targetAt(renderer, activeMode, x, y);
        if (!recorded) {
          writeFileSync(targetPath, target?.action ?? "none");
          recorded = true;
        }
        return target;
      };
      ctx.ui.notify("E2E_RESTORED_BASH_SEMANTICS_ARMED", "info");
    },
  });

  pi.registerCommand("e2e-detach-tool-identity", {
    description: "Reproduce completed-turn transcript height drift after the visible frame was built",
    handler: async (_args, ctx) => {
      const prototype = (PiTui as any).TuiAltScreen?.prototype;
      const state = prototype?.[TOOL_GROUP_MOUSE_PATCH_FLAG];
      if (!state?.targetAt) throw new Error("cc-tools mouse adapter was not installed");
      const targetAt = state.targetAt;
      let drifted = false;
      state.targetAt = (renderer: any, mode: any, x: number, y: number) => {
        if (!drifted) {
          introduceTranscriptHeightDrift(mode);
          drifted = true;
        }
        return targetAt(renderer, mode, x, y);
      };
      ctx.ui.notify("E2E_CROSS_CONTEXT_TOOL_ARMED", "info");
    },
  });
}
