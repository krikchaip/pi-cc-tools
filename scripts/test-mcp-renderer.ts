import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initTheme, theme } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";

initTheme("dark", false);

const realHome = process.env.HOME;
const realAgentDir = process.env.PI_CODING_AGENT_DIR;
const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cc-tools-mcp-renderer-"));
const tempAgentDir = path.join(tempHome, "agent");
fs.mkdirSync(tempAgentDir);
fs.writeFileSync(path.join(tempAgentDir, "settings.json"), JSON.stringify({ outputPad: 0 }));
process.env.HOME = tempHome;
process.env.PI_CODING_AGENT_DIR = tempAgentDir;

try {
  const fakePi = {
    tools: new Map<string, any>(),
    handlers: new Map<string, any[]>(),
    registerTool(definition: any) { this.tools.set(definition.name, definition); },
    registerCommand() {},
    registerShortcut() {},
    on(name: string, handler: any) { this.handlers.set(name, [...(this.handlers.get(name) ?? []), handler]); },
    getThinkingLevel() { return "off"; },
    getAllTools() { return [...this.tools.values()]; },
  };

  fakePi.registerTool({
    name: "mcp",
    label: "MCP",
    description: "MCP gateway",
    parameters: {},
    async execute() { return { content: [] }; },
  });

  const extension = await import("../extensions/index.ts");
  extension.default(fakePi as any);
  for (const handler of fakePi.handlers.get("session_start") ?? []) {
    await handler({}, { hasUI: false });
  }

  const mcp = fakePi.tools.get("mcp");
  if (typeof mcp?.renderResult !== "function") throw new Error("MCP renderer was not registered");
  if (mcp.renderShell !== "self") {
    throw new Error("MCP renderer did not use a host-independent self-render shell");
  }

  const renderRaw = (text: string, expanded = false): string => {
    const component = mcp.renderResult(
      { content: [{ type: "text", text }] },
      { expanded, isPartial: false },
      theme,
      { state: {}, isError: false, lastComponent: undefined },
    );
    return component.render(120).join("\n");
  };
  const render = (text: string, expanded = false): string => (
    renderRaw(text, expanded).replace(/\x1b\[[0-9;]*m/g, "")
  );

  const fields = [
    "Repository: example-org/example-repo",
    "Default branch: main",
    "Visibility: public",
    "Open issues: 12",
    "Latest release: v1.0.76",
    "Updated: 2026-07-31",
  ].join("\n");

  const collapsed = render(fields);
  if (!collapsed.includes("Repository") || !collapsed.includes("example-org/example-repo")) {
    throw new Error("collapsed MCP field output did not show key/value content");
  }
  if (!collapsed.includes("Default branch  main")) {
    throw new Error("collapsed MCP field output did not align key/value columns");
  }
  if (collapsed.includes("Latest release")) {
    throw new Error("collapsed MCP field output exceeded the four-row scan limit");
  }
  if (!collapsed.includes("2 more")) {
    throw new Error("collapsed MCP field output did not show the hidden-row count");
  }

  const expanded = render(fields, true);
  if (!expanded.includes("Latest release") || !expanded.includes("Updated")) {
    throw new Error("expanded MCP field output did not show all rows");
  }
  if (expanded.includes("2 more")) {
    throw new Error("expanded MCP field output kept the collapsed hidden-row hint");
  }

  const githubGetMe = JSON.stringify({
    login: "example-user",
    id: 12345678,
    profile_url: "https://example.com/users/example-user",
    avatar_url: "https://example.com/avatars/example-user.png",
    details: {
      name: "Example User",
      location: "Example City",
      hireable: true,
      public_repos: 26,
      public_gists: 7,
      followers: 17,
      following: 23,
      created_at: "2016-11-01T08:39:34Z",
      updated_at: "2026-05-17T08:02:00Z",
    },
  });
  const jsonCollapsed = render(githubGetMe);
  for (const expected of ["Response", "object · 5 fields", "login", "example-user", "profile_url", "details", "object · 9 fields", "7 more"]) {
    if (!jsonCollapsed.includes(expected)) {
      throw new Error(`collapsed JSON MCP output missed branch-tree content ${JSON.stringify(expected)}`);
    }
  }
  if (jsonCollapsed.includes('{"login"')) {
    throw new Error("collapsed JSON MCP output kept the raw JSON line");
  }
  if (!renderRaw(githubGetMe).includes(theme.fg("muted", ")"))) {
    throw new Error("collapsed JSON MCP hint did not restore muted color for its closing parenthesis");
  }
  const jsonExpanded = render(githubGetMe, true);
  if (!jsonExpanded.includes("details") || !jsonExpanded.includes("name") || !jsonExpanded.includes("Example User")) {
    throw new Error("expanded JSON MCP output did not preserve nested object fields");
  }
  if (jsonExpanded.includes("Details name")) {
    throw new Error("expanded JSON MCP output still flattened nested paths");
  }

  const commitsJson = JSON.stringify({
    total_count: 2,
    commits: [
      {
        sha: "a1b2c3d4",
        author: { name: "Example Author", verified: true },
        parents: ["91aa004", "82bb113"],
      },
      {
        sha: "e5f6a7b8",
        author: { name: "Sample Contributor", verified: false },
        parents: ["a1b2c3d4"],
      },
    ],
  });
  const commitsExpandedRaw = renderRaw(commitsJson, true);
  const commitsExpanded = commitsExpandedRaw.replace(/\x1b\[[0-9;]*m/g, "");
  for (const expected of ["commits", "array · 2 items", "[1]", "object · 3 fields", "author", "object · 2 fields", "parents", "array · 2 items"]) {
    if (!commitsExpanded.includes(expected)) {
      throw new Error(`expanded JSON MCP output missed nested array content ${JSON.stringify(expected)}`);
    }
  }
  for (const expected of [
    "total_count  2",
    "commits      array · 2 items",
    "sha      a1b2c3d4",
    "author   object · 2 fields",
    "parents  array · 2 items",
    "name      Example Author",
    "verified  true",
  ]) {
    if (!commitsExpanded.includes(expected)) {
      throw new Error(`expanded JSON MCP output did not align sibling columns at ${JSON.stringify(expected)}`);
    }
  }
  const ansiBefore = (index: number): string | undefined => (
    [...commitsExpandedRaw.slice(0, index).matchAll(/\x1b\[[0-9;]*m/g)].at(-1)?.[0]
  );
  const responseIndex = commitsExpandedRaw.indexOf("Response");
  const rootConnectorIndex = commitsExpandedRaw.lastIndexOf("└", responseIndex);
  const childConnectorIndex = commitsExpandedRaw.indexOf("├", responseIndex);
  if (rootConnectorIndex < 0 || childConnectorIndex < 0) {
    throw new Error("expanded JSON MCP output did not render root and child connectors");
  }
  const rootConnectorColor = ansiBefore(rootConnectorIndex);
  const childConnectorColor = ansiBefore(childConnectorIndex);
  if (!rootConnectorColor || childConnectorColor !== rootConnectorColor) {
    throw new Error(`nested JSON guide color did not match root branch: ${JSON.stringify({ rootConnectorColor, childConnectorColor })}`);
  }

  const prose = render("Found one repository\nOwner is example-org\nReady to inspect");
  if (!prose.includes("Found one repository") || !prose.includes("Owner is example-org")) {
    throw new Error("non-field MCP output did not fall back to a verbatim preview");
  }
  if (prose.includes("3 lines returned")) {
    throw new Error("non-field MCP output regressed to the count-only result");
  }

  const { ToolExecutionComponent } = await import(
    "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/tool-execution.js"
  );
  const legacyRenderer = {
    render() { return ["6 lines returned"]; },
    invalidate() {},
  };
  const legacyDefinition = {
    name: "mcp",
    label: "MCP",
    description: "MCP gateway",
    parameters: {},
    async execute() { return { content: [] }; },
    renderCall() { return legacyRenderer; },
    renderResult() { return legacyRenderer; },
  } as any;
  const execution = new ToolExecutionComponent(
    "mcp",
    "call_fixture",
    { server: "github", tool: "get_repository" },
    {},
    legacyDefinition,
    { requestRender() {} } as any,
    process.cwd(),
  );
  for (const handler of fakePi.handlers.get("agent_start") ?? []) {
    await handler({}, { hasUI: false });
  }
  execution.markExecutionStarted();
  const running = execution.render(120).join("\n").replace(/\x1b\[[0-9;]*m/g, "");
  const runningHeaders = running.split("\n").filter((line) => line.includes("MCP") && line.includes("get_repository"));
  if (runningHeaders.length !== 1) {
    throw new Error(`standalone MCP running state rendered ${runningHeaders.length} call headers`);
  }
  execution.setArgsComplete();
  execution.updateResult({ content: [{ type: "text", text: fields }], isError: false }, false);
  const integrated = execution.render(120).join("\n").replace(/\x1b\[[0-9;]*m/g, "");
  if (!integrated.includes("Repository") || integrated.includes("6 lines returned")) {
    throw new Error("ToolExecutionComponent kept Pi's existing MCP renderer instead of the key/value scan");
  }
  const repositoryRow = integrated.split("\n").find((line) => line.includes("Repository"));
  if (!repositoryRow?.startsWith("├")) {
    throw new Error(`MCP renderer ignored outputPad 0: ${JSON.stringify(repositoryRow)}`);
  }

  fs.writeFileSync(path.join(tempAgentDir, "settings.json"), JSON.stringify({ outputPad: 1 }));
  await new Promise((resolve) => setTimeout(resolve, 300));
  const directPadded = render(fields);
  const directPaddedRepositoryRow = directPadded.split("\n").find((line) => line.includes("Repository"));
  if (!directPaddedRepositoryRow?.startsWith(" ├")) {
    throw new Error(`self-rendered MCP output ignored outputPad 1: ${JSON.stringify(directPaddedRepositoryRow)}`);
  }
  const padded = execution.render(120).join("\n").replace(/\x1b\[[0-9;]*m/g, "");
  const paddedRepositoryRow = padded.split("\n").find((line) => line.includes("Repository"));
  if (!paddedRepositoryRow?.startsWith(" ├")) {
    throw new Error(`MCP renderer ignored outputPad 1: ${JSON.stringify(paddedRepositoryRow)}`);
  }

  const groupedPeer = new ToolExecutionComponent(
    "mcp",
    "call_fixture_2",
    { server: "github", tool: "get_repository" },
    {},
    legacyDefinition,
    { requestRender() {} } as any,
    process.cwd(),
  );
  groupedPeer.markExecutionStarted();
  groupedPeer.setArgsComplete();
  groupedPeer.updateResult({ content: [{ type: "text", text: fields }], isError: false }, false);
  const { Container } = await import("../node_modules/@earendil-works/pi-tui/dist/tui.js");
  const groupParent = new Container();
  groupParent.addChild(execution);
  groupParent.addChild(groupedPeer);
  if ((groupParent as any).children.length !== 1) {
    throw new Error("grouped-header regression setup did not create a tool group");
  }
  groupParent.render(120);
  const group = (groupParent as any).children[0];
  group.setExpanded(true);
  const expandedGroupLines = groupParent.render(120).map((line: string) => line.replace(/\x1b\[[0-9;]*m/g, ""));
  const childCallRow = expandedGroupLines.find((line: string) => line.includes("MCP") && line.includes("get_repository"));
  const nestedResultRow = expandedGroupLines.find((line: string) => line.includes("Repository"));
  const childFirstCharacterColumn = childCallRow?.indexOf("●") ?? -1;
  const nestedGuideColumn = nestedResultRow ? Math.max(nestedResultRow.indexOf("├"), nestedResultRow.indexOf("└")) : -1;
  if (childFirstCharacterColumn < 0 || nestedGuideColumn !== childFirstCharacterColumn) {
    throw new Error(`grouped nested guide was not below the child row's first character: ${JSON.stringify({ childCallRow, nestedResultRow })}`);
  }

  const makeJsonExecution = (id: string) => {
    const component = new ToolExecutionComponent(
      "mcp",
      id,
      { server: "github", tool: "list_commits" },
      {},
      legacyDefinition,
      { requestRender() {} } as any,
      process.cwd(),
    );
    component.markExecutionStarted();
    component.setArgsComplete();
    component.updateResult({ content: [{ type: "text", text: commitsJson }], isError: false }, false);
    return component;
  };
  const jsonGroupParent = new Container();
  jsonGroupParent.addChild(makeJsonExecution("call_json_fixture_1"));
  jsonGroupParent.addChild(makeJsonExecution("call_json_fixture_2"));
  jsonGroupParent.render(120);
  const jsonGroup = (jsonGroupParent as any).children[0];
  jsonGroup.setExpanded(true);
  const jsonGroupLines = jsonGroupParent.render(120).map((line: string) => line.replace(/\x1b\[[0-9;]*m/g, ""));
  const jsonCallRow = jsonGroupLines.find((line: string) => line.includes("MCP") && line.includes("list_commits"));
  const jsonResponseRow = jsonGroupLines.find((line: string) => line.includes("Response") && line.includes("object"));
  const jsonRootFieldRow = jsonGroupLines.find((line: string) => line.includes("total_count"));
  const jsonArrayItemRow = jsonGroupLines.find((line: string) => line.includes("[1]") && line.includes("object"));
  const jsonNestedFieldRow = jsonGroupLines.find((line: string) => line.includes("sha") && line.includes("a1b2c3d4"));
  const statusColumn = jsonCallRow?.indexOf("●") ?? -1;
  const deepestGuideColumn = (line: string | undefined): number => line ? Math.max(line.lastIndexOf("├"), line.lastIndexOf("└")) : -1;
  const groupedJsonColumns = {
    status: statusColumn,
    response: deepestGuideColumn(jsonResponseRow),
    rootField: deepestGuideColumn(jsonRootFieldRow),
    arrayItem: deepestGuideColumn(jsonArrayItemRow),
    nestedField: deepestGuideColumn(jsonNestedFieldRow),
  };
  if (
    statusColumn < 0
    || groupedJsonColumns.response !== statusColumn
    || groupedJsonColumns.rootField !== groupedJsonColumns.response + 2
    || groupedJsonColumns.arrayItem !== groupedJsonColumns.rootField + 2
    || groupedJsonColumns.nestedField !== groupedJsonColumns.arrayItem + 2
  ) {
    throw new Error(`grouped JSON tree lost one or more indentation levels: ${JSON.stringify({ groupedJsonColumns, jsonCallRow, jsonResponseRow, jsonRootFieldRow, jsonArrayItemRow, jsonNestedFieldRow })}`);
  }

  for (const handler of fakePi.handlers.get("agent_end") ?? []) {
    await handler({}, { hasUI: false });
  }
  await Promise.resolve();

  console.log("OK  MCP scan, expansion, fallback, renderer priority, outputPad, standalone lifecycle, and grouped alignment");
} finally {
  if (realHome === undefined) delete process.env.HOME;
  else process.env.HOME = realHome;
  if (realAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = realAgentDir;
  fs.rmSync(tempHome, { recursive: true, force: true });
}
