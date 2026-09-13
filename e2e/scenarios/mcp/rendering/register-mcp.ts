import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function registerMcpFixture(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "mcp",
    label: "MCP",
    description: "E2E MCP fixture",
    parameters: {},
    async execute() {
      return { content: [] };
    },
  } as any);
}
