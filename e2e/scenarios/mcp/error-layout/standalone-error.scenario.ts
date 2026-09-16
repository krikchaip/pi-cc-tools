import assert from "node:assert/strict";

import { clickSettings, fixture, mcpFamily } from "../family.ts";

const errorSummary = "Error: MCP error -32602";
const firstDetail = "Required at issueIdOrKey";
const finalDetail = "responseContentFormat";

export default mcpFamily.scenario({
  name: "standalone MCP errors retain their summary and full payload",
  start: {
    mode: "session",
    session: {
      path: fixture("error-layout/mcp-standalone-error-session.jsonl"),
      replaceCwd: "/tmp/pi-cc-tools-mcp-standalone-error-e2e",
    },
    extensions: [fixture("rendering/register-mcp.ts")],
    settings: clickSettings,
  },
  async run(terminal) {
    const issues: string[] = [];
    const collapsed = await terminal.expect("collapsed-standalone-error", {
      visible: [/MCP.*atlassian_getJiraIssue/, errorSummary, /click.*to expand/],
      absent: [firstDetail, "Expected parameters:", finalDetail],
    });
    const headerRow = collapsed.lines.findIndex((line) => /MCP.*atlassian_getJiraIssue/.test(line));
    const summaryRowIndex = collapsed.lines.findIndex((line) => line.includes(errorSummary));
    const summaryRow = collapsed.lines[summaryRowIndex] ?? "";
    assert.equal(summaryRowIndex, headerRow + 1, `standalone error summary is not distinct from its detail\n${collapsed.text}`);
    if (!/^\s*[├└] /.test(summaryRow)) {
      issues.push(`summary row is not execution-anchored: ${JSON.stringify(summaryRow)}`);
    }

    await terminal.perform({ type: "click", at: collapsed.find(/MCP.*atlassian_getJiraIssue/) });
    const expanded = await terminal.expect("expanded-standalone-error", {
      visible: [errorSummary, firstDetail, "Expected parameters:", /click.*for more detail/],
    });
    const detailRow = expanded.lines.find((line) => line.includes(firstDetail)) ?? "";
    if (!/^\s*│ /.test(detailRow)) {
      issues.push(`detail row has no branch guide: ${JSON.stringify(detailRow)}`);
    }
    const summaryForeground = foregroundBefore(expanded.raw, errorSummary);
    const detailForeground = foregroundBefore(expanded.raw, firstDetail);
    if (!summaryForeground || summaryForeground !== detailForeground) {
      issues.push(`summary/detail error tones differ: ${summaryForeground ?? "unknown"} vs ${detailForeground ?? "unknown"}`);
    }

    await terminal.perform({ type: "click", at: expanded.find(/click.*for more detail/) });
    const maximum = await terminal.expect("maximum-standalone-error", {
      visible: [finalDetail],
      absent: [/more lines.*for more detail/],
    });
    const finalForeground = foregroundBefore(maximum.raw, finalDetail);
    if (!summaryForeground || summaryForeground !== finalForeground) {
      issues.push(`maximum detail lost the error tone: ${summaryForeground ?? "unknown"} vs ${finalForeground ?? "unknown"}`);
    }

    if (issues.length > 0) {
      throw new Error(`Standalone MCP error layout regression:\n- ${issues.join("\n- ")}`);
    }
  },
});

function foregroundBefore(raw: string, token: string): string | undefined {
  const tokenIndex = raw.lastIndexOf(token);
  if (tokenIndex === -1) return undefined;

  let foreground: string | undefined;
  for (const match of raw.slice(0, tokenIndex).matchAll(/\u001b\[([0-9;:]*)m/g)) {
    const parameters = match[1]!.replaceAll(":", ";").split(";").map((value) => Number(value || "0"));
    for (let index = 0; index < parameters.length; index += 1) {
      const parameter = parameters[index]!;
      if (parameter === 0 || parameter === 39) foreground = undefined;
      if (parameter !== 38) continue;
      if (parameters[index + 1] === 2 && parameters.length > index + 4) {
        foreground = `rgb:${parameters[index + 2]},${parameters[index + 3]},${parameters[index + 4]}`;
        index += 4;
      } else if (parameters[index + 1] === 5 && parameters.length > index + 2) {
        foreground = `palette:${parameters[index + 2]}`;
        index += 2;
      }
    }
  }
  return foreground;
}
