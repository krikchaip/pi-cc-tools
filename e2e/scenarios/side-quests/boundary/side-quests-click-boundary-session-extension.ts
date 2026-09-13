import path from "node:path";
import { pathToFileURL } from "node:url";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Installs the real Side Quests renderers used by click-boundary sessions. */
export default async function installSideQuestsClickBoundaryRenderers(
  pi: ExtensionAPI,
): Promise<void> {
  const rendererPath = process.env.SIDE_QUESTS_RENDERER;
  if (!rendererPath) throw new Error("SIDE_QUESTS_RENDERER is required");
  const rendererDirectory = path.dirname(path.resolve(rendererPath));
  const importRenderer = (name: string): Promise<any> =>
    import(pathToFileURL(path.join(rendererDirectory, name)).href);
  const { AgentRenderer } = await importRenderer("agent-renderer.ts");
  const { AskParentRenderer } = await importRenderer("ask-parent-renderer.ts");
  const { ContinuationRenderer } = await importRenderer("continuation-renderer.ts");
  const { SideQuestResultRenderer } = await importRenderer(
    "side-quest-result-renderer.ts",
  );
  const { WrapUpRenderer } = await importRenderer("wrap-up-renderer.ts");

  pi.registerProvider("side-quests-boundary-e2e", {
    api: "side-quests-boundary-e2e-api",
    baseUrl: "http://side-quests-boundary.invalid",
    apiKey: "e2e-local",
    streamSimple() {
      throw new Error("The historical click-boundary fixture must not call a model");
    },
    models: [
      {
        id: "historical-session",
        name: "Historical click-boundary session",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 4096,
        maxTokens: 1024,
      },
    ],
  });

  AgentRenderer.register(pi);
  SideQuestResultRenderer.register(pi);
  ContinuationRenderer.register(pi);

  pi.registerTool({
    name: "ask_parent",
    label: "Ask parent",
    description: "Historical ASK PARENT click-boundary fixture",
    parameters: {},
    renderShell: "self",
    renderCall: AskParentRenderer.renderCall,
    renderResult: AskParentRenderer.renderResult,
    async execute() {
      return { content: [] };
    },
  } as any);

  pi.registerTool({
    name: "subagent_done",
    label: "Subagent done",
    description: "Historical WRAP UP click-boundary fixture",
    parameters: {},
    renderShell: "self",
    renderCall: WrapUpRenderer.renderCall,
    renderResult: WrapUpRenderer.renderResult,
    async execute() {
      return { content: [] };
    },
  } as any);
}
