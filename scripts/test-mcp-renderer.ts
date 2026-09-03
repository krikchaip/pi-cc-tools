import {
  assertPayloadRowInert,
  assertResultSummaryAnchor,
  plain,
  withRendererHarness,
} from "./renderer-test-harness.ts";

await withRendererHarness(
  {
    name: "mcp-renderer",
    stubTools: ["mcp"],
    agentSettings: { outputPad: 0 },
  },
  async ({
    fakePi,
    theme,
    ToolExecutionComponent,
    Container,
    emitLifecycle,
    writeAgentSettings,
  }) => {
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
      plain(renderRaw(text, expanded, width))
    );

    const summaryResult = {
      content: [{ type: "text", text: JSON.stringify({ ok: true, count: 2 }) }],
    };
    assertResultSummaryAnchor(fakePi, "mcp", summaryResult, false, "Response");
    assertResultSummaryAnchor(fakePi, "mcp", summaryResult, true, "Response");
    assertPayloadRowInert(
      fakePi,
      "mcp",
      { content: [{ type: "text", text: "Repository: example\nBranch: main" }] },
      "Repository",
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
    const commitsExpanded = plain(commitsExpandedRaw);
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
    await emitLifecycle("agent_start");
    execution.markExecutionStarted();
    const running = plain(execution.render(120).join("\n"));
    const runningHeaders = running.split("\n").filter((line: string) => line.includes("MCP") && line.includes("get_repository"));
    if (runningHeaders.length !== 1) {
      throw new Error(`standalone MCP running state rendered ${runningHeaders.length} call headers`);
    }
    execution.setArgsComplete();
    execution.updateResult({ content: [{ type: "text", text: fields }], isError: false }, false);
    const integrated = plain(execution.render(120).join("\n"));
    if (!integrated.includes("Repository") || integrated.includes("6 lines returned")) {
      throw new Error("ToolExecutionComponent kept Pi's existing MCP renderer instead of the key/value scan");
    }
    const repositoryRow = integrated.split("\n").find((line: string) => line.includes("Repository"));
    if (!repositoryRow?.startsWith("├")) {
      throw new Error(`MCP renderer ignored outputPad 0: ${JSON.stringify(repositoryRow)}`);
    }

    const mcpAnchorExecution = new ToolExecutionComponent(
      "mcp",
      "call_anchor_matrix",
      { server: "github", tool: "get_repository" },
      {},
      legacyDefinition,
      { mode: "fullscreen", requestRender() {} } as any,
      process.cwd(),
    ) as any;
    mcpAnchorExecution.markExecutionStarted();
    mcpAnchorExecution.setArgsComplete();
    mcpAnchorExecution.updateResult({
      content: [{ type: "text", text: Array.from({ length: 20 }, (_, i) => `MCP payload ${i + 1}`).join("\n") }],
      isError: false,
    }, false);
    const findMcpAnchor = (action: string, viewportAnchor = "top"): any => {
      const rows = mcpAnchorExecution.render(120);
      for (let y = 0; y < rows.length; y++) {
        for (let x = 0; x < 120; x++) {
          const anchor = mcpAnchorExecution.clickAnchorAtPoint(x, y);
          if (anchor?.action === action && anchor.viewportAnchor === viewportAnchor) return anchor;
        }
      }
      return undefined;
    };
    if (!findMcpAnchor("expand") || !mcpAnchorExecution.activateClickAction("expand", "top")) {
      throw new Error("MCP collapsed expansion anchor did not activate");
    }
    if (!findMcpAnchor("expand") || !findMcpAnchor("detail-extra")) {
      throw new Error("expanded capped MCP output lacked inline collapse or extra-detail anchors");
    }
    if (!mcpAnchorExecution.activateClickAction("detail-extra", "top")
      || mcpAnchorExecution.rendererState[Symbol.for("pi-claude-style-tools:tool-click-detail-level")] !== 2) {
      throw new Error("MCP extra-detail anchor did not activate maximum detail");
    }
    if (!findMcpAnchor("detail-extra") || !mcpAnchorExecution.activateClickAction("detail-extra", "top")
      || mcpAnchorExecution.rendererState[Symbol.for("pi-claude-style-tools:tool-click-detail-level")] !== undefined) {
      throw new Error("MCP less-detail anchor did not return to normal detail");
    }
    if (!mcpAnchorExecution.activateClickAction("expand", "top") || mcpAnchorExecution.expanded) {
      throw new Error("MCP inline collapse anchor did not collapse");
    }
    if (!findMcpAnchor("header") || !mcpAnchorExecution.activateClickAction("header", "top") || !mcpAnchorExecution.expanded) {
      throw new Error("MCP header anchor did not expand");
    }

    writeAgentSettings({ outputPad: 1 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const directPadded = render(fields);
    const directPaddedRepositoryRow = directPadded.split("\n").find((line) => line.includes("Repository"));
    if (!directPaddedRepositoryRow?.startsWith(" ├")) {
      throw new Error(`self-rendered MCP output ignored outputPad 1: ${JSON.stringify(directPaddedRepositoryRow)}`);
    }
    const padded = plain(execution.render(120).join("\n"));
    const paddedRepositoryRow = padded.split("\n").find((line: string) => line.includes("Repository"));
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
    const groupParent = new Container();
    groupParent.addChild(execution);
    groupParent.addChild(groupedPeer);
    groupParent.render(120);
    const group = (groupParent as any).children[0];
    if (!group) throw new Error("grouped MCP regression setup did not create a tool group");
    group.setExpanded(true);
    const expandedGroupLines = groupParent.render(120).map((line: string) => plain(line));
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
    const wrappedGroupLines = wrappedGroupParent.render(44).map((line: string) => plain(line));
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
    const jsonGroupLines = jsonGroupParent.render(120).map((line: string) => plain(line));
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

    console.log("OK  MCP scan, JSON, prose, wrapping, renderer priority, lifecycle, outputPad, and grouped alignment");
  },
);
