import { Container } from "@earendil-works/pi-tui";
import { ToolExecutionComponent, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
const success = { content: [{ type: "text", text: JSON.stringify({ sha: "254df9c", commit: { message: "anchor response at bullet", author: { name: "Example Author", email: "author@example.com" } } }) }] };
const failure = { content: [{ type: "text", text: "Error: missing required parameter: sha" }], isError: true };
export default function fixture(pi: ExtensionAPI): void {
  const definition = { name: "mcp", label: "MCP", description: "fixture", parameters: {}, async execute() { return success; } } as any;
  pi.registerTool(definition);
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    const make = (id: string, result: any) => {
      const tool = new ToolExecutionComponent("mcp", id, { server: "github", tool: "get_commit" }, {}, definition, { requestRender() {} } as any, ctx.cwd);
      tool.markExecutionStarted(); tool.setArgsComplete(); tool.updateResult(result, false); return tool;
    };
    const group = new Container(); group.addChild(make("failed", failure)); group.addChild(make("success", success));
    group.render(100); (group as any).children[0].setExpanded(true);
    setTimeout(() => { void ctx.ui.custom<void>((_tui, theme, _keys, done) => ({
      render: (width: number) => [theme.bold("BATCH ANCHOR E2E"), ...group.render(width)],
      handleInput: (data: string) => { if (data === "\u001b") done(); },
      invalidate: () => group.invalidate(),
    })); }, 200);
  });
}
