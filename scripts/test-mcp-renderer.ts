import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initTheme, theme } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";

initTheme("dark", false);

const realHome = process.env.HOME;
const realAgentDir = process.env.PI_CODING_AGENT_DIR;
const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cc-tools-mcp-renderer-"));
const tempAgentDir = path.join(tempHome, "agent");
const tempPiDir = path.join(tempHome, ".pi");
fs.mkdirSync(tempAgentDir);
fs.mkdirSync(tempPiDir);
fs.writeFileSync(path.join(tempAgentDir, "settings.json"), JSON.stringify({ outputPad: 0 }));
fs.writeFileSync(path.join(tempPiDir, "settings.json"), JSON.stringify({
  clickExpansion: true,
  expandedPreviewMaxLines: 10,
  extraExpandedPreviewMaxLines: 15,
}));
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
  for (const name of ["apply_patch", "web_search", "TaskList"]) {
    fakePi.registerTool({
      name,
      label: name,
      description: name,
      parameters: {},
      async execute() { return { content: [] }; },
    });
  }

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
  const plain = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, "");
  const assertResultSummaryAnchor = (
    name: string,
    result: any,
    expanded: boolean,
    expectedSummary: string,
    ctxOverrides: Record<string, unknown> = {},
  ): void => {
    const definition = fakePi.tools.get(name);
    if (typeof definition?.renderResult !== "function") {
      throw new Error(`${name} renderer was not registered`);
    }
    const state = {};
    const component = definition.renderResult(
      result,
      { expanded, isPartial: false },
      theme,
      {
        state,
        args: {},
        argsComplete: true,
        cwd: process.cwd(),
        expanded,
        isError: false,
        lastComponent: undefined,
        ...ctxOverrides,
      },
    );
    const rows = component.render(120).map((line: string) => plain(line));
    const semanticRows = component.getSemanticRows?.().map((row: any) => ({ ...row, text: plain(row.text) })) ?? [];
    const summaryIndex = rows.findIndex((line: string) => line.includes(expectedSummary));
    if (summaryIndex < 0) {
      throw new Error(`${name} did not render result summary ${JSON.stringify(expectedSummary)}: ${JSON.stringify(rows)}`);
    }
    if (!semanticRows.some((row: any) => row.line === summaryIndex && row.action === "expand")) {
      throw new Error(`${name} result summary was not a stable expansion anchor: ${JSON.stringify({ rows, semanticRows })}`);
    }
  };

  const summaryCases: Array<[string, any, string, Record<string, unknown>?]> = [
    ["read", { content: [{ type: "text", text: "read one\nread two" }] }, "2 lines loaded"],
    ["read", { content: [{ type: "image", data: "", mimeType: "image/png" }] }, "Image loaded"],
    ["bash", { content: [{ type: "text", text: "bash one\nbash two" }] }, "Done (2 lines)", { args: { command: "printf test" } }],
    ["grep", { content: [{ type: "text", text: "a.ts:1:one\na.ts:2:two" }] }, "2 matches"],
    ["find", { content: [{ type: "text", text: "a.ts\nb.ts" }] }, "2 files"],
    ["ls", { content: [{ type: "text", text: "a.ts\nb.ts" }] }, "2 entries"],
    ["write", { content: [{ type: "text", text: "Wrote fixture.ts" }] }, "Written"],
    ["edit", { content: [{ type: "text", text: "Edited fixture.ts" }] }, "Applied"],
    ["apply_patch", { content: [{ type: "text", text: "Done!" }] }, "Applied"],
    ["mcp", { content: [{ type: "text", text: JSON.stringify({ ok: true, count: 2 }) }] }, "Response"],
    ["web_search", { content: [{ type: "text", text: "search one\nsearch two" }] }, "2 lines returned"],
    ["TaskList", { content: [{ type: "text", text: "#1 [pending] First\n#2 [completed] Second" }] }, "2 tasks"],
  ];
  for (const [name, result, expectedSummary, ctxOverrides] of summaryCases) {
    assertResultSummaryAnchor(name, result, false, expectedSummary, ctxOverrides);
    assertResultSummaryAnchor(name, result, true, expectedSummary, ctxOverrides);
  }

  const assertPayloadRowInert = (
    name: string,
    result: any,
    expectedPayload: string,
    ctxOverrides: Record<string, unknown> = {},
  ): void => {
    const definition = fakePi.tools.get(name);
    const component = definition.renderResult(
      result,
      { expanded: true, isPartial: false },
      theme,
      { state: {}, args: {}, cwd: process.cwd(), expanded: true, isError: false, lastComponent: undefined, ...ctxOverrides },
    );
    const rows = component.render(120).map((line: string) => plain(line));
    const payloadRow = rows.findIndex((line: string) => line.includes(expectedPayload));
    const semanticRows = component.getSemanticRows?.() ?? [];
    if (payloadRow < 0 || semanticRows.some((row: any) => row.line === payloadRow)) {
      throw new Error(`${name} raw payload row was clickable: ${JSON.stringify({ rows, semanticRows })}`);
    }
  };
  assertPayloadRowInert("bash", { content: [{ type: "text", text: "" }] }, "(no output)", { args: { command: "true" } });
  assertPayloadRowInert("mcp", { content: [{ type: "text", text: "Repository: example\nBranch: main" }] }, "Repository");
  assertPayloadRowInert("write", { content: [{ type: "text", text: "write failed raw payload" }] }, "write failed raw payload", { isError: true });
  assertPayloadRowInert("web_search", { content: [{ type: "text", text: "search failed raw payload\nsecond error line" }] }, "search failed raw payload", { isError: true });

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
  const waitFor = async (ready: () => boolean, description = "asynchronous tool preview rendering"): Promise<void> => {
    const deadline = Date.now() + 5000;
    while (!ready() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    if (!ready()) throw new Error(`timed out waiting for ${description}`);
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

  const readDefinition = fakePi.tools.get("read");
  const readExecution = new ToolExecutionComponent(
    "read",
    "read_click_fixture",
    { path: "fixture.ts" },
    {},
    readDefinition,
    { mode: "fullscreen", requestRender() {} } as any,
    process.cwd(),
  ) as any;
  readExecution.markExecutionStarted();
  readExecution.setArgsComplete();
  readExecution.updateResult({ content: [{ type: "text", text: cappedOutput }], isError: false }, false);
  readExecution.setExpanded(true);
  const readRows = readExecution.render(120).map((line: string) => line.replace(/\x1b\[[0-9;]*m/g, ""));
  const readExpanded = readRows.join("\n");
  if (!readExpanded.includes("result line 8") || readExpanded.includes("result line 9")) {
    throw new Error(`standalone first expansion did not stop at the normal 8-line preview: ${JSON.stringify(readExpanded)}`);
  }
  const standaloneActionX = (row: number, action: string): number => (
    Array.from({ length: 120 }, (_, x) => x).find((x) => readExecution.clickActionAtPoint(x, row) === action) ?? -1
  );
  const readSummaryRow = readRows.findIndex((line: string) => line.includes("20 lines loaded"));
  const readSummaryStart = readSummaryRow < 0 ? -1 : readRows[readSummaryRow].indexOf("20 lines loaded");
  const readSummaryEnd = readSummaryRow < 0 ? -1 : readRows[readSummaryRow].trimEnd().length;
  const readPayloadRow = readRows.findIndex((line: string) => line.includes("result line 1"));
  if (
    readSummaryStart < 0
    || !Array.from({ length: readSummaryEnd - readSummaryStart }, (_, offset) => readSummaryStart + offset)
      .every((x) => readExecution.clickActionAtPoint(x, readSummaryRow) === "expand")
    || readExecution.clickActionAtPoint(Math.max(0, readSummaryStart - 1), readSummaryRow) !== undefined
    || readExecution.clickActionAtPoint(readSummaryEnd, readSummaryRow) !== undefined
    || readPayloadRow < 0
    || Array.from({ length: readRows[readPayloadRow].trimEnd().length }, (_, x) => readExecution.clickActionAtPoint(x, readPayloadRow))
      .some((action) => action !== undefined)
  ) {
    throw new Error(`standalone result summary did not bind only its full semantic row: ${JSON.stringify({ readRows, readSummaryRow, readSummaryStart, readSummaryEnd, readPayloadRow })}`);
  }
  const detailRow = readRows.findIndex((line: string, index: number) => (
    line.includes("more lines")
    && !line.includes("click to collapse")
    && line.includes("click for more detail")
    && standaloneActionX(index, "expand") < 0
    && standaloneActionX(index, "detail") >= 0
  ));
  const detailStart = detailRow < 0 ? -1 : readRows[detailRow].indexOf("...");
  const detailEnd = detailRow < 0 ? -1 : readRows[detailRow].trimEnd().length;
  const detailCoversFullRow = detailRow >= 0
    && detailStart >= 0
    && Array.from({ length: detailEnd - detailStart }, (_, offset) => detailStart + offset)
      .every((x) => readExecution.clickActionAtPoint(x, detailRow) === "detail")
    && readExecution.clickActionAtPoint(Math.max(0, detailStart - 1), detailRow) !== "detail"
    && readExecution.clickActionAtPoint(detailEnd, detailRow) !== "detail";
  if (!detailCoversFullRow) {
    throw new Error(`standalone hidden-content row did not bind one full-row detail anchor: ${JSON.stringify({ readRows, detailRow, detailStart, detailEnd, actions: readRows.map((_: string, index: number) => [index, standaloneActionX(index, "expand"), standaloneActionX(index, "detail")]) })}`);
  }
  if (!readExecution.activateClickAction("detail")) {
    throw new Error("standalone standard-detail action did not activate");
  }
  const standardReadRows = readExecution.render(120).map((line: string) => line.replace(/\x1b\[[0-9;]*m/g, ""));
  const standardRead = standardReadRows.join("\n");
  if (!standardRead.includes("result line 10") || standardRead.includes("result line 11")) {
    throw new Error(`standalone first detail action did not stop at expandedPreviewMaxLines=10: ${JSON.stringify(standardRead)}`);
  }
  const extraDetailRow = standardReadRows.findIndex((line: string, index: number) => (
    line.includes("more lines")
    && line.includes("click for more detail")
    && standaloneActionX(index, "detail") >= 0
  ));
  if (extraDetailRow < 0 || !readExecution.activateClickAction("detail")) {
    throw new Error(`standalone standard-detail layer did not preserve its extra-detail gate: ${JSON.stringify(standardReadRows)}`);
  }
  const extraDetailedReadRows = readExecution.render(120).map((line: string) => line.replace(/\x1b\[[0-9;]*m/g, ""));
  const extraDetailedRead = extraDetailedReadRows.join("\n");
  if (!extraDetailedRead.includes("result line 15") || extraDetailedRead.includes("result line 16")) {
    throw new Error(`standalone second detail action did not stop at extraExpandedPreviewMaxLines=15: ${JSON.stringify(extraDetailedRead)}`);
  }
  const finalReadSummary = extraDetailedReadRows.find((line: string) => line.includes("20 lines loaded"));
  const finalReadPayload = extraDetailedReadRows.find((line: string) => line.includes("result line 1"));
  const finalReadCollapseRow = extraDetailedReadRows.findIndex((line: string) => line.includes("click to collapse"));
  const finalCollapseStart = finalReadCollapseRow < 0 ? -1 : standaloneActionX(finalReadCollapseRow, "expand");
  const finalCollapseEnd = finalReadCollapseRow < 0 ? -1 : extraDetailedReadRows[finalReadCollapseRow].trimEnd().length;
  if (
    !finalReadSummary?.trimStart().startsWith("├")
    || !finalReadPayload?.trimStart().startsWith("│")
    || finalReadCollapseRow < 0
    || !extraDetailedReadRows[finalReadCollapseRow].trimStart().startsWith("└")
    || finalCollapseStart < 0
    || !Array.from({ length: finalCollapseEnd - finalCollapseStart }, (_, offset) => finalCollapseStart + offset)
      .every((x) => readExecution.clickActionAtPoint(x, finalReadCollapseRow) === "expand")
  ) {
    throw new Error(`standalone final detail layer did not end with a full-row branched collapse action: ${JSON.stringify(extraDetailedReadRows)}`);
  }
  if (!readExecution.activateClickAction("expand") || readExecution.expanded) {
    throw new Error("standalone final collapse action did not collapse the execution");
  }

  const readOffsetNotice = "[23 more lines in file. Use offset=11 to continue.]";
  const tenLineOutput = [...Array.from({ length: 9 }, (_, index) => `level-one line ${index + 1}`), readOffsetNotice].join("\n");
  const effectiveFinalRead = new ToolExecutionComponent(
    "read",
    "read_effective_final_fixture",
    { path: "level-one.ts" },
    {},
    readDefinition,
    { mode: "fullscreen", requestRender() {} } as any,
    process.cwd(),
  ) as any;
  effectiveFinalRead.markExecutionStarted();
  effectiveFinalRead.setArgsComplete();
  effectiveFinalRead.updateResult({ content: [{ type: "text", text: tenLineOutput }], isError: false }, false);
  effectiveFinalRead.setExpanded(true);
  const normalEffectiveFinalRows = effectiveFinalRead.render(120).map((line: string) => plain(line));
  if (normalEffectiveFinalRows.some((line: string) => line.includes("click to collapse"))) {
    throw new Error(`content-exhausted normal preview added a dedicated collapse row: ${JSON.stringify(normalEffectiveFinalRows)}`);
  }
  if (!effectiveFinalRead.activateClickAction("detail")) {
    throw new Error("effective-final Read did not enter its first detail layer");
  }
  const levelOneEffectiveFinalRows = effectiveFinalRead.render(120).map((line: string) => plain(line));
  const levelOneCollapseRow = levelOneEffectiveFinalRows.findIndex((line: string) => line.includes("click to collapse"));
  const levelOneCollapseX = levelOneCollapseRow < 0
    ? -1
    : Array.from({ length: 120 }, (_, x) => x).find((x) => effectiveFinalRead.clickActionAtPoint(x, levelOneCollapseRow) === "expand") ?? -1;
  const readOffsetNoticeRow = levelOneEffectiveFinalRows.findIndex((line: string) => line.includes(readOffsetNotice));
  if (
    readOffsetNoticeRow < 0
    || Array.from({ length: levelOneEffectiveFinalRows[readOffsetNoticeRow].trimEnd().length }, (_, x) => effectiveFinalRead.clickActionAtPoint(x, readOffsetNoticeRow))
      .some((action) => action !== undefined)
    || levelOneCollapseRow < 0
    || levelOneCollapseX < 0
    || levelOneEffectiveFinalRows.some((line: string) => line.includes("click for more detail"))
  ) {
    throw new Error(`first detail layer that revealed all returned content was not final: ${JSON.stringify(levelOneEffectiveFinalRows)}`);
  }

  const readPeer = new ToolExecutionComponent(
    "read",
    "read_click_fixture_2",
    { path: "peer.ts" },
    {},
    readDefinition,
    { mode: "fullscreen", requestRender() {} } as any,
    process.cwd(),
  ) as any;
  readPeer.markExecutionStarted();
  readPeer.setArgsComplete();
  readPeer.updateResult({ content: [{ type: "text", text: cappedOutput }], isError: false }, false);
  const { Container: ReadContainer } = await import("../node_modules/@earendil-works/pi-tui/dist/tui.js");
  const readGroupParent = new ReadContainer();
  readGroupParent.addChild(readExecution);
  readGroupParent.addChild(readPeer);
  const readGroup = (readGroupParent as any).children[0];
  readGroupParent.render(120);
  if (!readGroup.toggleToolAtPoint(5, 2)) {
    throw new Error("grouped Read header did not expand its selected execution");
  }
  const groupedActionX = (row: number, action: string): number => (
    Array.from({ length: 120 }, (_, x) => x).find((x) => readGroup.actionAtPoint(x, row) === action) ?? -1
  );
  const expandedReadGroupRows = readGroupParent.render(120).map((line: string) => line.replace(/\x1b\[[0-9;]*m/g, ""));
  const groupedDetailRow = expandedReadGroupRows.findIndex((line: string, index: number) => (
    line.includes("more lines") && groupedActionX(index, "detail") >= 0
  ));
  const groupedDetailX = groupedDetailRow < 0 ? -1 : groupedActionX(groupedDetailRow, "detail");
  if (groupedDetailRow < 0 || groupedDetailX < 0 || !readGroup.toggleToolAtPoint(groupedDetailX, groupedDetailRow)) {
    throw new Error(`expanded tool group did not bind its standard-detail row: ${JSON.stringify(expandedReadGroupRows)}`);
  }
  const standardReadGroupRows = readGroupParent.render(120).map((line: string) => line.replace(/\x1b\[[0-9;]*m/g, ""));
  const standardReadGroup = standardReadGroupRows.join("\n");
  if (!standardReadGroup.includes("result line 10") || standardReadGroup.includes("result line 11")) {
    throw new Error(`grouped first detail action did not stop at expandedPreviewMaxLines=10: ${JSON.stringify(standardReadGroup)}`);
  }
  const groupedExtraDetailRow = standardReadGroupRows.findIndex((line: string, index: number) => (
    line.includes("more lines") && groupedActionX(index, "detail") >= 0
  ));
  const groupedExtraDetailX = groupedExtraDetailRow < 0 ? -1 : groupedActionX(groupedExtraDetailRow, "detail");
  if (groupedExtraDetailRow < 0 || groupedExtraDetailX < 0 || !readGroup.toggleToolAtPoint(groupedExtraDetailX, groupedExtraDetailRow)) {
    throw new Error(`grouped standard-detail layer did not preserve its extra-detail gate: ${JSON.stringify(standardReadGroupRows)}`);
  }
  const extraDetailedReadGroupRows = readGroupParent.render(120).map((line: string) => line.replace(/\x1b\[[0-9;]*m/g, ""));
  const extraDetailedReadGroup = extraDetailedReadGroupRows.join("\n");
  if (!extraDetailedReadGroup.includes("result line 15") || extraDetailedReadGroup.includes("result line 16")) {
    throw new Error(`grouped second detail action did not stop at extraExpandedPreviewMaxLines=15: ${JSON.stringify(extraDetailedReadGroup)}`);
  }
  const groupedCollapseRow = extraDetailedReadGroupRows.findIndex((line: string) => line.includes("click to collapse"));
  const groupedCollapseX = groupedCollapseRow < 0 ? -1 : groupedActionX(groupedCollapseRow, "expand");
  if (groupedCollapseRow < 0 || groupedCollapseX < 0 || !readGroup.toggleToolAtPoint(groupedCollapseX, groupedCollapseRow)) {
    const rowActions = groupedCollapseRow < 0
      ? []
      : Array.from({ length: 120 }, (_, x) => [x, readGroup.actionAtPoint(x, groupedCollapseRow)]).filter(([, action]) => action);
    throw new Error(`grouped final detail layer did not expose a clickable collapse row: ${JSON.stringify({ rows: extraDetailedReadGroupRows, groupedCollapseRow, rowActions, semantics: readExecution.resultRendererComponent?.getSemanticRows?.().map((row: any) => ({ ...row, text: row.text.replace(/\x1b\[[0-9;]*m/g, "") })) })}`);
  }

  fs.writeFileSync(path.join(tempPiDir, "settings.json"), JSON.stringify({
    clickExpansion: true,
    expandedPreviewMaxLines: 200,
    extraExpandedPreviewMaxLines: 240,
  }));
  await new Promise((resolve) => setTimeout(resolve, 5100));
  const writeExecution = new ToolExecutionComponent(
    "write",
    "write_click_fixture",
    { path: "fixture.ts", content: "new" },
    {},
    write,
    { mode: "fullscreen", requestRender() {} } as any,
    process.cwd(),
  ) as any;
  writeExecution.markExecutionStarted();
  writeExecution.setArgsComplete();
  writeExecution.updateResult({
    content: [{ type: "text", text: "Wrote fixture.ts" }],
    details: { _type: "diff", summary: "+1 -1", diff: { added: 1, removed: 1, chars: 4000, lines: expandedDiffLines } },
    isError: false,
  }, false);
  writeExecution.setExpanded(true);
  await waitFor(
    () => typeof writeExecution.rendererState._wdt === "string"
      && writeExecution.rendererState._wdt.includes("more diff lines")
      && writeExecution.rendererState._wdk.endsWith(":150"),
    "expanded Write diff at its normal 150-line render cap",
  );
  const writeExecutionRows = writeExecution.render(120).map((line: string) => line.replace(/\x1b\[[0-9;]*m/g, ""));
  const writeDetailActionX = (row: number): number => (
    Array.from({ length: 120 }, (_, x) => x).find((x) => writeExecution.clickActionAtPoint(x, row) === "detail") ?? -1
  );
  const writeDetailRow = writeExecutionRows.findIndex((line: string, index: number) => (
    line.includes("more diff lines") && writeDetailActionX(index) >= 0
  ));
  if (writeDetailRow < 0 || !writeExecution.activateClickAction("detail")) {
    throw new Error(`expanded Write diff did not bind its standard-detail row: ${JSON.stringify(writeExecutionRows)}`);
  }
  const detailLevelSymbol = Symbol.for("pi-claude-style-tools:tool-click-detail-level");
  if (writeExecution.rendererState[detailLevelSymbol] !== 1) {
    throw new Error("Write standard-detail activation did not persist level 1");
  }
  await waitFor(
    () => typeof writeExecution.rendererState._wdk === "string"
      && writeExecution.rendererState._wdk.endsWith(":200"),
    `standard-detail Write diff at its configured 200-line render cap (key: ${writeExecution.rendererState._wdk})`,
  );
  const standardWriteRows = writeExecution.render(120).map((line: string) => line.replace(/\x1b\[[0-9;]*m/g, ""));
  const writeExtraDetailRow = standardWriteRows.findIndex((line: string, index: number) => (
    line.includes("more diff lines") && writeDetailActionX(index) >= 0
  ));

  const effectiveFinalWrite = new ToolExecutionComponent(
    "write",
    "write_effective_final_fixture",
    { path: "effective-final.ts", content: "new" },
    {},
    write,
    { mode: "fullscreen", requestRender() {} } as any,
    process.cwd(),
  ) as any;
  effectiveFinalWrite.markExecutionStarted();
  effectiveFinalWrite.setArgsComplete();
  effectiveFinalWrite.updateResult({
    content: [{ type: "text", text: "Wrote effective-final.ts" }],
    details: { _type: "diff", summary: "+1 -1", diff: { added: 1, removed: 1, chars: 3000, lines: expandedDiffLines.slice(0, 180) } },
    isError: false,
  }, false);
  effectiveFinalWrite.setExpanded(true);
  await waitFor(
    () => typeof effectiveFinalWrite.rendererState._wdt === "string"
      && effectiveFinalWrite.rendererState._wdt.includes("more diff lines")
      && effectiveFinalWrite.rendererState._wdk.endsWith(":150"),
    "effective-final Write normal detail layer",
  );
  effectiveFinalWrite.render(120);
  if (!effectiveFinalWrite.activateClickAction("detail")) {
    throw new Error("effective-final Write did not enter level 1");
  }
  await waitFor(
    () => typeof effectiveFinalWrite.rendererState._wdk === "string"
      && effectiveFinalWrite.rendererState._wdk.endsWith(":200")
      && typeof effectiveFinalWrite.rendererState._wdt === "string"
      && !effectiveFinalWrite.rendererState._wdt.includes("rendering diff"),
    "effective-final Write level-1 collapse row",
  );
  const effectiveFinalWriteRows = effectiveFinalWrite.render(120).map((line: string) => plain(line));
  if (
    effectiveFinalWriteRows.some((line: string) => line.includes("more diff lines"))
    || effectiveFinalWriteRows.some((line: string) => line.includes("click for more detail"))
    || !effectiveFinalWriteRows.some((line: string) => line.includes("click to collapse"))
  ) {
    throw new Error(`Write level 1 that revealed all returned diff content was not final: ${JSON.stringify(effectiveFinalWriteRows)}`);
  }

  if (writeExtraDetailRow < 0 || !writeExecution.activateClickAction("detail")) {
    throw new Error(`standard-detail Write diff did not preserve its extra-detail row: ${JSON.stringify(standardWriteRows)}`);
  }
  if (writeExecution.rendererState[detailLevelSymbol] !== 2) {
    throw new Error("Write extra-detail activation did not persist level 2");
  }
  await waitFor(
    () => typeof writeExecution.rendererState._wdk === "string"
      && writeExecution.rendererState._wdk.endsWith(":240"),
    `extra-detail Write diff at its configured 240-line render cap (key: ${writeExecution.rendererState._wdk})`,
  );

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
  const regularCollapsedGroup = groupParent.render(120).join("\n").replace(/\x1b\[[0-9;]*m/g, "");
  if (regularCollapsedGroup.includes("click any for details")) {
    throw new Error("regular TUI mode advertised inactive tool-group click anchors");
  }

  (execution as any).ui.mode = "fullscreen";
  (groupedPeer as any).ui.mode = "fullscreen";
  group.invalidate();
  const clickableGroupRaw = groupParent.render(120).join("\n");
  const clickableGroup = clickableGroupRaw.replace(/\x1b\[[0-9;]*m/g, "");
  if (!clickableGroup.includes("click any for details")) {
    throw new Error("fullscreen collapsed tool group did not show click guidance");
  }
  const styledGroupGuidance = `${theme.fg("muted", " • ")}${theme.fg("dim", "click")}${theme.fg("muted", " any for details")}`;
  if (!clickableGroupRaw.includes(styledGroupGuidance)) {
    throw new Error("tool-group click guidance did not dim only `click`");
  }
  if (group.toolAtPoint(4, 2) !== undefined || group.toolAtPoint(5, 2) !== execution) {
    throw new Error("tool-group click anchor did not exclude the branch connector and status indicator");
  }
  if (!group.toggleToolAtPoint(5, 2)) {
    throw new Error("first tool-group click anchor did not toggle its execution");
  }
  const locallyExpandedGroup = groupParent.render(120).join("\n").replace(/\x1b\[[0-9;]*m/g, "");
  if ((locallyExpandedGroup.match(/Repository/g) ?? []).length !== 1 || !(execution as any).expanded || (groupedPeer as any).expanded) {
    throw new Error("tool-group click did not expand only the selected execution");
  }

  group.setExpanded(true);
  const groupedThird = new ToolExecutionComponent(
    "mcp",
    "call_fixture_3",
    { server: "github", tool: "get_repository" },
    {},
    legacyDefinition,
    { mode: "fullscreen", requestRender() {} } as any,
    process.cwd(),
  );
  groupedThird.markExecutionStarted();
  groupedThird.setArgsComplete();
  groupedThird.updateResult({ content: [{ type: "text", text: fields }], isError: false }, false);
  groupParent.addChild(groupedThird);
  if (!(groupedThird as any).expanded) {
    throw new Error("new grouped execution did not inherit global expanded mode");
  }
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
  group.setExpanded(false);
  if ((execution as any).expanded || (groupedPeer as any).expanded || (groupedThird as any).expanded) {
    throw new Error("global collapse did not reset all per-execution expansion state");
  }
  const resetGroup = groupParent.render(120).join("\n").replace(/\x1b\[[0-9;]*m/g, "");
  if (!resetGroup.includes("click any for details") || resetGroup.includes("Repository")) {
    throw new Error("global collapse did not restore compact clickable group rows");
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
