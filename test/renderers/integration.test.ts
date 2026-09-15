import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertCollapsedIndicator,
  assertExpandedIndicator,
  assertPayloadRowInert,
  assertResultSummaryAnchor,
  observeRenderer,
  plain,
  type ObservedRenderer,
  type ToolExecutionFixture,
  waitFor,
  withRendererHarness,
} from "./harness.ts";

const PRELOADED_AGENT_GETTER = Symbol.for(
  "pi-cc-tools:test-preloaded-agent-getter",
);

await withRendererHarness(
  {
    name: "renderer-integration",
    stubTools: [
      "apply_patch",
      "web_search",
      "TaskList",
      "Agent",
      "ask_parent",
      "subagent_done",
    ],
    beforeExtension: ({ ToolExecutionComponent }) => {
      const prototype = ToolExecutionComponent.prototype as any;
      const delegatedGetter = prototype.getResultRenderer;
      const producerGetter = function (this: any): any {
        if (
          this.toolName === "Agent" &&
          this.isPartial !== true &&
          this.result?.isError !== true
        ) {
          return this.toolDefinition?.renderResult;
        }
        return delegatedGetter.call(this);
      };
      prototype.getResultRenderer = producerGetter;
      (globalThis as any)[PRELOADED_AGENT_GETTER] = producerGetter;
    },
  },
  async ({
    fakePi,
    theme,
    ToolExecutionComponent,
    tempPiDir,
    toolExecution,
    toolGroup,
    emitLifecycle,
    writePiSettings,
  }) => {
    const {
      BashExecutionComponent,
      BranchSummaryMessageComponent,
      CompactionSummaryMessageComponent,
      CustomMessageComponent,
    } =
      await import("../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/index.js");
    const { Box, Markdown, Text } =
      await import("../../node_modules/@earendil-works/pi-tui/dist/index.js");
    const { getMarkdownTheme } =
      await import("../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js");
    const reportedDefects: string[] = [];
    const fullscreenExecution = (
      fixture: ToolExecutionFixture,
    ): ObservedRenderer =>
      toolExecution({
        ...fixture,
        interaction: "fullscreen",
      });
    const builtinWidth = 72;
    const hasExactPaintedVerticalPadding = (rows: string[]): boolean => {
      if (rows.length < 4) return false;
      const painted = rows.map((line) => line.includes("\x1b[48;"));
      return (
        !painted[0] &&
        plain(rows[0]).trim().length === 0 &&
        painted.slice(1).every(Boolean) &&
        plain(rows[1]).trim().length === 0 &&
        plain(rows[2]).trim().length > 0 &&
        plain(rows.at(-2) ?? "").trim().length > 0 &&
        plain(rows.at(-1) ?? "").trim().length === 0
      );
    };
    const assertFullWidthActionRows = (
      frame: ReturnType<ObservedRenderer["observe"]>,
      rows: Iterable<number>,
      label: string,
    ): void => {
      for (const row of rows) {
        const action = frame.actions.find((candidate) => candidate.row === row);
        if (action?.start !== 0 || action.end !== builtinWidth) {
          throw new Error(
            `${label} row ${row} was not clickable across its full bounds: ${JSON.stringify(action)}`,
          );
        }
      }
    };
    const assertWholeComponentToggle = (
      component: any,
      expandedNeedle: string,
      label: string,
    ): void => {
      const observed = observeRenderer(component, component);
      const collapsed = observed.observe(builtinWidth);
      assertFullWidthActionRows(
        collapsed,
        collapsed.rows.keys(),
        `${label} collapsed`,
      );
      const expansion = observed.activate(collapsed.actions[0]);
      if (!expansion.accepted) {
        throw new Error(
          `${label} did not expand from its whole-component action`,
        );
      }
      if (!expansion.after.text.includes(expandedNeedle)) {
        throw new Error(
          `${label} expanded content did not render: ${JSON.stringify(expansion.after.rows)}`,
        );
      }
      assertFullWidthActionRows(
        expansion.after,
        expansion.after.rows.keys(),
        `${label} expanded`,
      );
      if (!observed.activate(expansion.after.actions[0]).accepted) {
        throw new Error(
          `${label} did not collapse from its whole-component action`,
        );
      }
    };
    const assertPaintedComponentToggle = (
      component: any,
      expandedNeedle: string,
      label: string,
    ): void => {
      const observed = observeRenderer(component, component);
      let frame = observed.observe(builtinWidth);
      for (const expanded of [false, true]) {
        if (frame.actions.some((action) => action.row === 0)) {
          throw new Error(
            `${label} ${expanded ? "expanded" : "collapsed"} outer spacer was clickable`,
          );
        }
        assertFullWidthActionRows(
          frame,
          Array.from(
            { length: frame.rows.length - 1 },
            (_, index) => index + 1,
          ),
          `${label} ${expanded ? "expanded" : "collapsed"} painted`,
        );
        if (expanded && !frame.text.includes(expandedNeedle)) {
          throw new Error(
            `${label} expanded content did not render: ${JSON.stringify(frame.rows)}`,
          );
        }
        const toggle = frame.actions.find((action) => action.row === 1);
        const transition = toggle ? observed.activate(toggle) : undefined;
        if (!transition?.accepted) {
          throw new Error(
            `${label} did not ${expanded ? "collapse" : "expand"}`,
          );
        }
        frame = transition.after;
      }
    };

    assertWholeComponentToggle(
      new CompactionSummaryMessageComponent({
        role: "compactionSummary",
        summary: "COMPACTION_EXPANDED_DETAIL",
        tokensBefore: 1234,
        timestamp: Date.now(),
      }),
      "COMPACTION_EXPANDED_DETAIL",
      "compaction summary",
    );
    assertWholeComponentToggle(
      new BranchSummaryMessageComponent({
        role: "branchSummary",
        summary: "BRANCH_EXPANDED_DETAIL",
        fromId: "branch-source",
        timestamp: Date.now(),
      }),
      "BRANCH_EXPANDED_DETAIL",
      "branch summary",
    );

    const builtinUi = { requestRender() {} } as any;
    const longShell = new BashExecutionComponent("printf long", builtinUi);
    longShell.appendOutput(
      Array.from(
        { length: 24 },
        (_, index) => `SHELL_DETAIL_${index + 1}`,
      ).join("\n"),
    );
    longShell.setComplete(0, false);
    assertWholeComponentToggle(
      longShell,
      "SHELL_DETAIL_1",
      "! shell execution",
    );

    const shortShell = new BashExecutionComponent(
      "printf short",
      builtinUi,
    ) as any;
    shortShell.appendOutput("SHORT_SHELL_1\nSHORT_SHELL_2");
    shortShell.setComplete(0, false);
    const shortShellFrame = observeRenderer(shortShell, shortShell).observe(
      builtinWidth,
    );
    if (shortShellFrame.actions.length > 0) {
      throw new Error(
        "fully visible ! shell output exposed a no-op click target",
      );
    }

    const customMessageText = `${Array.from({ length: 12 }, (_, index) => `SIDE_QUEST_EVENT_${index + 1}`).join("\n")}\n\n`;
    const sideQuestMessageRenderer = (
      message: any,
      options: any,
      messageTheme: any,
    ) => {
      const text = typeof message.content === "string" ? message.content : "";
      const box = new Box(2, 1, (line: string) =>
        messageTheme.bg("customMessageBg", line),
      );
      box.addChild(
        options.expanded
          ? new Markdown(text, 0, 0, getMarkdownTheme())
          : new Text(`${text.slice(0, 24)}… dynamic-key for details`, 0, 0),
      );
      return box;
    };
    for (const customType of ["side-quest-result", "side-quest-continuation"]) {
      const customMessage = new CustomMessageComponent(
        {
          role: "custom",
          customType,
          content: customMessageText,
          display: true,
          timestamp: Date.now(),
        },
        sideQuestMessageRenderer,
      );
      const customRendered = customMessage.render(builtinWidth);
      const customRows = customRendered.map((line: string) => plain(line));
      if (customRows.some((line: string) => /^─+$/.test(line.trim()))) {
        reportedDefects.push(`${customType} retained standalone border rows`);
      }
      if (!hasExactPaintedVerticalPadding(customRendered)) {
        reportedDefects.push(
          `${customType} did not preserve exactly one painted top/bottom padding row`,
        );
      }
      assertPaintedComponentToggle(
        customMessage,
        "SIDE_QUEST_EVENT_12",
        `${customType} custom message`,
      );
    }
    const unrelatedCustomMessage = new CustomMessageComponent(
      {
        role: "custom",
        customType: "unrelated",
        content: customMessageText,
        display: true,
        timestamp: Date.now(),
      },
      sideQuestMessageRenderer,
    ) as any;
    if (
      observeRenderer(unrelatedCustomMessage, unrelatedCustomMessage).observe(
        builtinWidth,
      ).actions.length > 0
    ) {
      throw new Error(
        "an unrelated custom message received a Side Quests click target",
      );
    }

    const summaryCases: Array<[string, any, string, Record<string, unknown>?]> =
      [
        [
          "read",
          { content: [{ type: "text", text: "read one\nread two" }] },
          "2 lines loaded",
        ],
        [
          "read",
          { content: [{ type: "image", data: "", mimeType: "image/png" }] },
          "Image loaded",
        ],
        [
          "bash",
          { content: [{ type: "text", text: "bash one\nbash two" }] },
          "Done (2 lines)",
          { args: { command: "printf test" } },
        ],
        [
          "grep",
          { content: [{ type: "text", text: "a.ts:1:one\na.ts:2:two" }] },
          "2 matches",
        ],
        [
          "find",
          { content: [{ type: "text", text: "a.ts\nb.ts" }] },
          "2 files",
        ],
        [
          "ls",
          { content: [{ type: "text", text: "a.ts\nb.ts" }] },
          "2 entries",
        ],
        [
          "write",
          { content: [{ type: "text", text: "Wrote fixture.ts" }] },
          "Written",
        ],
        [
          "edit",
          { content: [{ type: "text", text: "Edited fixture.ts" }] },
          "Applied",
        ],
        [
          "apply_patch",
          { content: [{ type: "text", text: "Done!" }] },
          "Applied",
        ],
        [
          "web_search",
          { content: [{ type: "text", text: "search one\nsearch two" }] },
          "2 lines returned",
        ],
        [
          "TaskList",
          {
            content: [
              {
                type: "text",
                text: "#1 [pending] First\n#2 [completed] Second",
              },
            ],
          },
          "2 tasks",
        ],
      ];
    for (const [name, result, expectedSummary, ctxOverrides] of summaryCases) {
      assertResultSummaryAnchor(
        fakePi,
        name,
        result,
        false,
        expectedSummary,
        ctxOverrides,
      );
      assertResultSummaryAnchor(
        fakePi,
        name,
        result,
        true,
        expectedSummary,
        ctxOverrides,
      );
    }

    assertPayloadRowInert(
      fakePi,
      "bash",
      { content: [{ type: "text", text: "" }] },
      "(no output)",
      { args: { command: "true" } },
    );
    assertPayloadRowInert(
      fakePi,
      "write",
      { content: [{ type: "text", text: "write failed raw payload" }] },
      "write failed raw payload",
      { isError: true },
    );
    assertPayloadRowInert(
      fakePi,
      "web_search",
      {
        content: [
          {
            type: "text",
            text: "search failed raw payload\nsecond error line",
          },
        ],
      },
      "search failed raw payload",
      { isError: true },
    );

    writePiSettings({
      clickExpansion: true,
      previewLines: 3,
      expandedPreviewMaxLines: 5,
      extraExpandedPreviewMaxLines: 7,
    });
    const agentDefinition = fakePi.tools.get("Agent");
    agentDefinition.renderCall = (args: any) =>
      new Text(`● Agent general-purpose :: ${args.description}`, 0, 0);
    agentDefinition.renderResult = (
      result: any,
      options: any,
      renderTheme: any,
      ctx: any,
    ) => {
      const presentation = result.details?.sideQuestPresentation;
      const statuses = presentation?.statuses ?? [];
      const payload = statuses.length ? ` [${statuses.join(" | ")}]` : "";
      const resultStatus = presentation?.resultStatus ?? "spawned";
      const resultLabel = resultStatus[0].toUpperCase() + resultStatus.slice(1);
      const summary = `${renderTheme.fg("success", resultLabel)}${renderTheme.fg("muted", payload)}`;
      if (!options.expanded)
        return new Text(`└ ${summary} • dynamic-key for details`, 0, 0);
      const sessionPath = result.details?.sessionPath ?? "Unavailable";
      return new Text(
        [
          `└ ${summary}`,
          `  session path: ${sessionPath}`,
          "  ⠀",
          ...String(ctx.args?.prompt ?? "")
            .split("\n")
            .map((line) => `  ${line}`),
        ].join("\n"),
        0,
        0,
      );
    };
    const createAgentFixture = (
      id: string,
      version = 1,
      promptLineCount = 7,
      resultStatus: "spawned" | "resumed" | "answered" | "steered" = "spawned",
    ) => {
      const sessionPath = `/tmp/${id}/session.jsonl`;
      return {
        tool: "Agent",
        id,
        args: {
          description: `Agent fixture ${id}`,
          inherit_context: true,
          interactive: true,
          prompt: Array.from(
            { length: promptLineCount },
            (_, index) => `AGENT_${id}_PROMPT_${index + 1}`,
          ).join("\n"),
          ...(resultStatus === "spawned" ? {} : { resume: sessionPath }),
        },
        definition: agentDefinition,
        interaction: "fullscreen" as const,
        result: {
          content: [{ type: "text", text: `Subagent ${resultStatus}.` }],
          details: {
            operation:
              resultStatus === "spawned"
                ? "launched"
                : resultStatus === "resumed"
                  ? "reopened"
                  : "continued",
            continuationKind: resultStatus === "answered" ? "answer" : "steer",
            sessionPath,
            sideQuestPresentation: {
              version,
              surface: "agent",
              resultStatus,
              statuses:
                resultStatus === "spawned" ? ["inherited", "interactive"] : [],
            },
          },
          isError: false,
        },
      };
    };
    const createAgentExecution = (
      id: string,
      version = 1,
      promptLineCount = 7,
      resultStatus: "spawned" | "resumed" | "answered" | "steered" = "spawned",
    ): ObservedRenderer =>
      fullscreenExecution(
        createAgentFixture(id, version, promptLineCount, resultStatus),
      );
    const toolPrototype = ToolExecutionComponent.prototype as any;
    const installSimulatedSideQuestsOuterGetter = (): (() => any) => {
      const delegatedGetter = toolPrototype.getResultRenderer;
      const sideQuestsGetter = function (this: any): any {
        const delegated = delegatedGetter.call(this);
        if (
          this.toolName === "Agent" &&
          this.isPartial !== true &&
          this.result?.isError !== true
        ) {
          return agentDefinition.renderResult;
        }
        return delegated;
      };
      toolPrototype.getResultRenderer = sideQuestsGetter;
      return sideQuestsGetter;
    };
    const assertAgentOrderAdapter = (
      execution: ObservedRenderer,
      resultStatus: "spawned" | "resumed" | "answered" | "steered",
      label: string,
    ): void => {
      const resultLabel = resultStatus[0].toUpperCase() + resultStatus.slice(1);
      const statuses =
        resultStatus === "spawned" ? " [inherited | interactive]" : "";
      const frame = execution.observe(100);
      const summary = frame.actions.find(
        (action) =>
          action.origin === "result-summary" &&
          action.text.includes(`${resultLabel}${statuses}`),
      );
      if (!summary) {
        throw new Error(
          `${label} did not retain the Agent ${resultLabel} summary adapter: ${JSON.stringify(frame.rows)}`,
        );
      }
    };

    const producerFirstGetter = (globalThis as any)[PRELOADED_AGENT_GETTER];
    const initialCcToolsGetter = toolPrototype.getResultRenderer;
    assertAgentOrderAdapter(
      createAgentExecution("producer_first"),
      "spawned",
      "Side Quests → cc-tools",
    );
    assertAgentOrderAdapter(
      createAgentExecution("producer_first_resumed", 1, 7, "resumed"),
      "resumed",
      "Side Quests → cc-tools resumed",
    );
    assertAgentOrderAdapter(
      createAgentExecution("producer_first_steered", 1, 7, "steered"),
      "steered",
      "Side Quests → cc-tools steered",
    );
    assertAgentOrderAdapter(
      createAgentExecution("producer_first_answered", 1, 7, "answered"),
      "answered",
      "Side Quests → cc-tools answered",
    );
    if (
      initialCcToolsGetter === producerFirstGetter ||
      toolPrototype.getResultRenderer !== initialCcToolsGetter
    ) {
      throw new Error(
        "Side Quests → cc-tools did not install one stable outer adapter",
      );
    }

    const cachedBeforeLateProducer = createAgentExecution("cached_before_late");
    cachedBeforeLateProducer.observe(100);
    const producerLateGetter = installSimulatedSideQuestsOuterGetter();
    assertAgentOrderAdapter(
      cachedBeforeLateProducer,
      "spawned",
      "cc-tools → Side Quests cached execution",
    );
    assertAgentOrderAdapter(
      createAgentExecution("consumer_first_resumed", 1, 7, "resumed"),
      "resumed",
      "cc-tools → Side Quests resumed",
    );
    assertAgentOrderAdapter(
      createAgentExecution("consumer_first_steered", 1, 7, "steered"),
      "steered",
      "cc-tools → Side Quests steered",
    );
    assertAgentOrderAdapter(
      createAgentExecution("consumer_first_answered", 1, 7, "answered"),
      "answered",
      "cc-tools → Side Quests answered",
    );
    if (toolPrototype.getResultRenderer !== producerLateGetter) {
      throw new Error(
        "cc-tools → Side Quests replaced the late producer getter",
      );
    }
    for (let cycle = 1; cycle <= 12; cycle++) {
      await emitLifecycle("session_start");
      assertAgentOrderAdapter(
        createAgentExecution(`reload_${cycle}`),
        "spawned",
        `reload cycle ${cycle}`,
      );
      if (toolPrototype.getResultRenderer !== producerLateGetter) {
        throw new Error(
          `reload cycle ${cycle} grew the result-renderer wrapper chain`,
        );
      }
    }

    assertAgentOrderAdapter(
      fullscreenExecution({
        ...createAgentFixture("own_getter"),
        lockOwnResultRenderer: true,
      }),
      "spawned",
      "non-configurable own getter",
    );

    const shortAgentExecution = createAgentExecution("short_standalone", 1, 2);
    const shortAgentCollapsed = shortAgentExecution.observe(100);
    const shortAgentSummary = shortAgentCollapsed.actions.find(
      (action) => action.origin === "result-summary",
    );
    const shortAgentExpansion = shortAgentSummary
      ? shortAgentExecution.activate(shortAgentSummary)
      : undefined;
    if (!shortAgentExpansion?.accepted) {
      throw new Error(
        "short standalone Agent did not expand from its result summary",
      );
    }
    if (shortAgentExpansion.after.text.includes("Output ends here")) {
      reportedDefects.push(
        "short standalone Agent retained a bottom collapse anchor below the L0 gate",
      );
    }

    const shortAgentGroup = toolGroup([
      createAgentFixture("short_grouped_first", 1, 3),
      createAgentFixture("short_grouped_second", 1, 3),
    ]);
    const shortGroupCollapsed = shortAgentGroup.observe(100);
    const shortGroupHeader = shortGroupCollapsed.actions.find(
      (action) =>
        action.origin === "execution-header" &&
        action.text.includes("short_grouped_first"),
    );
    const shortGroupExpansion = shortGroupHeader
      ? shortAgentGroup.activate(shortGroupHeader)
      : undefined;
    if (!shortGroupExpansion?.accepted) {
      throw new Error("short grouped Agent did not expand from its header");
    }
    if (shortGroupExpansion.after.text.includes("Output ends here")) {
      reportedDefects.push(
        "short grouped Agent retained a bottom collapse anchor below the L0 gate",
      );
    }

    const agentExecution = createAgentExecution("standalone");
    const collapsedAgent = agentExecution.observe(100);
    const nonBlankAgentRows = collapsedAgent.rows.filter(
      (line: string) => line.trim().length > 0,
    );
    if (
      !/^─+$/.test(nonBlankAgentRows[0]?.trim() ?? "") ||
      !/^─+$/.test(nonBlankAgentRows.at(-1)?.trim() ?? "")
    ) {
      throw new Error(
        `standalone Agent output did not retain top and bottom borders: ${JSON.stringify(collapsedAgent.rows)}`,
      );
    }
    const collapsedAgentSummary = collapsedAgent.actions.find(
      (action) =>
        action.origin === "result-summary" &&
        action.text.includes("Spawned [inherited | interactive]"),
    );
    const agentL0Transition = collapsedAgentSummary
      ? agentExecution.activate(collapsedAgentSummary)
      : undefined;
    if (!agentL0Transition?.accepted) {
      throw new Error(
        `standalone Agent result summary was not clickable: ${JSON.stringify(collapsedAgent.rows)}`,
      );
    }
    let agentFrame = agentL0Transition.after;
    if (
      !agentFrame.text.includes("AGENT_standalone_PROMPT_3") ||
      agentFrame.text.includes("AGENT_standalone_PROMPT_4") ||
      !agentFrame.text.includes("click for more detail")
    ) {
      throw new Error(
        `standalone Agent L0 did not use the configured compact preview: ${JSON.stringify(agentFrame.rows)}`,
      );
    }
    const agentL0Summary = agentFrame.rows.find((line: string) =>
      line.includes("Spawned"),
    );
    if (agentL0Summary?.includes("click to collapse")) {
      throw new Error(
        `expanded Agent top summary exposed a collapse hint: ${JSON.stringify(agentL0Summary)}`,
      );
    }
    const activateAgentDetail = (
      expectedLastLine: number,
      expectFinal: boolean,
    ): void => {
      const detail = agentFrame.actions.find(
        (action) =>
          action.behavior === "next-detail" &&
          action.text.includes("click for more detail"),
      );
      const transition = detail ? agentExecution.activate(detail) : undefined;
      if (!transition?.accepted) {
        throw new Error(
          `Agent detail action did not activate: ${JSON.stringify(agentFrame)}`,
        );
      }
      agentFrame = transition.after;
      if (
        !agentFrame.text.includes(`AGENT_standalone_PROMPT_${expectedLastLine}`)
      ) {
        throw new Error(
          `Agent detail layer omitted prompt line ${expectedLastLine}: ${JSON.stringify(agentFrame.rows)}`,
        );
      }
      if (
        expectFinal !==
        agentFrame.text.includes("Output ends here • click to collapse")
      ) {
        throw new Error(
          `Agent final collapse row mismatch: ${JSON.stringify(agentFrame.rows)}`,
        );
      }
    };
    activateAgentDetail(5, false);
    activateAgentDetail(7, true);
    const agentCollapse = agentFrame.actions.find(
      (action) =>
        action.behavior === "toggle" && action.viewportAnchor === "bottom",
    );
    const agentCollapseTransition = agentCollapse
      ? agentExecution.activate(agentCollapse)
      : undefined;
    if (
      !agentCollapseTransition?.accepted ||
      agentCollapseTransition.after.text.includes("AGENT_standalone_PROMPT_1")
    ) {
      throw new Error(
        "Agent final collapse action did not restore compact output",
      );
    }

    const agentGroup = toolGroup([
      createAgentFixture("grouped_first"),
      createAgentFixture("grouped_second"),
    ]);
    const compactAgentGroup = agentGroup.observe(100);
    const groupedAgentHeader = compactAgentGroup.actions.find(
      (action) =>
        action.origin === "execution-header" &&
        action.text.includes("grouped_first"),
    );
    const groupedAgentExpansion = groupedAgentHeader
      ? agentGroup.activate(groupedAgentHeader)
      : undefined;
    if (!groupedAgentExpansion?.accepted) {
      throw new Error(
        `grouped Agent header did not expand its execution: ${JSON.stringify(compactAgentGroup.rows)}`,
      );
    }
    let groupedAgentFrame = groupedAgentExpansion.after;
    if (
      !groupedAgentFrame.text.includes("AGENT_grouped_first_PROMPT_3") ||
      groupedAgentFrame.rows.some((line: string) => /^─+$/.test(line.trim()))
    ) {
      throw new Error(
        `grouped Agent output did not preserve L0 content without standalone borders: ${JSON.stringify(groupedAgentFrame.rows)}`,
      );
    }
    const groupedAgentSummary = groupedAgentFrame.actions.find(
      (action) =>
        action.origin === "result-summary" &&
        action.text.includes("Spawned [inherited | interactive]"),
    );
    const groupedAgentCollapse = groupedAgentSummary
      ? agentGroup.activate(groupedAgentSummary)
      : undefined;
    if (
      !groupedAgentCollapse?.accepted ||
      groupedAgentCollapse.after.text.includes("AGENT_grouped_first_PROMPT_1")
    ) {
      throw new Error(
        `grouped Agent result summary did not collapse its execution: ${JSON.stringify(groupedAgentFrame.rows)}`,
      );
    }
    groupedAgentFrame = groupedAgentCollapse.after;
    for (const behavior of ["toggle", "next-detail", "next-detail"] as const) {
      const action = groupedAgentFrame.actions.find(
        (candidate) => candidate.behavior === behavior,
      );
      const transition = action ? agentGroup.activate(action) : undefined;
      if (!transition?.accepted) {
        throw new Error(
          `grouped Agent did not advance through ${behavior}: ${JSON.stringify(groupedAgentFrame)}`,
        );
      }
      groupedAgentFrame = transition.after;
    }
    if (
      !groupedAgentFrame.text.includes("AGENT_grouped_first_PROMPT_7") ||
      !groupedAgentFrame.text.includes(
        "Output ends here • click to collapse",
      ) ||
      groupedAgentFrame.rows.some((line: string) => /^─+$/.test(line.trim()))
    ) {
      throw new Error(
        `long grouped Agent omitted its unframed final detail layer or collapse row: ${JSON.stringify(groupedAgentFrame.rows)}`,
      );
    }

    const unknownAgent = createAgentExecution("future", 99).observe(100);
    if (
      !unknownAgent.text.includes("dynamic-key for details") ||
      unknownAgent.actions.length > 0
    ) {
      throw new Error(
        `unknown Agent presentation version did not fail closed: ${JSON.stringify(unknownAgent.rows)}`,
      );
    }

    const longBanner = Array.from(
      { length: 30 },
      (_, index) => `BANNER_${index + 1}`,
    ).join(" ");
    for (const [name, field, expandedNeedle] of [
      ["ask_parent", "prompt", "BANNER_30"],
      ["subagent_done", "result", "BANNER_30"],
    ] as const) {
      const definition = fakePi.tools.get(name);
      definition.renderShell = "self";
      definition.renderCall = (_args: any, _theme: any, ctx: any) =>
        ctx.isPartial
          ? new Text(longBanner.slice(0, 48), 0, 0)
          : new Text("", 0, 0);
      definition.renderResult = (
        _result: any,
        options: any,
        bannerTheme: any,
      ) => {
        const box = new Box(2, 1, (line: string) =>
          bannerTheme.bg("customMessageBg", line),
        );
        box.addChild(
          new Text(
            options.expanded
              ? longBanner
              : `${longBanner.slice(0, 48)}… dynamic-key for details`,
            0,
            0,
          ),
        );
        return box;
      };
      const banner = fullscreenExecution({
        tool: name,
        id: `${name}_binary_fixture`,
        args: { [field]: longBanner },
        definition,
        interaction: "fullscreen",
        result: {
          content: [{ type: "text", text: "recorded" }],
          isError: false,
        },
      });
      const compactBanner = banner.observe(72);
      const bannerRendered = compactBanner.rawRows;
      const bannerRows = compactBanner.rows;
      if (bannerRows.some((line: string) => /^─+$/.test(line.trim()))) {
        reportedDefects.push(`${name} retained standalone border rows`);
      }
      if (!hasExactPaintedVerticalPadding(bannerRendered)) {
        reportedDefects.push(
          `${name} did not preserve exactly one painted top/bottom padding row`,
        );
      }
      if (bannerRows.some((line: string) => line.includes("click to expand"))) {
        throw new Error(
          `${name} compact banner duplicated its fade affordance with a click-to-expand row: ${JSON.stringify(bannerRows)}`,
        );
      }
      const firstPaintedRow = bannerRendered.findIndex((line: string) =>
        line.includes("\x1b[48;"),
      );
      const coversRow = (y: number): boolean =>
        compactBanner.actions.some(
          (action) =>
            action.origin === "result-summary" &&
            action.row === y &&
            action.start === 0 &&
            action.end >= 72,
        );
      const deadRow = bannerRows.findIndex(
        (_: string, y: number) => y >= firstPaintedRow && !coversRow(y),
      );
      const activeOuterSpacer = Array.from(
        { length: Math.max(0, firstPaintedRow) },
        (_, y) => y,
      ).find(coversRow);
      if (
        firstPaintedRow < 0 ||
        deadRow >= 0 ||
        activeOuterSpacer !== undefined
      ) {
        throw new Error(
          `${name} banner click bounds did not cover only the painted block: ${JSON.stringify({ bannerRows, firstPaintedRow, deadRow, activeOuterSpacer })}`,
        );
      }
      const expansionAction = compactBanner.actions.find(
        (action) => action.origin === "result-summary",
      );
      const expansion = expansionAction
        ? banner.activate(expansionAction)
        : undefined;
      if (!expansion?.accepted)
        throw new Error(`${name} banner did not expand`);
      const expandedBanner = expansion.after;
      if (!expandedBanner.text.includes(expandedNeedle)) {
        throw new Error(`${name} banner did not reveal its full content`);
      }
      if (
        expandedBanner.text.includes("Output ends here • click to collapse")
      ) {
        throw new Error(
          `${name} expanded banner retained its terminal collapse row`,
        );
      }
      if (!hasExactPaintedVerticalPadding(expandedBanner.rawRows)) {
        reportedDefects.push(
          `${name} expanded output did not preserve exactly one painted top/bottom padding row`,
        );
      }
    }

    for (const [name, field, content] of [
      ["ask_parent", "prompt", "😀".repeat(121)],
      ["subagent_done", "result", `${" ".repeat(241)}short`],
    ] as const) {
      const definition = fakePi.tools.get(name);
      definition.renderShell = "self";
      definition.renderCall = () => new Text("", 0, 0);
      definition.renderResult = (
        _result: any,
        _options: any,
        _theme: any,
        ctx: any,
      ) => {
        const shown =
          name === "subagent_done"
            ? String(ctx.args?.[field] ?? "").trim()
            : String(ctx.args?.[field] ?? "");
        return new Text(shown, 0, 0);
      };
      const banner = fullscreenExecution({
        tool: name,
        id: `${name}_unicode_noop_fixture`,
        args: { [field]: content },
        definition,
        result: {
          content: [{ type: "text", text: "recorded" }],
          isError: false,
        },
      });
      const observation = banner.observe(72);
      if (observation.actions.length > 0) {
        throw new Error(
          `${name} exposed a no-op click target for fully visible Unicode-normalized content`,
        );
      }
    }

    writePiSettings({
      clickExpansion: true,
      expandedPreviewMaxLines: 10,
      extraExpandedPreviewMaxLines: 15,
    });
    const write = fakePi.tools.get("write");
    if (
      typeof write?.execute !== "function" ||
      typeof write?.renderResult !== "function"
    ) {
      throw new Error("Write tool was not registered");
    }
    const executeWriteFixture = async (
      id: string,
      fileName: string,
      before: string | null,
      after: string,
    ): Promise<{ args: { path: string; content: string }; result: any }> => {
      const path = join(tempPiDir, fileName);
      if (before === null) rmSync(path, { force: true });
      else writeFileSync(path, before);
      const args = { path, content: after };
      const result = await write.execute(id, args, undefined, undefined, {
        cwd: process.cwd(),
      });
      return { args, result };
    };
    const contextLines = Array.from(
      { length: 40 },
      (_, index) => `context line ${index + 1}`,
    );
    const oldContextLines = Array.from(
      { length: 40 },
      (_, index) => `old context line ${index + 1}`,
    );
    const smallOldContent = ["const value = 'old';", ...oldContextLines].join(
      "\n",
    );
    const smallNewContent = ["const value = 'new';", ...contextLines].join(
      "\n",
    );
    const { result: writeResult, args: writeArgs } = await executeWriteFixture(
      "write_collapsed_fixture",
      "write-collapsed-fixture.ts",
      smallOldContent,
      smallNewContent,
    );
    const writeContext = {
      state: {},
      isError: false,
      lastComponent: undefined,
      args: writeArgs,
      cwd: process.cwd(),
      expanded: false,
    } as any;
    write.renderResult(
      writeResult,
      { expanded: false, isPartial: false },
      theme,
      writeContext,
    );
    await waitFor(() =>
      write
        .renderResult(
          writeResult,
          { expanded: false, isPartial: false },
          theme,
          writeContext,
        )
        .render(120)
        .some((line: string) => plain(line).includes("more diff lines")),
    );
    const writeRaw = write
      .renderResult(
        writeResult,
        { expanded: false, isPartial: false },
        theme,
        writeContext,
      )
      .render(120)
      .join("\n");
    assertCollapsedIndicator(writeRaw, "more diff lines", true);

    const expandedContextLines = Array.from(
      { length: 260 },
      (_, index) => `expanded context line ${index + 1}`,
    );
    const oldExpandedContextLines = Array.from(
      { length: 260 },
      (_, index) => `old expanded context line ${index + 1}`,
    );
    const expandedOldContent = [
      "const value = 'old';",
      ...oldContextLines,
      ...oldExpandedContextLines,
    ].join("\n");
    const expandedNewContent = [
      "const value = 'new';",
      ...contextLines,
      ...expandedContextLines,
    ].join("\n");
    const expandedWriteFixture = await executeWriteFixture(
      "write_expanded_fixture",
      "write-expanded-fixture.ts",
      expandedOldContent,
      expandedNewContent,
    );
    const createContent = Array.from(
      { length: 220 },
      (_, index) => `created line ${index + 1}`,
    ).join("\n");
    const newFileWriteFixture = await executeWriteFixture(
      "write_created_fixture",
      "write-created-fixture.ts",
      null,
      createContent,
    );
    for (const { result, args } of [
      expandedWriteFixture,
      newFileWriteFixture,
    ]) {
      const context = {
        state: {},
        isError: false,
        lastComponent: undefined,
        args,
        cwd: process.cwd(),
        expanded: true,
      } as any;
      write.renderResult(
        result,
        { expanded: true, isPartial: false },
        theme,
        context,
      );
      await waitFor(() =>
        write
          .renderResult(
            result,
            { expanded: true, isPartial: false },
            theme,
            context,
          )
          .render(120)
          .some((line: string) => plain(line).includes("more diff lines")),
      );
      const raw = write
        .renderResult(
          result,
          { expanded: true, isPartial: false },
          theme,
          context,
        )
        .render(120)
        .join("\n");
      assertExpandedIndicator(raw, "more diff lines");
    }

    const bash = fakePi.tools.get("bash");
    if (
      typeof bash?.renderCall !== "function" ||
      typeof bash?.renderResult !== "function"
    )
      throw new Error("Bash renderer was not registered");
    const bashContext = {
      state: {},
      isError: false,
      lastComponent: undefined,
      args: { command: "printf fixture" },
      cwd: process.cwd(),
      expanded: false,
      executionStarted: true,
    } as any;
    const bashRaw = bash
      .renderResult(
        {
          content: [
            {
              type: "text",
              text: Array.from(
                { length: 8 },
                (_, index) => `line ${index + 1}`,
              ).join("\n"),
            },
          ],
          details: {},
        },
        { expanded: false, isPartial: true },
        theme,
        bashContext,
      )
      .render(120)
      .join("\n");
    assertCollapsedIndicator(bashRaw, "earlier lines", true);

    const streamingTimerRows = bash
      .renderCall({ command: "echo STREAMING_TIMER_INLINE" }, theme, {
        state: { _toolStatus: "pending", _bashStartedAtMs: Date.now() },
        isError: false,
        lastComponent: undefined,
        args: { command: "echo STREAMING_TIMER_INLINE" },
        argsComplete: true,
        cwd: process.cwd(),
        expanded: false,
        executionStarted: true,
      } as any)
      .render(100)
      .map((line: string) => plain(line));
    const streamingTimerRow = streamingTimerRows.find((line: string) =>
      line.includes("STREAMING_TIMER_INLINE"),
    );
    if (!streamingTimerRow?.includes("echo STREAMING_TIMER_INLINE · <1s")) {
      throw new Error(
        `streaming Bash timer was not placed directly after the command with one leading space: ${JSON.stringify(streamingTimerRows)}`,
      );
    }

    const groupedIndentPrefixes = ["", "  ", "    ", "       ", "\t", " \t  "];
    const cappedOutput = Array.from({ length: 20 }, (_, index) => {
      const indent = groupedIndentPrefixes[index] ?? "";
      return `${indent}result line ${index + 1}`;
    }).join("\n");
    for (const { name, args } of [
      { name: "read", args: { path: "fixture.ts" } },
      { name: "grep", args: { pattern: "result", path: "." } },
      { name: "bash", args: { command: "printf fixture" } },
    ]) {
      const tool = fakePi.tools.get(name);
      if (typeof tool?.renderResult !== "function")
        throw new Error(`${name} renderer was not registered`);
      const raw = tool
        .renderResult(
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
        )
        .render(120)
        .join("\n");
      assertExpandedIndicator(raw, "more lines");
    }

    const edit = fakePi.tools.get("edit");
    if (
      typeof edit?.renderCall !== "function" ||
      typeof edit?.renderResult !== "function"
    )
      throw new Error("Edit renderer was not registered");
    const editArgs = {
      path: "missing-fixture.ts",
      edits: Array.from({ length: 4 }, (_, index) => ({
        oldText: `old ${index}`,
        newText: `new ${index}`,
      })),
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
    await waitFor(() =>
      edit
        .renderCall(editArgs, theme, editContext)
        .render(120)
        .some((line: string) => plain(line).includes("more edit block")),
    );
    const editRaw = edit
      .renderCall(editArgs, theme, editContext)
      .render(120)
      .join("\n");
    assertCollapsedIndicator(editRaw, "more edit block");

    const editErrorComponent = edit.renderResult(
      {
        content: [
          {
            type: "text",
            text: "Could not find the exact text in extensions/index.ts. The old text must match exactly including all whitespace and newlines.",
          },
        ],
      },
      { expanded: false, isPartial: false },
      theme,
      { state: {}, isError: true, lastComponent: undefined },
    );
    const editErrorRows = editErrorComponent
      .render(44)
      .map((line: string) => line.replace(/\x1b\[[0-9;]*m/g, ""));
    const editErrorStart = editErrorRows.findIndex((line: string) =>
      line.startsWith("  Could not find"),
    );
    const editContinuations =
      editErrorStart >= 0 ? editErrorRows.slice(editErrorStart + 1) : [];
    if (editErrorStart < 0 || editContinuations.length === 0) {
      throw new Error(
        `Edit error indentation regression setup did not wrap: ${JSON.stringify(editErrorRows)}`,
      );
    }
    if (editErrorRows.some((line: string) => /^[ ]*[├│└] /.test(line))) {
      throw new Error(
        `Edit error retained a branch connector: ${JSON.stringify(editErrorRows)}`,
      );
    }
    if (editContinuations.some((line: string) => !line.startsWith("  "))) {
      throw new Error(
        `wrapped Edit error lost two-space indentation: ${JSON.stringify(editErrorRows)}`,
      );
    }

    for (const name of ["write", "apply_patch", "web_search", "TaskList"]) {
      const definition = fakePi.tools.get(name);
      const errorRows = definition
        .renderResult(
          {
            content: [{ type: "text", text: "AUDIT failure detail" }],
            details: {},
          },
          { expanded: false, isPartial: false },
          theme,
          {
            state: {},
            args: {},
            argsComplete: true,
            cwd: process.cwd(),
            expanded: false,
            isError: true,
            lastComponent: undefined,
          },
        )
        .render(80)
        .map((line: string) => plain(line));
      const errorRow = errorRows.find((line: string) =>
        line.includes("AUDIT failure detail"),
      );
      if (!errorRow?.startsWith("  ") || /^[ ]*[├│└] /.test(errorRow)) {
        throw new Error(
          `${name} error did not use two-space connector-free indentation: ${JSON.stringify(errorRows)}`,
        );
      }
    }

    const readNoTextRows = fakePi.tools
      .get("read")
      .renderResult(
        { content: [], details: {} },
        { expanded: false, isPartial: false },
        theme,
        {
          state: {},
          args: {},
          expanded: false,
          isError: true,
          lastComponent: undefined,
        },
      )
      .render(80)
      .map((line: string) => plain(line));
    const readNoTextRow = readNoTextRows.find((line: string) =>
      line.includes("No text content"),
    );
    if (!readNoTextRow?.startsWith("  ") || /^[ ]*[├│└] /.test(readNoTextRow)) {
      throw new Error(
        `Read no-text error did not use two-space connector-free indentation: ${JSON.stringify(readNoTextRows)}`,
      );
    }

    await emitLifecycle("agent_start");

    const bashCommandExecution = fullscreenExecution({
      tool: "bash",
      id: "standalone_bash_command_click_fixture",
      args: {
        command:
          "echo STANDALONE_COMMAND_SOURCE\necho STANDALONE_COMMAND_CONTINUATION",
      },
      definition: bash,
      result: {
        content: [
          {
            type: "text",
            text: Array.from(
              { length: 10 },
              (_, index) => `standalone Bash result ${index + 1}`,
            ).join("\n"),
          },
        ],
        isError: false,
      },
    });
    const compactBashCommand = bashCommandExecution.observe(120);
    const bashSummary = compactBashCommand.actions.find(
      (action) =>
        action.origin === "result-summary" &&
        action.text.includes("Done (10 lines)"),
    );
    const bashExpansion = bashSummary
      ? bashCommandExecution.activate(bashSummary)
      : undefined;
    if (!bashExpansion?.accepted) {
      throw new Error(
        `standalone Bash setup did not expand through its result summary: ${JSON.stringify(compactBashCommand.rows)}`,
      );
    }
    const expandedBashCommand = bashExpansion.after;
    const bashCommandRow = expandedBashCommand.rows.findIndex((line: string) =>
      line.includes("echo STANDALONE_COMMAND_SOURCE"),
    );
    const bashCommandStart =
      bashCommandRow < 0
        ? -1
        : expandedBashCommand.rows[bashCommandRow].indexOf(
            "echo STANDALONE_COMMAND_SOURCE",
          );
    const bashCommandEnd =
      bashCommandStart < 0
        ? -1
        : bashCommandStart + "echo STANDALONE_COMMAND_SOURCE".length;
    const bashHeader = expandedBashCommand.actions.find(
      (action) =>
        action.origin === "execution-header" &&
        action.row === bashCommandRow &&
        action.start <= bashCommandStart &&
        action.end >= bashCommandEnd,
    );
    const standaloneBashCollapse = bashHeader
      ? bashCommandExecution.activate(bashHeader)
      : undefined;
    if (
      bashCommandRow < 0 ||
      bashCommandStart < 0 ||
      !standaloneBashCollapse?.accepted ||
      standaloneBashCollapse.after.text.includes(
        "STANDALONE_COMMAND_CONTINUATION",
      )
    ) {
      throw new Error(
        `expanded standalone Bash command text did not bind a collapse action: ${JSON.stringify({ rows: expandedBashCommand.rows, bashCommandRow, bashCommandStart, bashCommandEnd })}`,
      );
    }

    const bashCommandPreviewLines = [
      "for i in 1 2 3; do",
      "  : # BASH_COLLAPSED_CONTINUATION_TARGET",
      "  sleep 0.1",
      "done",
      ": # BASH_COMMAND_VISIBLE_1",
      ": # BASH_COMMAND_VISIBLE_2",
      ": # BASH_COMMAND_VISIBLE_3",
      ": # BASH_COMMAND_HIDDEN_1",
      ": # BASH_COMMAND_HIDDEN_FINAL",
    ];
    const bashCommandWrappedExecution = fullscreenExecution({
      tool: "bash",
      id: "standalone_bash_command_continuation_click_fixture",
      args: { command: bashCommandPreviewLines.join("\n") },
      definition: bash,
      result: {
        content: [{ type: "text", text: "fixture failed" }],
        isError: true,
      },
    });
    const bashCommandWrapped = bashCommandWrappedExecution.observe(40);
    const bashCommandWrappedRow = bashCommandWrapped.rows.findIndex(
      (line: string) => line.includes("BASH_COLLAPSED"),
    );
    const bashCommandWrappedStart =
      bashCommandWrappedRow < 0
        ? -1
        : bashCommandWrapped.rows[bashCommandWrappedRow].indexOf(
            "BASH_COLLAPSED",
          );
    const wrappedHeader = bashCommandWrapped.actions.find(
      (action) =>
        action.origin === "execution-header" &&
        action.row === bashCommandWrappedRow &&
        action.start <= bashCommandWrappedStart &&
        action.end > bashCommandWrappedStart,
    );
    const wrappedExpansion = wrappedHeader
      ? bashCommandWrappedExecution.activate(wrappedHeader)
      : undefined;
    if (
      bashCommandWrappedStart < 0 ||
      !wrappedExpansion?.accepted ||
      !wrappedExpansion.after.text.includes("BASH_COMMAND_HIDDEN_FINAL")
    ) {
      throw new Error(
        `collapsed Bash command continuation row did not bind an expansion action: ${JSON.stringify({ rows: bashCommandWrapped.rows, bashCommandWrappedRow, bashCommandWrappedStart })}`,
      );
    }

    const bashCommandRemainderExecution = fullscreenExecution({
      tool: "bash",
      id: "standalone_bash_command_remainder_click_fixture",
      args: { command: bashCommandPreviewLines.join("\n") },
      definition: bash,
      result: {
        content: [{ type: "text", text: "fixture failed" }],
        isError: true,
      },
    });
    const bashCommandPreview = bashCommandRemainderExecution.observe(120);
    const bashCommandRemainderRow = bashCommandPreview.rows.findIndex(
      (line: string) => line.includes("... 2 more lines"),
    );
    const bashCommandRemainderStart =
      bashCommandRemainderRow < 0
        ? -1
        : bashCommandPreview.rows[bashCommandRemainderRow].indexOf(
            "... 2 more lines",
          );
    const remainderHeader = bashCommandPreview.actions.find(
      (action) =>
        action.origin === "execution-header" &&
        action.row === bashCommandRemainderRow &&
        action.start <= bashCommandRemainderStart &&
        action.end > bashCommandRemainderStart,
    );
    const remainderExpansion = remainderHeader
      ? bashCommandRemainderExecution.activate(remainderHeader)
      : undefined;
    if (
      bashCommandRemainderStart < 0 ||
      bashCommandPreview.rows[bashCommandRemainderRow].includes(
        "click to expand",
      ) ||
      !remainderExpansion?.accepted ||
      !remainderExpansion.after.text.includes("BASH_COMMAND_HIDDEN_FINAL")
    ) {
      throw new Error(
        `collapsed Bash command remainder did not stay terse and clickable: ${JSON.stringify({ rows: bashCommandPreview.rows, bashCommandRemainderRow, bashCommandRemainderStart })}`,
      );
    }

    const readDefinition = fakePi.tools.get("read");
    const skillReadExecution = fullscreenExecution({
      tool: "read",
      id: "standalone_skill_read_click_fixture",
      args: { path: "/tmp/pi-cc-tools-skill-anchor/skills/grilling/SKILL.md" },
      definition: readDefinition,
      result: {
        content: [
          {
            type: "text",
            text: Array.from(
              { length: 6 },
              (_, index) => `skill anchor payload ${index + 1}`,
            ).join("\n"),
          },
        ],
        isError: false,
      },
    });
    const skillRead = skillReadExecution.observe(120);
    const skillHeader = skillRead.actions.find(
      (action) =>
        action.origin === "execution-header" &&
        action.text.includes("[skill] grilling"),
    );
    const skillExpansion = skillHeader
      ? skillReadExecution.activate(skillHeader)
      : undefined;
    if (
      !skillExpansion?.accepted ||
      !skillExpansion.after.text.includes("skill anchor payload 3")
    ) {
      throw new Error(
        `standalone skill header did not expand its Read result: ${JSON.stringify(skillRead.rows)}`,
      );
    }

    {
      const viewportRead = fullscreenExecution({
        tool: "read",
        id: "read_viewport_reveal_fixture",
        args: { path: "viewport.ts" },
        definition: readDefinition,
        result: {
          content: [{ type: "text", text: cappedOutput }],
          isError: false,
        },
        viewport: {
          height: 34,
          scrollTop: 73,
          followingEnd: false,
          prefixRows: 104,
        },
      });
      const collapsedViewportRead = viewportRead.observe(120);
      const expand = collapsedViewportRead.actions.find(
        (action) =>
          action.behavior === "toggle" &&
          action.origin === "result-summary" &&
          action.viewportAnchor === "top",
      );
      const expansion = expand ? viewportRead.activate(expand) : undefined;
      if (!expansion?.accepted) {
        throw new Error(
          "viewport reveal fixture did not activate its summary expansion",
        );
      }
      const viewport = expansion.after.viewport;
      if (!viewport || viewport.visibleSubjectRows < 8) {
        throw new Error(
          `top-anchored expansion left its new detail outside the viewport: ${JSON.stringify(viewport)}`,
        );
      }
    }

    const readExecution = fullscreenExecution({
      tool: "read",
      id: "read_click_fixture",
      args: { path: "fixture.ts" },
      definition: readDefinition,
      result: {
        content: [{ type: "text", text: cappedOutput }],
        isError: false,
      },
      expanded: true,
    });
    let readFrame = readExecution.observe(120);
    const readRows = readFrame.rows;
    if (
      !readFrame.text.includes("result line 8") ||
      readFrame.text.includes("result line 9")
    ) {
      throw new Error(
        `standalone first expansion did not stop at the normal 8-line preview: ${JSON.stringify(readFrame.text)}`,
      );
    }
    const standalonePayloadColumns = Object.fromEntries(
      [1, 3, 5, 6].map((lineNumber) => {
        const token = `result line ${lineNumber}`;
        return [
          lineNumber,
          readRows
            .find((line: string) => line.includes(token))
            ?.indexOf(token) ?? -1,
        ];
      }),
    );
    if (
      standalonePayloadColumns[1] < 0 ||
      standalonePayloadColumns[3] !== standalonePayloadColumns[1] + 4 ||
      standalonePayloadColumns[5] !== standalonePayloadColumns[1] + 4 ||
      standalonePayloadColumns[6] !== standalonePayloadColumns[1] + 6
    ) {
      throw new Error(
        `standalone Read did not preserve four-column tab stops: ${JSON.stringify(standalonePayloadColumns)}`,
      );
    }
    const readSummaryRow = readRows.findIndex((line: string) =>
      line.includes("20 lines loaded"),
    );
    const readSummaryStart =
      readSummaryRow < 0
        ? -1
        : readRows[readSummaryRow].indexOf("20 lines loaded");
    const readSummaryEnd =
      readSummaryRow < 0 ? -1 : readRows[readSummaryRow].trimEnd().length;
    const readSummaryAction = readFrame.actions.find(
      (action) =>
        action.origin === "result-summary" && action.row === readSummaryRow,
    );
    const readPayloadRow = readRows.findIndex((line: string) =>
      line.includes("result line 1"),
    );
    if (
      readSummaryStart < 0 ||
      readSummaryAction?.start !== readSummaryStart ||
      readSummaryAction.end !== readSummaryEnd ||
      readPayloadRow < 0 ||
      readFrame.actions.some((action) => action.row === readPayloadRow)
    ) {
      throw new Error(
        `standalone result summary did not bind only its full semantic row: ${JSON.stringify({ readRows, readSummaryRow, readSummaryStart, readSummaryEnd, readPayloadRow })}`,
      );
    }
    const detailAction = readFrame.actions.find(
      (action) =>
        action.behavior === "next-detail" &&
        action.text.includes("more lines") &&
        action.text.includes("click for more detail"),
    );
    const detailStart = detailAction
      ? readRows[detailAction.row].indexOf("…")
      : -1;
    const detailEnd = detailAction
      ? readRows[detailAction.row].trimEnd().length
      : -1;
    if (
      !detailAction ||
      detailStart < 0 ||
      detailAction.start !== detailStart ||
      detailAction.end !== detailEnd
    ) {
      throw new Error(
        `standalone hidden-content row did not bind one full-row detail anchor: ${JSON.stringify({ readRows, detailAction })}`,
      );
    }
    const standardDetail = readExecution.activate(detailAction);
    if (!standardDetail.accepted)
      throw new Error("standalone standard-detail action did not activate");
    readFrame = standardDetail.after;
    const standardReadRows = readFrame.rows;
    if (
      !readFrame.text.includes("result line 10") ||
      readFrame.text.includes("result line 11")
    ) {
      throw new Error(
        `standalone first detail action did not stop at expandedPreviewMaxLines=10: ${JSON.stringify(readFrame.text)}`,
      );
    }
    const extraDetail = readFrame.actions.find(
      (action) =>
        action.behavior === "next-detail" &&
        action.text.includes("more lines") &&
        action.text.includes("click for more detail"),
    );
    const extraDetailTransition = extraDetail
      ? readExecution.activate(extraDetail)
      : undefined;
    if (!extraDetailTransition?.accepted) {
      throw new Error(
        `standalone standard-detail layer did not preserve its extra-detail gate: ${JSON.stringify(standardReadRows)}`,
      );
    }
    readFrame = extraDetailTransition.after;
    const extraDetailedReadRows = readFrame.rows;
    for (const token of [
      "result line 1",
      "result line 2",
      "result line 3",
      "result line 4",
      "result line 5",
      "result line 6",
    ]) {
      const columns = [readRows, standardReadRows, extraDetailedReadRows].map(
        (rows) =>
          rows.find((line: string) => line.includes(token))?.indexOf(token) ??
          -1,
      );
      if (
        columns.some((column) => column < 0) ||
        !columns.every((column) => column === columns[0])
      ) {
        throw new Error(
          `standalone Read payload indentation changed across L0/L1/L2: ${JSON.stringify({ token, columns })}`,
        );
      }
    }
    if (
      !readFrame.text.includes("result line 15") ||
      readFrame.text.includes("result line 16")
    ) {
      throw new Error(
        `standalone second detail action did not stop at extraExpandedPreviewMaxLines=15: ${JSON.stringify(readFrame.text)}`,
      );
    }
    const finalReadSummary = extraDetailedReadRows.find((line: string) =>
      line.includes("20 lines loaded"),
    );
    const finalReadPayload = extraDetailedReadRows.find((line: string) =>
      line.includes("result line 1"),
    );
    const finalCollapse = readFrame.actions.find(
      (action) =>
        action.behavior === "toggle" &&
        action.origin === "result-summary" &&
        action.viewportAnchor === "bottom" &&
        action.text.includes("click to collapse"),
    );
    const finalCollapseEnd = finalCollapse
      ? extraDetailedReadRows[finalCollapse.row].trimEnd().length
      : -1;
    if (
      !finalReadSummary?.trimStart().startsWith("├") ||
      !finalReadPayload?.trimStart().startsWith("│") ||
      !finalCollapse ||
      !extraDetailedReadRows[finalCollapse.row].trimStart().startsWith("└") ||
      finalCollapse.end !== finalCollapseEnd
    ) {
      throw new Error(
        `standalone final detail layer did not end with a full-row branched collapse action: ${JSON.stringify(extraDetailedReadRows)}`,
      );
    }
    const finalReadCollapse = readExecution.activate(finalCollapse);
    if (
      !finalReadCollapse.accepted ||
      finalReadCollapse.after.text.includes("result line 1")
    ) {
      throw new Error(
        "standalone final collapse action did not collapse the execution",
      );
    }

    const newlineOwnedBashOutput = [
      "",
      "BASH_NEWLINE_ROOT",
      "  BASH_NEWLINE_CHILD",
      "",
      "\t",
      " \t  BASH_NEWLINE_MIXED",
      ...Array.from(
        { length: 6 },
        (_, index) => `BASH_NEWLINE_FILLER_${index + 1}`,
      ),
      "BASH_NEWLINE_END",
      "",
      "",
    ].join("\n");
    const newlineOwnedBash = fullscreenExecution({
      tool: "bash",
      id: "bash_newline_fixture",
      args: { command: "printf fixture" },
      definition: bash,
      result: {
        content: [{ type: "text", text: newlineOwnedBashOutput }],
        isError: false,
      },
      expanded: true,
    });
    const assertBashOwnedPrefix = (rows: string[], layer: string): void => {
      const summary = rows.findIndex((line) =>
        line.includes("Done (15 lines)"),
      );
      const root = rows.findIndex((line) => line.includes("BASH_NEWLINE_ROOT"));
      const child = rows.findIndex((line) =>
        line.includes("BASH_NEWLINE_CHILD"),
      );
      const mixed = rows.findIndex((line) =>
        line.includes("BASH_NEWLINE_MIXED"),
      );
      if (
        summary < 0 ||
        root !== summary + 2 ||
        child !== root + 1 ||
        mixed !== child + 3
      ) {
        throw new Error(
          `standalone Bash did not preserve output-owned prefix newlines at ${layer}: ${JSON.stringify(rows)}`,
        );
      }
    };
    const bashLevel0 = newlineOwnedBash.observe(120);
    assertBashOwnedPrefix(bashLevel0.rows, "L0");
    const bashLevel1Action = bashLevel0.actions.find(
      (action) => action.behavior === "next-detail",
    );
    const bashLevel1 = bashLevel1Action
      ? newlineOwnedBash.activate(bashLevel1Action)
      : undefined;
    if (!bashLevel1?.accepted)
      throw new Error("standalone Bash did not enter L1");
    assertBashOwnedPrefix(bashLevel1.after.rows, "L1");
    const bashLevel2Action = bashLevel1.after.actions.find(
      (action) => action.behavior === "next-detail",
    );
    const bashLevel2 = bashLevel2Action
      ? newlineOwnedBash.activate(bashLevel2Action)
      : undefined;
    if (!bashLevel2?.accepted)
      throw new Error("standalone Bash did not enter L2");
    const bashLevel2Rows = bashLevel2.after.rows;
    assertBashOwnedPrefix(bashLevel2Rows, "L2");
    const bashEnd = bashLevel2Rows.findIndex((line: string) =>
      line.includes("BASH_NEWLINE_END"),
    );
    const bashCollapse = bashLevel2Rows.findIndex((line: string) =>
      line.includes("click to collapse"),
    );
    if (bashEnd < 0 || bashCollapse !== bashEnd + 3) {
      throw new Error(
        `standalone Bash did not preserve trailing output-owned newlines at L2: ${JSON.stringify(bashLevel2Rows)}`,
      );
    }

    const newlineOwnedReadOutput = newlineOwnedBashOutput.replaceAll(
      "BASH_NEWLINE",
      "READ_NEWLINE",
    );
    const readOutputFixture = (
      id: string,
      path: string,
      text = newlineOwnedReadOutput,
      expanded = true,
    ) => ({
      tool: "read",
      id,
      args: { path },
      definition: readDefinition,
      interaction: "fullscreen" as const,
      result: { content: [{ type: "text", text }], isError: false },
      expanded,
    });
    const assertReadOutputShape = (
      execution: ObservedRenderer,
      label: string,
    ): void => {
      let levelZero = execution.observe(120);
      if (
        !levelZero.actions.some((action) => action.behavior === "next-detail")
      ) {
        const header = levelZero.actions.find(
          (action) => action.origin === "execution-header",
        );
        const expansion = header ? execution.activate(header) : undefined;
        if (!expansion?.accepted) throw new Error(`${label} did not enter L0`);
        levelZero = expansion.after;
      }
      const levelOneAction = levelZero.actions.find(
        (action) => action.behavior === "next-detail",
      );
      const levelOne = levelOneAction
        ? execution.activate(levelOneAction)
        : undefined;
      if (!levelOne?.accepted) throw new Error(`${label} did not enter L1`);
      const levelTwoAction = levelOne.after.actions.find(
        (action) => action.behavior === "next-detail",
      );
      const levelTwo = levelTwoAction
        ? execution.activate(levelTwoAction)
        : undefined;
      if (!levelTwo?.accepted) throw new Error(`${label} did not enter L2`);
      const layers = [levelZero.rows, levelOne.after.rows, levelTwo.after.rows];
      layers.forEach((rows, index) => {
        const summary = rows.findIndex((line) =>
          line.includes("15 lines loaded"),
        );
        const root = rows.findIndex((line) =>
          line.includes("READ_NEWLINE_ROOT"),
        );
        const child = rows.findIndex((line) =>
          line.includes("READ_NEWLINE_CHILD"),
        );
        const mixed = rows.findIndex((line) =>
          line.includes("READ_NEWLINE_MIXED"),
        );
        if (
          summary < 0 ||
          root !== summary + 2 ||
          child !== root + 1 ||
          mixed !== child + 3
        ) {
          throw new Error(
            `${label} did not preserve output-owned prefix empty lines at L${index}: ${JSON.stringify(rows)}`,
          );
        }
      });
      for (const token of [
        "READ_NEWLINE_ROOT",
        "READ_NEWLINE_CHILD",
        "READ_NEWLINE_MIXED",
      ]) {
        const columns = layers.map(
          (rows) =>
            rows.find((line) => line.includes(token))?.indexOf(token) ?? -1,
        );
        if (
          columns.some((column) => column < 0) ||
          !columns.every((column) => column === columns[0])
        ) {
          throw new Error(
            `${label} did not preserve output indentation across L0/L1/L2: ${JSON.stringify({ token, columns })}`,
          );
        }
      }
      const finalRows = layers[2];
      const end = finalRows.findIndex((line) =>
        line.includes("READ_NEWLINE_END"),
      );
      const collapse = finalRows.findIndex((line) =>
        line.includes("click to collapse"),
      );
      if (end < 0 || collapse !== end + 3) {
        throw new Error(
          `${label} did not preserve trailing output-owned empty lines at L2: ${JSON.stringify(finalRows)}`,
        );
      }
    };
    for (const fixture of [
      { label: "standalone Read", path: "read-output-shape.txt" },
      {
        label: "standalone [skill]",
        path: "/tmp/read-output-shape/skills/shape/SKILL.md",
      },
    ]) {
      const execution = fullscreenExecution(
        readOutputFixture(`newline_${fixture.label}`, fixture.path),
      );
      assertReadOutputShape(execution, fixture.label);
    }
    for (const fixture of [
      { label: "grouped Read", path: "grouped-read-output-shape.txt" },
      {
        label: "grouped [skill]",
        path: "/tmp/grouped-output-shape/skills/shape/SKILL.md",
      },
    ]) {
      const group = toolGroup([
        readOutputFixture(
          `newline_${fixture.label}`,
          fixture.path,
          newlineOwnedReadOutput,
          false,
        ),
        readOutputFixture(
          `newline_${fixture.label}_peer`,
          "grouped-output-shape-peer.txt",
          "GROUPED_OUTPUT_SHAPE_PEER",
          false,
        ),
      ]);
      assertReadOutputShape(group, fixture.label);
    }

    const readOffsetNotice =
      "[23 more lines in file. Use offset=11 to continue.]";
    const tenLineOutput = [
      ...Array.from({ length: 9 }, (_, index) => `level-one line ${index + 1}`),
      readOffsetNotice,
    ].join("\n");
    const effectiveFinalRead = fullscreenExecution({
      tool: "read",
      id: "read_effective_final_fixture",
      args: { path: "level-one.ts" },
      definition: readDefinition,
      result: {
        content: [{ type: "text", text: tenLineOutput }],
        isError: false,
      },
      expanded: true,
    });
    const normalEffectiveFinal = effectiveFinalRead.observe(120);
    const normalEffectiveFinalRows = normalEffectiveFinal.rows;
    if (
      normalEffectiveFinalRows.some((line: string) =>
        line.includes("click to collapse"),
      )
    ) {
      throw new Error(
        `content-exhausted normal preview added a dedicated collapse row: ${JSON.stringify(normalEffectiveFinalRows)}`,
      );
    }
    const effectiveFinalDetail = normalEffectiveFinal.actions.find(
      (action) => action.behavior === "next-detail",
    );
    const effectiveFinalExpansion = effectiveFinalDetail
      ? effectiveFinalRead.activate(effectiveFinalDetail)
      : undefined;
    if (!effectiveFinalExpansion?.accepted) {
      throw new Error(
        "effective-final Read did not enter its first detail layer",
      );
    }
    const levelOneEffectiveFinal = effectiveFinalExpansion.after;
    const levelOneEffectiveFinalRows = levelOneEffectiveFinal.rows;
    const levelOneCollapse = levelOneEffectiveFinal.actions.find(
      (action) =>
        action.behavior === "toggle" &&
        action.origin === "result-summary" &&
        action.text.includes("click to collapse"),
    );
    const readOffsetNoticeRow = levelOneEffectiveFinalRows.findIndex(
      (line: string) => line.includes(readOffsetNotice),
    );
    if (
      readOffsetNoticeRow < 0 ||
      levelOneEffectiveFinal.actions.some(
        (action) => action.row === readOffsetNoticeRow,
      ) ||
      !levelOneCollapse ||
      levelOneEffectiveFinalRows.some((line: string) =>
        line.includes("click for more detail"),
      )
    ) {
      throw new Error(
        `first detail layer that revealed all returned content was not final: ${JSON.stringify(levelOneEffectiveFinalRows)}`,
      );
    }

    const readGroup = toolGroup([
      {
        tool: "read",
        id: "read_click_fixture_grouped",
        args: { path: "fixture.ts" },
        definition: readDefinition,
        interaction: "fullscreen",
        result: {
          content: [{ type: "text", text: cappedOutput }],
          isError: false,
        },
      },
      {
        tool: "read",
        id: "read_click_fixture_2",
        args: { path: "peer.ts" },
        definition: readDefinition,
        interaction: "fullscreen",
        result: {
          content: [{ type: "text", text: cappedOutput }],
          isError: false,
        },
      },
    ]);
    const collapsedReadGroup = readGroup.observe(120);
    const groupedHeader = collapsedReadGroup.actions.find(
      (action) =>
        action.origin === "execution-header" &&
        action.text.includes("fixture.ts"),
    );
    const groupedExpansion = groupedHeader
      ? readGroup.activate(groupedHeader)
      : undefined;
    if (!groupedExpansion?.accepted)
      throw new Error(
        "grouped Read header did not expand its selected execution",
      );
    let readGroupFrame = groupedExpansion.after;
    const expandedReadGroupRows = readGroupFrame.rows;
    const expandedReadChildEnd = expandedReadGroupRows.findIndex(
      (line: string) => line.includes("peer.ts"),
    );
    const expandedReadChildRows = expandedReadGroupRows.slice(
      0,
      expandedReadChildEnd < 0 ? undefined : expandedReadChildEnd,
    );
    if (
      expandedReadChildRows.some((line: string) =>
        line.includes("Read fixture.ts"),
      ) ||
      expandedReadChildRows.some((line: string) => line.includes("────────"))
    ) {
      throw new Error(
        `grouped Read embedded standalone component chrome: ${JSON.stringify(expandedReadGroupRows)}`,
      );
    }
    const groupedDetail = readGroupFrame.actions.find(
      (action) => action.behavior === "next-detail",
    );
    const groupedStandardDetail = groupedDetail
      ? readGroup.activate(groupedDetail)
      : undefined;
    if (!groupedStandardDetail?.accepted) {
      throw new Error(
        `expanded tool group did not bind its standard-detail row: ${JSON.stringify(expandedReadGroupRows)}`,
      );
    }
    readGroupFrame = groupedStandardDetail.after;
    const standardReadGroupRows = readGroupFrame.rows;
    if (
      !readGroupFrame.text.includes("result line 10") ||
      readGroupFrame.text.includes("result line 11")
    ) {
      throw new Error(
        `grouped first detail action did not stop at expandedPreviewMaxLines=10: ${JSON.stringify(readGroupFrame.text)}`,
      );
    }
    const groupedExtraDetail = readGroupFrame.actions.find(
      (action) => action.behavior === "next-detail",
    );
    const groupedExtraDetailTransition = groupedExtraDetail
      ? readGroup.activate(groupedExtraDetail)
      : undefined;
    if (!groupedExtraDetailTransition?.accepted) {
      throw new Error(
        `grouped standard-detail layer did not preserve its extra-detail gate: ${JSON.stringify(standardReadGroupRows)}`,
      );
    }
    readGroupFrame = groupedExtraDetailTransition.after;
    const extraDetailedReadGroupRows = readGroupFrame.rows;
    for (const token of [
      "result line 1",
      "result line 2",
      "result line 3",
      "result line 4",
      "result line 5",
      "result line 6",
    ]) {
      const columns = [
        expandedReadGroupRows,
        standardReadGroupRows,
        extraDetailedReadGroupRows,
      ].map(
        (rows) =>
          rows.find((line: string) => line.includes(token))?.indexOf(token) ??
          -1,
      );
      if (
        columns.some((column) => column < 0) ||
        !columns.every((column) => column === columns[0])
      ) {
        throw new Error(
          `grouped Read payload indentation changed across L0/L1/L2: ${JSON.stringify({ token, columns })}`,
        );
      }
    }
    if (
      !readGroupFrame.text.includes("result line 15") ||
      readGroupFrame.text.includes("result line 16")
    ) {
      throw new Error(
        `grouped second detail action did not stop at extraExpandedPreviewMaxLines=15: ${JSON.stringify(readGroupFrame.text)}`,
      );
    }
    const groupedCollapse = readGroupFrame.actions.find(
      (action) =>
        action.behavior === "toggle" &&
        action.origin === "result-summary" &&
        action.viewportAnchor === "bottom" &&
        action.text.includes("click to collapse"),
    );
    const groupedCollapseTransition = groupedCollapse
      ? readGroup.activate(groupedCollapse)
      : undefined;
    if (!groupedCollapseTransition?.accepted) {
      throw new Error(
        `grouped final detail layer did not expose a clickable collapse row: ${JSON.stringify(extraDetailedReadGroupRows)}`,
      );
    }

    const progressiveAnchorCases = [
      {
        name: "bash",
        args: { command: "printf fixture" },
        lines: Array.from({ length: 20 }, (_, i) => `bash line ${i + 1}`),
      },
      {
        name: "grep",
        args: { pattern: "fixture", path: "." },
        lines: Array.from({ length: 20 }, (_, i) => `file.ts:${i + 1}:fixture`),
      },
      {
        name: "find",
        args: { pattern: "*.ts", path: "." },
        lines: Array.from({ length: 20 }, (_, i) => `file-${i + 1}.ts`),
      },
      {
        name: "ls",
        args: { path: "." },
        lines: Array.from({ length: 20 }, (_, i) => `entry-${i + 1}.ts`),
      },
      {
        name: "TaskList",
        args: {},
        lines: Array.from(
          { length: 20 },
          (_, i) => `#${i + 1} [pending] Task ${i + 1}`,
        ),
      },
    ];
    for (const fixture of progressiveAnchorCases) {
      const execution = fullscreenExecution({
        tool: fixture.name,
        id: `${fixture.name}_anchor_matrix`,
        args: fixture.args,
        result: {
          content: [{ type: "text", text: fixture.lines.join("\n") }],
          isError: false,
        },
      });
      const collapsed = execution.observe(120);
      const expand = collapsed.actions.find(
        (action) =>
          action.behavior === "toggle" &&
          action.origin === "result-summary" &&
          action.viewportAnchor === "top",
      );
      const expansion = expand ? execution.activate(expand) : undefined;
      if (!expansion?.accepted)
        throw new Error(`${fixture.name} summary anchor did not expand`);

      let frame = expansion.after;
      const levelZeroSummary = frame.actions.find(
        (action) => action.origin === "result-summary",
      );
      const levelZeroDetail = frame.actions.find(
        (action) => action.behavior === "next-detail",
      );
      if (
        !levelZeroSummary ||
        !levelZeroDetail ||
        levelZeroDetail.row <= levelZeroSummary.row ||
        !frame.rows[levelZeroSummary.row].trimStart().startsWith("├") ||
        !frame.rows[levelZeroDetail.row].trimStart().startsWith("└") ||
        frame.rows
          .slice(levelZeroSummary.row + 1, levelZeroDetail.row)
          .some((line: string) => !line.trimStart().startsWith("│"))
      ) {
        throw new Error(
          `${fixture.name} L0 preview did not branch from its summary through its detail action: ${JSON.stringify(frame.rows)}`,
        );
      }
      for (const [level, visibleIndex, hiddenIndex] of [
        [1, 9, 10],
        [2, 14, 15],
      ] as const) {
        const detail = frame.actions.find(
          (action) =>
            action.behavior === "next-detail" &&
            action.viewportAnchor === "top",
        );
        const transition = detail ? execution.activate(detail) : undefined;
        const visibleNeedle = fixture.lines[visibleIndex].replace(
          "[pending]",
          "pending",
        );
        const hiddenNeedle = fixture.lines[hiddenIndex].replace(
          "[pending]",
          "pending",
        );
        if (
          !transition?.accepted ||
          !transition.after.text.includes(visibleNeedle) ||
          transition.after.text.includes(hiddenNeedle)
        ) {
          throw new Error(
            `${fixture.name} detail anchor did not expose level ${level}: ${JSON.stringify(transition?.after.rows)}`,
          );
        }
        frame = transition.after;
      }
      const collapse = frame.actions.find(
        (action) =>
          action.behavior === "toggle" &&
          action.origin === "result-summary" &&
          action.viewportAnchor === "bottom",
      );
      const collapsedAgain = collapse
        ? execution.activate(collapse)
        : undefined;
      const firstVisibleNeedle = fixture.lines[0].replace(
        "[pending]",
        "pending",
      );
      if (
        !collapsedAgain?.accepted ||
        collapsedAgain.after.text.includes(firstVisibleNeedle)
      ) {
        throw new Error(`${fixture.name} final bottom anchor did not collapse`);
      }
      const header = collapsedAgain.after.actions.find(
        (action) =>
          action.behavior === "toggle" && action.origin === "execution-header",
      );
      const headerExpanded = header ? execution.activate(header) : undefined;
      if (
        !headerExpanded?.accepted ||
        !headerExpanded.after.text.includes(firstVisibleNeedle)
      ) {
        throw new Error(`${fixture.name} header anchor did not re-expand`);
      }
      const expandedHeader = headerExpanded.after.actions.find(
        (action) =>
          action.behavior === "toggle" && action.origin === "execution-header",
      );
      const headerCollapsed = expandedHeader
        ? execution.activate(expandedHeader)
        : undefined;
      if (
        !headerCollapsed?.accepted ||
        headerCollapsed.after.text.includes(firstVisibleNeedle)
      ) {
        throw new Error(`${fixture.name} header anchor did not collapse`);
      }
    }

    const openAiExecution = fullscreenExecution({
      tool: "web_search",
      id: "web_search_anchor_matrix",
      args: { query: "fixture" },
      result: {
        content: [
          {
            type: "text",
            text: Array.from(
              { length: 20 },
              (_, i) => `search result ${i + 1}`,
            ).join("\n"),
          },
        ],
        isError: false,
      },
    });
    const openAiCollapsed = openAiExecution.observe(120);
    const openAiExpand = openAiCollapsed.actions.find(
      (action) =>
        action.behavior === "toggle" &&
        action.origin === "result-summary" &&
        action.viewportAnchor === "top",
    );
    const openAiExpansion = openAiExpand
      ? openAiExecution.activate(openAiExpand)
      : undefined;
    if (!openAiExpansion?.accepted)
      throw new Error("OpenAI-style summary anchor did not expand");
    let openAiFrame = openAiExpansion.after;
    if (
      !openAiFrame.actions.some(
        (action) =>
          action.origin === "result-summary" && action.viewportAnchor === "top",
      ) ||
      !openAiFrame.actions.some(
        (action) => action.behavior === "toggle-max-detail",
      )
    ) {
      throw new Error(
        "OpenAI-style capped output lacked inline collapse or extra-detail anchors",
      );
    }
    if (
      openAiFrame.actions.some(
        (action) =>
          action.origin === "result-summary" &&
          action.viewportAnchor === "bottom",
      )
    ) {
      throw new Error(
        "OpenAI-style non-progressive output exposed an invalid bottom anchor",
      );
    }
    const maximumDetail = openAiFrame.actions.find(
      (action) => action.behavior === "toggle-max-detail",
    );
    const maximumDetailTransition = maximumDetail
      ? openAiExecution.activate(maximumDetail)
      : undefined;
    if (
      !maximumDetailTransition?.accepted ||
      !maximumDetailTransition.after.text.includes("search result 15") ||
      maximumDetailTransition.after.text.includes("search result 16")
    ) {
      throw new Error(
        "OpenAI-style extra-detail anchor did not activate maximum detail",
      );
    }
    openAiFrame = maximumDetailTransition.after;
    const normalDetail = openAiFrame.actions.find(
      (action) => action.behavior === "toggle-max-detail",
    );
    const normalDetailTransition = normalDetail
      ? openAiExecution.activate(normalDetail)
      : undefined;
    if (
      !normalDetailTransition?.accepted ||
      !normalDetailTransition.after.text.includes("search result 10") ||
      normalDetailTransition.after.text.includes("search result 11")
    ) {
      throw new Error(
        "OpenAI-style less-detail anchor did not return to normal detail",
      );
    }
    openAiFrame = normalDetailTransition.after;
    const openAiCollapse = openAiFrame.actions.find(
      (action) => action.origin === "result-summary",
    );
    const openAiCollapsedAgain = openAiCollapse
      ? openAiExecution.activate(openAiCollapse)
      : undefined;
    if (
      !openAiCollapsedAgain?.accepted ||
      openAiCollapsedAgain.after.text.includes("search result 1")
    ) {
      throw new Error("OpenAI-style inline collapse anchor did not collapse");
    }
    const openAiHeader = openAiCollapsedAgain.after.actions.find(
      (action) => action.origin === "execution-header",
    );
    const openAiHeaderExpansion = openAiHeader
      ? openAiExecution.activate(openAiHeader)
      : undefined;
    if (
      !openAiHeaderExpansion?.accepted ||
      !openAiHeaderExpansion.after.text.includes("search result 1")
    ) {
      throw new Error("OpenAI-style header anchor did not expand");
    }

    for (const terminal of [
      {
        name: "read",
        id: "read_image_anchor_matrix",
        args: { path: "fixture.png" },
        result: {
          content: [{ type: "image", data: "", mimeType: "image/png" }],
          isError: false,
        },
      },
      {
        name: "web_search",
        id: "web_search_error_anchor_matrix",
        args: { query: "fixture" },
        result: {
          content: [{ type: "text", text: "search failed\nrequest rejected" }],
          isError: true,
        },
      },
    ]) {
      const execution = fullscreenExecution({
        tool: terminal.name,
        id: terminal.id,
        args: terminal.args,
        result: terminal.result,
      });
      const collapsed = execution.observe(120);
      const expand = collapsed.actions.find(
        (action) =>
          action.behavior === "toggle" &&
          action.origin === "result-summary" &&
          action.viewportAnchor === "top",
      );
      const expansion = expand ? execution.activate(expand) : undefined;
      if (!expansion?.accepted)
        throw new Error(
          `${terminal.id} collapsed expansion anchor did not activate`,
        );
      const expandedActions = expansion.after.actions;
      if (
        expandedActions.some(
          (action) =>
            action.behavior === "next-detail" ||
            action.behavior === "toggle-max-detail" ||
            action.viewportAnchor === "bottom",
        )
      ) {
        throw new Error(
          `${terminal.id} terminal expansion exposed an invalid detail or bottom anchor`,
        );
      }
      const header = expandedActions.find(
        (action) => action.origin === "execution-header",
      );
      const collapse = header ? execution.activate(header) : undefined;
      if (
        !collapse?.accepted ||
        collapse.after.actions.some(
          (action) => action.origin === "result-detail",
        )
      ) {
        throw new Error(
          `${terminal.id} header anchor did not collapse the terminal expansion`,
        );
      }
    }

    writePiSettings({
      clickExpansion: true,
      expandedPreviewMaxLines: 200,
      extraExpandedPreviewMaxLines: 240,
    });
    await new Promise((resolve) => setTimeout(resolve, 5100));
    const writeExecution = fullscreenExecution({
      tool: "write",
      id: "write_click_fixture",
      args: expandedWriteFixture.args,
      definition: write,
      result: { ...expandedWriteFixture.result, isError: false },
      expanded: true,
    });
    const normalWrite = await writeExecution.waitFor(
      (frame) =>
        frame.text.includes("expanded context line 109") &&
        frame.text.includes("more diff lines") &&
        !frame.text.includes("expanded context line 110"),
      {
        width: 120,
        description: "expanded Write diff at its normal 150-line render cap",
      },
    );
    const writeDetail = normalWrite.actions.find(
      (action) =>
        action.behavior === "next-detail" &&
        action.text.includes("more diff lines"),
    );
    const writeStandardDetail = writeDetail
      ? writeExecution.activate(writeDetail)
      : undefined;
    if (!writeStandardDetail?.accepted) {
      throw new Error(
        `expanded Write diff did not bind its standard-detail row: ${JSON.stringify(normalWrite.rows)}`,
      );
    }
    const standardWrite = await writeExecution.waitFor(
      (frame) =>
        frame.text.includes("expanded context line 159") &&
        frame.text.includes("more diff lines") &&
        !frame.text.includes("expanded context line 160"),
      {
        width: 120,
        description:
          "standard-detail Write diff at its configured 200-line render cap",
      },
    );
    if (
      !/\x1b\[38;2;\d+;\d+;\d+mconst/.test(standardWrite.rawRows.join("\n"))
    ) {
      throw new Error(
        "standard-detail Write diff lost syntax highlighting above 150 rendered lines",
      );
    }
    const writeExtraDetail = standardWrite.actions.find(
      (action) =>
        action.behavior === "next-detail" &&
        action.text.includes("more diff lines"),
    );
    const writeExtraDetailText = writeExtraDetail
      ? standardWrite.rows[writeExtraDetail.row]
      : "";
    if (!/^\s*└ …/.test(writeExtraDetailText)) {
      throw new Error(
        `standard-detail Write diff did not use one space after its branch indicator: ${JSON.stringify(writeExtraDetailText)}`,
      );
    }

    const effectiveFinalWriteFixture = await executeWriteFixture(
      "write_effective_final_fixture",
      "write-effective-final-fixture.ts",
      Array.from(
        { length: 30 },
        (_, index) => `old effective line ${index + 1}`,
      ).join("\n"),
      Array.from(
        { length: 150 },
        (_, index) => `effective final line ${index + 1}`,
      ).join("\n"),
    );
    const effectiveFinalWrite = fullscreenExecution({
      tool: "write",
      id: "write_effective_final_fixture",
      args: effectiveFinalWriteFixture.args,
      definition: write,
      result: { ...effectiveFinalWriteFixture.result, isError: false },
      expanded: true,
    });
    const normalEffectiveFinalWrite = await effectiveFinalWrite.waitFor(
      (frame) =>
        frame.text.includes("effective final line 120") &&
        frame.text.includes("more diff lines") &&
        !frame.text.includes("effective final line 121"),
      { width: 120, description: "effective-final Write normal detail layer" },
    );
    const effectiveFinalWriteDetail = normalEffectiveFinalWrite.actions.find(
      (action) =>
        action.behavior === "next-detail" &&
        action.text.includes("more diff lines"),
    );
    const effectiveFinalWriteExpansion = effectiveFinalWriteDetail
      ? effectiveFinalWrite.activate(effectiveFinalWriteDetail)
      : undefined;
    if (!effectiveFinalWriteExpansion?.accepted) {
      throw new Error("effective-final Write did not enter level 1");
    }
    const settledEffectiveFinalWrite = await effectiveFinalWrite.waitFor(
      (frame) =>
        frame.text.includes("effective final line 150") &&
        frame.text.includes("click to collapse") &&
        !frame.text.includes("rendering diff"),
      { width: 120, description: "effective-final Write level-1 collapse row" },
    );
    if (
      settledEffectiveFinalWrite.text.includes("more diff lines") ||
      settledEffectiveFinalWrite.text.includes("click for more detail") ||
      !settledEffectiveFinalWrite.text.includes("click to collapse")
    ) {
      throw new Error(
        `Write level 1 that revealed all returned diff content was not final: ${JSON.stringify(settledEffectiveFinalWrite.rows)}`,
      );
    }

    const writeExtraDetailTransition = writeExtraDetail
      ? writeExecution.activate(writeExtraDetail)
      : undefined;
    if (!writeExtraDetailTransition?.accepted) {
      throw new Error(
        `standard-detail Write diff did not preserve its extra-detail row: ${JSON.stringify(standardWrite.rows)}`,
      );
    }
    await writeExecution.waitFor(
      (frame) =>
        frame.text.includes("expanded context line 199") &&
        frame.text.includes("more diff lines") &&
        !frame.text.includes("expanded context line 200"),
      {
        width: 120,
        description:
          "extra-detail Write diff at its configured 240-line render cap",
      },
    );

    {
      const pairedWriteFixture = await executeWriteFixture(
        "write_normal_split_final_fixture",
        "write-paired-final-fixture.ts",
        Array.from(
          { length: 100 },
          (_, index) => `old paired line ${index + 1}`,
        ).join("\n"),
        Array.from(
          { length: 100 },
          (_, index) => `new paired line ${index + 1}`,
        ).join("\n"),
      );
      const pairedWriteExecution = fullscreenExecution({
        tool: "write",
        id: "write_normal_split_final_fixture",
        args: pairedWriteFixture.args,
        definition: write,
        result: { ...pairedWriteFixture.result, isError: false },
      });
      const collapsedPairedWrite = await pairedWriteExecution.waitFor(
        (frame) => frame.text.includes("more diff lines"),
        { width: 180, description: "collapsed paired Write split diff" },
      );
      const pairedWriteSummary = collapsedPairedWrite.actions.find(
        (action) =>
          action.behavior === "toggle" &&
          action.origin === "result-summary" &&
          action.text.includes("+100") &&
          action.text.includes("-100"),
      );
      const pairedWriteExpansion = pairedWriteSummary
        ? pairedWriteExecution.activate(pairedWriteSummary)
        : undefined;
      if (!pairedWriteExpansion?.accepted) {
        throw new Error(
          `paired Write summary was not clickable: ${JSON.stringify(collapsedPairedWrite.rows)}`,
        );
      }
      const immediatePairedWriteRows = pairedWriteExpansion.after.rows;
      if (
        immediatePairedWriteRows.some((line: string) =>
          line.includes("rendering diff"),
        ) ||
        !immediatePairedWriteRows.some((line: string) =>
          line.includes("old paired line 1"),
        )
      ) {
        throw new Error(
          `paired Write replaced its stable preview during async expansion: ${JSON.stringify(immediatePairedWriteRows)}`,
        );
      }
      const collapseText = "Output ends here • click to collapse";
      const expandedPairedWrite = await pairedWriteExecution.waitFor(
        (frame) => frame.text.includes(collapseText),
        {
          width: 180,
          description: "normal expanded paired Write bottom collapse anchor",
        },
      );
      if (expandedPairedWrite.text.includes("more diff lines")) {
        throw new Error(
          `fully rendered paired Write retained a hidden-diff row: ${JSON.stringify(expandedPairedWrite.rows)}`,
        );
      }
    }

    {
      const newFileContent = Array.from(
        { length: 100 },
        (_, index) => `new file line ${index + 1}`,
      ).join("\n");
      const normalNewFileFixture = await executeWriteFixture(
        "write_normal_new_file_final_fixture",
        "write-new-final-fixture.ts",
        null,
        newFileContent,
      );
      const newFileWriteExecution = fullscreenExecution({
        tool: "write",
        id: "write_normal_new_file_final_fixture",
        args: normalNewFileFixture.args,
        definition: write,
        result: { ...normalNewFileFixture.result, isError: false },
      });
      const collapsedNewFile = await newFileWriteExecution.waitFor(
        (frame) => frame.text.includes("more diff lines"),
        { width: 120, description: "collapsed new-file Write diff" },
      );
      const newFileSummary = collapsedNewFile.actions.find(
        (action) =>
          action.origin === "result-summary" &&
          action.text.includes("+100") &&
          action.text.includes("new file"),
      );
      const newFileExpansion = newFileSummary
        ? newFileWriteExecution.activate(newFileSummary)
        : undefined;
      if (!newFileExpansion?.accepted) {
        throw new Error(
          `new-file Write summary was not clickable: ${JSON.stringify(collapsedNewFile.rows)}`,
        );
      }
      const immediateNewFileRows = newFileExpansion.after.rows;
      if (
        immediateNewFileRows.some((line: string) =>
          line.includes("rendering diff"),
        ) ||
        !immediateNewFileRows.some((line: string) =>
          line.includes("new file line 1"),
        )
      ) {
        throw new Error(
          `new-file Write replaced its stable preview during async expansion: ${JSON.stringify(immediateNewFileRows)}`,
        );
      }
      const collapseText = "Output ends here • click to collapse";
      const expandedNewFile = await newFileWriteExecution.waitFor(
        (frame) => frame.text.includes(collapseText),
        {
          width: 120,
          description: "normal expanded new-file Write bottom collapse anchor",
        },
      );
      if (expandedNewFile.text.includes("more diff lines")) {
        throw new Error(
          `fully rendered new-file Write retained a hidden-diff row: ${JSON.stringify(expandedNewFile.rows)}`,
        );
      }
    }

    {
      const shortWriteFixture = await executeWriteFixture(
        "write_short_fully_visible_fixture",
        "write-short-fixture.ts",
        "const value = 1;",
        "const value = 2;",
      );
      const shortWriteFixtureInput = {
        tool: "write",
        id: "write_short_fully_visible_fixture",
        args: shortWriteFixture.args,
        definition: write,
        result: { ...shortWriteFixture.result, isError: false },
      };
      const shortWriteExecution = fullscreenExecution(shortWriteFixtureInput);
      const shortWrite = await shortWriteExecution.waitFor(
        (frame) => frame.text.includes("+1") && frame.text.includes("-1"),
        { width: 120, description: "fully visible short Write preview" },
      );
      const shortWriteSummaryRow = shortWrite.rows.findIndex(
        (line: string) => line.includes("+1") && line.includes("-1"),
      );
      const shortWriteSummaryActions = shortWrite.actions.filter(
        (action) => action.row === shortWriteSummaryRow,
      );
      if (shortWriteSummaryRow < 0 || shortWriteSummaryActions.length > 0) {
        throw new Error(
          `fully visible short Write exposed a no-op summary action: ${JSON.stringify({ rows: shortWrite.rows, shortWriteSummaryActions })}`,
        );
      }
      const expandedShortWriteExecution = fullscreenExecution({
        ...shortWriteFixtureInput,
        expanded: true,
      });
      const expandedShortWrite = await expandedShortWriteExecution.waitFor(
        (frame) => frame.text.includes("const value = 2;"),
        {
          width: 120,
          description: "programmatically expanded short Write preview",
        },
      );
      if (expandedShortWrite.text.includes("click to collapse")) {
        throw new Error(
          `fully visible short Write added a no-op collapse anchor: ${JSON.stringify(expandedShortWrite.rows)}`,
        );
      }
    }

    {
      const tabbedWriteFixture = await executeWriteFixture(
        "write_tab_indentation_fixture",
        "write-tabbed-fixture.ts",
        null,
        "    WRITE_SPACE_INDENT\n\tWRITE_TAB_INDENT",
      );
      const tabbedWriteExecution = fullscreenExecution({
        tool: "write",
        id: "write_tab_indentation_fixture",
        args: tabbedWriteFixture.args,
        definition: write,
        result: { ...tabbedWriteFixture.result, isError: false },
      });
      const tabbedWrite = await tabbedWriteExecution.waitFor(
        (frame) => frame.text.includes("WRITE_TAB_INDENT"),
        { width: 120, description: "tab-indented new-file Write preview" },
      );
      const tabbedWriteRows = tabbedWrite.rows;
      const spaceIndentColumn =
        tabbedWriteRows
          .find((line: string) => line.includes("WRITE_SPACE_INDENT"))
          ?.indexOf("WRITE_SPACE_INDENT") ?? -1;
      const tabIndentColumn =
        tabbedWriteRows
          .find((line: string) => line.includes("WRITE_TAB_INDENT"))
          ?.indexOf("WRITE_TAB_INDENT") ?? -1;
      if (spaceIndentColumn < 0 || tabIndentColumn !== spaceIndentColumn) {
        throw new Error(
          `new-file Write did not preserve tab indentation: ${JSON.stringify({ spaceIndentColumn, tabIndentColumn, tabbedWriteRows })}`,
        );
      }
    }

    {
      const applyPatch = fakePi.tools.get("apply_patch");
      if (typeof applyPatch?.renderCall !== "function")
        throw new Error("Apply Patch renderer was not registered");
      const shortPatchText = [
        "*** Begin Patch",
        "*** Add File: apply-short-visible.ts",
        "+const first = 1;",
        "+const second = 2;",
        "*** End Patch",
      ].join("\n");
      const shortApplyPatchFixture = {
        tool: "apply_patch",
        id: "apply_patch_short_fully_visible_fixture",
        args: { patchText: shortPatchText },
        definition: applyPatch,
      };
      const incompleteApplyPatchExecution = fullscreenExecution({
        ...shortApplyPatchFixture,
        id: "apply_patch_incomplete_header_fixture",
        argsComplete: false,
      });
      const incompleteApplyPatchRows =
        incompleteApplyPatchExecution.observe(120).rows;
      if (
        !incompleteApplyPatchRows.some(
          (line: string) =>
            line.includes("Apply Patch") &&
            line.includes("apply-short-visible.ts"),
        ) ||
        incompleteApplyPatchRows.some(
          (line: string) =>
            line.includes("rendering") ||
            line.includes("Create apply-short-visible.ts"),
        )
      ) {
        throw new Error(
          `incomplete Apply Patch did not keep its module-owned header-only presentation: ${JSON.stringify(incompleteApplyPatchRows)}`,
        );
      }
      const shortApplyPatchExecution = fullscreenExecution(
        shortApplyPatchFixture,
      );
      const shortApplyPatch = await shortApplyPatchExecution.waitFor(
        (frame) =>
          frame.text.includes("Create apply-short-visible.ts") &&
          frame.text.includes("+2"),
        { width: 120, description: "fully visible short Apply Patch preview" },
      );
      const shortApplyPatchRows = shortApplyPatch.rows;
      const shortApplySummaryRow = shortApplyPatchRows.findIndex(
        (line: string) =>
          line.includes("Create apply-short-visible.ts") && line.includes("+2"),
      );
      const shortApplySummaryActions = shortApplyPatch.actions.filter(
        (action) => action.row === shortApplySummaryRow,
      );
      if (shortApplySummaryRow < 0 || shortApplySummaryActions.length > 0) {
        throw new Error(
          `fully visible short Apply Patch exposed a no-op summary action: ${JSON.stringify({ shortApplyPatchRows, shortApplySummaryActions })}`,
        );
      }
      const expandedShortApplyPatchExecution = fullscreenExecution({
        ...shortApplyPatchFixture,
        expanded: true,
      });
      const expandedShortApplyPatch =
        await expandedShortApplyPatchExecution.waitFor(
          (frame) => frame.text.includes("const second = 2;"),
          {
            width: 120,
            description: "programmatically expanded short Apply Patch preview",
          },
        );
      if (expandedShortApplyPatch.text.includes("click to collapse")) {
        throw new Error(
          `fully visible short Apply Patch added a no-op collapse anchor: ${JSON.stringify(expandedShortApplyPatch.rows)}`,
        );
      }
    }

    {
      const applyPatch = fakePi.tools.get("apply_patch");
      if (typeof applyPatch?.renderCall !== "function")
        throw new Error("Apply Patch renderer was not registered");
      const patchText = [
        "*** Begin Patch",
        "*** Add File: apply-single-final.ts",
        ...Array.from(
          { length: 40 },
          (_, index) => `+apply patch line ${index + 1}`,
        ),
        "*** End Patch",
      ].join("\n");
      const applyPatchExecution = fullscreenExecution({
        tool: "apply_patch",
        id: "apply_patch_single_final_fixture",
        args: { patchText },
        definition: applyPatch,
      });
      const collapsedApplyPatch = await applyPatchExecution.waitFor(
        (frame) => frame.text.includes("more diff lines"),
        {
          width: 120,
          description: "collapsed single-file Apply Patch preview",
        },
      );
      const collapsedApplyPatchRows = collapsedApplyPatch.rows;
      const applyPatchSummaryRow = collapsedApplyPatchRows.findIndex(
        (line: string) =>
          line.includes("Create apply-single-final.ts") && line.includes("+40"),
      );
      const applyPatchSummary = collapsedApplyPatch.actions.find(
        (action) =>
          action.origin === "result-summary" &&
          action.row === applyPatchSummaryRow,
      );
      const applyPatchExpansion = applyPatchSummary
        ? applyPatchExecution.activate(applyPatchSummary)
        : undefined;
      if (!applyPatchExpansion?.accepted) {
        throw new Error(
          `single-file Apply Patch summary was not clickable: ${JSON.stringify(collapsedApplyPatchRows)}`,
        );
      }
      const collapseText = "Output ends here • click to collapse";
      const expandedApplyPatch = await applyPatchExecution.waitFor(
        (frame) => frame.text.includes(collapseText),
        {
          width: 120,
          description:
            "normal expanded single-file Apply Patch bottom collapse anchor",
        },
      );
      if (expandedApplyPatch.text.includes("more diff lines")) {
        throw new Error(
          `fully rendered single-file Apply Patch retained a hidden-diff row: ${JSON.stringify(expandedApplyPatch.rows)}`,
        );
      }
    }

    {
      const applyPatch = fakePi.tools.get("apply_patch");
      if (typeof applyPatch?.renderCall !== "function")
        throw new Error("Apply Patch renderer was not registered");
      const filePatch = (pathName: string) => [
        `*** Add File: ${pathName}`,
        ...Array.from(
          { length: 40 },
          (_, index) => `+${pathName} line ${index + 1}`,
        ),
      ];
      const patchText = [
        "*** Begin Patch",
        ...filePatch("apply-multi-a.ts"),
        ...filePatch("apply-multi-b.ts"),
        "*** End Patch",
      ].join("\n");
      const multiApplyPatchExecution = fullscreenExecution({
        tool: "apply_patch",
        id: "apply_patch_multi_final_fixture",
        args: { patchText },
        definition: applyPatch,
      });
      await multiApplyPatchExecution.waitFor(
        (frame) => frame.text.includes("2 files"),
        { width: 120, description: "collapsed multi-file Apply Patch preview" },
      );
      const collapsedMultiApply = multiApplyPatchExecution.updateResult({
        content: [{ type: "text", text: "Done!" }],
        details: {},
        isError: false,
      });
      const collapsedMultiApplyRows = collapsedMultiApply.rows;
      const collapsedMultiApplyContent = collapsedMultiApplyRows.filter(
        (line: string) => line.trim().length > 0,
      );
      const collapsedApplyHunkRows = collapsedMultiApplyContent.filter(
        (line: string) => line.includes("hunks"),
      );
      const collapsedApplyHunkRow = collapsedMultiApplyContent.findIndex(
        (line: string) => line.includes("hunks"),
      );
      const firstApplyBlockRow = collapsedMultiApplyContent.findIndex(
        (line: string) => line.includes("Create apply-multi-a.ts"),
      );
      const collapsedApplyBlockHeadings = collapsedMultiApplyContent.filter(
        (line: string) => line.includes("Create apply-multi-"),
      );
      const collapsedApplyLocalRemainders = collapsedMultiApplyContent.filter(
        (line: string) => line.includes("more diff lines"),
      );
      if (
        collapsedApplyHunkRows.length !== 1 ||
        collapsedApplyHunkRow < 0 ||
        collapsedApplyHunkRow >= firstApplyBlockRow ||
        collapsedApplyBlockHeadings.some(
          (line: string) => !/^\s*├ Create apply-multi-/.test(line),
        ) ||
        collapsedApplyLocalRemainders.length !== 2 ||
        !/^\s*│ …/.test(collapsedApplyLocalRemainders[0] ?? "") ||
        !/^\s*└ …/.test(collapsedApplyLocalRemainders[1] ?? "") ||
        collapsedMultiApplyContent.at(-1) !== collapsedApplyLocalRemainders[1]
      ) {
        throw new Error(
          `collapsed multi-file Apply Patch did not follow aggregate/block/terminal branch grammar: ${JSON.stringify(collapsedMultiApplyContent)}`,
        );
      }
      const multiApplySummaryRow = collapsedMultiApplyRows.findIndex(
        (line: string) => line.includes("2 files") && line.includes("+80"),
      );
      const multiApplySummary = collapsedMultiApply.actions.find(
        (action) =>
          action.origin === "result-summary" &&
          action.row === multiApplySummaryRow,
      );
      const multiApplyExpansion = multiApplySummary
        ? multiApplyPatchExecution.activate(multiApplySummary)
        : undefined;
      if (!multiApplyExpansion?.accepted) {
        throw new Error(
          `multi-file Apply Patch summary was not clickable: ${JSON.stringify(collapsedMultiApplyRows)}`,
        );
      }
      const collapseText = "Output ends here • click to collapse";
      const expandedMultiApply = await multiApplyPatchExecution.waitFor(
        (frame) => frame.text.includes(collapseText),
        {
          width: 120,
          description:
            "normal expanded multi-file Apply Patch bottom collapse anchor",
        },
      );
      const expandedMultiApplyRows = expandedMultiApply.rows;
      const expandedMultiApplyContent = expandedMultiApplyRows.filter(
        (line: string) => line.trim().length > 0,
      );
      const expandedApplyHunkRows = expandedMultiApplyContent.filter(
        (line: string) => line.includes("hunks"),
      );
      const expandedApplyBlockHeadings = expandedMultiApplyContent.filter(
        (line: string) => line.includes("Create apply-multi-"),
      );
      const expandedApplyTerminal = expandedMultiApplyContent.at(-1) ?? "";
      if (
        expandedApplyHunkRows.length !== 1 ||
        expandedApplyBlockHeadings.some(
          (line: string) => !/^\s*├ Create apply-multi-/.test(line),
        ) ||
        !/^\s*└ Output ends here/.test(expandedApplyTerminal)
      ) {
        throw new Error(
          `expanded multi-file Apply Patch did not keep one summary and one terminal collapse row: ${JSON.stringify(expandedMultiApplyContent)}`,
        );
      }
    }

    {
      const restoredEditPath = join(tempPiDir, "restored-edit-fixture.ts");
      writeFileSync(restoredEditPath, "old restored value");
      const restoredEditArgs = {
        path: restoredEditPath,
        edits: [
          { oldText: "old restored value", newText: "new restored value" },
        ],
      };
      const restoredEditResult = await edit.execute(
        "restored_edit_fixture",
        restoredEditArgs,
        undefined,
        undefined,
        { cwd: process.cwd() },
      );
      const restoredEditExecution = fullscreenExecution({
        tool: "edit",
        id: "restored_edit_fixture",
        args: restoredEditArgs,
        definition: edit,
        result: { ...restoredEditResult, isError: false },
      });
      const restoredEditRows = restoredEditExecution.observe(120).rows;
      if (
        restoredEditRows.filter((line: string) => line.includes("1 hunk"))
          .length !== 1 ||
        !restoredEditRows.some((line: string) =>
          /^└ .*\+1.*-1.*1 hunk/.test(line),
        ) ||
        !restoredEditRows
          .find((line: string) => line.trim())
          ?.startsWith("● Edit")
      ) {
        throw new Error(
          `restored completed Edit was indented or lost its original result summary: ${JSON.stringify(restoredEditRows)}`,
        );
      }
    }

    {
      const addedOnlyEditExecution = fullscreenExecution({
        tool: "edit",
        id: "added_only_edit_fixture",
        args: {
          path: "missing-added-only-edit-fixture.ts",
          oldText: "anchor line",
          newText: [
            "anchor line",
            ...Array.from(
              { length: 12 },
              (_, index) =>
                `added line ${index + 1} ${"wide content ".repeat(16)}`,
            ),
          ].join("\n"),
        },
        definition: edit,
      });
      const addedOnly = await addedOnlyEditExecution.waitFor(
        (frame) => {
          const summaryRow = frame.rows.findIndex((line: string) =>
            line.includes("1 hunk"),
          );
          return (
            summaryRow >= 0 &&
            /^│ ─+\s*$/.test(frame.rows[summaryRow + 1] ?? "") &&
            !frame.text.includes("rendering diff")
          );
        },
        { width: 120, description: "added-only Edit preview" },
      );
      const addedOnlyRows = addedOnly.rows;
      const addedOnlySummaryRow = addedOnlyRows.findIndex((line: string) =>
        line.includes("1 hunk"),
      );
      const physicalRowAfterAddedOnlySummary =
        addedOnlyRows[addedOnlySummaryRow + 1] ?? "";
      if (
        addedOnlySummaryRow < 0 ||
        !/^│ ─+\s*$/.test(physicalRowAfterAddedOnlySummary)
      ) {
        throw new Error(
          `single unified Edit did not place its top border directly after the summary: ${JSON.stringify({ physicalRowAfterAddedOnlySummary, addedOnlyRows })}`,
        );
      }
    }

    {
      const shortEditWidth = 180;
      let shortEditRenderRequests = 0;
      const shortEditFixture = {
        tool: "edit",
        id: "edit_short_fully_visible_fixture",
        args: {
          path: "missing-short-edit-fixture.ts",
          oldText: "const value = 1;",
          newText: "const value = 2;",
        },
        definition: edit,
        ui: {
          mode: "fullscreen",
          requestRender() {
            shortEditRenderRequests++;
          },
        },
      };
      const shortEditExecution = fullscreenExecution(shortEditFixture);
      const shortEdit = await shortEditExecution.waitFor(
        (frame) => frame.text.includes("+1") && frame.text.includes("-1"),
        {
          width: shortEditWidth,
          description: "fully visible short Edit preview",
        },
      );
      const shortEditRows = shortEdit.rows;
      const shortEditSummaryRow = shortEditRows.findIndex(
        (line: string) => line.includes("+1") && line.includes("-1"),
      );
      const shortEditSummaryActions = shortEdit.actions.filter(
        (action) => action.row === shortEditSummaryRow,
      );
      if (
        shortEditSummaryRow < 0 ||
        shortEditSummaryActions.length > 0 ||
        shortEditRows.some((line: string) => line.includes("click to collapse"))
      ) {
        throw new Error(
          `fully visible short Edit exposed a no-op click control: ${JSON.stringify({ shortEditRows, shortEditSummaryActions })}`,
        );
      }
      const shortEditResult = {
        content: [{ type: "text", text: "Applied edit" }],
        details: {
          _type: "editInfo",
          summary: "+1 -1",
          editLine: 1,
          hunks: 1,
          added: 1,
          removed: 1,
        },
        isError: false,
      };
      shortEditExecution.updateResult(shortEditResult, {
        width: shortEditWidth,
      });
      const completeShortEdit = await shortEditExecution.waitFor(
        (frame) =>
          frame.rows.filter(
            (line: string) => line.includes("+1") && line.includes("-1"),
          ).length === 1 &&
          frame.rows.filter((line: string) => line.includes("1 hunk"))
            .length === 1,
        {
          width: shortEditWidth,
          description: "complete fully visible short Edit execution",
        },
      );
      const completeShortEditRows = completeShortEdit.rows;
      const completeShortEditSummaryRow = completeShortEditRows.findIndex(
        (line: string) => line.includes("1 hunk"),
      );
      const physicalRowAfterShortEditSummary =
        completeShortEditRows[completeShortEditSummaryRow + 1] ?? "";
      if (
        completeShortEditSummaryRow < 0 ||
        !physicalRowAfterShortEditSummary.includes("old") ||
        !physicalRowAfterShortEditSummary.includes("new") ||
        !physicalRowAfterShortEditSummary.includes("┊") ||
        !/^│ old.*┊new/.test(physicalRowAfterShortEditSummary)
      ) {
        throw new Error(
          `single split Edit inserted a physical gap above its diff: ${JSON.stringify(completeShortEditRows)}`,
        );
      }
      if (completeShortEdit.actions.length < 1) {
        throw new Error(
          `complete short Edit did not retain its inert header anchor: ${JSON.stringify(completeShortEditRows)}`,
        );
      }
      const renderRequestsBeforeNoOpClicks = shortEditRenderRequests;
      for (const expectedAction of completeShortEdit.actions) {
        const current = shortEditExecution.observe(shortEditWidth);
        const action = current.actions.find(
          (candidate) =>
            candidate.behavior === expectedAction.behavior &&
            candidate.origin === expectedAction.origin &&
            candidate.row === expectedAction.row,
        );
        if (!action)
          throw new Error(
            `short Edit anchor vanished before activation: ${JSON.stringify(expectedAction)}`,
          );
        const noOp = shortEditExecution.activate(action);
        if (
          noOp.accepted ||
          JSON.stringify(noOp.after.rawRows) !==
            JSON.stringify(noOp.before.rawRows)
        ) {
          throw new Error(
            `fully visible short Edit activated a no-op anchor: ${JSON.stringify(action)}`,
          );
        }
      }
      if (shortEditRenderRequests !== renderRequestsBeforeNoOpClicks) {
        throw new Error(
          `fully visible short Edit repainted after no-op clicks: ${JSON.stringify({ shortEditRenderRequests, renderRequestsBeforeNoOpClicks })}`,
        );
      }
      const expandedShortEditExecution = fullscreenExecution({
        ...shortEditFixture,
        id: "edit_short_fully_visible_expanded_fixture",
        result: shortEditResult,
        expanded: true,
      });
      const expandedShortEdit = await expandedShortEditExecution.waitFor(
        (frame) => frame.text.includes("const value = 2;"),
        {
          width: shortEditWidth,
          description: "programmatically expanded short Edit preview",
        },
      );
      if (expandedShortEdit.text.includes("click to collapse")) {
        throw new Error(
          `fully visible short Edit added a no-op collapse anchor after expansion: ${JSON.stringify(expandedShortEdit.rows)}`,
        );
      }
    }

    {
      const postEditDir = mkdtempSync(
        join(tmpdir(), "pi-cc-tools-post-edit-lines-"),
      );
      try {
        const sourceLines = Array.from(
          { length: 420 },
          (_, index) => `ORIGINAL_${index + 1}`,
        );
        const operation = (prefix: string, start: number, end: number) => ({
          oldText: Array.from(
            { length: end - start + 1 },
            (_, index) => `ORIGINAL_${start + index}`,
          ).join("\n"),
          newText: Array.from(
            { length: end - start + 1 },
            (_, index) => `${prefix}_${start + index}`,
          ).join("\n"),
        });
        const operations = [
          operation("MULTI_A", 101, 140),
          operation("MULTI_B", 351, 390),
        ];
        for (const { prefix, start, end } of [
          { prefix: "MULTI_A", start: 101, end: 140 },
          { prefix: "MULTI_B", start: 351, end: 390 },
        ]) {
          for (let line = start; line <= end; line++)
            sourceLines[line - 1] = `${prefix}_${line}`;
        }
        const postEditPath = join(postEditDir, "post-edit-lines.txt");
        writeFileSync(postEditPath, `${sourceLines.join("\n")}\n`);
        const postEditExecution = fullscreenExecution({
          tool: "edit",
          id: "post_edit_line_number_fixture",
          args: { path: postEditPath, edits: operations },
          definition: edit,
        });
        const postEdit = await postEditExecution.waitFor(
          (frame) =>
            frame.rows.filter((line: string) => /Edit [12]\/2/.test(line))
              .length === 2 &&
            frame.text.includes("MULTI_A_101") &&
            frame.text.includes("MULTI_B_351") &&
            !frame.text.includes("rendering diff"),
          { width: 180, description: "post-write multi-Edit localization" },
        );
        const postEditRows = postEdit.rows;
        const expectedBlocks = [
          { token: "MULTI_A_101", line: 101 },
          { token: "MULTI_B_351", line: 351 },
        ];
        for (const [index, expected] of expectedBlocks.entries()) {
          const headingIndex = postEditRows.findIndex((line: string) =>
            line.includes(`Edit ${index + 1}/2`),
          );
          const nextHeadingIndex = postEditRows.findIndex(
            (line: string, row: number) =>
              row > headingIndex && /Edit \d\/2/.test(line),
          );
          const blockRows = postEditRows.slice(
            headingIndex + 1,
            nextHeadingIndex < 0 ? undefined : nextHeadingIndex,
          );
          const heading = postEditRows[headingIndex] ?? "";
          const row =
            blockRows.find((line: string) => line.includes(expected.token)) ??
            "";
          if (
            headingIndex < 0 ||
            !heading.includes(`at line ${expected.line}`) ||
            !new RegExp(`\\b${expected.line}\\+`).test(row)
          ) {
            throw new Error(
              `post-write multi-Edit lost source line ${expected.line}: ${JSON.stringify({ heading, row })}`,
            );
          }
        }

        const retainedLines = Array.from(
          { length: 140 },
          (_, index) => `RETAINED_${index + 1}`,
        );
        const retainedOperations = [
          {
            oldText: "RETAINED_27",
            newText: [
              "RETAINED_27",
              "FIRST_INSERT_1",
              "FIRST_INSERT_2",
              "FIRST_INSERT_3",
              "FIRST_INSERT_4",
              "FIRST_INSERT_5",
            ].join("\n"),
          },
          {
            oldText: "RETAINED_83",
            newText: [
              "RETAINED_83",
              "SECOND_INSERT_1",
              "SECOND_INSERT_2",
              "SECOND_INSERT_3",
              "SECOND_INSERT_4",
              "SECOND_INSERT_5",
              "SECOND_INSERT_6",
            ].join("\n"),
          },
        ];
        for (const operation of [...retainedOperations].reverse()) {
          const index = retainedLines.indexOf(operation.oldText);
          retainedLines.splice(index, 1, ...operation.newText.split("\n"));
        }
        const retainedPath = join(postEditDir, "retained-prefix-lines.txt");
        writeFileSync(retainedPath, `${retainedLines.join("\n")}\n`);
        const retainedExecution = fullscreenExecution({
          tool: "edit",
          id: "post_edit_retained_prefix_fixture",
          args: { path: retainedPath, edits: retainedOperations },
          definition: edit,
        });
        const retained = await retainedExecution.waitFor(
          (frame) =>
            frame.rows.filter((line: string) => /Edit [12]\/2/.test(line))
              .length === 2 &&
            frame.text.includes("RETAINED_83") &&
            !frame.text.includes("rendering diff"),
          {
            width: 180,
            description: "post-write retained-prefix multi-Edit localization",
          },
        );
        const retainedRows = retained.rows;
        const secondHeadingIndex = retainedRows.findIndex((line: string) =>
          line.includes("Edit 2/2"),
        );
        const secondHeading = retainedRows[secondHeadingIndex] ?? "";
        const secondRows = retainedRows.slice(secondHeadingIndex + 1);
        const secondAnchorRow =
          secondRows.find((line: string) => line.includes("RETAINED_83")) ?? "";
        if (
          !secondHeading.includes("at line 88") ||
          !/\b83-/.test(secondAnchorRow) ||
          !/\b88\+/.test(secondAnchorRow)
        ) {
          throw new Error(
            `retained-prefix multi-Edit shifted block 2 twice: ${JSON.stringify({ secondHeading, secondAnchorRow })}`,
          );
        }
      } finally {
        rmSync(postEditDir, { recursive: true, force: true });
      }
    }

    {
      const editLines = (prefix: string) =>
        Array.from({ length: 80 }, (_, index) => `${prefix} ${index + 1}`).join(
          "\n",
        );
      const asyncEditExecution = fullscreenExecution({
        tool: "edit",
        id: "edit_async_detail_fixture",
        args: {
          path: "missing-async-detail-fixture.ts",
          oldText: editLines("old async line"),
          newText: editLines("new async line"),
        },
        definition: edit,
      });
      const collapsedAsyncEdit = await asyncEditExecution.waitFor(
        (frame) => frame.text.includes("more diff lines"),
        { width: 120, description: "collapsed async Edit preview" },
      );
      const asyncEditSummary = collapsedAsyncEdit.actions.find(
        (action) =>
          action.origin === "result-summary" &&
          action.text.includes("+80") &&
          action.text.includes("-80"),
      );
      const asyncEditExpansion = asyncEditSummary
        ? asyncEditExecution.activate(asyncEditSummary)
        : undefined;
      if (!asyncEditExpansion?.accepted) {
        throw new Error(
          `async Edit summary was not clickable: ${JSON.stringify(collapsedAsyncEdit.rows)}`,
        );
      }
      const immediateExpandedEditRows = asyncEditExpansion.after.rows;
      if (
        immediateExpandedEditRows.some((line: string) =>
          line.includes("rendering"),
        ) ||
        !immediateExpandedEditRows.some((line: string) =>
          line.includes("old async line 1"),
        )
      ) {
        throw new Error(
          `Edit replaced its stable preview during async expansion: ${JSON.stringify(immediateExpandedEditRows)}`,
        );
      }
      const normalAsyncEdit = await asyncEditExecution.waitFor(
        (frame) =>
          !frame.text.includes("rendering diff") &&
          frame.actions.some(
            (action) =>
              action.behavior === "next-detail" &&
              action.text.includes("more diff lines"),
          ),
        { width: 120, description: "normal expanded async Edit preview" },
      );
      const asyncEditDetail = normalAsyncEdit.actions.find(
        (action) =>
          action.behavior === "next-detail" &&
          action.text.includes("more diff lines"),
      );
      const asyncEditDetailExpansion = asyncEditDetail
        ? asyncEditExecution.activate(asyncEditDetail)
        : undefined;
      if (!asyncEditDetailExpansion?.accepted) {
        throw new Error(
          `normal async Edit preview lacked a detail action: ${JSON.stringify(normalAsyncEdit.rows)}`,
        );
      }
      const immediateDetailedEditRows = asyncEditDetailExpansion.after.rows;
      if (
        immediateDetailedEditRows.some((line: string) =>
          line.includes("rendering"),
        ) ||
        !immediateDetailedEditRows.some((line: string) =>
          line.includes("old async line 1"),
        )
      ) {
        throw new Error(
          `Edit replaced its stable preview during async detail expansion: ${JSON.stringify(immediateDetailedEditRows)}`,
        );
      }
      const collapseText = "Output ends here • click to collapse";
      const detailedAsyncEdit = await asyncEditExecution.waitFor(
        (frame) => frame.text.includes(collapseText),
        {
          width: 120,
          description: "async Edit level-1 bottom collapse anchor",
        },
      );
      if (detailedAsyncEdit.text.includes("more diff lines")) {
        throw new Error(
          `async Edit level 1 did not retain its configured 200-line budget: ${JSON.stringify(detailedAsyncEdit.rows)}`,
        );
      }
      const bottomCollapse = detailedAsyncEdit.actions.find(
        (action) =>
          action.behavior === "toggle" && action.viewportAnchor === "bottom",
      );
      const bottomCollapseTransition = bottomCollapse
        ? asyncEditExecution.activate(bottomCollapse)
        : undefined;
      if (!bottomCollapseTransition?.accepted) {
        throw new Error("async Edit bottom anchor did not start collapse");
      }
      const immediateCollapsedEditRows = bottomCollapseTransition.after.rows;
      if (
        immediateCollapsedEditRows.some((line: string) =>
          line.includes("rendering"),
        ) ||
        !immediateCollapsedEditRows.some((line: string) =>
          line.includes("old async line 80"),
        )
      ) {
        throw new Error(
          `Edit replaced its stable preview during async bottom collapse: ${JSON.stringify(immediateCollapsedEditRows)}`,
        );
      }
      const pendingBottom = bottomCollapseTransition.after.actions.find(
        (action) =>
          action.behavior === "toggle" && action.viewportAnchor === "bottom",
      );
      if (
        pendingBottom &&
        asyncEditExecution.activate(pendingBottom).accepted
      ) {
        throw new Error("pending Edit bottom anchor re-expanded the execution");
      }
      await asyncEditExecution.waitFor(
        (frame) => frame.text.includes("more diff lines"),
        { width: 120, description: "async Edit bottom collapse completion" },
      );
    }

    {
      const editAnchorWidth = 180;
      const splitLines = (prefix: string, editIndex: number) =>
        Array.from(
          { length: 30 },
          (_, lineIndex) => `${prefix} ${editIndex}.${lineIndex}`,
        ).join("\n");
      const editAnchorArgs = {
        path: "missing-edit-anchor-fixture.ts",
        edits: Array.from({ length: 4 }, (_, editIndex) => ({
          oldText: splitLines("old", editIndex),
          newText: splitLines("new", editIndex),
        })),
      };
      const editAnchorExecution = fullscreenExecution({
        tool: "edit",
        id: "edit_anchor_fixture",
        args: editAnchorArgs,
        definition: edit,
      });
      await editAnchorExecution.waitFor(
        (frame) => frame.text.includes("more edit block"),
        { width: editAnchorWidth, description: "collapsed multi-Edit preview" },
      );
      editAnchorExecution.updateResult(
        {
          content: [{ type: "text", text: "Applied 4 edits" }],
          details: {
            _type: "multiEditInfo",
            editCount: 4,
            diffLineCount: 240,
            hunks: 4,
            totalAdded: 120,
            totalRemoved: 120,
          },
          isError: false,
        },
        { width: editAnchorWidth },
      );
      const collapsedEdit = await editAnchorExecution.waitFor(
        (frame) =>
          frame.text.includes("more edit block") &&
          !frame.text.includes("rendering diff"),
        {
          width: editAnchorWidth,
          description: "settled collapsed multi-Edit preview",
        },
      );

      const collapsedEditRows = collapsedEdit.rows;
      const collapsedEditContentRows = collapsedEditRows.filter(
        (line: string) => line.trim().length > 0,
      );
      const collapsedHunkRows = collapsedEditContentRows.filter(
        (line: string) => line.includes("hunks"),
      );
      const collapsedHunkRow = collapsedEditContentRows.findIndex(
        (line: string) => line.includes("hunks"),
      );
      const firstEditBlockRow = collapsedEditContentRows.findIndex(
        (line: string) => line.includes("Edit 1/4"),
      );
      const collapsedBlockHeadings = collapsedEditContentRows.filter(
        (line: string) => /Edit \d\/4/.test(line),
      );
      const collapsedLocalRemainders = collapsedEditContentRows.filter(
        (line: string) => line.includes("more diff lines"),
      );
      const collapsedTerminalRow = collapsedEditContentRows.at(-1) ?? "";
      if (
        collapsedHunkRows.length !== 1 ||
        collapsedHunkRow < 0 ||
        collapsedHunkRow >= firstEditBlockRow ||
        collapsedBlockHeadings.some(
          (line: string) => !/^\s*├ Edit \d\/4/.test(line),
        ) ||
        collapsedLocalRemainders.length === 0 ||
        collapsedLocalRemainders.some(
          (line: string) => !/^\s*│ …/.test(line),
        ) ||
        !/^\s*└ … 1 more edit block/.test(collapsedTerminalRow)
      ) {
        throw new Error(
          `collapsed multi-Edit did not follow aggregate/block/terminal branch grammar: ${JSON.stringify(collapsedEditContentRows)}`,
        );
      }
      const editSummaryRow = collapsedEditRows.findIndex((line: string) =>
        line.includes("4 edits +"),
      );
      const editSummary = collapsedEdit.actions.find(
        (action) =>
          action.origin === "result-summary" && action.row === editSummaryRow,
      );
      const editExpansion = editSummary
        ? editAnchorExecution.activate(editSummary)
        : undefined;
      if (editSummaryRow < 0 || !editExpansion?.accepted) {
        throw new Error(
          `multi-Edit aggregate summary was not a clickable expansion anchor: ${JSON.stringify(collapsedEditRows)}`,
        );
      }

      const collapseText = "Output ends here • click to collapse";
      const expandedEdit = await editAnchorExecution.waitFor(
        (frame) => frame.text.includes(collapseText),
        {
          width: editAnchorWidth,
          description: "expanded multi-Edit bottom collapse anchor",
        },
      );
      const expandedEditRows = expandedEdit.rows;
      const expandedEditContentRows = expandedEditRows.filter(
        (line: string) => line.trim().length > 0,
      );
      const expandedHunkRows = expandedEditContentRows.filter((line: string) =>
        line.includes("hunks"),
      );
      const expandedBlockHeadings = expandedEditContentRows.filter(
        (line: string) => /Edit \d\/4/.test(line),
      );
      const expandedTerminalRow = expandedEditContentRows.at(-1) ?? "";
      const editCollapseRow = expandedEditRows.findIndex((line: string) =>
        line.includes(collapseText),
      );
      const editCollapseStart =
        editCollapseRow < 0
          ? -1
          : expandedEditRows[editCollapseRow].indexOf(collapseText);
      const collapseAction = expandedEdit.actions.find(
        (action) =>
          action.behavior === "toggle" &&
          action.origin === "result-summary" &&
          action.viewportAnchor === "bottom" &&
          action.row === editCollapseRow,
      );
      const fullCollapseTarget =
        editCollapseStart >= 0 &&
        collapseAction !== undefined &&
        collapseAction.start <= editCollapseStart &&
        collapseAction.end >= editCollapseStart + collapseText.length;
      if (
        editCollapseRow < 0 ||
        !fullCollapseTarget ||
        expandedHunkRows.length !== 1 ||
        expandedBlockHeadings.some(
          (line: string) => !/^\s*├ Edit \d\/4/.test(line),
        ) ||
        !expandedTerminalRow.includes(collapseText) ||
        !/^\s*└ Output ends here/.test(expandedTerminalRow) ||
        expandedEditRows.some((line: string) =>
          line.includes("more diff lines"),
        )
      ) {
        throw new Error(
          `fully rendered multi-Edit split diff lacked its canonical bottom collapse row: ${JSON.stringify(expandedEditRows)}`,
        );
      }
    }

    const groupedReadFixture = (
      id: string,
      filePath: string,
      text: string,
      interaction: "regular" | "fullscreen" = "regular",
    ) => ({
      tool: "read",
      id,
      args: { path: filePath },
      definition: readDefinition,
      interaction,
      result: { content: [{ type: "text", text }], isError: false },
    });
    const regularGroup = toolGroup([
      groupedReadFixture(
        "read_regular_group_fixture_1",
        "regular-group-a.ts",
        cappedOutput,
      ),
      groupedReadFixture(
        "read_regular_group_fixture_2",
        "regular-group-b.ts",
        cappedOutput,
      ),
    ]);
    if (regularGroup.observe(120).text.includes("click any for details")) {
      throw new Error(
        "regular TUI mode advertised inactive tool-group click anchors",
      );
    }

    const peerOutput = cappedOutput.replaceAll(
      "result line",
      "peer result line",
    );
    const clickableGroup = toolGroup([
      groupedReadFixture(
        "read_group_fixture_1",
        "group-a.ts",
        cappedOutput,
        "fullscreen",
      ),
      groupedReadFixture(
        "read_group_fixture_2",
        "group-b.ts",
        peerOutput,
        "fullscreen",
      ),
    ]);
    const clickableGroupFrame = clickableGroup.observe(120);
    if (!clickableGroupFrame.text.includes("click any for details")) {
      throw new Error(
        "fullscreen collapsed tool group did not show click guidance",
      );
    }
    const styledGroupGuidance = `${theme.fg("muted", " • ")}${theme.fg("dim", "click")}${theme.fg("muted", " any for details")}`;
    if (!clickableGroupFrame.rawRows.join("\n").includes(styledGroupGuidance)) {
      throw new Error("tool-group click guidance did not dim only `click`");
    }
    const clickableGroupHeader = clickableGroupFrame.actions.find(
      (action) =>
        action.origin === "execution-header" &&
        action.text.includes("group-a.ts"),
    );
    if (
      clickableGroupHeader?.start !== 5 ||
      clickableGroupHeader.viewportAnchor !== "top"
    ) {
      throw new Error(
        `tool-group click anchor did not preserve its edge or content-only span: ${JSON.stringify(clickableGroupHeader)}`,
      );
    }
    const localExpansion = clickableGroup.activate(clickableGroupHeader);
    if (
      !localExpansion.accepted ||
      !localExpansion.after.text.includes("result line 8") ||
      localExpansion.after.text.includes("peer result line 1")
    ) {
      throw new Error(
        "tool-group click did not expand only the selected execution",
      );
    }

    clickableGroup.setExpanded(true, 120);
    const expandedGroup = clickableGroup.append(
      groupedReadFixture(
        "read_group_fixture_3",
        "group-c.ts",
        cappedOutput.replaceAll("result line", "third result line"),
        "fullscreen",
      ),
      120,
    );
    if (!expandedGroup.text.includes("third result line 8")) {
      throw new Error(
        "new grouped execution did not inherit global expanded mode",
      );
    }
    const expandedGroupHeader = expandedGroup.rows.find(
      (line: string) =>
        line.includes("to collapse") || line.includes("to toggle"),
    );
    if (
      !expandedGroupHeader?.includes("to collapse") ||
      expandedGroupHeader.includes("to toggle")
    ) {
      throw new Error(
        `expanded tool group did not describe its collapse action: ${JSON.stringify(expandedGroupHeader)}`,
      );
    }
    const resetGroup = clickableGroup.setExpanded(false, 120);
    if (
      !resetGroup.text.includes("click any for details") ||
      resetGroup.text.includes("result line 1") ||
      resetGroup.text.includes("peer result line 1") ||
      resetGroup.text.includes("third result line 1")
    ) {
      throw new Error(
        "global collapse did not restore compact clickable group rows",
      );
    }

    if (reportedDefects.length > 0) {
      throw new Error(
        `reported Side Quests banner regressions:\n- ${reportedDefects.join("\n- ")}`,
      );
    }
    console.log(
      "OK  renderer summaries, payloads, indicators, click detail layers, async diffs, and grouped controls",
    );
  },
);
