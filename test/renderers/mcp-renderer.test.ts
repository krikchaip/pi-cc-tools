import {
  getCapabilities,
  setCapabilities,
} from "../../node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-tui/dist/index.js";
import {
  assertPayloadRowInert,
  assertResultSummaryAnchor,
  plain,
  withRendererHarness,
} from "./harness.ts";

await withRendererHarness(
  {
    name: "mcp-renderer",
    stubTools: ["mcp"],
    agentSettings: { outputPad: 0 },
  },
  async ({
    fakePi,
    theme,
    toolExecution,
    toolGroup,
    emitLifecycle,
    writeAgentSettings,
    writePiSettings,
  }) => {
    const mcp = fakePi.tools.get("mcp");
    if (typeof mcp?.renderResult !== "function")
      throw new Error("MCP renderer was not registered");
    if (mcp.renderShell !== "self") {
      throw new Error(
        "MCP renderer did not use a host-independent self-render shell",
      );
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
    const render = (text: string, expanded = false, width = 120): string =>
      plain(renderRaw(text, expanded, width));

    const summaryResult = {
      content: [{ type: "text", text: JSON.stringify({ ok: true, count: 2 }) }],
    };
    assertResultSummaryAnchor(fakePi, "mcp", summaryResult, false, "Responded");
    assertResultSummaryAnchor(fakePi, "mcp", summaryResult, true, "Responded");
    assertPayloadRowInert(
      fakePi,
      "mcp",
      {
        content: [{ type: "text", text: "Repository: example\nBranch: main" }],
      },
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
    if (
      !collapsed.includes("Responded (6 lines)") ||
      collapsed.includes("Repository") ||
      collapsed.includes("example-org/example-repo")
    ) {
      throw new Error(
        `collapsed MCP field output was not summary-only: ${JSON.stringify(collapsed)}`,
      );
    }
    if (
      !collapsedRaw.includes(theme.fg("success", "Responded")) ||
      !collapsedRaw.includes(theme.fg("muted", "(6 lines)"))
    ) {
      throw new Error(
        `MCP text summary did not use success plus dim metadata: ${JSON.stringify(collapsedRaw)}`,
      );
    }

    const expandedRaw = renderRaw(fields, true);
    const expanded = plain(expandedRaw);
    if (!expandedRaw.includes(theme.fg("dim", "example-org/example-repo"))) {
      throw new Error(
        `MCP field payload did not use the dimmer raw-output color: ${JSON.stringify(expandedRaw)}`,
      );
    }
    for (const expected of [
      "Responded (6 lines)",
      "Repository",
      "example-org/example-repo",
      "Default branch  main",
      "Latest release",
      "Updated",
    ]) {
      if (!expanded.includes(expected)) {
        throw new Error(
          `MCP L0 field output missed ${JSON.stringify(expected)}: ${JSON.stringify(expanded)}`,
        );
      }
    }
    if (expanded.includes("more lines")) {
      throw new Error(
        "MCP L0 field output kept a hidden-row hint after exhausting the response",
      );
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
        throw new Error(
          `collapsed JSON MCP output missed summary content ${JSON.stringify(expected)}`,
        );
      }
    }
    if (
      !jsonCollapsedRaw.includes(theme.fg("success", "Responded")) ||
      !jsonCollapsedRaw.includes(theme.fg("muted", "[object] (5 fields)"))
    ) {
      throw new Error(
        `MCP JSON summary did not use success plus dim metadata: ${JSON.stringify(jsonCollapsedRaw)}`,
      );
    }
    for (const hidden of [
      "login",
      "example-user",
      "profile_url",
      "details",
      '{"login"',
    ]) {
      if (jsonCollapsed.includes(hidden)) {
        throw new Error(
          `collapsed JSON MCP output exposed payload ${JSON.stringify(hidden)}`,
        );
      }
    }
    const jsonExpandedRaw = renderRaw(githubGetMe, true);
    const jsonExpanded = plain(jsonExpandedRaw);
    for (const payload of ["example-user", "12345678", "true"]) {
      if (!jsonExpandedRaw.includes(theme.fg("dim", payload))) {
        throw new Error(
          `MCP JSON payload did not use the dimmer raw-output color for ${JSON.stringify(payload)}: ${JSON.stringify(jsonExpandedRaw)}`,
        );
      }
    }
    if (
      !jsonExpanded.includes("details") ||
      !jsonExpanded.includes("name") ||
      !jsonExpanded.includes("Example User")
    ) {
      throw new Error(
        "expanded JSON MCP output did not preserve nested object fields",
      );
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
    for (const expected of [
      "commits",
      "array · 2 items",
      "[1]",
      "object · 3 fields",
      "author",
      "object · 2 fields",
      "parents",
      "array · 2 items",
    ]) {
      if (!commitsExpanded.includes(expected)) {
        throw new Error(
          `expanded JSON MCP output missed nested array content ${JSON.stringify(expected)}`,
        );
      }
    }
    for (const payload of [
      "total_count",
      "array · 2 items",
      "Example Author",
    ]) {
      if (!commitsExpandedRaw.includes(theme.fg("dim", payload))) {
        throw new Error(
          `nested MCP JSON payload did not use the dimmer raw-output color for ${JSON.stringify(payload)}: ${JSON.stringify(commitsExpandedRaw)}`,
        );
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
        throw new Error(
          `expanded JSON MCP output did not align sibling columns at ${JSON.stringify(expected)}`,
        );
      }
    }
    const ansiBefore = (index: number): string | undefined =>
      [...commitsExpandedRaw.slice(0, index).matchAll(/\x1b\[[0-9;]*m/g)].at(
        -1,
      )?.[0];
    const responseIndex = commitsExpandedRaw.indexOf("Responded");
    const rootConnectorIndex = commitsExpandedRaw.lastIndexOf(
      "├",
      responseIndex,
    );
    const childConnectorIndex = commitsExpandedRaw.indexOf("├", responseIndex);
    if (rootConnectorIndex < 0 || childConnectorIndex < 0) {
      throw new Error(
        "expanded JSON MCP output did not render root and child connectors",
      );
    }
    const rootConnectorColor = ansiBefore(rootConnectorIndex);
    const childConnectorColor = ansiBefore(childConnectorIndex);
    if (!rootConnectorColor || childConnectorColor !== rootConnectorColor) {
      throw new Error(
        `nested JSON guide color did not match root branch: ${JSON.stringify({ rootConnectorColor, childConnectorColor })}`,
      );
    }

    const proseCollapsed = render(
      "Found one repository\nOwner is example-org\nReady to inspect",
    );
    if (
      !proseCollapsed.includes("Responded (3 lines)") ||
      proseCollapsed.includes("Found one repository")
    ) {
      throw new Error(
        `collapsed prose MCP output was not summary-only: ${JSON.stringify(proseCollapsed)}`,
      );
    }
    const proseExpandedRaw = renderRaw(
      "Found one repository\nOwner is example-org\nReady to inspect",
      true,
    );
    const proseExpanded = plain(proseExpandedRaw);
    if (!proseExpandedRaw.includes(theme.fg("dim", "Found one repository"))) {
      throw new Error(
        `MCP prose payload did not use the dimmer raw-output color: ${JSON.stringify(proseExpandedRaw)}`,
      );
    }
    if (
      !proseExpanded.includes("Responded (3 lines)") ||
      !proseExpanded.includes("Found one repository") ||
      !proseExpanded.includes("Owner is example-org")
    ) {
      throw new Error("MCP prose L0 did not reveal its verbatim payload");
    }

    const wrappedFinalRows = render(
      "The earlier MCP output line is long enough to wrap before the final line\nThe final MCP output line is long enough to wrap across several terminal rows",
      true,
      32,
    ).split("\n");
    const finalBranchIndex = wrappedFinalRows.findIndex((line) =>
      line.startsWith("└ "),
    );
    const finalContinuations =
      finalBranchIndex >= 0 ? wrappedFinalRows.slice(finalBranchIndex + 1) : [];
    if (finalBranchIndex < 0 || finalContinuations.length === 0) {
      throw new Error(
        `MCP final-line wrap regression setup did not wrap: ${JSON.stringify(wrappedFinalRows)}`,
      );
    }
    if (
      !wrappedFinalRows
        .slice(0, finalBranchIndex)
        .some((line) => line.startsWith("│ "))
    ) {
      throw new Error(
        `wrapped MCP non-final line lost its indentation guide: ${JSON.stringify(wrappedFinalRows)}`,
      );
    }
    if (finalContinuations.some((line) => line.startsWith("│ "))) {
      throw new Error(
        `wrapped MCP final line kept indentation guides: ${JSON.stringify(wrappedFinalRows)}`,
      );
    }
    if (finalContinuations.some((line) => !line.startsWith("  "))) {
      throw new Error(
        `wrapped MCP final line lost branch indentation: ${JSON.stringify(wrappedFinalRows)}`,
      );
    }

    const scalarCollapsed = render("42");
    const scalarExpandedRaw = renderRaw("42", true);
    const scalarExpanded = plain(scalarExpandedRaw);
    if (
      !scalarCollapsed.includes("Responded [number]") ||
      scalarCollapsed.includes("└ 42")
    ) {
      throw new Error(
        `collapsed scalar MCP output was not type-only: ${JSON.stringify(scalarCollapsed)}`,
      );
    }
    if (
      !scalarExpanded.includes("Responded [number]") ||
      !scalarExpanded.includes("42") ||
      !scalarExpandedRaw.includes(theme.fg("dim", "42"))
    ) {
      throw new Error(
        `MCP scalar L0 did not reveal a dimmer raw value: ${JSON.stringify(scalarExpandedRaw)}`,
      );
    }
    const arrayCollapsed = render("[true]");
    if (!arrayCollapsed.includes("Responded [array] (1 item)")) {
      throw new Error(
        `collapsed array MCP output did not use an item-count summary: ${JSON.stringify(arrayCollapsed)}`,
      );
    }

    const errorComponent = mcp.renderResult(
      {
        content: [
          {
            type: "text",
            text: "Error: complete first failure line\nrequest id: fixture-123",
          },
        ],
      },
      { expanded: false, isPartial: false },
      theme,
      { state: {}, isError: true, lastComponent: undefined },
    );
    const collapsedErrorRaw = errorComponent.render(120).join("\n");
    const collapsedError = plain(collapsedErrorRaw);
    if (
      !collapsedError.includes("Error: complete first failure line") ||
      collapsedError.includes("request id: fixture-123")
    ) {
      throw new Error(
        `collapsed MCP error did not preserve only its first line: ${JSON.stringify(collapsedError)}`,
      );
    }
    if (
      !collapsedErrorRaw.includes(
        theme.fg("error", "Error: complete first failure line"),
      )
    ) {
      throw new Error(
        `collapsed MCP error summary did not retain its error color: ${JSON.stringify(collapsedErrorRaw)}`,
      );
    }
    const collapsedErrorRow = collapsedError
      .split("\n")
      .find((line) => line.includes("Error: complete first failure line"));
    if (
      !collapsedErrorRow?.startsWith("  ") ||
      /^[ ]*[├│└] /.test(collapsedErrorRow)
    ) {
      throw new Error(
        `collapsed MCP error retained a branch connector: ${JSON.stringify(collapsedError)}`,
      );
    }
    const expandedErrorComponent = mcp.renderResult(
      {
        content: [
          {
            type: "text",
            text: "Error: complete first failure line\nrequest id: fixture-123",
          },
        ],
      },
      { expanded: true, isPartial: false },
      theme,
      { state: {}, isError: true, lastComponent: undefined },
    );
    const expandedErrorRaw = expandedErrorComponent.render(120).join("\n");
    const expandedError = plain(expandedErrorRaw);
    if (
      (expandedError.match(/Error: complete first failure line/g) ?? [])
        .length !== 1 ||
      !expandedError.includes("request id: fixture-123")
    ) {
      throw new Error(
        `expanded MCP error duplicated its summary or hid detail: ${JSON.stringify(expandedError)}`,
      );
    }
    if (
      !expandedErrorRaw.includes(theme.fg("error", "request id: fixture-123"))
    ) {
      throw new Error(
        `expanded MCP error payload did not retain its error color: ${JSON.stringify(expandedErrorRaw)}`,
      );
    }
    const expandedErrorRows = expandedError
      .split("\n")
      .filter((line) => line.trim().length > 0);
    if (
      expandedErrorRows.some(
        (line) => !line.startsWith("  ") || /^[ ]*[├│└] /.test(line),
      )
    ) {
      throw new Error(
        `expanded MCP error retained branch connectors: ${JSON.stringify(expandedErrorRows)}`,
      );
    }

    const partialComponent = mcp.renderResult(
      { content: [{ type: "text", text: "partial MCP payload" }] },
      { expanded: true, isPartial: true },
      theme,
      { state: {}, isError: false, lastComponent: undefined },
    );
    const partialRaw = partialComponent.render(120).join("\n");
    if (!partialRaw.includes(theme.fg("dim", "partial MCP payload"))) {
      throw new Error(
        `partial MCP payload did not use the dimmer raw-output color: ${JSON.stringify(partialRaw)}`,
      );
    }

    const partialErrorComponent = mcp.renderResult(
      { content: [{ type: "text", text: "partial MCP error" }] },
      { expanded: true, isPartial: true },
      theme,
      { state: {}, isError: true, lastComponent: undefined },
    );
    const partialErrorRaw = partialErrorComponent.render(120).join("\n");
    if (!partialErrorRaw.includes(theme.fg("error", "partial MCP error"))) {
      throw new Error(
        `partial MCP error payload did not retain its error color: ${JSON.stringify(partialErrorRaw)}`,
      );
    }

    const legacyRenderer = {
      render() {
        return ["6 lines returned"];
      },
      invalidate() {},
    };
    const legacyDefinition = {
      name: "mcp",
      label: "MCP",
      description: "MCP gateway",
      parameters: {},
      async execute() {
        return { content: [] };
      },
      renderCall() {
        return legacyRenderer;
      },
      renderResult() {
        return legacyRenderer;
      },
    } as any;
    const execution = toolExecution({
      tool: "mcp",
      id: "call_fixture",
      args: { server: "github", tool: "get_repository" },
      definition: legacyDefinition,
      argsComplete: false,
    });
    await emitLifecycle("agent_start");
    const running = execution.observe(120).text;
    const runningHeaders = running
      .split("\n")
      .filter(
        (line: string) =>
          line.includes("MCP") && line.includes("get_repository"),
      );
    if (runningHeaders.length !== 1) {
      throw new Error(
        `standalone MCP running state rendered ${runningHeaders.length} call headers`,
      );
    }
    const integratedFrame = execution.complete(
      { content: [{ type: "text", text: fields }], isError: false },
      { width: 120 },
    );
    const integratedRows = integratedFrame.rows;
    const integrated = integratedFrame.text;
    if (
      !integrated.includes("Responded (6 lines)") ||
      !integrated.includes("ctrl+o to expand") ||
      integrated.includes("Repository") ||
      integrated.includes("6 lines returned") ||
      integratedFrame.actions.length > 0
    ) {
      throw new Error(
        `ToolExecutionComponent did not preserve the regular MCP collapsed summary layer: ${JSON.stringify(integratedFrame)}`,
      );
    }
    const integratedContentRows = integratedRows.filter((line: string) =>
      line.trim(),
    );
    if (
      !/^─+$/.test(integratedContentRows[0] ?? "") ||
      !/^─+$/.test(integratedContentRows.at(-1) ?? "")
    ) {
      throw new Error(
        `standalone MCP did not retain its top and bottom borders: ${JSON.stringify(integratedRows)}`,
      );
    }
    const responseRow = integrated
      .split("\n")
      .find((line: string) => line.includes("Responded (6 lines)"));
    if (!responseRow?.startsWith("└")) {
      throw new Error(
        `MCP renderer ignored outputPad 0: ${JSON.stringify(responseRow)}`,
      );
    }

    const mcpAnchorExecution = toolExecution({
      tool: "mcp",
      id: "call_anchor_matrix",
      args: { server: "github", tool: "get_repository" },
      definition: legacyDefinition,
      interaction: "fullscreen",
      result: {
        content: [
          {
            type: "text",
            text: Array.from(
              { length: 20 },
              (_, i) => `MCP payload ${i + 1}`,
            ).join("\n"),
          },
        ],
        isError: false,
      },
    });
    const assertMcpFrame = (rows: string[], state: string): void => {
      const contentRows = rows.filter((line) => line.trim());
      if (
        !/^─+$/.test(contentRows[0] ?? "") ||
        !/^─+$/.test(contentRows.at(-1) ?? "")
      ) {
        throw new Error(
          `standalone MCP ${state} lost its top or bottom border: ${JSON.stringify(rows)}`,
        );
      }
    };
    const collapsedMcp = mcpAnchorExecution.observe(120);
    assertMcpFrame(collapsedMcp.rows, "collapsed layer");
    if (collapsedMcp.text.includes("MCP payload 1")) {
      throw new Error(
        `collapsed standalone MCP exposed payload: ${JSON.stringify(collapsedMcp.rows)}`,
      );
    }
    const expandMcp = collapsedMcp.actions.find(
      (action) =>
        action.behavior === "toggle" &&
        action.origin === "result-summary" &&
        action.viewportAnchor === "top",
    );
    const expandedMcp = expandMcp
      ? mcpAnchorExecution.activate(expandMcp)
      : undefined;
    if (!expandedMcp?.accepted)
      throw new Error("MCP collapsed expansion anchor did not activate");
    let mcpFrame = expandedMcp.after;
    assertMcpFrame(mcpFrame.rows, "L0");
    if (
      !mcpFrame.text.includes("MCP payload 8") ||
      mcpFrame.text.includes("MCP payload 9") ||
      !mcpFrame.actions.some((action) => action.behavior === "next-detail")
    ) {
      throw new Error(
        `MCP L0 did not stop at previewLines=8: ${JSON.stringify(mcpFrame.text)}`,
      );
    }
    const levelOneAction = mcpFrame.actions.find(
      (action) => action.behavior === "next-detail",
    );
    const levelOne = levelOneAction
      ? mcpAnchorExecution.activate(levelOneAction)
      : undefined;
    if (!levelOne?.accepted)
      throw new Error("MCP L1 detail anchor did not activate");
    mcpFrame = levelOne.after;
    assertMcpFrame(mcpFrame.rows, "L1");
    if (
      !mcpFrame.text.includes("MCP payload 10") ||
      mcpFrame.text.includes("MCP payload 11") ||
      !mcpFrame.actions.some((action) => action.behavior === "next-detail")
    ) {
      throw new Error(
        `MCP L1 did not stop at expandedPreviewMaxLines=10: ${JSON.stringify(mcpFrame.text)}`,
      );
    }
    const levelTwoAction = mcpFrame.actions.find(
      (action) => action.behavior === "next-detail",
    );
    const levelTwo = levelTwoAction
      ? mcpAnchorExecution.activate(levelTwoAction)
      : undefined;
    if (!levelTwo?.accepted)
      throw new Error("MCP L2 detail anchor did not activate");
    mcpFrame = levelTwo.after;
    assertMcpFrame(mcpFrame.rows, "L2");
    const collapseMcp = mcpFrame.actions.find(
      (action) =>
        action.behavior === "toggle" &&
        action.origin === "result-summary" &&
        action.viewportAnchor === "bottom",
    );
    if (
      !mcpFrame.text.includes("MCP payload 15") ||
      mcpFrame.text.includes("MCP payload 16") ||
      !collapseMcp
    ) {
      throw new Error(
        `MCP L2 did not stop at extraExpandedPreviewMaxLines=15 with a collapse row: ${JSON.stringify(mcpFrame.text)}`,
      );
    }
    const collapsedAgain = mcpAnchorExecution.activate(collapseMcp);
    if (
      !collapsedAgain.accepted ||
      collapsedAgain.after.text.includes("MCP payload 1")
    ) {
      throw new Error("MCP terminal collapse anchor did not collapse");
    }
    const headerMcp = collapsedAgain.after.actions.find(
      (action) => action.origin === "execution-header",
    );
    const headerExpandedMcp = headerMcp
      ? mcpAnchorExecution.activate(headerMcp)
      : undefined;
    if (
      !headerExpandedMcp?.accepted ||
      !headerExpandedMcp.after.text.includes("MCP payload 1")
    ) {
      throw new Error("MCP header anchor did not expand");
    }

    writeAgentSettings({ outputPad: 1 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const directPadded = render(fields);
    const directPaddedResponseRow = directPadded
      .split("\n")
      .find((line) => line.includes("Responded (6 lines)"));
    if (!directPaddedResponseRow?.startsWith(" └")) {
      throw new Error(
        `self-rendered MCP output ignored outputPad 1: ${JSON.stringify(directPaddedResponseRow)}`,
      );
    }
    const padded = execution.observe(120).text;
    const paddedResponseRow = padded
      .split("\n")
      .find((line: string) => line.includes("Responded (6 lines)"));
    if (!paddedResponseRow?.startsWith(" └")) {
      throw new Error(
        `MCP renderer ignored outputPad 1: ${JSON.stringify(paddedResponseRow)}`,
      );
    }

    const retainedPreKernelGroup = toolGroup([
      {
        tool: "mcp",
        id: "retained_pre_kernel_group",
        args: { server: "github", tool: "get_repository" },
        definition: legacyDefinition,
        interaction: "fullscreen",
        retainedCallRendererVersion: "pre-presentation-kernel",
        result: {
          content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
        },
      },
      {
        tool: "mcp",
        id: "retained_pre_kernel_peer",
        args: { server: "github", tool: "list_commits" },
        definition: legacyDefinition,
        interaction: "fullscreen",
        result: {
          content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
        },
      },
    ]);
    const retainedPreKernelFrame = retainedPreKernelGroup.observe(120);
    if (!retainedPreKernelFrame.text.includes("get_repository")) {
      throw new Error("retained pre-kernel MCP call row was not rendered");
    }

    const shortGroup = toolGroup([
      {
        tool: "mcp",
        id: "call_short_group_1",
        args: { server: "github", tool: "get_repository" },
        definition: legacyDefinition,
        interaction: "fullscreen",
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                repository: "MCP_FIRST_UNIT_PAYLOAD",
                private: false,
              }),
            },
          ],
          isError: false,
        },
      },
      {
        tool: "mcp",
        id: "call_short_group_2",
        args: { server: "github", tool: "list_commits" },
        definition: legacyDefinition,
        interaction: "fullscreen",
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({ commits: ["MCP_SECOND_UNIT_PAYLOAD"] }),
            },
          ],
          isError: false,
        },
      },
    ]);
    const collapsedGroup = shortGroup.observe(120);
    const firstChild = collapsedGroup.actions.find(
      (action) =>
        action.origin === "execution-header" &&
        action.text.includes("get_repository"),
    );
    const firstChildExpanded = firstChild
      ? shortGroup.activate(firstChild)
      : undefined;
    if (
      !firstChildExpanded?.accepted ||
      collapsedGroup.text.includes("Responded") ||
      collapsedGroup.text.includes("MCP_FIRST_UNIT_PAYLOAD")
    ) {
      throw new Error(
        `short grouped MCP child did not activate from its execution summary: ${JSON.stringify(collapsedGroup.rows)}`,
      );
    }
    if (
      !firstChildExpanded.after.text.includes(
        "Responded [object] (2 fields)",
      ) ||
      !firstChildExpanded.after.text.includes("MCP_FIRST_UNIT_PAYLOAD") ||
      firstChildExpanded.after.text.includes("MCP_SECOND_UNIT_PAYLOAD")
    ) {
      throw new Error(
        `grouped MCP child expansion did not isolate L0: ${JSON.stringify(firstChildExpanded.after.rows)}`,
      );
    }

    const guideGroup = toolGroup([
      {
        tool: "mcp",
        id: "call_fixture_1",
        args: { server: "github", tool: "get_repository" },
        definition: legacyDefinition,
        result: { content: [{ type: "text", text: fields }], isError: false },
      },
      {
        tool: "mcp",
        id: "call_fixture_2",
        args: { server: "github", tool: "get_repository" },
        definition: legacyDefinition,
        result: { content: [{ type: "text", text: fields }], isError: false },
      },
    ]);
    const collapsedGuideGroup = guideGroup.observe(120);
    if (
      collapsedGuideGroup.actions.length > 0 ||
      collapsedGuideGroup.text.includes("click any for details")
    ) {
      throw new Error(
        `regular grouped MCP guide fixture exposed click interaction: ${JSON.stringify(collapsedGuideGroup)}`,
      );
    }
    const expandedGroupLines = guideGroup.setExpanded(true, 120).rows;
    const childCallRow = expandedGroupLines.find(
      (line: string) => line.includes("MCP") && line.includes("get_repository"),
    );
    const nestedResultRow = expandedGroupLines.find((line: string) =>
      line.includes("Repository"),
    );
    const childFirstCharacterColumn = childCallRow?.indexOf("●") ?? -1;
    const nestedGuideColumn = nestedResultRow
      ? Math.max(
          nestedResultRow.lastIndexOf("│"),
          nestedResultRow.lastIndexOf("├"),
          nestedResultRow.lastIndexOf("└"),
        )
      : -1;
    if (
      childFirstCharacterColumn < 0 ||
      nestedGuideColumn !== childFirstCharacterColumn
    ) {
      throw new Error(
        `grouped nested guide was not below the child row's first character: ${JSON.stringify({ childCallRow, nestedResultRow })}`,
      );
    }

    const wrappedGroupText = [
      "Progress: one two three four five six nonfinal-tail-token",
      "Summary: alpha beta gamma delta grouped-tail-token",
    ].join("\n");
    const wrappedGroup = toolGroup([
      {
        tool: "mcp",
        id: "call_wrap_fixture_1",
        args: { server: "github", tool: "get_repository" },
        definition: legacyDefinition,
        result: { content: [{ type: "text", text: fields }], isError: false },
      },
      {
        tool: "mcp",
        id: "call_wrap_fixture_2",
        args: { server: "github", tool: "get_repository" },
        definition: legacyDefinition,
        result: {
          content: [{ type: "text", text: wrappedGroupText }],
          isError: false,
        },
      },
    ]);
    const collapsedWrappedGroup = wrappedGroup.observe(44);
    if (
      collapsedWrappedGroup.actions.length > 0 ||
      collapsedWrappedGroup.text.includes("click any for details")
    ) {
      throw new Error(
        `regular grouped MCP wrap fixture exposed click interaction: ${JSON.stringify(collapsedWrappedGroup)}`,
      );
    }
    const wrappedGroupLines = wrappedGroup.setExpanded(true, 44).rows;
    const groupedProgressContinuation = wrappedGroupLines.find((line: string) =>
      line.includes("nonfinal-tail-token"),
    );
    const groupedSummaryRow = wrappedGroupLines.find((line: string) =>
      line.includes("Summary"),
    );
    const groupedFinalContinuation = wrappedGroupLines.find((line: string) =>
      line.includes("grouped-tail-token"),
    );
    const groupedClosedBranchColumn = groupedSummaryRow?.lastIndexOf("└") ?? -1;
    const groupedSummaryColumn = groupedSummaryRow?.indexOf("Summary") ?? -1;
    const groupedFinalContinuationColumn =
      groupedFinalContinuation?.indexOf("grouped-tail-token") ?? -1;
    const groupedFinalContinuationPrefix =
      groupedFinalContinuation?.slice(0, groupedFinalContinuationColumn) ?? "";
    if (!groupedProgressContinuation?.includes("│")) {
      throw new Error(
        `grouped non-final wrap lost its indentation guide: ${JSON.stringify(wrappedGroupLines)}`,
      );
    }
    if (
      groupedClosedBranchColumn < 0 ||
      groupedSummaryColumn !== groupedClosedBranchColumn + 2 ||
      groupedFinalContinuation === groupedSummaryRow ||
      groupedFinalContinuationColumn !== groupedSummaryColumn ||
      /[│├└]/.test(groupedFinalContinuationPrefix)
    ) {
      throw new Error(
        `grouped final wrap was not aligned with its first text character: ${JSON.stringify({ groupedClosedBranchColumn, groupedSummaryColumn, groupedFinalContinuationColumn, groupedFinalContinuationPrefix, wrappedGroupLines })}`,
      );
    }

    const jsonGroup = toolGroup([
      {
        tool: "mcp",
        id: "call_json_fixture_1",
        args: { server: "github", tool: "list_commits" },
        definition: legacyDefinition,
        result: {
          content: [{ type: "text", text: commitsJson }],
          isError: false,
        },
      },
      {
        tool: "mcp",
        id: "call_json_fixture_2",
        args: { server: "github", tool: "list_commits" },
        definition: legacyDefinition,
        result: {
          content: [{ type: "text", text: commitsJson }],
          isError: false,
        },
      },
    ]);
    const collapsedJsonGroup = jsonGroup.observe(120);
    if (
      collapsedJsonGroup.actions.length > 0 ||
      collapsedJsonGroup.text.includes("click any for details")
    ) {
      throw new Error(
        `regular grouped MCP JSON fixture exposed click interaction: ${JSON.stringify(collapsedJsonGroup)}`,
      );
    }
    const jsonGroupLines = jsonGroup.setExpanded(true, 120).rows;
    const jsonCallRow = jsonGroupLines.find(
      (line: string) => line.includes("MCP") && line.includes("list_commits"),
    );
    const jsonResponseRow = jsonGroupLines.find(
      (line: string) => line.includes("Responded") && line.includes("[object]"),
    );
    const jsonRootFieldRow = jsonGroupLines.find((line: string) =>
      line.includes("total_count"),
    );
    const jsonArrayItemRow = jsonGroupLines.find(
      (line: string) => line.includes("[1]") && line.includes("object"),
    );
    const jsonNestedFieldRow = jsonGroupLines.find(
      (line: string) => line.includes("sha") && line.includes("a1b2c3d4"),
    );
    const statusColumn = jsonCallRow?.indexOf("●") ?? -1;
    const deepestGuideColumn = (line: string | undefined): number =>
      line ? Math.max(line.lastIndexOf("├"), line.lastIndexOf("└")) : -1;
    const groupedJsonColumns = {
      status: statusColumn,
      response: deepestGuideColumn(jsonResponseRow),
      rootField: deepestGuideColumn(jsonRootFieldRow),
      arrayItem: deepestGuideColumn(jsonArrayItemRow),
      nestedField: deepestGuideColumn(jsonNestedFieldRow),
    };
    if (
      statusColumn < 0 ||
      groupedJsonColumns.response !== statusColumn ||
      groupedJsonColumns.rootField !== groupedJsonColumns.response + 2 ||
      groupedJsonColumns.arrayItem !== groupedJsonColumns.rootField + 2 ||
      groupedJsonColumns.nestedField !== groupedJsonColumns.arrayItem + 2
    ) {
      throw new Error(
        `grouped JSON tree lost one or more indentation levels: ${JSON.stringify({ groupedJsonColumns, jsonCallRow, jsonResponseRow, jsonRootFieldRow, jsonArrayItemRow, jsonNestedFieldRow })}`,
      );
    }

    const imageComponent = mcp.renderResult(
      { content: [{ type: "image", data: "", mimeType: "image/png" }] },
      { expanded: false, isPartial: false },
      theme,
      { state: {}, isError: false, lastComponent: undefined },
    );
    const imageRows = imageComponent
      .render(120)
      .map((line: string) => plain(line));
    if (
      !imageRows.some((line: string) =>
        line.includes("Responded [image] (image/png)"),
      )
    ) {
      throw new Error(
        `MCP image response did not report its type: ${JSON.stringify(imageRows)}`,
      );
    }

    const savedCapabilities = getCapabilities();
    setCapabilities({ ...savedCapabilities, images: "iterm2" });
    try {
      const imageExecution = toolExecution({
        tool: "mcp",
        id: "call_image_fixture",
        args: { server: "fixture", tool: "image" },
        definition: mcp,
        interaction: "fullscreen",
        result: {
          content: [
            {
              type: "image",
              data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
              mimeType: "image/png",
            },
          ],
          isError: false,
        },
      });
      const collapsedImage = imageExecution.observe(120);
      const expandImage = collapsedImage.actions.find(
        (action) =>
          action.behavior === "toggle" && action.origin === "result-summary",
      );
      const expandedImage = expandImage
        ? imageExecution.activate(expandImage)
        : undefined;
      if (
        !expandedImage?.accepted ||
        collapsedImage.rawRows.some((line) =>
          line.includes("\x1b]1337;File="),
        ) ||
        !expandedImage.after.rawRows.some((line) =>
          line.includes("\x1b]1337;File="),
        )
      ) {
        throw new Error(
          `expanded MCP image did not reveal its image payload: ${JSON.stringify({ collapsed: collapsedImage.rows, expanded: expandedImage?.after.rows })}`,
        );
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
    const summaryOnlyRows = summaryOnlyComponent
      .render(120)
      .map((line: string) => plain(line));
    if (
      !summaryOnlyRows.some((line: string) =>
        line.includes("Responded [object] (2 fields)"),
      ) ||
      summaryOnlyRows.some(
        (line: string) => line.includes("ok") || line.includes("count"),
      ) ||
      (summaryOnlyComponent as any).getSemanticRows().length > 0
    ) {
      throw new Error(
        `MCP summary mode exposed payload or click anchors: ${JSON.stringify({ summaryOnlyRows, semanticRows: (summaryOnlyComponent as any).getSemanticRows() })}`,
      );
    }

    const summaryGroup = toolGroup([
      {
        tool: "mcp",
        id: "call_summary_group_1",
        args: { server: "github", tool: "get_repository" },
        definition: legacyDefinition,
        interaction: "fullscreen",
        result: {
          content: [{ type: "text", text: summaryResult.content[0].text }],
          isError: false,
        },
      },
      {
        tool: "mcp",
        id: "call_summary_group_2",
        args: { server: "github", tool: "list_commits" },
        definition: legacyDefinition,
        interaction: "fullscreen",
        result: {
          content: [{ type: "text", text: summaryResult.content[0].text }],
          isError: false,
        },
      },
    ]);
    const summaryGroupFrame = summaryGroup.observe(120);
    if (
      summaryGroupFrame.text.includes("click any for details") ||
      summaryGroupFrame.text.includes("Responded") ||
      summaryGroupFrame.actions.length > 0
    ) {
      throw new Error(
        `MCP summary-mode group exposed dead click anchors: ${JSON.stringify(summaryGroupFrame)}`,
      );
    }

    console.log(
      "OK  MCP collapsed summary, L0/L1/L2, shapes, errors, renderer priority, and grouped child isolation",
    );
  },
);
