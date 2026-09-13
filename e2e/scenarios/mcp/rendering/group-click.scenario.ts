import { clickSettings, fixture, mcpFamily } from "../family.ts";

export default mcpFamily.scenario({
  name: "group child expands without its peer",
  start: {
    mode: "session",
    session: {
      path: fixture("rendering/mcp-group-click-session.jsonl"),
      replaceCwd: "/tmp/pi-cc-tools-mcp-click-e2e",
    },
    extensions: [fixture("rendering/register-mcp.ts")],
    settings: clickSettings,
  },
  async run(terminal) {
    const collapsed = await terminal.expect("collapsed-group", {
      visible: [/click.*any for details/],
      absent: ["MCP_FIRST_PAYLOAD", "MCP_SECOND_PAYLOAD"],
    });
    const firstExecution = collapsed.find(/MCP github:get_repository/);
    await terminal.perform({ type: "click", at: { column: 6, row: firstExecution.row } });
    await terminal.expect("first-child-expanded", {
      visible: [/Responded.*\[object\].*\(2 fields\)/, "MCP_FIRST_PAYLOAD"],
      absent: ["MCP_SECOND_PAYLOAD"],
    });
  },
});
