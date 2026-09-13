import { clickSettings, fixture, mcpFamily } from "../family.ts";

export default mcpFamily.scenario({
  name: "standalone frame and collapsed summary grammar",
  start: {
    mode: "session",
    session: {
      path: fixture("rendering/mcp-standalone-frame-session.jsonl"),
      replaceCwd: "/tmp/pi-cc-tools-mcp-standalone-frame-e2e",
    },
    extensions: [fixture("rendering/register-mcp.ts")],
    settings: clickSettings,
  },
  async run(terminal) {
    await terminal.expect("standalone-frame", {
      visible: [
        /MCP.*github:get_repository/,
        /Responded.*\[object\].*\(6 fields\).*click.*expand/,
      ],
      ordered: [
        /─{20,}/,
        /MCP.*github:get_repository/,
        /Responded.*\[object\].*\(6 fields\).*click.*expand/,
        /─{20,}/,
      ],
    });
  },
});
