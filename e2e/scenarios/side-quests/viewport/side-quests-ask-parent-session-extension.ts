import path from "node:path";
import { pathToFileURL } from "node:url";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Installs the real Side Quests transcript renderers for historical fixtures. */
export default async function installSideQuestsSessionRenderers(
  pi: ExtensionAPI,
): Promise<void> {
  const rendererPath = process.env.SIDE_QUESTS_RENDERER;
  if (!rendererPath) throw new Error("SIDE_QUESTS_RENDERER is required");
  const resolvedRendererPath = path.resolve(rendererPath);
  const rendererDirectory = path.dirname(resolvedRendererPath);
  const { AgentRenderer } = await import(pathToFileURL(resolvedRendererPath).href);
  const { WrapUpRenderer } = await import(
    pathToFileURL(path.join(rendererDirectory, "wrap-up-renderer.ts")).href
  );
  AgentRenderer.register(pi);
  pi.registerTool({
    name: "subagent_done",
    label: "Subagent done",
    description: "Historical WRAP UP viewport fixture",
    parameters: {},
    renderShell: "self",
    renderCall: WrapUpRenderer.renderCall,
    renderResult: WrapUpRenderer.renderResult,
    async execute() {
      return { content: [] };
    },
  } as any);
}
