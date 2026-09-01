import { type ExtensionAPI, InteractiveMode } from "@earendil-works/pi-coding-agent";

const PATCH = Symbol.for("pi-cc-tools-e2e:switch-to-fullscreen");

export default function (_pi: ExtensionAPI): void {
  const prototype = InteractiveMode.prototype as any;
  if (prototype[PATCH]) return;
  prototype[PATCH] = true;
  const originalRenderInitialMessages = prototype.renderInitialMessages;
  prototype.renderInitialMessages = function () {
    const result = originalRenderInitialMessages.apply(this, arguments);
    setTimeout(() => this.switchTuiMode("fullscreen"), 300);
    return result;
  };
}
