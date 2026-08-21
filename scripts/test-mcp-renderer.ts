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

  const renderRaw = (text: string, expanded = false, width = 120): string => {
    const component = mcp.renderResult(
      { content: [{ type: "text", text }] },
      { expanded, isPartial: false },
      theme,
      { state: {}, isError: false, lastComponent: undefined },
    );
    return component.render(width).join("\n");
  };
  const render = (text: string, expanded = false, width = 120): string => (
    renderRaw(text, expanded, width).replace(/\x1b\[[0-9;]*m/g, "")
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

  const wrappedFinalRows = render(
    "The earlier MCP output line is long enough to wrap before the final line\nThe final MCP output line is long enough to wrap across several terminal rows",
    false,
    32,
  ).split("\n");
  const finalBranchIndex = wrappedFinalRows.findIndex((line) => line.startsWith("└ "));
  const finalContinuations = finalBranchIndex >= 0 ? wrappedFinalRows.slice(finalBranchIndex + 1) : [];
  if (finalBranchIndex < 0 || finalContinuations.length === 0) {
    throw new Error(`MCP final-line wrap regression setup did not wrap: ${JSON.stringify(wrappedFinalRows)}`);
  }
  if (!wrappedFinalRows.slice(0, finalBranchIndex).some((line) => line.startsWith("│ "))) {
    throw new Error(`wrapped MCP non-final line lost its indentation guide: ${JSON.stringify(wrappedFinalRows)}`);
  }
  if (finalContinuations.some((line) => line.startsWith("│ "))) {
    throw new Error(`wrapped MCP final line kept indentation guides: ${JSON.stringify(wrappedFinalRows)}`);
  }
  if (finalContinuations.some((line) => !line.startsWith("  "))) {
    throw new Error(`wrapped MCP final line lost branch indentation: ${JSON.stringify(wrappedFinalRows)}`);
  }

  const indicatorLine = (raw: string, anchor: string): string => {
    const index = raw.lastIndexOf(anchor);
    if (index < 0) throw new Error(`expansion indicator did not render ${JSON.stringify(anchor)}`);
    const start = raw.lastIndexOf("\n", index) + 1;
    const end = raw.indexOf("\n", index);
    return raw.slice(start, end < 0 ? undefined : end);
  };
  const assertCollapsedIndicator = (raw: string, anchor: string, checkClosingParenthesis = false): void => {
    const line = indicatorLine(raw, anchor);
    const plain = line.replace(/\x1b\[[0-9;]*m/g, "");
    if (!plain.includes("to expand") || plain.includes("to toggle")) {
      throw new Error(`collapsed expansion indicator did not describe its state: ${JSON.stringify(plain)}`);
    }
    if (checkClosingParenthesis) {
      const anchorIndex = line.lastIndexOf(anchor);
      const openingIndex = line.lastIndexOf("(", anchorIndex);
      const closingIndex = line.indexOf(")", anchorIndex);
      const foregroundBefore = (index: number): string | undefined => (
        [...line.slice(0, index).matchAll(/\x1b\[38;(?:2;\d+;\d+;\d+|5;\d+)m/g)].at(-1)?.[0]
      );
      const openingForeground = foregroundBefore(openingIndex);
      const closingForeground = foregroundBefore(closingIndex);
      if (openingIndex < 0 || closingIndex < 0 || !openingForeground || closingForeground !== openingForeground) {
        throw new Error(`expansion indicator closing parenthesis color bled: ${JSON.stringify({ plain, openingForeground, closingForeground })}`);
      }
    }
  };
  const assertExpandedIndicator = (raw: string, anchor: string): void => {
    const plain = indicatorLine(raw, anchor).replace(/\x1b\[[0-9;]*m/g, "");
    if (!plain.includes("to collapse") || plain.includes("to expand") || plain.includes("to toggle")) {
      throw new Error(`expanded expansion indicator did not describe its state: ${JSON.stringify(plain)}`);
    }
  };
  const waitFor = async (ready: () => boolean): Promise<void> => {
    const deadline = Date.now() + 3000;
    while (!ready() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    if (!ready()) throw new Error("timed out waiting for asynchronous tool preview rendering");
  };

  const write = fakePi.tools.get("write");
  if (typeof write?.renderResult !== "function") throw new Error("Write renderer was not registered");
  const diffLines = [
    { type: "del", content: "const value = 'old';", oldNum: 1, newNum: null },
    { type: "add", content: "const value = 'new';", oldNum: null, newNum: 1 },
    ...Array.from({ length: 40 }, (_, index) => ({
      type: "ctx",
      content: `context line ${index + 1}`,
      oldNum: index + 2,
      newNum: index + 2,
    })),
  ];
  const writeResult = {
    content: [{ type: "text", text: "Wrote fixture.ts" }],
    details: { _type: "diff", summary: "+1 -1", diff: { added: 1, removed: 1, chars: 400, lines: diffLines } },
  };
  const writeContext = {
    state: {},
    isError: false,
    lastComponent: undefined,
    args: { path: "fixture.ts", content: "new" },
    cwd: process.cwd(),
    expanded: false,
  } as any;
  write.renderResult(writeResult, { expanded: false, isPartial: false }, theme, writeContext);
  await waitFor(() => typeof writeContext.state._wdt === "string" && writeContext.state._wdt.includes("more diff lines"));
  const writeRaw = write.renderResult(writeResult, { expanded: false, isPartial: false }, theme, writeContext).render(120).join("\n");
  assertCollapsedIndicator(writeRaw, "more diff lines", true);

  const expandedDiffLines = [
    ...diffLines,
    ...Array.from({ length: 180 }, (_, index) => ({
      type: "ctx",
      content: `expanded context line ${index + 1}`,
      oldNum: index + 42,
      newNum: index + 42,
    })),
  ];
  const createContent = Array.from({ length: 220 }, (_, index) => `created line ${index + 1}`).join("\n");
  for (const { result, args, stateKey } of [
    {
      result: {
        content: [{ type: "text", text: "Wrote fixture.ts" }],
        details: { _type: "diff", summary: "+1 -1", diff: { added: 1, removed: 1, chars: 4000, lines: expandedDiffLines } },
      },
      args: { path: "fixture.ts", content: "new" },
      stateKey: "_wdt",
    },
    {
      result: {
        content: [{ type: "text", text: "Wrote created-fixture.ts" }],
        details: { _type: "new", lines: 220, filePath: "created-fixture.ts" },
      },
      args: { path: "created-fixture.ts", content: createContent },
      stateKey: "_nft",
    },
  ]) {
    const context = {
      state: {},
      isError: false,
      lastComponent: undefined,
      args,
      cwd: process.cwd(),
      expanded: true,
    } as any;
    write.renderResult(result, { expanded: true, isPartial: false }, theme, context);
    await waitFor(() => typeof context.state[stateKey] === "string" && context.state[stateKey].includes("more diff lines"));
    const raw = write.renderResult(result, { expanded: true, isPartial: false }, theme, context).render(120).join("\n");
    assertExpandedIndicator(raw, "more diff lines");
  }

  const bash = fakePi.tools.get("bash");
  if (typeof bash?.renderResult !== "function") throw new Error("Bash renderer was not registered");
  const bashContext = {
    state: {},
    isError: false,
    lastComponent: undefined,
    args: { command: "printf fixture" },
    cwd: process.cwd(),
    expanded: false,
    executionStarted: true,
  } as any;
  const bashRaw = bash.renderResult(
    { content: [{ type: "text", text: Array.from({ length: 8 }, (_, index) => `line ${index + 1}`).join("\n") }], details: {} },
    { expanded: false, isPartial: true },
    theme,
    bashContext,
  ).render(120).join("\n");
  assertCollapsedIndicator(bashRaw, "earlier lines", true);

  const cappedOutput = Array.from({ length: 20 }, (_, index) => `result line ${index + 1}`).join("\n");
  for (const { name, args } of [
    { name: "read", args: { path: "fixture.ts" } },
    { name: "grep", args: { pattern: "result", path: "." } },
    { name: "bash", args: { command: "printf fixture" } },
  ]) {
    const tool = fakePi.tools.get(name);
    if (typeof tool?.renderResult !== "function") throw new Error(`${name} renderer was not registered`);
    const raw = tool.renderResult(
      { content: [{ type: "text", text: cappedOutput }], details: {} },
      { expanded: true, isPartial: false },
      theme,
      {
        state: {},
        isError: false,
        lastComponent: undefined,
        args,
        cwd: process.cwd(),
        expanded: true,
        executionStarted: true,
      } as any,
    ).render(120).join("\n");
    assertExpandedIndicator(raw, "more lines");
  }

  const edit = fakePi.tools.get("edit");
  if (typeof edit?.renderCall !== "function" || typeof edit?.renderResult !== "function") throw new Error("Edit renderer was not registered");
  const editArgs = {
    path: "missing-fixture.ts",
    edits: Array.from({ length: 4 }, (_, index) => ({ oldText: `old ${index}`, newText: `new ${index}` })),
  };
  const editContext = {
    state: {},
    isError: false,
    lastComponent: undefined,
    args: editArgs,
    argsComplete: true,
    cwd: process.cwd(),
    expanded: false,
    executionStarted: true,
  } as any;
  edit.renderCall(editArgs, theme, editContext);
  await waitFor(() => typeof editContext.state._ptBody === "string" && editContext.state._ptBody.includes("more edit blocks"));
  const editRaw = edit.renderCall(editArgs, theme, editContext).render(120).join("\n");
  assertCollapsedIndicator(editRaw, "more edit blocks");

  const editErrorComponent = edit.renderResult(
    {
      content: [{
        type: "text",
        text: "Could not find the exact text in extensions/index.ts. The old text must match exactly including all whitespace and newlines.",
      }],
    },
    { expanded: false, isPartial: false },
    theme,
    { state: {}, isError: true, lastComponent: undefined },
  );
  const editErrorRows = editErrorComponent.render(44)
    .map((line: string) => line.replace(/\x1b\[[0-9;]*m/g, ""));
  const editBranchIndex = editErrorRows.findIndex((line: string) => line.startsWith(" └ "));
  const editContinuations = editBranchIndex >= 0 ? editErrorRows.slice(editBranchIndex + 1) : [];
  if (editBranchIndex < 0 || editContinuations.length === 0) {
    throw new Error(`Edit final-line wrap regression setup did not wrap: ${JSON.stringify(editErrorRows)}`);
  }
  if (editContinuations.some((line: string) => line.startsWith(" │ "))) {
    throw new Error(`wrapped Edit final line kept indentation guides: ${JSON.stringify(editErrorRows)}`);
  }
  if (editContinuations.some((line: string) => !line.startsWith("   "))) {
    throw new Error(`wrapped Edit final line lost branch indentation: ${JSON.stringify(editErrorRows)}`);
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
  const expandedGroupHeader = expandedGroupLines.find((line: string) => line.includes("to collapse") || line.includes("to toggle"));
  if (!expandedGroupHeader?.includes("to collapse") || expandedGroupHeader.includes("to toggle")) {
    throw new Error(`expanded tool group did not describe its collapse action: ${JSON.stringify(expandedGroupHeader)}`);
  }
  const childCallRow = expandedGroupLines.find((line: string) => line.includes("MCP") && line.includes("get_repository"));
  const nestedResultRow = expandedGroupLines.find((line: string) => line.includes("Repository"));
  const childFirstCharacterColumn = childCallRow?.indexOf("●") ?? -1;
  const nestedGuideColumn = nestedResultRow ? Math.max(nestedResultRow.indexOf("├"), nestedResultRow.indexOf("└")) : -1;
  if (childFirstCharacterColumn < 0 || nestedGuideColumn !== childFirstCharacterColumn) {
    throw new Error(`grouped nested guide was not below the child row's first character: ${JSON.stringify({ childCallRow, nestedResultRow })}`);
  }

  const wrappedGroupText = [
    "Progress: one two three four five six nonfinal-tail-token",
    "Summary: alpha beta gamma delta grouped-tail-token",
  ].join("\n");
  const makeWrappedExecution = (id: string, text: string) => {
    const component = new ToolExecutionComponent(
      "mcp",
      id,
      { server: "github", tool: "get_repository" },
      {},
      legacyDefinition,
      { requestRender() {} } as any,
      process.cwd(),
    );
    component.markExecutionStarted();
    component.setArgsComplete();
    component.updateResult({ content: [{ type: "text", text }], isError: false }, false);
    return component;
  };
  const wrappedGroupParent = new Container();
  wrappedGroupParent.addChild(makeWrappedExecution("call_wrap_fixture_1", fields));
  wrappedGroupParent.addChild(makeWrappedExecution("call_wrap_fixture_2", wrappedGroupText));
  wrappedGroupParent.render(44);
  const wrappedGroup = (wrappedGroupParent as any).children[0];
  wrappedGroup.setExpanded(true);
  const wrappedGroupLines = wrappedGroupParent.render(44)
    .map((line: string) => line.replace(/\x1b\[[0-9;]*m/g, ""));
  const groupedProgressContinuation = wrappedGroupLines.find((line: string) => line.includes("nonfinal-tail-token"));
  const groupedSummaryRow = wrappedGroupLines.find((line: string) => line.includes("Summary"));
  const groupedFinalContinuation = wrappedGroupLines.find((line: string) => line.includes("grouped-tail-token"));
  const groupedClosedBranchColumn = groupedSummaryRow?.lastIndexOf("└") ?? -1;
  const groupedSummaryColumn = groupedSummaryRow?.indexOf("Summary") ?? -1;
  const groupedFinalContinuationColumn = groupedFinalContinuation?.indexOf("grouped-tail-token") ?? -1;
  const groupedFinalContinuationPrefix = groupedFinalContinuation?.slice(0, groupedFinalContinuationColumn) ?? "";
  if (!groupedProgressContinuation?.includes("│")) {
    throw new Error(`grouped non-final wrap lost its indentation guide: ${JSON.stringify(wrappedGroupLines)}`);
  }
  if (
    groupedClosedBranchColumn < 0
    || groupedSummaryColumn !== groupedClosedBranchColumn + 2
    || groupedFinalContinuation === groupedSummaryRow
    || groupedFinalContinuationColumn !== groupedSummaryColumn
    || /[│├└]/.test(groupedFinalContinuationPrefix)
  ) {
    throw new Error(`grouped final wrap was not aligned with its first text character: ${JSON.stringify({ groupedClosedBranchColumn, groupedSummaryColumn, groupedFinalContinuationColumn, groupedFinalContinuationPrefix, wrappedGroupLines })}`);
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
