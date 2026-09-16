import { clickSettings, fixture, mcpFamily } from "../family.ts";

const expectedSummary = /Responded.*\[object\].*\(3 fields\)/;
const failureError = "truncated MCP JSON did not use its complete spill file";

export default mcpFamily.scenario({
  name: "truncated JSON uses its complete spill file for tree presentation",
  start: {
    mode: "session",
    session: {
      path: fixture("rendering/mcp-truncated-json-session.jsonl"),
      replaceCwd: "/tmp/pi-cc-tools-mcp-truncated-json-e2e",
      replacements: {
        __FULL_OUTPUT_PATH__: { workspacePath: "full-mcp-result.json" },
      },
    },
    workspace: {
      files: [
        {
          path: "full-mcp-result.json",
          content: JSON.stringify(
            {
              key: "JIRA-123",
              fields: {
                summary: "safe fixture",
                description: "before\n\nafter",
              },
              comments: [],
            },
            null,
            2,
          ),
        },
      ],
    },
    extensions: [fixture("rendering/register-mcp.ts")],
    settings: clickSettings,
  },
  async run(terminal) {
    const collapsed = await terminal.expect("truncated-json-collapsed", {
      visible: [/MCP.*atlassian:atlassian_getJiraIssue/, /Responded/],
    });
    if (!expectedSummary.test(collapsed.text)) throw new Error(failureError);

    await terminal.perform({ type: "click", at: collapsed.find(/Responded/) });
    await terminal.expect("truncated-json-expanded", {
      visible: [
        expectedSummary,
        /key.*JIRA-123/,
        /fields.*object.*2 fields/,
        /comments.*array.*0 items/,
      ],
      absent: ['"key": "JIRA-123"'],
    });
  },
});
