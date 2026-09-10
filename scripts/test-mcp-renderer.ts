import {
  getCapabilities,
  setCapabilities,
} from "../node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-tui/dist/index.js";
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
    writePiSettings,
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
    assertResultSummaryAnchor(fakePi, "mcp", summaryResult, false, "Responded");
    assertResultSummaryAnchor(fakePi, "mcp", summaryResult, true, "Responded");
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

    const collapsedRaw = renderRaw(fields);
    const collapsed = plain(collapsedRaw);
    if (!collapsed.includes("Responded (6 lines)") || collapsed.includes("Repository") || collapsed.includes("example-org/example-repo")) {
      throw new Error(`collapsed MCP field output was not summary-only: ${JSON.stringify(collapsed)}`);
    }
    if (!collapsedRaw.includes(theme.fg("success", "Responded")) || !collapsedRaw.includes(theme.fg("muted", "(6 lines)"))) {
      throw new Error(`MCP text summary did not use success plus dim metadata: ${JSON.stringify(collapsedRaw)}`);
    }

    const expandedRaw = renderRaw(fields, true);
    const expanded = plain(expandedRaw);
    if (!expandedRaw.includes(theme.fg("dim", "example-org/example-repo"))) {
      throw new Error(`MCP field payload did not use the dimmer raw-output color: ${JSON.stringify(expandedRaw)}`);
    }
    for (const expected of ["Responded (6 lines)", "Repository", "example-org/example-repo", "Default branch  main", "Latest release", "Updated"]) {
      if (!expanded.includes(expected)) {
        throw new Error(`MCP L0 field output missed ${JSON.stringify(expected)}: ${JSON.stringify(expanded)}`);
      }
    }
    if (expanded.includes("more lines")) {
      throw new Error("MCP L0 field output kept a hidden-row hint after exhausting the response");
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
    const jsonCollapsedRaw = renderRaw(githubGetMe);
    const jsonCollapsed = plain(jsonCollapsedRaw);
    for (const expected of ["Responded [object] (5 fields)", "to expand"]) {
      if (!jsonCollapsed.includes(expected)) {
        throw new Error(`collapsed JSON MCP output missed summary content ${JSON.stringify(expected)}`);
      }
    }
    if (!jsonCollapsedRaw.includes(theme.fg("success", "Responded")) || !jsonCollapsedRaw.includes(theme.fg("muted", "[object] (5 fields)"))) {
      throw new Error(`MCP JSON summary did not use success plus dim metadata: ${JSON.stringify(jsonCollapsedRaw)}`);
    }
    for (const hidden of ["login", "example-user", "profile_url", "details", '{"login"']) {
      if (jsonCollapsed.includes(hidden)) {
        throw new Error(`collapsed JSON MCP output exposed payload ${JSON.stringify(hidden)}`);
      }
    }
    const jsonExpandedRaw = renderRaw(githubGetMe, true);
    const jsonExpanded = plain(jsonExpandedRaw);
    for (const payload of ["example-user", "12345678", "true"]) {
      if (!jsonExpandedRaw.includes(theme.fg("dim", payload))) {
        throw new Error(`MCP JSON payload did not use the dimmer raw-output color for ${JSON.stringify(payload)}: ${JSON.stringify(jsonExpandedRaw)}`);
      }
    }
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
    for (const payload of ["total_count", "array · 2 items", "Example Author"]) {
      if (!commitsExpandedRaw.includes(theme.fg("dim", payload))) {
        throw new Error(`nested MCP JSON payload did not use the dimmer raw-output color for ${JSON.stringify(payload)}: ${JSON.stringify(commitsExpandedRaw)}`);
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
    const responseIndex = commitsExpandedRaw.indexOf("Responded");
    const rootConnectorIndex = commitsExpandedRaw.lastIndexOf("├", responseIndex);
    const childConnectorIndex = commitsExpandedRaw.indexOf("├", responseIndex);
    if (rootConnectorIndex < 0 || childConnectorIndex < 0) {
      throw new Error("expanded JSON MCP output did not render root and child connectors");
    }
    const rootConnectorColor = ansiBefore(rootConnectorIndex);
    const childConnectorColor = ansiBefore(childConnectorIndex);
    if (!rootConnectorColor || childConnectorColor !== rootConnectorColor) {
      throw new Error(`nested JSON guide color did not match root branch: ${JSON.stringify({ rootConnectorColor, childConnectorColor })}`);
    }

    const proseCollapsed = render("Found one repository\nOwner is example-org\nReady to inspect");
    if (!proseCollapsed.includes("Responded (3 lines)") || proseCollapsed.includes("Found one repository")) {
      throw new Error(`collapsed prose MCP output was not summary-only: ${JSON.stringify(proseCollapsed)}`);
    }
    const proseExpandedRaw = renderRaw("Found one repository\nOwner is example-org\nReady to inspect", true);
    const proseExpanded = plain(proseExpandedRaw);
    if (!proseExpandedRaw.includes(theme.fg("dim", "Found one repository"))) {
      throw new Error(`MCP prose payload did not use the dimmer raw-output color: ${JSON.stringify(proseExpandedRaw)}`);
    }
    if (!proseExpanded.includes("Responded (3 lines)") || !proseExpanded.includes("Found one repository") || !proseExpanded.includes("Owner is example-org")) {
      throw new Error("MCP prose L0 did not reveal its verbatim payload");
    }

    const wrappedFinalRows = render(
      "The earlier MCP output line is long enough to wrap before the final line\nThe final MCP output line is long enough to wrap across several terminal rows",
      true,
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

    const scalarCollapsed = render("42");
    const scalarExpandedRaw = renderRaw("42", true);
    const scalarExpanded = plain(scalarExpandedRaw);
    if (!scalarCollapsed.includes("Responded [number]") || scalarCollapsed.includes("└ 42")) {
      throw new Error(`collapsed scalar MCP output was not type-only: ${JSON.stringify(scalarCollapsed)}`);
    }
    if (!scalarExpanded.includes("Responded [number]") || !scalarExpanded.includes("42") || !scalarExpandedRaw.includes(theme.fg("dim", "42"))) {
      throw new Error(`MCP scalar L0 did not reveal a dimmer raw value: ${JSON.stringify(scalarExpandedRaw)}`);
    }
    const arrayCollapsed = render("[true]");
    if (!arrayCollapsed.includes("Responded [array] (1 item)")) {
      throw new Error(`collapsed array MCP output did not use an item-count summary: ${JSON.stringify(arrayCollapsed)}`);
    }

    const errorComponent = mcp.renderResult(
      { content: [{ type: "text", text: "Error: complete first failure line\nrequest id: fixture-123" }] },
      { expanded: false, isPartial: false },
      theme,
      { state: {}, isError: true, lastComponent: undefined },
    );
    const collapsedErrorRaw = errorComponent.render(120).join("\n");
    const collapsedError = plain(collapsedErrorRaw);
    if (!collapsedError.includes("Error: complete first failure line") || collapsedError.includes("request id: fixture-123")) {
      throw new Error(`collapsed MCP error did not preserve only its first line: ${JSON.stringify(collapsedError)}`);
    }
    if (!collapsedErrorRaw.includes(theme.fg("error", "Error: complete first failure line"))) {
      throw new Error(`collapsed MCP error summary did not retain its error color: ${JSON.stringify(collapsedErrorRaw)}`);
    }
    const expandedErrorComponent = mcp.renderResult(
      { content: [{ type: "text", text: "Error: complete first failure line\nrequest id: fixture-123" }] },
      { expanded: true, isPartial: false },
      theme,
      { state: {}, isError: true, lastComponent: undefined },
    );
    const expandedErrorRaw = expandedErrorComponent.render(120).join("\n");
    const expandedError = plain(expandedErrorRaw);
    if ((expandedError.match(/Error: complete first failure line/g) ?? []).length !== 1 || !expandedError.includes("request id: fixture-123")) {
      throw new Error(`expanded MCP error duplicated its summary or hid detail: ${JSON.stringify(expandedError)}`);
    }
    if (!expandedErrorRaw.includes(theme.fg("error", "request id: fixture-123"))) {
      throw new Error(`expanded MCP error payload did not retain its error color: ${JSON.stringify(expandedErrorRaw)}`);
    }

    const partialComponent = mcp.renderResult(
      { content: [{ type: "text", text: "partial MCP payload" }] },
      { expanded: true, isPartial: true },
      theme,
      { state: {}, isError: false, lastComponent: undefined },
    );
    const partialRaw = partialComponent.render(120).join("\n");
    if (!partialRaw.includes(theme.fg("dim", "partial MCP payload"))) {
      throw new Error(`partial MCP payload did not use the dimmer raw-output color: ${JSON.stringify(partialRaw)}`);
    }

    const partialErrorComponent = mcp.renderResult(
      { content: [{ type: "text", text: "partial MCP error" }] },
      { expanded: true, isPartial: true },
      theme,
      { state: {}, isError: true, lastComponent: undefined },
    );
    const partialErrorRaw = partialErrorComponent.render(120).join("\n");
    if (!partialErrorRaw.includes(theme.fg("error", "partial MCP error"))) {
      throw new Error(`partial MCP error payload did not retain its error color: ${JSON.stringify(partialErrorRaw)}`);
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
    const integratedRows = execution.render(120).map((line: string) => plain(line));
    const integrated = integratedRows.join("\n");
    if (!integrated.includes("Responded (6 lines)") || integrated.includes("Repository") || integrated.includes("6 lines returned")) {
      throw new Error(`ToolExecutionComponent did not render the MCP collapsed summary layer: ${JSON.stringify(integrated)}`);
    }
    const integratedContentRows = integratedRows.filter((line: string) => line.trim());
    if (!/^─+$/.test(integratedContentRows[0] ?? "") || !/^─+$/.test(integratedContentRows.at(-1) ?? "")) {
      throw new Error(`standalone MCP did not retain its top and bottom borders: ${JSON.stringify(integratedRows)}`);
    }
    const responseRow = integrated.split("\n").find((line: string) => line.includes("Responded (6 lines)"));
    if (!responseRow?.startsWith("└")) {
      throw new Error(`MCP renderer ignored outputPad 0: ${JSON.stringify(responseRow)}`);
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
    const assertMcpFrame = (rows: string[], state: string): void => {
      const contentRows = rows.filter((line) => line.trim());
      if (!/^─+$/.test(contentRows[0] ?? "") || !/^─+$/.test(contentRows.at(-1) ?? "")) {
        throw new Error(`standalone MCP ${state} lost its top or bottom border: ${JSON.stringify(rows)}`);
      }
    };
    const collapsedMcpRows = mcpAnchorExecution.render(120).map((line: string) => plain(line));
    assertMcpFrame(collapsedMcpRows, "collapsed layer");
    if (collapsedMcpRows.some((line: string) => line.includes("MCP payload 1"))) {
      throw new Error(`collapsed standalone MCP exposed payload: ${JSON.stringify(collapsedMcpRows)}`);
    }
    if (!findMcpAnchor("expand") || !mcpAnchorExecution.activateClickAction("expand", "top")) {
      throw new Error("MCP collapsed expansion anchor did not activate");
    }
    const l0McpRows = mcpAnchorExecution.render(120).map((line: string) => plain(line));
    assertMcpFrame(l0McpRows, "L0");
    const l0Mcp = l0McpRows.join("\n");
    if (!l0Mcp.includes("MCP payload 8") || l0Mcp.includes("MCP payload 9") || !findMcpAnchor("detail")) {
      throw new Error(`MCP L0 did not stop at previewLines=8: ${JSON.stringify(l0Mcp)}`);
    }
    if (!mcpAnchorExecution.activateClickAction("detail", "top")
      || mcpAnchorExecution.rendererState[Symbol.for("pi-claude-style-tools:tool-click-detail-level")] !== 1) {
      throw new Error("MCP L1 detail anchor did not activate");
    }
    const l1McpRows = mcpAnchorExecution.render(120).map((line: string) => plain(line));
    assertMcpFrame(l1McpRows, "L1");
    const l1Mcp = l1McpRows.join("\n");
    if (!l1Mcp.includes("MCP payload 10") || l1Mcp.includes("MCP payload 11") || !findMcpAnchor("detail")) {
      throw new Error(`MCP L1 did not stop at expandedPreviewMaxLines=10: ${JSON.stringify(l1Mcp)}`);
    }
    if (!mcpAnchorExecution.activateClickAction("detail", "top")
      || mcpAnchorExecution.rendererState[Symbol.for("pi-claude-style-tools:tool-click-detail-level")] !== 2) {
      throw new Error("MCP L2 detail anchor did not activate");
    }
    const l2McpRows = mcpAnchorExecution.render(120).map((line: string) => plain(line));
    assertMcpFrame(l2McpRows, "L2");
    const l2Mcp = l2McpRows.join("\n");
    if (!l2Mcp.includes("MCP payload 15") || l2Mcp.includes("MCP payload 16") || !findMcpAnchor("expand", "bottom")) {
      throw new Error(`MCP L2 did not stop at extraExpandedPreviewMaxLines=15 with a collapse row: ${JSON.stringify(l2Mcp)}`);
    }
    if (!mcpAnchorExecution.activateClickAction("expand", "bottom") || mcpAnchorExecution.expanded) {
      throw new Error("MCP terminal collapse anchor did not collapse");
    }
    if (!findMcpAnchor("header") || !mcpAnchorExecution.activateClickAction("header", "top") || !mcpAnchorExecution.expanded) {
      throw new Error("MCP header anchor did not expand");
    }

    writeAgentSettings({ outputPad: 1 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const directPadded = render(fields);
    const directPaddedResponseRow = directPadded.split("\n").find((line) => line.includes("Responded (6 lines)"));
    if (!directPaddedResponseRow?.startsWith(" └")) {
      throw new Error(`self-rendered MCP output ignored outputPad 1: ${JSON.stringify(directPaddedResponseRow)}`);
    }
    const padded = plain(execution.render(120).join("\n"));
    const paddedResponseRow = padded.split("\n").find((line: string) => line.includes("Responded (6 lines)"));
    if (!paddedResponseRow?.startsWith(" └")) {
      throw new Error(`MCP renderer ignored outputPad 1: ${JSON.stringify(paddedResponseRow)}`);
    }

    const makeShortGroupedExecution = (id: string, toolName: string, payload: string) => {
      const component = new ToolExecutionComponent(
        "mcp",
        id,
        { server: "github", tool: toolName },
        {},
        legacyDefinition,
        { mode: "fullscreen", requestRender() {} } as any,
        process.cwd(),
      ) as any;
      component.markExecutionStarted();
      component.setArgsComplete();
      component.updateResult({ content: [{ type: "text", text: payload }], isError: false }, false);
      return component;
    };
    const groupedFirst = makeShortGroupedExecution(
      "call_short_group_1",
      "get_repository",
      JSON.stringify({ repository: "MCP_FIRST_UNIT_PAYLOAD", private: false }),
    );
    const groupedSecond = makeShortGroupedExecution(
      "call_short_group_2",
      "list_commits",
      JSON.stringify({ commits: ["MCP_SECOND_UNIT_PAYLOAD"] }),
    );
    const shortGroupParent = new Container();
    shortGroupParent.addChild(groupedFirst);
    shortGroupParent.addChild(groupedSecond);
    const shortGroup = (shortGroupParent as any).children[0];
    const collapsedGroupRows = shortGroupParent.render(120).map((line: string) => plain(line));
    const firstChildRow = collapsedGroupRows.findIndex((line: string) => line.includes("get_repository"));
    const firstChildX = firstChildRow < 0 ? -1 : collapsedGroupRows[firstChildRow].indexOf("get_repository");
    if (
      firstChildX < 0
      || collapsedGroupRows.some((line: string) => line.includes("Responded") || line.includes("MCP_FIRST_UNIT_PAYLOAD"))
      || !shortGroup.toggleToolAtPoint(firstChildX, firstChildRow)
    ) {
      throw new Error(`short grouped MCP child did not activate from its execution summary: ${JSON.stringify(collapsedGroupRows)}`);
    }
    const firstChildExpandedRows = shortGroupParent.render(120).map((line: string) => plain(line));
    if (
      !firstChildExpandedRows.some((line: string) => line.includes("Responded [object] (2 fields)"))
      || !firstChildExpandedRows.some((line: string) => line.includes("MCP_FIRST_UNIT_PAYLOAD"))
      || firstChildExpandedRows.some((line: string) => line.includes("MCP_SECOND_UNIT_PAYLOAD"))
    ) {
      throw new Error(`grouped MCP child expansion did not isolate L0: ${JSON.stringify(firstChildExpandedRows)}`);
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
    const nestedGuideColumn = nestedResultRow ? Math.max(nestedResultRow.lastIndexOf("│"), nestedResultRow.lastIndexOf("├"), nestedResultRow.lastIndexOf("└")) : -1;
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
    const jsonResponseRow = jsonGroupLines.find((line: string) => line.includes("Responded") && line.includes("[object]"));
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

    const imageComponent = mcp.renderResult(
      { content: [{ type: "image", data: "", mimeType: "image/png" }] },
      { expanded: false, isPartial: false },
      theme,
      { state: {}, isError: false, lastComponent: undefined },
    );
    const imageRows = imageComponent.render(120).map((line: string) => plain(line));
    if (!imageRows.some((line: string) => line.includes("Responded [image] (image/png)"))) {
      throw new Error(`MCP image response did not report its type: ${JSON.stringify(imageRows)}`);
    }

    const savedCapabilities = getCapabilities();
    setCapabilities({ ...savedCapabilities, images: "iterm2" });
    try {
      const imageExecution = new ToolExecutionComponent(
        "mcp",
        "call_image_fixture",
        { server: "fixture", tool: "image" },
        {},
        mcp,
        { mode: "fullscreen", requestRender() {} } as any,
        process.cwd(),
      ) as any;
      imageExecution.markExecutionStarted();
      imageExecution.setArgsComplete();
      imageExecution.updateResult({
        content: [{
          type: "image",
          data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          mimeType: "image/png",
        }],
        isError: false,
      }, false);
      if (imageExecution.imageComponents.length !== 0) {
        throw new Error("collapsed MCP image exposed its payload before local expansion");
      }
      const imageActivated = imageExecution.activateClickAction("expand", "top");
      if (!imageActivated || imageExecution.imageComponents.length !== 1) {
        throw new Error(`expanded MCP image did not reveal its image payload: ${JSON.stringify({ imageActivated, expanded: imageExecution.expanded, imageCount: imageExecution.imageComponents.length, rows: imageExecution.render(120).map((line: string) => plain(line)) })}`);
      }
    } finally {
      setCapabilities(savedCapabilities);
    }

    writePiSettings({
      clickExpansion: true,
      expandedPreviewMaxLines: 10,
      extraExpandedPreviewMaxLines: 15,
      mcpOutputMode: "summary",
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const summaryOnlyComponent = mcp.renderResult(
      summaryResult,
      { expanded: true, isPartial: false },
      theme,
      { state: {}, isError: false, lastComponent: undefined },
    );
    const summaryOnlyRows = summaryOnlyComponent.render(120).map((line: string) => plain(line));
    if (
      !summaryOnlyRows.some((line: string) => line.includes("Responded [object] (2 fields)"))
      || summaryOnlyRows.some((line: string) => line.includes("ok") || line.includes("count"))
      || (summaryOnlyComponent as any).getSemanticRows().length > 0
    ) {
      throw new Error(`MCP summary mode exposed payload or click anchors: ${JSON.stringify({ summaryOnlyRows, semanticRows: (summaryOnlyComponent as any).getSemanticRows() })}`);
    }

    const summaryGroupParent = new Container();
    summaryGroupParent.addChild(makeShortGroupedExecution("call_summary_group_1", "get_repository", summaryResult.content[0].text));
    summaryGroupParent.addChild(makeShortGroupedExecution("call_summary_group_2", "list_commits", summaryResult.content[0].text));
    const summaryGroup = (summaryGroupParent as any).children[0];
    const summaryGroupRows = summaryGroupParent.render(120).map((line: string) => plain(line));
    if (
      summaryGroupRows.some((line: string) => line.includes("click any for details") || line.includes("Responded"))
      || summaryGroup.clickAnchors.length > 0
    ) {
      throw new Error(`MCP summary-mode group exposed dead click anchors: ${JSON.stringify({ summaryGroupRows, clickAnchors: summaryGroup.clickAnchors })}`);
    }

    console.log("OK  MCP collapsed summary, L0/L1/L2, shapes, errors, renderer priority, and grouped child isolation");
  },
);
