import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertCollapsedIndicator,
  assertExpandedIndicator,
  assertPayloadRowInert,
  assertResultSummaryAnchor,
  plain,
  waitFor,
  withRendererHarness,
} from "./renderer-test-harness.ts";

const PRELOADED_AGENT_GETTER = Symbol.for("pi-cc-tools:test-preloaded-agent-getter");

await withRendererHarness(
  {
    name: "renderer-integration",
    stubTools: ["apply_patch", "web_search", "TaskList", "Agent", "ask_parent", "subagent_done"],
    beforeExtension: ({ ToolExecutionComponent }) => {
      const prototype = ToolExecutionComponent.prototype as any;
      const delegatedGetter = prototype.getResultRenderer;
      const producerGetter = function (this: any): any {
        if (this.toolName === "Agent" && this.isPartial !== true && this.result?.isError !== true) {
          return this.toolDefinition?.renderResult;
        }
        return delegatedGetter.call(this);
      };
      prototype.getResultRenderer = producerGetter;
      (globalThis as any)[PRELOADED_AGENT_GETTER] = producerGetter;
    },
  },
  async ({ fakePi, theme, ToolExecutionComponent, Container, emitLifecycle, writePiSettings }) => {
    const {
      BashExecutionComponent,
      BranchSummaryMessageComponent,
      CompactionSummaryMessageComponent,
      CustomMessageComponent,
    } = await import("../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/index.js");
    const { Box, Text } = await import("../node_modules/@earendil-works/pi-tui/dist/index.js");
    const reportedDefects: string[] = [];
    const builtinWidth = 72;
    const hasExactPaintedVerticalPadding = (rows: string[]): boolean => {
      if (rows.length < 4) return false;
      const painted = rows.map((line) => line.includes("\x1b[48;"));
      return !painted[0]
        && plain(rows[0]).trim().length === 0
        && painted.slice(1).every(Boolean)
        && plain(rows[1]).trim().length === 0
        && plain(rows[2]).trim().length > 0
        && plain(rows.at(-2) ?? "").trim().length > 0
        && plain(rows.at(-1) ?? "").trim().length === 0;
    };
    const assertWholeComponentToggle = (component: any, expandedNeedle: string, label: string): void => {
      const collapsedRows = component.render(builtinWidth).map((line: string) => plain(line));
      for (const y of collapsedRows.keys()) {
        if (
          component.clickActionAtPoint?.(0, y) !== "expand"
          || component.clickActionAtPoint?.(builtinWidth - 1, y) !== "expand"
        ) {
          throw new Error(`${label} collapsed component was not clickable across its full bounds at row ${y}: ${JSON.stringify({ left: component.clickActionAtPoint?.(0, y), right: component.clickActionAtPoint?.(builtinWidth - 1, y), collapsedRows })}`);
        }
      }
      if (!component.activateClickAction?.("expand") || (component.expanded ?? component._expanded) !== true) {
        throw new Error(`${label} did not expand from its whole-component action`);
      }
      const expandedRows = component.render(builtinWidth).map((line: string) => plain(line));
      if (!expandedRows.some((line: string) => line.includes(expandedNeedle))) {
        throw new Error(`${label} expanded content did not render: ${JSON.stringify(expandedRows)}`);
      }
      for (const y of expandedRows.keys()) {
        if (
          component.clickActionAtPoint?.(0, y) !== "expand"
          || component.clickActionAtPoint?.(builtinWidth - 1, y) !== "expand"
        ) {
          throw new Error(`${label} expanded component was not clickable across its full bounds at row ${y}`);
        }
      }
      if (!component.activateClickAction?.("expand") || (component.expanded ?? component._expanded) !== false) {
        throw new Error(`${label} did not collapse from its whole-component action`);
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
    longShell.appendOutput(Array.from({ length: 24 }, (_, index) => `SHELL_DETAIL_${index + 1}`).join("\n"));
    longShell.setComplete(0, false);
    assertWholeComponentToggle(longShell, "SHELL_DETAIL_1", "! shell execution");

    const shortShell = new BashExecutionComponent("printf short", builtinUi) as any;
    shortShell.appendOutput("SHORT_SHELL_1\nSHORT_SHELL_2");
    shortShell.setComplete(0, false);
    const shortRows = shortShell.render(builtinWidth);
    if (shortRows.some((_: string, y: number) => shortShell.clickActionAtPoint?.(1, y) !== undefined)) {
      throw new Error("fully visible ! shell output exposed a no-op click target");
    }
    if (shortShell.activateClickAction?.("expand") === true || shortShell.expanded !== false) {
      throw new Error("fully visible ! shell output accepted a no-op expansion action");
    }

    const customMessageText = Array.from({ length: 12 }, (_, index) => `SIDE_QUEST_EVENT_${index + 1}`).join("\n");
    const sideQuestMessageRenderer = (message: any, options: any, messageTheme: any) => {
      const text = typeof message.content === "string" ? message.content : "";
      const box = new Box(2, 1, (line: string) => messageTheme.bg("customMessageBg", line));
      box.addChild(new Text(options.expanded ? text : `${text.slice(0, 24)}… dynamic-key for details`, 0, 0));
      return box;
    };
    for (const customType of ["side-quest-result", "side-quest-continuation"]) {
      const customMessage = new CustomMessageComponent(
        { role: "custom", customType, content: customMessageText, display: true, timestamp: Date.now() },
        sideQuestMessageRenderer,
      );
      const customRendered = customMessage.render(builtinWidth);
      const customRows = customRendered.map((line: string) => plain(line));
      if (customRows.some((line: string) => /^─+$/.test(line.trim()))) {
        reportedDefects.push(`${customType} retained standalone border rows`);
      }
      if (!hasExactPaintedVerticalPadding(customRendered)) {
        reportedDefects.push(`${customType} did not preserve exactly one painted top/bottom padding row`);
      }
      assertWholeComponentToggle(
        customMessage,
        "SIDE_QUEST_EVENT_12",
        `${customType} custom message`,
      );
    }
    const unrelatedCustomMessage = new CustomMessageComponent(
      { role: "custom", customType: "unrelated", content: customMessageText, display: true, timestamp: Date.now() },
      sideQuestMessageRenderer,
    ) as any;
    if (unrelatedCustomMessage.clickActionAtPoint?.(1, 1) !== undefined) {
      throw new Error("an unrelated custom message received a Side Quests click target");
    }

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
      ["web_search", { content: [{ type: "text", text: "search one\nsearch two" }] }, "2 lines returned"],
      ["TaskList", { content: [{ type: "text", text: "#1 [pending] First\n#2 [completed] Second" }] }, "2 tasks"],
    ];
    for (const [name, result, expectedSummary, ctxOverrides] of summaryCases) {
      assertResultSummaryAnchor(fakePi, name, result, false, expectedSummary, ctxOverrides);
      assertResultSummaryAnchor(fakePi, name, result, true, expectedSummary, ctxOverrides);
    }

    assertPayloadRowInert(fakePi, "bash", { content: [{ type: "text", text: "" }] }, "(no output)", { args: { command: "true" } });
    assertPayloadRowInert(fakePi, "write", { content: [{ type: "text", text: "write failed raw payload" }] }, "write failed raw payload", { isError: true });
    assertPayloadRowInert(fakePi, "web_search", { content: [{ type: "text", text: "search failed raw payload\nsecond error line" }] }, "search failed raw payload", { isError: true });

    writePiSettings({
      clickExpansion: true,
      previewLines: 3,
      expandedPreviewMaxLines: 5,
      extraExpandedPreviewMaxLines: 7,
    });
    const agentDefinition = fakePi.tools.get("Agent");
    agentDefinition.renderCall = (args: any) => new Text(`● Agent general-purpose :: ${args.description}`, 0, 0);
    agentDefinition.renderResult = (result: any, options: any, renderTheme: any, ctx: any) => {
      const statuses = result.details?.sideQuestPresentation?.statuses ?? [];
      const payload = statuses.length ? ` [${statuses.join(" | ")}]` : "";
      const summary = `${renderTheme.fg("success", "Spawned")}${renderTheme.fg("muted", payload)}`;
      if (!options.expanded) return new Text(`└ ${summary} • dynamic-key for details`, 0, 0);
      const sessionPath = result.details?.sessionPath ?? "Unavailable";
      return new Text(
        [`└ ${summary}`, `  session path: ${sessionPath}`, "  ⠀", ...String(ctx.args?.prompt ?? "").split("\n").map((line) => `  ${line}`)].join("\n"),
        0,
        0,
      );
    };
    const createAgentExecution = (id: string, version = 1, promptLineCount = 7): any => {
      const execution = new ToolExecutionComponent(
        "Agent",
        id,
        {
          description: `Agent fixture ${id}`,
          inherit_context: true,
          interactive: true,
          prompt: Array.from({ length: promptLineCount }, (_, index) => `AGENT_${id}_PROMPT_${index + 1}`).join("\n"),
        },
        {},
        agentDefinition,
        { mode: "fullscreen", requestRender() {} } as any,
        process.cwd(),
      ) as any;
      execution.markExecutionStarted();
      execution.setArgsComplete();
      execution.updateResult({
        content: [{ type: "text", text: "Subagent launched." }],
        details: {
          sessionPath: `/tmp/${id}/session.jsonl`,
          sideQuestPresentation: { version, surface: "agent", statuses: ["inherited", "interactive"] },
        },
        isError: false,
      }, false);
      return execution;
    };
    const toolPrototype = ToolExecutionComponent.prototype as any;
    const installSimulatedSideQuestsOuterGetter = (): (() => any) => {
      const delegatedGetter = toolPrototype.getResultRenderer;
      const sideQuestsGetter = function (this: any): any {
        const delegated = delegatedGetter.call(this);
        if (this.toolName === "Agent" && this.isPartial !== true && this.result?.isError !== true) {
          return agentDefinition.renderResult;
        }
        return delegated;
      };
      toolPrototype.getResultRenderer = sideQuestsGetter;
      return sideQuestsGetter;
    };
    const assertAgentOrderAdapter = (execution: any, label: string): void => {
      const rows = execution.render(100).map((line: string) => plain(line));
      const summaryRow = rows.findIndex((line: string) => line.includes("Spawned [inherited | interactive]"));
      const summaryX = rows[summaryRow]?.indexOf("Spawned") ?? -1;
      if (summaryRow < 0 || execution.clickActionAtPoint?.(summaryX, summaryRow) !== "expand") {
        throw new Error(`${label} did not retain the Agent summary adapter: ${JSON.stringify(rows)}`);
      }
    };

    const producerFirstGetter = (globalThis as any)[PRELOADED_AGENT_GETTER];
    const initialCcToolsGetter = toolPrototype.getResultRenderer;
    assertAgentOrderAdapter(createAgentExecution("producer_first"), "Side Quests → cc-tools");
    if (initialCcToolsGetter === producerFirstGetter || toolPrototype.getResultRenderer !== initialCcToolsGetter) {
      throw new Error("Side Quests → cc-tools did not install one stable outer adapter");
    }

    const cachedBeforeLateProducer = createAgentExecution("cached_before_late");
    cachedBeforeLateProducer.render(100);
    const producerLateGetter = installSimulatedSideQuestsOuterGetter();
    assertAgentOrderAdapter(cachedBeforeLateProducer, "cc-tools → Side Quests cached execution");
    if (toolPrototype.getResultRenderer !== producerLateGetter) {
      throw new Error("cc-tools → Side Quests replaced the late producer getter");
    }
    for (let cycle = 1; cycle <= 12; cycle++) {
      await emitLifecycle("session_start");
      assertAgentOrderAdapter(createAgentExecution(`reload_${cycle}`), `reload cycle ${cycle}`);
      if (toolPrototype.getResultRenderer !== producerLateGetter) {
        throw new Error(`reload cycle ${cycle} grew the result-renderer wrapper chain`);
      }
    }

    const ownGetterExecution = createAgentExecution("own_getter");
    const ownGetter = function (this: any): any {
      return this.toolDefinition?.renderResult;
    };
    Object.defineProperty(ownGetterExecution, "getResultRenderer", {
      configurable: false,
      enumerable: false,
      writable: false,
      value: ownGetter,
    });
    const ownDescriptorBefore = Object.getOwnPropertyDescriptor(ownGetterExecution, "getResultRenderer");
    assertAgentOrderAdapter(ownGetterExecution, "non-configurable own getter");
    const ownDescriptorAfter = Object.getOwnPropertyDescriptor(ownGetterExecution, "getResultRenderer");
    if (
      ownDescriptorAfter?.value !== ownDescriptorBefore?.value
      || ownDescriptorAfter?.configurable !== ownDescriptorBefore?.configurable
      || ownDescriptorAfter?.enumerable !== ownDescriptorBefore?.enumerable
      || ownDescriptorAfter?.writable !== ownDescriptorBefore?.writable
    ) {
      throw new Error("Agent adaptation changed the execution's own result-renderer descriptor");
    }

    const shortAgentExecution = createAgentExecution("short_standalone", 1, 2);
    if (!shortAgentExecution.activateClickAction?.("expand")) {
      throw new Error("short standalone Agent did not expand from its result summary");
    }
    const shortStandaloneRows = shortAgentExecution.render(100).map((line: string) => plain(line));
    if (shortStandaloneRows.some((line: string) => line.includes("Output ends here"))) {
      reportedDefects.push("short standalone Agent retained a bottom collapse anchor below the L0 gate");
    }

    const shortGroupedFirst = createAgentExecution("short_grouped_first", 1, 3);
    const shortGroupedSecond = createAgentExecution("short_grouped_second", 1, 3);
    const shortGroupParent = new Container();
    shortGroupParent.addChild(shortGroupedFirst);
    shortGroupParent.addChild(shortGroupedSecond);
    const shortGroup = (shortGroupParent as any).children[0];
    shortGroupParent.render(100);
    let shortHeader: { x: number; y: number } | undefined;
    for (let y = 0; y < 20 && !shortHeader; y++) {
      for (let x = 0; x < 100; x++) {
        if (shortGroup.clickAnchorAtPoint?.(x, y)?.tool === shortGroupedFirst) {
          shortHeader = { x, y };
          break;
        }
      }
    }
    if (!shortHeader || !shortGroup.toggleToolAtPoint(shortHeader.x, shortHeader.y)) {
      throw new Error("short grouped Agent did not expand from its header");
    }
    const shortGroupedRows = shortGroupParent.render(100).map((line: string) => plain(line));
    if (shortGroupedRows.some((line: string) => line.includes("Output ends here"))) {
      reportedDefects.push("short grouped Agent retained a bottom collapse anchor below the L0 gate");
    }

    const agentExecution = createAgentExecution("standalone");
    const collapsedAgentRows = agentExecution.render(100).map((line: string) => plain(line));
    const nonBlankAgentRows = collapsedAgentRows.filter((line: string) => line.trim().length > 0);
    if (!/^─+$/.test(nonBlankAgentRows[0]?.trim() ?? "") || !/^─+$/.test(nonBlankAgentRows.at(-1)?.trim() ?? "")) {
      throw new Error(`standalone Agent output did not retain top and bottom borders: ${JSON.stringify(collapsedAgentRows)}`);
    }
    const collapsedAgentSummary = collapsedAgentRows.findIndex((line: string) => line.includes("Spawned [inherited | interactive]"));
    const collapsedAgentX = collapsedAgentRows[collapsedAgentSummary]?.indexOf("Spawned") ?? -1;
    if (collapsedAgentSummary < 0 || agentExecution.clickActionAtPoint?.(collapsedAgentX, collapsedAgentSummary) !== "expand") {
      throw new Error(`standalone Agent result summary was not clickable: ${JSON.stringify(collapsedAgentRows)}`);
    }
    if (!agentExecution.activateClickAction?.("expand")) throw new Error("standalone Agent did not enter L0");
    const agentL0 = agentExecution.render(100).map((line: string) => plain(line));
    if (!agentL0.some((line: string) => line.includes("AGENT_standalone_PROMPT_3")) || agentL0.some((line: string) => line.includes("AGENT_standalone_PROMPT_4")) || !agentL0.some((line: string) => line.includes("click for more detail"))) {
      throw new Error(`standalone Agent L0 did not use the configured compact preview: ${JSON.stringify(agentL0)}`);
    }
    const agentL0Summary = agentL0.find((line: string) => line.includes("Spawned"));
    if (agentL0Summary?.includes("click to collapse")) {
      throw new Error(`expanded Agent top summary exposed a collapse hint: ${JSON.stringify(agentL0Summary)}`);
    }
    const activateAgentDetail = (expectedLastLine: number, expectFinal: boolean): void => {
      const rows = agentExecution.render(100).map((line: string) => plain(line));
      const detailRow = rows.findIndex((line: string) => line.includes("click for more detail"));
      if (detailRow < 0) throw new Error(`Agent detail action was missing: ${JSON.stringify(rows)}`);
      const x = rows[detailRow]?.indexOf("click for more detail") ?? -1;
      const action = agentExecution.clickAnchorAtPoint?.(x, detailRow);
      if (!action || !agentExecution.activateClickAction?.(action.action, action.viewportAnchor)) {
        throw new Error(`Agent detail action did not activate: ${JSON.stringify({ rows, action })}`);
      }
      const nextRows = agentExecution.render(100).map((line: string) => plain(line));
      if (!nextRows.some((line: string) => line.includes(`AGENT_standalone_PROMPT_${expectedLastLine}`))) {
        throw new Error(`Agent detail layer omitted prompt line ${expectedLastLine}: ${JSON.stringify(nextRows)}`);
      }
      if (expectFinal !== nextRows.some((line: string) => line.includes("Output ends here • click to collapse"))) {
        throw new Error(`Agent final collapse row mismatch: ${JSON.stringify(nextRows)}`);
      }
    };
    activateAgentDetail(5, false);
    activateAgentDetail(7, true);
    const agentFinalRows = agentExecution.render(100).map((line: string) => plain(line));
    const agentFinalRow = agentFinalRows.findIndex((line: string) => line.includes("Output ends here • click to collapse"));
    const agentFinalX = agentFinalRows[agentFinalRow]?.indexOf("Output ends here") ?? -1;
    const agentCollapse = agentExecution.clickAnchorAtPoint?.(agentFinalX, agentFinalRow);
    if (!agentCollapse || !agentExecution.activateClickAction?.(agentCollapse.action, agentCollapse.viewportAnchor) || agentExecution.expanded) {
      throw new Error("Agent final collapse action did not restore compact output");
    }

    const groupedAgentFirst = createAgentExecution("grouped_first");
    const groupedAgentSecond = createAgentExecution("grouped_second");
    const agentGroupParent = new Container();
    agentGroupParent.addChild(groupedAgentFirst);
    agentGroupParent.addChild(groupedAgentSecond);
    const agentGroup = (agentGroupParent as any).children[0];
    if ((agentGroupParent as any).children.length !== 1 || typeof agentGroup?.clickAnchorAtPoint !== "function") {
      throw new Error("Agent executions did not enter the standard tool group");
    }
    const compactAgentGroupRows = agentGroupParent.render(100).map((line: string) => plain(line));
    let groupedAgentHeader: { x: number; y: number } | undefined;
    for (let y = 0; y < compactAgentGroupRows.length && !groupedAgentHeader; y++) {
      for (let x = 0; x < 100; x++) {
        const anchor = agentGroup.clickAnchorAtPoint(x, y);
        if (anchor?.tool === groupedAgentFirst && anchor.action === "header") {
          groupedAgentHeader = { x, y };
          break;
        }
      }
    }
    if (!groupedAgentHeader || !agentGroup.toggleToolAtPoint(groupedAgentHeader.x, groupedAgentHeader.y)) {
      throw new Error(`grouped Agent header did not expand its execution: ${JSON.stringify(compactAgentGroupRows)}`);
    }
    const expandedAgentGroupRows = agentGroupParent.render(100).map((line: string) => plain(line));
    if (!expandedAgentGroupRows.some((line: string) => line.includes("AGENT_grouped_first_PROMPT_3")) || expandedAgentGroupRows.some((line: string) => /^─+$/.test(line.trim()))) {
      throw new Error(`grouped Agent output did not preserve L0 content without standalone borders: ${JSON.stringify(expandedAgentGroupRows)}`);
    }
    const groupedAgentSummaryRow = expandedAgentGroupRows.findIndex((line: string) => line.includes("Spawned [inherited | interactive]"));
    const groupedAgentSummaryX = Array.from({ length: 100 }, (_, x) => x).find((x) => {
      const anchor = agentGroup.clickAnchorAtPoint(x, groupedAgentSummaryRow);
      return anchor?.tool === groupedAgentFirst && anchor.action === "expand";
    });
    if (groupedAgentSummaryX === undefined || !agentGroup.toggleToolAtPoint(groupedAgentSummaryX, groupedAgentSummaryRow) || groupedAgentFirst.expanded) {
      throw new Error(`grouped Agent result summary did not collapse its execution: ${JSON.stringify(expandedAgentGroupRows)}`);
    }
    if (
      !groupedAgentFirst.activateClickAction?.("expand")
      || !groupedAgentFirst.activateClickAction?.("detail")
      || !groupedAgentFirst.activateClickAction?.("detail")
    ) {
      throw new Error("grouped Agent did not advance to its final detail layer");
    }
    const finalAgentGroupRows = agentGroupParent.render(100).map((line: string) => plain(line));
    if (
      !finalAgentGroupRows.some((line: string) => line.includes("AGENT_grouped_first_PROMPT_7"))
      || !finalAgentGroupRows.some((line: string) => line.includes("Output ends here • click to collapse"))
      || finalAgentGroupRows.some((line: string) => /^─+$/.test(line.trim()))
    ) {
      throw new Error(`long grouped Agent omitted its unframed final detail layer or collapse row: ${JSON.stringify(finalAgentGroupRows)}`);
    }

    const unknownAgent = createAgentExecution("future", 99);
    const unknownAgentRows = unknownAgent.render(100).map((line: string) => plain(line));
    if (!unknownAgentRows.some((line: string) => line.includes("dynamic-key for details")) || unknownAgentRows.some((_: string, y: number) => unknownAgent.clickActionAtPoint?.(10, y) !== undefined)) {
      throw new Error(`unknown Agent presentation version did not fail closed: ${JSON.stringify(unknownAgentRows)}`);
    }

    const longBanner = Array.from({ length: 30 }, (_, index) => `BANNER_${index + 1}`).join(" ");
    for (const [name, field, expandedNeedle] of [
      ["ask_parent", "prompt", "BANNER_30"],
      ["subagent_done", "result", "BANNER_30"],
    ] as const) {
      const definition = fakePi.tools.get(name);
      definition.renderShell = "self";
      definition.renderCall = (_args: any, _theme: any, ctx: any) => ctx.isPartial ? new Text(longBanner.slice(0, 48), 0, 0) : new Text("", 0, 0);
      definition.renderResult = (_result: any, options: any, bannerTheme: any) => {
        const box = new Box(2, 1, (line: string) => bannerTheme.bg("customMessageBg", line));
        box.addChild(new Text(options.expanded ? longBanner : `${longBanner.slice(0, 48)}… dynamic-key for details`, 0, 0));
        return box;
      };
      const banner = new ToolExecutionComponent(
        name,
        `${name}_binary_fixture`,
        { [field]: longBanner },
        {},
        definition,
        { mode: "fullscreen", requestRender() {} } as any,
        process.cwd(),
      ) as any;
      banner.markExecutionStarted();
      banner.setArgsComplete();
      banner.updateResult({ content: [{ type: "text", text: "recorded" }], isError: false }, false);
      const bannerRendered = banner.render(72);
      const bannerRows = bannerRendered.map((line: string) => plain(line));
      if (bannerRows.some((line: string) => /^─+$/.test(line.trim()))) {
        reportedDefects.push(`${name} retained standalone border rows`);
      }
      if (!hasExactPaintedVerticalPadding(bannerRendered)) {
        reportedDefects.push(`${name} did not preserve exactly one painted top/bottom padding row`);
      }
      const firstPaintedRow = bannerRendered.findIndex((line: string) => line.includes("\x1b[48;"));
      const deadRow = bannerRows.findIndex((_: string, y: number) => y >= firstPaintedRow && (
        banner.clickActionAtPoint?.(0, y) !== "expand" || banner.clickActionAtPoint?.(71, y) !== "expand"
      ));
      const activeOuterSpacer = Array.from({ length: Math.max(0, firstPaintedRow) }, (_, y) => y)
        .find((y) => banner.clickActionAtPoint?.(0, y) !== undefined || banner.clickActionAtPoint?.(71, y) !== undefined);
      if (firstPaintedRow < 0 || deadRow >= 0 || activeOuterSpacer !== undefined) {
        throw new Error(`${name} banner click bounds did not cover only the painted block: ${JSON.stringify({ bannerRows, firstPaintedRow, deadRow, activeOuterSpacer })}`);
      }
      if (!banner.activateClickAction?.("expand")) throw new Error(`${name} banner did not expand`);
      const expandedBannerRendered = banner.render(72);
      if (!expandedBannerRendered.some((line: string) => plain(line).includes(expandedNeedle))) {
        throw new Error(`${name} banner did not reveal its full content`);
      }
      if (!hasExactPaintedVerticalPadding(expandedBannerRendered)) {
        reportedDefects.push(`${name} expanded output did not preserve exactly one painted top/bottom padding row`);
      }
    }

    for (const [name, field, content] of [
      ["ask_parent", "prompt", "😀".repeat(121)],
      ["subagent_done", "result", `${" ".repeat(241)}short`],
    ] as const) {
      const definition = fakePi.tools.get(name);
      definition.renderShell = "self";
      definition.renderCall = () => new Text("", 0, 0);
      definition.renderResult = (_result: any, _options: any, _theme: any, ctx: any) => {
        const shown = name === "subagent_done" ? String(ctx.args?.[field] ?? "").trim() : String(ctx.args?.[field] ?? "");
        return new Text(shown, 0, 0);
      };
      const banner = new ToolExecutionComponent(
        name,
        `${name}_unicode_noop_fixture`,
        { [field]: content },
        {},
        definition,
        { mode: "fullscreen", requestRender() {} } as any,
        process.cwd(),
      ) as any;
      banner.markExecutionStarted();
      banner.setArgsComplete();
      banner.updateResult({ content: [{ type: "text", text: "recorded" }], isError: false }, false);
      const rows = banner.render(72);
      if (rows.some((_: string, y: number) => banner.clickActionAtPoint?.(1, y) !== undefined) || banner.activateClickAction?.("expand") === true) {
        throw new Error(`${name} exposed a no-op click target for fully visible Unicode-normalized content`);
      }
    }

    writePiSettings({
      clickExpansion: true,
      expandedPreviewMaxLines: 10,
      extraExpandedPreviewMaxLines: 15,
    });
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
    if (typeof bash?.renderCall !== "function" || typeof bash?.renderResult !== "function") throw new Error("Bash renderer was not registered");
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

    const streamingTimerRows = bash.renderCall(
      { command: "echo STREAMING_TIMER_INLINE" },
      theme,
      {
        state: { _toolStatus: "pending", _bashStartedAtMs: Date.now() },
        isError: false,
        lastComponent: undefined,
        args: { command: "echo STREAMING_TIMER_INLINE" },
        argsComplete: true,
        cwd: process.cwd(),
        expanded: false,
        executionStarted: true,
      } as any,
    ).render(100).map((line: string) => plain(line));
    const streamingTimerRow = streamingTimerRows.find((line: string) => line.includes("STREAMING_TIMER_INLINE"));
    if (!streamingTimerRow?.includes("echo STREAMING_TIMER_INLINE · <1s")) {
      throw new Error(`streaming Bash timer was not placed directly after the command with one leading space: ${JSON.stringify(streamingTimerRows)}`);
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
    await waitFor(() => typeof editContext.state._ptBody === "string" && editContext.state._ptBody.includes("more edit block"));
    const editRaw = edit.renderCall(editArgs, theme, editContext).render(120).join("\n");
    assertCollapsedIndicator(editRaw, "more edit block");

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
    const editErrorStart = editErrorRows.findIndex((line: string) => line.startsWith("  Could not find"));
    const editContinuations = editErrorStart >= 0 ? editErrorRows.slice(editErrorStart + 1) : [];
    if (editErrorStart < 0 || editContinuations.length === 0) {
      throw new Error(`Edit error indentation regression setup did not wrap: ${JSON.stringify(editErrorRows)}`);
    }
    if (editErrorRows.some((line: string) => /^[ ]*[├│└] /.test(line))) {
      throw new Error(`Edit error retained a branch connector: ${JSON.stringify(editErrorRows)}`);
    }
    if (editContinuations.some((line: string) => !line.startsWith("  "))) {
      throw new Error(`wrapped Edit error lost two-space indentation: ${JSON.stringify(editErrorRows)}`);
    }

    for (const name of ["write", "apply_patch", "web_search", "TaskList"]) {
      const definition = fakePi.tools.get(name);
      const errorRows = definition.renderResult(
        { content: [{ type: "text", text: "AUDIT failure detail" }], details: {} },
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
      ).render(80).map((line: string) => plain(line));
      const errorRow = errorRows.find((line: string) => line.includes("AUDIT failure detail"));
      if (!errorRow?.startsWith("  ") || /^[ ]*[├│└] /.test(errorRow)) {
        throw new Error(`${name} error did not use two-space connector-free indentation: ${JSON.stringify(errorRows)}`);
      }
    }

    const readNoTextRows = fakePi.tools.get("read").renderResult(
      { content: [], details: {} },
      { expanded: false, isPartial: false },
      theme,
      { state: {}, args: {}, expanded: false, isError: true, lastComponent: undefined },
    ).render(80).map((line: string) => plain(line));
    const readNoTextRow = readNoTextRows.find((line: string) => line.includes("No text content"));
    if (!readNoTextRow?.startsWith("  ") || /^[ ]*[├│└] /.test(readNoTextRow)) {
      throw new Error(`Read no-text error did not use two-space connector-free indentation: ${JSON.stringify(readNoTextRows)}`);
    }

    await emitLifecycle("agent_start");

    const bashCommandExecution = new ToolExecutionComponent(
      "bash",
      "standalone_bash_command_click_fixture",
      { command: "echo STANDALONE_COMMAND_SOURCE\necho STANDALONE_COMMAND_CONTINUATION" },
      {},
      bash,
      { mode: "fullscreen", requestRender() {} } as any,
      process.cwd(),
    ) as any;
    bashCommandExecution.markExecutionStarted();
    bashCommandExecution.setArgsComplete();
    bashCommandExecution.updateResult({
      content: [{
        type: "text",
        text: Array.from({ length: 10 }, (_, index) => `standalone Bash result ${index + 1}`).join("\n"),
      }],
      isError: false,
    }, false);
    const compactBashCommandRows = bashCommandExecution.render(120).map((line: string) => plain(line));
    const compactBashSummaryRow = compactBashCommandRows.findIndex((line: string) => line.includes("Done (10 lines)"));
    const compactBashSummaryX = compactBashSummaryRow < 0
      ? -1
      : Array.from({ length: 120 }, (_, x) => x)
        .find((x) => bashCommandExecution.clickActionAtPoint(x, compactBashSummaryRow) === "expand") ?? -1;
    if (compactBashSummaryX < 0 || !bashCommandExecution.activateClickAction("expand", "top")) {
      throw new Error(`standalone Bash setup did not expand through its result summary: ${JSON.stringify(compactBashCommandRows)}`);
    }
    const bashCommandRows = bashCommandExecution.render(120).map((line: string) => plain(line));
    const bashCommandRow = bashCommandRows.findIndex((line: string) => line.includes("echo STANDALONE_COMMAND_SOURCE"));
    const bashCommandStart = bashCommandRow < 0 ? -1 : bashCommandRows[bashCommandRow].indexOf("echo STANDALONE_COMMAND_SOURCE");
    const bashCommandEnd = bashCommandStart < 0 ? -1 : bashCommandStart + "echo STANDALONE_COMMAND_SOURCE".length;
    if (
      bashCommandRow < 0
      || bashCommandStart < 0
      || !Array.from({ length: bashCommandEnd - bashCommandStart }, (_, offset) => bashCommandStart + offset)
        .every((x) => bashCommandExecution.clickActionAtPoint(x, bashCommandRow) === "header")
      || !bashCommandExecution.activateClickAction("header", "top")
      || bashCommandExecution.render(120).some((line: string) => plain(line).includes("STANDALONE_COMMAND_CONTINUATION"))
    ) {
      throw new Error(`expanded standalone Bash command text did not bind a collapse action: ${JSON.stringify({ bashCommandRows, bashCommandRow, bashCommandStart, bashCommandEnd })}`);
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
    const bashCommandWrappedExecution = new ToolExecutionComponent(
      "bash",
      "standalone_bash_command_continuation_click_fixture",
      { command: bashCommandPreviewLines.join("\n") },
      {},
      bash,
      { mode: "fullscreen", requestRender() {} } as any,
      process.cwd(),
    ) as any;
    bashCommandWrappedExecution.markExecutionStarted();
    bashCommandWrappedExecution.setArgsComplete();
    bashCommandWrappedExecution.updateResult({
      content: [{ type: "text", text: "fixture failed" }],
      isError: true,
    }, false);
    const bashCommandWrappedRows = bashCommandWrappedExecution.render(40).map((line: string) => plain(line));
    const bashCommandWrappedRow = bashCommandWrappedRows.findIndex((line: string) => line.includes("BASH_COLLAPSED"));
    const bashCommandWrappedStart = bashCommandWrappedRow < 0
      ? -1
      : bashCommandWrappedRows[bashCommandWrappedRow].indexOf("BASH_COLLAPSED");
    if (
      bashCommandWrappedStart < 0
      || bashCommandWrappedExecution.clickActionAtPoint(bashCommandWrappedStart, bashCommandWrappedRow) !== "header"
      || !bashCommandWrappedExecution.activateClickAction("header", "top")
      || !bashCommandWrappedExecution.render(40).some((line: string) => plain(line).includes("BASH_COMMAND_HIDDEN_FINAL"))
    ) {
      throw new Error(`collapsed Bash command continuation row did not bind an expansion action: ${JSON.stringify({ bashCommandWrappedRows, bashCommandWrappedRow, bashCommandWrappedStart })}`);
    }

    const bashCommandRemainderExecution = new ToolExecutionComponent(
      "bash",
      "standalone_bash_command_remainder_click_fixture",
      { command: bashCommandPreviewLines.join("\n") },
      {},
      bash,
      { mode: "fullscreen", requestRender() {} } as any,
      process.cwd(),
    ) as any;
    bashCommandRemainderExecution.markExecutionStarted();
    bashCommandRemainderExecution.setArgsComplete();
    bashCommandRemainderExecution.updateResult({
      content: [{ type: "text", text: "fixture failed" }],
      isError: true,
    }, false);
    const bashCommandPreviewRows = bashCommandRemainderExecution.render(120).map((line: string) => plain(line));
    const bashCommandRemainderRow = bashCommandPreviewRows.findIndex((line: string) => line.includes("... 2 more lines"));
    const bashCommandRemainderStart = bashCommandRemainderRow < 0
      ? -1
      : bashCommandPreviewRows[bashCommandRemainderRow].indexOf("... 2 more lines");
    if (
      bashCommandRemainderStart < 0
      || bashCommandPreviewRows[bashCommandRemainderRow].includes("click to expand")
      || bashCommandRemainderExecution.clickActionAtPoint(bashCommandRemainderStart, bashCommandRemainderRow) !== "header"
      || !bashCommandRemainderExecution.activateClickAction("header", "top")
      || !bashCommandRemainderExecution.render(120).some((line: string) => plain(line).includes("BASH_COMMAND_HIDDEN_FINAL"))
    ) {
      throw new Error(`collapsed Bash command remainder did not stay terse and clickable: ${JSON.stringify({ bashCommandPreviewRows, bashCommandRemainderRow, bashCommandRemainderStart })}`);
    }

    const readDefinition = fakePi.tools.get("read");
    const skillReadExecution = new ToolExecutionComponent(
      "read",
      "standalone_skill_read_click_fixture",
      { path: "/tmp/pi-cc-tools-skill-anchor/skills/grilling/SKILL.md" },
      {},
      readDefinition,
      { mode: "fullscreen", requestRender() {} } as any,
      process.cwd(),
    ) as any;
    skillReadExecution.markExecutionStarted();
    skillReadExecution.setArgsComplete();
    skillReadExecution.updateResult({
      content: [{
        type: "text",
        text: Array.from({ length: 6 }, (_, index) => `skill anchor payload ${index + 1}`).join("\n"),
      }],
      isError: false,
    }, false);
    const skillReadRows = skillReadExecution.render(120).map((line: string) => plain(line));
    const skillHeaderRow = skillReadRows.findIndex((line: string) => line.includes("[skill] grilling"));
    const skillHeaderX = skillHeaderRow < 0 ? -1 : skillReadRows[skillHeaderRow].indexOf("[skill]") + 1;
    if (
      skillHeaderRow < 0
      || skillHeaderX < 1
      || skillReadExecution.clickActionAtPoint(skillHeaderX, skillHeaderRow) !== "header"
      || !skillReadExecution.activateClickAction("header", "top")
      || !skillReadExecution.render(120).some((line: string) => plain(line).includes("skill anchor payload 3"))
    ) {
      throw new Error(`standalone skill header did not expand its Read result: ${JSON.stringify({ skillReadRows, skillHeaderRow, skillHeaderX })}`);
    }

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
    const standalonePayloadColumns = Object.fromEntries(
      [1, 3, 5, 6].map((lineNumber) => {
        const token = `result line ${lineNumber}`;
        return [lineNumber, readRows.find((line: string) => line.includes(token))?.indexOf(token) ?? -1];
      }),
    );
    if (
      standalonePayloadColumns[1] < 0
      || standalonePayloadColumns[3] !== standalonePayloadColumns[1] + 4
      || standalonePayloadColumns[5] !== standalonePayloadColumns[1] + 4
      || standalonePayloadColumns[6] !== standalonePayloadColumns[1] + 6
    ) {
      throw new Error(`standalone Read did not preserve four-column tab stops: ${JSON.stringify(standalonePayloadColumns)}`);
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
    const detailStart = detailRow < 0 ? -1 : readRows[detailRow].indexOf("…");
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
    for (const token of ["result line 1", "result line 2", "result line 3", "result line 4", "result line 5", "result line 6"]) {
      const columns = [readRows, standardReadRows, extraDetailedReadRows].map(
        (rows) => rows.find((line: string) => line.includes(token))?.indexOf(token) ?? -1,
      );
      if (columns.some((column) => column < 0) || !columns.every((column) => column === columns[0])) {
        throw new Error(`standalone Read payload indentation changed across L0/L1/L2: ${JSON.stringify({ token, columns })}`);
      }
    }
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
        .every((x) => {
          const anchor = readExecution.clickAnchorAtPoint(x, finalReadCollapseRow);
          return anchor?.action === "expand" && anchor.viewportAnchor === "bottom";
        })
    ) {
      throw new Error(`standalone final detail layer did not end with a full-row branched collapse action: ${JSON.stringify(extraDetailedReadRows)}`);
    }
    if (!readExecution.activateClickAction("expand") || readExecution.expanded) {
      throw new Error("standalone final collapse action did not collapse the execution");
    }

    const newlineOwnedBashOutput = [
      "",
      "BASH_NEWLINE_ROOT",
      "  BASH_NEWLINE_CHILD",
      "",
      "\t",
      " \t  BASH_NEWLINE_MIXED",
      ...Array.from({ length: 6 }, (_, index) => `BASH_NEWLINE_FILLER_${index + 1}`),
      "BASH_NEWLINE_END",
      "",
      "",
    ].join("\n");
    const newlineOwnedBash = new ToolExecutionComponent(
      "bash",
      "bash_newline_fixture",
      { command: "printf fixture" },
      {},
      bash,
      { mode: "fullscreen", requestRender() {} } as any,
      process.cwd(),
    ) as any;
    newlineOwnedBash.markExecutionStarted();
    newlineOwnedBash.setArgsComplete();
    newlineOwnedBash.updateResult({ content: [{ type: "text", text: newlineOwnedBashOutput }], isError: false }, false);
    newlineOwnedBash.setExpanded(true);
    const assertBashOwnedPrefix = (rows: string[], layer: string): void => {
      const summary = rows.findIndex((line) => line.includes("Done (15 lines)"));
      const root = rows.findIndex((line) => line.includes("BASH_NEWLINE_ROOT"));
      const child = rows.findIndex((line) => line.includes("BASH_NEWLINE_CHILD"));
      const mixed = rows.findIndex((line) => line.includes("BASH_NEWLINE_MIXED"));
      if (summary < 0 || root !== summary + 2 || child !== root + 1 || mixed !== child + 3) {
        throw new Error(`standalone Bash did not preserve output-owned prefix newlines at ${layer}: ${JSON.stringify(rows)}`);
      }
    };
    const bashLevel0Rows = newlineOwnedBash.render(120).map((line: string) => plain(line));
    assertBashOwnedPrefix(bashLevel0Rows, "L0");
    if (!newlineOwnedBash.activateClickAction("detail")) throw new Error("standalone Bash did not enter L1");
    const bashLevel1Rows = newlineOwnedBash.render(120).map((line: string) => plain(line));
    assertBashOwnedPrefix(bashLevel1Rows, "L1");
    if (!newlineOwnedBash.activateClickAction("detail")) throw new Error("standalone Bash did not enter L2");
    const bashLevel2Rows = newlineOwnedBash.render(120).map((line: string) => plain(line));
    assertBashOwnedPrefix(bashLevel2Rows, "L2");
    const bashEnd = bashLevel2Rows.findIndex((line: string) => line.includes("BASH_NEWLINE_END"));
    const bashCollapse = bashLevel2Rows.findIndex((line: string) => line.includes("click to collapse"));
    if (bashEnd < 0 || bashCollapse !== bashEnd + 3) {
      throw new Error(`standalone Bash did not preserve trailing output-owned newlines at L2: ${JSON.stringify(bashLevel2Rows)}`);
    }

    const newlineOwnedReadOutput = newlineOwnedBashOutput
      .replaceAll("BASH_NEWLINE", "READ_NEWLINE");
    const createNewlineOwnedRead = (id: string, path: string): any => {
      const execution = new ToolExecutionComponent(
        "read",
        id,
        { path },
        {},
        readDefinition,
        { mode: "fullscreen", requestRender() {} } as any,
        process.cwd(),
      ) as any;
      execution.markExecutionStarted();
      execution.setArgsComplete();
      execution.updateResult({ content: [{ type: "text", text: newlineOwnedReadOutput }], isError: false }, false);
      return execution;
    };
    const assertReadOutputShape = (
      execution: any,
      renderRows: () => string[],
      label: string,
    ): void => {
      execution.setExpanded(true);
      const layers = [renderRows()];
      if (!execution.activateClickAction("detail")) throw new Error(`${label} did not enter L1`);
      layers.push(renderRows());
      if (!execution.activateClickAction("detail")) throw new Error(`${label} did not enter L2`);
      layers.push(renderRows());
      layers.forEach((rows, index) => {
        const summary = rows.findIndex((line) => line.includes("15 lines loaded"));
        const root = rows.findIndex((line) => line.includes("READ_NEWLINE_ROOT"));
        const child = rows.findIndex((line) => line.includes("READ_NEWLINE_CHILD"));
        const mixed = rows.findIndex((line) => line.includes("READ_NEWLINE_MIXED"));
        if (summary < 0 || root !== summary + 2 || child !== root + 1 || mixed !== child + 3) {
          throw new Error(`${label} did not preserve output-owned prefix empty lines at L${index}: ${JSON.stringify(rows)}`);
        }
      });
      for (const token of ["READ_NEWLINE_ROOT", "READ_NEWLINE_CHILD", "READ_NEWLINE_MIXED"]) {
        const columns = layers.map((rows) => rows.find((line) => line.includes(token))?.indexOf(token) ?? -1);
        if (columns.some((column) => column < 0) || !columns.every((column) => column === columns[0])) {
          throw new Error(`${label} did not preserve output indentation across L0/L1/L2: ${JSON.stringify({ token, columns })}`);
        }
      }
      const finalRows = layers[2];
      const end = finalRows.findIndex((line) => line.includes("READ_NEWLINE_END"));
      const collapse = finalRows.findIndex((line) => line.includes("click to collapse"));
      if (end < 0 || collapse !== end + 3) {
        throw new Error(`${label} did not preserve trailing output-owned empty lines at L2: ${JSON.stringify(finalRows)}`);
      }
    };
    for (const fixture of [
      { label: "standalone Read", path: "read-output-shape.txt" },
      { label: "standalone [skill]", path: "/tmp/read-output-shape/skills/shape/SKILL.md" },
    ]) {
      const execution = createNewlineOwnedRead(`newline_${fixture.label}`, fixture.path);
      assertReadOutputShape(execution, () => execution.render(120).map((line: string) => plain(line)), fixture.label);
    }
    for (const fixture of [
      { label: "grouped Read", path: "grouped-read-output-shape.txt" },
      { label: "grouped [skill]", path: "/tmp/grouped-output-shape/skills/shape/SKILL.md" },
    ]) {
      const execution = createNewlineOwnedRead(`newline_${fixture.label}`, fixture.path);
      const peer = createNewlineOwnedRead(`newline_${fixture.label}_peer`, "grouped-output-shape-peer.txt");
      peer.updateResult({ content: [{ type: "text", text: "GROUPED_OUTPUT_SHAPE_PEER" }], isError: false }, false);
      const parent = new Container();
      parent.addChild(execution);
      parent.addChild(peer);
      assertReadOutputShape(execution, () => parent.render(120).map((line: string) => plain(line)), fixture.label);
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
    const ReadContainer = Container;
    const readGroupParent = new ReadContainer();
    readGroupParent.addChild(readExecution);
    readGroupParent.addChild(readPeer);
    const readGroup = (readGroupParent as any).children[0];
    readGroupParent.render(120);
    if (!readGroup.toggleToolAtPoint(5, 2)) {
      throw new Error("grouped Read header did not expand its selected execution");
    }
    const groupedActionX = (row: number, action: string, viewportAnchor = "top"): number => (
      Array.from({ length: 120 }, (_, x) => x).find((x) => {
        const anchor = readGroup.clickAnchorAtPoint(x, row);
        return anchor?.action === action && anchor?.viewportAnchor === viewportAnchor;
      }) ?? -1
    );
    const expandedReadGroupRows = readGroupParent.render(120).map((line: string) => line.replace(/\x1b\[[0-9;]*m/g, ""));
    const expandedReadChildEnd = expandedReadGroupRows.findIndex((line: string) => line.includes("peer.ts"));
    const expandedReadChildRows = expandedReadGroupRows.slice(0, expandedReadChildEnd < 0 ? undefined : expandedReadChildEnd);
    if (
      expandedReadChildRows.some((line: string) => line.includes("Read fixture.ts"))
      || expandedReadChildRows.some((line: string) => line.includes("────────"))
    ) {
      throw new Error(`grouped Read embedded standalone component chrome: ${JSON.stringify(expandedReadGroupRows)}`);
    }
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
    for (const token of ["result line 1", "result line 2", "result line 3", "result line 4", "result line 5", "result line 6"]) {
      const columns = [expandedReadGroupRows, standardReadGroupRows, extraDetailedReadGroupRows].map(
        (rows) => rows.find((line: string) => line.includes(token))?.indexOf(token) ?? -1,
      );
      if (columns.some((column) => column < 0) || !columns.every((column) => column === columns[0])) {
        throw new Error(`grouped Read payload indentation changed across L0/L1/L2: ${JSON.stringify({ token, columns })}`);
      }
    }
    if (!extraDetailedReadGroup.includes("result line 15") || extraDetailedReadGroup.includes("result line 16")) {
      throw new Error(`grouped second detail action did not stop at extraExpandedPreviewMaxLines=15: ${JSON.stringify(extraDetailedReadGroup)}`);
    }
    const groupedCollapseRow = extraDetailedReadGroupRows.findIndex((line: string) => line.includes("click to collapse"));
    const groupedCollapseX = groupedCollapseRow < 0 ? -1 : groupedActionX(groupedCollapseRow, "expand", "bottom");
    if (groupedCollapseRow < 0 || groupedCollapseX < 0 || !readGroup.toggleToolAtPoint(groupedCollapseX, groupedCollapseRow)) {
      const rowActions = groupedCollapseRow < 0
        ? []
        : Array.from({ length: 120 }, (_, x) => [x, readGroup.clickAnchorAtPoint(x, groupedCollapseRow)]).filter(([, anchor]) => anchor);
      throw new Error(`grouped final detail layer did not expose a clickable collapse row: ${JSON.stringify({ rows: extraDetailedReadGroupRows, groupedCollapseRow, rowActions, semantics: readExecution.resultRendererComponent?.getSemanticRows?.().map((row: any) => ({ ...row, text: row.text.replace(/\x1b\[[0-9;]*m/g, "") })) })}`);
    }

    const progressiveAnchorCases = [
      { name: "bash", args: { command: "printf fixture" }, lines: Array.from({ length: 20 }, (_, i) => `bash line ${i + 1}`) },
      { name: "grep", args: { pattern: "fixture", path: "." }, lines: Array.from({ length: 20 }, (_, i) => `file.ts:${i + 1}:fixture`) },
      { name: "find", args: { pattern: "*.ts", path: "." }, lines: Array.from({ length: 20 }, (_, i) => `file-${i + 1}.ts`) },
      { name: "ls", args: { path: "." }, lines: Array.from({ length: 20 }, (_, i) => `entry-${i + 1}.ts`) },
      { name: "TaskList", args: {}, lines: Array.from({ length: 20 }, (_, i) => `#${i + 1} [pending] Task ${i + 1}`) },
    ];
    for (const fixture of progressiveAnchorCases) {
      const definition = fakePi.tools.get(fixture.name);
      if (!definition) throw new Error(`${fixture.name} renderer was not registered`);
      const execution = new ToolExecutionComponent(
        fixture.name,
        `${fixture.name}_anchor_matrix`,
        fixture.args,
        {},
        definition,
        { mode: "fullscreen", requestRender() {} } as any,
        process.cwd(),
      ) as any;
      execution.markExecutionStarted();
      execution.setArgsComplete();
      execution.updateResult({ content: [{ type: "text", text: fixture.lines.join("\n") }], isError: false }, false);

      const findAnchor = (action: string, viewportAnchor?: string): any => {
        const rows = execution.render(120);
        for (let y = 0; y < rows.length; y++) {
          for (let x = 0; x < 120; x++) {
            const anchor = execution.clickAnchorAtPoint(x, y);
            if (anchor?.action === action && (!viewportAnchor || anchor.viewportAnchor === viewportAnchor)) return anchor;
          }
        }
        return undefined;
      };
      if (!findAnchor("expand", "top") || !execution.activateClickAction("expand", "top")) {
        throw new Error(`${fixture.name} summary anchor did not expand`);
      }
      const levelZeroRows = execution.render(120).map((line: string) => plain(line));
      const rowWithAction = (action: string): number => levelZeroRows.findIndex((_: string, y: number) => (
        Array.from({ length: 120 }, (_: unknown, x: number) => execution.clickActionAtPoint(x, y)).includes(action)
      ));
      const levelZeroSummaryRow = rowWithAction("expand");
      const levelZeroDetailRow = rowWithAction("detail");
      if (
        levelZeroSummaryRow < 0
        || levelZeroDetailRow <= levelZeroSummaryRow
        || !levelZeroRows[levelZeroSummaryRow].trimStart().startsWith("├")
        || !levelZeroRows[levelZeroDetailRow].trimStart().startsWith("└")
        || levelZeroRows.slice(levelZeroSummaryRow + 1, levelZeroDetailRow)
          .some((line: string) => !line.trimStart().startsWith("│"))
      ) {
        throw new Error(`${fixture.name} L0 preview did not branch from its summary through its detail action: ${JSON.stringify(levelZeroRows)}`);
      }
      for (const level of [1, 2]) {
        if (!findAnchor("detail", "top") || !execution.activateClickAction("detail", "top")) {
          throw new Error(`${fixture.name} detail anchor did not activate level ${level}`);
        }
        if (execution.rendererState[Symbol.for("pi-claude-style-tools:tool-click-detail-level")] !== level) {
          throw new Error(`${fixture.name} detail anchor did not persist level ${level}`);
        }
      }
      if (!findAnchor("expand", "bottom") || !execution.activateClickAction("expand", "bottom") || execution.expanded) {
        throw new Error(`${fixture.name} final bottom anchor did not collapse`);
      }
      if (!findAnchor("header", "top") || !execution.activateClickAction("header", "top") || !execution.expanded) {
        throw new Error(`${fixture.name} header anchor did not re-expand`);
      }
      if (!execution.activateClickAction("header", "top") || execution.expanded) {
        throw new Error(`${fixture.name} header anchor did not collapse`);
      }
    }

    const openAiDefinition = fakePi.tools.get("web_search");
    if (!openAiDefinition) throw new Error("web_search renderer was not registered");
    const openAiExecution = new ToolExecutionComponent(
      "web_search",
      "web_search_anchor_matrix",
      { query: "fixture" },
      {},
      openAiDefinition,
      { mode: "fullscreen", requestRender() {} } as any,
      process.cwd(),
    ) as any;
    openAiExecution.markExecutionStarted();
    openAiExecution.setArgsComplete();
    openAiExecution.updateResult({
      content: [{ type: "text", text: Array.from({ length: 20 }, (_, i) => `search result ${i + 1}`).join("\n") }],
      isError: false,
    }, false);
    const findOpenAiAnchor = (action: string, viewportAnchor = "top"): any => {
      const rows = openAiExecution.render(120);
      for (let y = 0; y < rows.length; y++) {
        for (let x = 0; x < 120; x++) {
          const anchor = openAiExecution.clickAnchorAtPoint(x, y);
          if (anchor?.action === action && anchor.viewportAnchor === viewportAnchor) return anchor;
        }
      }
      return undefined;
    };
    if (!findOpenAiAnchor("expand") || !openAiExecution.activateClickAction("expand", "top")) {
      throw new Error("OpenAI-style summary anchor did not expand");
    }
    if (!findOpenAiAnchor("expand") || !findOpenAiAnchor("detail-extra")) {
      throw new Error("OpenAI-style capped output lacked inline collapse or extra-detail anchors");
    }
    if (findOpenAiAnchor("expand", "bottom")) {
      throw new Error("OpenAI-style non-progressive output exposed an invalid bottom anchor");
    }
    if (!openAiExecution.activateClickAction("detail-extra", "top")
      || openAiExecution.rendererState[Symbol.for("pi-claude-style-tools:tool-click-detail-level")] !== 2) {
      throw new Error("OpenAI-style extra-detail anchor did not activate maximum detail");
    }
    if (!findOpenAiAnchor("detail-extra") || !openAiExecution.activateClickAction("detail-extra", "top")
      || openAiExecution.rendererState[Symbol.for("pi-claude-style-tools:tool-click-detail-level")] !== undefined) {
      throw new Error("OpenAI-style less-detail anchor did not return to normal detail");
    }
    if (!openAiExecution.activateClickAction("expand", "top") || openAiExecution.expanded) {
      throw new Error("OpenAI-style inline collapse anchor did not collapse");
    }
    if (!findOpenAiAnchor("header") || !openAiExecution.activateClickAction("header", "top") || !openAiExecution.expanded) {
      throw new Error("OpenAI-style header anchor did not expand");
    }

    for (const terminal of [
      {
        name: "read",
        id: "read_image_anchor_matrix",
        args: { path: "fixture.png" },
        result: { content: [{ type: "image", data: "", mimeType: "image/png" }], isError: false },
      },
      {
        name: "web_search",
        id: "web_search_error_anchor_matrix",
        args: { query: "fixture" },
        result: { content: [{ type: "text", text: "search failed\nrequest rejected" }], isError: true },
      },
    ]) {
      const definition = fakePi.tools.get(terminal.name);
      const execution = new ToolExecutionComponent(
        terminal.name,
        terminal.id,
        terminal.args,
        {},
        definition,
        { mode: "fullscreen", requestRender() {} } as any,
        process.cwd(),
      ) as any;
      execution.markExecutionStarted();
      execution.setArgsComplete();
      execution.updateResult(terminal.result, false);
      const anchors = (): any[] => {
        const found = new Map<string, any>();
        const rows = execution.render(120);
        for (let y = 0; y < rows.length; y++) {
          for (let x = 0; x < 120; x++) {
            const anchor = execution.clickAnchorAtPoint(x, y);
            if (anchor) found.set(`${anchor.action}:${anchor.viewportAnchor}`, anchor);
          }
        }
        return [...found.values()];
      };
      if (!anchors().some((anchor) => anchor.action === "expand" && anchor.viewportAnchor === "top")
        || !execution.activateClickAction("expand", "top")) {
        throw new Error(`${terminal.id} collapsed expansion anchor did not activate`);
      }
      const expandedAnchors = anchors();
      if (expandedAnchors.some((anchor) => anchor.action === "detail" || anchor.action === "detail-extra" || anchor.viewportAnchor === "bottom")) {
        throw new Error(`${terminal.id} terminal expansion exposed an invalid detail or bottom anchor`);
      }
      if (!expandedAnchors.some((anchor) => anchor.action === "header")
        || !execution.activateClickAction("header", "top") || execution.expanded) {
        throw new Error(`${terminal.id} header anchor did not collapse the terminal expansion`);
      }
    }

    writePiSettings({
      clickExpansion: true,
      expandedPreviewMaxLines: 200,
      extraExpandedPreviewMaxLines: 240,
    });
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
      details: {
        _type: "diff",
        summary: "+1 -1",
        diff: { added: 1, removed: 1, chars: 4000, lines: expandedDiffLines },
        language: "typescript",
      },
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
        && writeExecution.rendererState._wdk.endsWith(":200")
        && writeExecution.rendererState._ptAsyncRenderPending === false,
      `standard-detail Write diff at its configured 200-line render cap (key: ${writeExecution.rendererState._wdk})`,
    );
    if (!/\x1b\[38;2;\d+;\d+;\d+mconst/.test(writeExecution.rendererState._wdt)) {
      throw new Error("standard-detail Write diff lost syntax highlighting above 150 rendered lines");
    }
    const standardWriteRows = writeExecution.render(120).map((line: string) => line.replace(/\x1b\[[0-9;]*m/g, ""));
    const writeExtraDetailRow = standardWriteRows.findIndex((line: string, index: number) => (
      line.includes("more diff lines") && writeDetailActionX(index) >= 0
    ));
    const writeExtraDetailText = standardWriteRows[writeExtraDetailRow] ?? "";
    if (!/^\s*└ …/.test(writeExtraDetailText)) {
      throw new Error(`standard-detail Write diff did not use one space after its branch indicator: ${JSON.stringify(writeExtraDetailText)}`);
    }

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
        && effectiveFinalWrite.rendererState._ptAsyncRenderPending === false
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

    {
      const pairedWriteLines = [
        ...Array.from({ length: 100 }, (_, index) => ({
          type: "del",
          content: `old paired line ${index + 1}`,
          oldNum: index + 1,
          newNum: null,
        })),
        ...Array.from({ length: 100 }, (_, index) => ({
          type: "add",
          content: `new paired line ${index + 1}`,
          oldNum: null,
          newNum: index + 1,
        })),
      ];
      const pairedWriteExecution = new ToolExecutionComponent(
        "write",
        "write_normal_split_final_fixture",
        { path: "paired-final.ts", content: "new" },
        {},
        write,
        { mode: "fullscreen", requestRender() {} } as any,
        process.cwd(),
      ) as any;
      pairedWriteExecution.markExecutionStarted();
      pairedWriteExecution.setArgsComplete();
      pairedWriteExecution.updateResult({
        content: [{ type: "text", text: "Wrote paired-final.ts" }],
        details: {
          _type: "diff",
          summary: "+100 -100",
          diff: { added: 100, removed: 100, chars: 4000, lines: pairedWriteLines },
        },
        isError: false,
      }, false);
      await waitFor(
        () => pairedWriteExecution.render(180).some((line: string) => plain(line).includes("more diff lines")),
        "collapsed paired Write split diff",
      );
      const collapsedPairedWriteRows = pairedWriteExecution.render(180).map((line: string) => plain(line));
      const pairedWriteSummaryRow = collapsedPairedWriteRows.findIndex((line: string) => line.includes("+100") && line.includes("-100"));
      const pairedWriteSummaryX = pairedWriteSummaryRow < 0
        ? -1
        : Array.from({ length: 180 }, (_, x) => x).find(
          (x) => pairedWriteExecution.clickActionAtPoint(x, pairedWriteSummaryRow) === "expand",
        ) ?? -1;
      if (
        pairedWriteSummaryX < 0
        || !pairedWriteExecution.activateClickAction(
          pairedWriteExecution.clickActionAtPoint(pairedWriteSummaryX, pairedWriteSummaryRow),
        )
      ) {
        throw new Error(`paired Write summary was not clickable: ${JSON.stringify(collapsedPairedWriteRows)}`);
      }
      const immediatePairedWriteRows = pairedWriteExecution.render(180).map((line: string) => plain(line));
      if (
        immediatePairedWriteRows.some((line: string) => line.includes("rendering diff"))
        || !immediatePairedWriteRows.some((line: string) => line.includes("old paired line 1"))
      ) {
        throw new Error(`paired Write replaced its stable preview during async expansion: ${JSON.stringify(immediatePairedWriteRows)}`);
      }
      const collapseText = "Output ends here • click to collapse";
      await waitFor(
        () => pairedWriteExecution.render(180).some((line: string) => plain(line).includes(collapseText)),
        "normal expanded paired Write bottom collapse anchor",
      );
      const expandedPairedWriteRows = pairedWriteExecution.render(180).map((line: string) => plain(line));
      if (expandedPairedWriteRows.some((line: string) => line.includes("more diff lines"))) {
        throw new Error(`fully rendered paired Write retained a hidden-diff row: ${JSON.stringify(expandedPairedWriteRows)}`);
      }
    }

    {
      const newFileContent = Array.from({ length: 100 }, (_, index) => `new file line ${index + 1}`).join("\n");
      const newFileWriteExecution = new ToolExecutionComponent(
        "write",
        "write_normal_new_file_final_fixture",
        { path: "new-final.ts", content: newFileContent },
        {},
        write,
        { mode: "fullscreen", requestRender() {} } as any,
        process.cwd(),
      ) as any;
      newFileWriteExecution.markExecutionStarted();
      newFileWriteExecution.setArgsComplete();
      newFileWriteExecution.updateResult({
        content: [{ type: "text", text: "Wrote new-final.ts" }],
        details: { _type: "new", lines: 100, filePath: "new-final.ts" },
        isError: false,
      }, false);
      await waitFor(
        () => newFileWriteExecution.render(120).some((line: string) => plain(line).includes("more diff lines")),
        "collapsed new-file Write diff",
      );
      const collapsedNewFileRows = newFileWriteExecution.render(120).map((line: string) => plain(line));
      const newFileSummaryRow = collapsedNewFileRows.findIndex((line: string) => line.includes("+100") && line.includes("new file"));
      const newFileSummaryX = newFileSummaryRow < 0
        ? -1
        : Array.from({ length: 120 }, (_, x) => x).find(
          (x) => newFileWriteExecution.clickActionAtPoint(x, newFileSummaryRow) === "expand",
        ) ?? -1;
      if (
        newFileSummaryX < 0
        || !newFileWriteExecution.activateClickAction(
          newFileWriteExecution.clickActionAtPoint(newFileSummaryX, newFileSummaryRow),
        )
      ) {
        throw new Error(`new-file Write summary was not clickable: ${JSON.stringify(collapsedNewFileRows)}`);
      }
      const immediateNewFileRows = newFileWriteExecution.render(120).map((line: string) => plain(line));
      if (
        immediateNewFileRows.some((line: string) => line.includes("rendering diff"))
        || !immediateNewFileRows.some((line: string) => line.includes("new file line 1"))
      ) {
        throw new Error(`new-file Write replaced its stable preview during async expansion: ${JSON.stringify(immediateNewFileRows)}`);
      }
      const collapseText = "Output ends here • click to collapse";
      await waitFor(
        () => newFileWriteExecution.render(120).some((line: string) => plain(line).includes(collapseText)),
        "normal expanded new-file Write bottom collapse anchor",
      );
      const expandedNewFileRows = newFileWriteExecution.render(120).map((line: string) => plain(line));
      if (expandedNewFileRows.some((line: string) => line.includes("more diff lines"))) {
        throw new Error(`fully rendered new-file Write retained a hidden-diff row: ${JSON.stringify(expandedNewFileRows)}`);
      }
    }

    {
      const shortWriteExecution = new ToolExecutionComponent(
        "write",
        "write_short_fully_visible_fixture",
        { path: "short-write.ts", content: "const value = 2;" },
        {},
        write,
        { mode: "fullscreen", requestRender() {} } as any,
        process.cwd(),
      ) as any;
      shortWriteExecution.markExecutionStarted();
      shortWriteExecution.setArgsComplete();
      shortWriteExecution.updateResult({
        content: [{ type: "text", text: "Wrote short-write.ts" }],
        details: {
          _type: "diff",
          summary: "+1 -1",
          diff: {
            added: 1,
            removed: 1,
            chars: 32,
            lines: [
              { type: "del", content: "const value = 1;", oldNum: 1, newNum: null },
              { type: "add", content: "const value = 2;", oldNum: null, newNum: 1 },
            ],
          },
        },
        isError: false,
      }, false);
      await waitFor(
        () => shortWriteExecution.render(120).some((line: string) => {
          const text = plain(line);
          return text.includes("+1") && text.includes("-1");
        }),
        "fully visible short Write preview",
      );
      const shortWriteRows = shortWriteExecution.render(120).map((line: string) => plain(line));
      const shortWriteSummaryRow = shortWriteRows.findIndex(
        (line: string) => line.includes("+1") && line.includes("-1"),
      );
      const shortWriteSummaryActions = shortWriteSummaryRow < 0
        ? []
        : Array.from({ length: 120 }, (_, x) => shortWriteExecution.clickActionAtPoint(x, shortWriteSummaryRow))
          .filter((action) => action !== undefined);
      if (shortWriteSummaryRow < 0 || shortWriteSummaryActions.length > 0) {
        throw new Error(`fully visible short Write exposed a no-op summary action: ${JSON.stringify({ shortWriteRows, shortWriteSummaryActions })}`);
      }
      shortWriteExecution.setExpanded(true);
      await waitFor(
        () => shortWriteExecution.render(120).some((line: string) => plain(line).includes("const value = 2;")),
        "programmatically expanded short Write preview",
      );
      const expandedShortWriteRows = shortWriteExecution.render(120).map((line: string) => plain(line));
      if (expandedShortWriteRows.some((line: string) => line.includes("click to collapse"))) {
        throw new Error(`fully visible short Write added a no-op collapse anchor: ${JSON.stringify(expandedShortWriteRows)}`);
      }
    }

    {
      const tabbedWriteExecution = new ToolExecutionComponent(
        "write",
        "write_tab_indentation_fixture",
        { path: "tabbed-write.ts", content: "    WRITE_SPACE_INDENT\n\tWRITE_TAB_INDENT" },
        {},
        write,
        { mode: "fullscreen", requestRender() {} } as any,
        process.cwd(),
      ) as any;
      tabbedWriteExecution.markExecutionStarted();
      tabbedWriteExecution.setArgsComplete();
      tabbedWriteExecution.updateResult({
        content: [{ type: "text", text: "Wrote tabbed-write.ts" }],
        details: { _type: "new", filePath: "tabbed-write.ts", lines: 2 },
        isError: false,
      }, false);
      await waitFor(
        () => tabbedWriteExecution.render(120).some((line: string) => plain(line).includes("WRITE_TAB_INDENT")),
        "tab-indented new-file Write preview",
      );
      const tabbedWriteRows = tabbedWriteExecution.render(120).map((line: string) => plain(line));
      const spaceIndentColumn = tabbedWriteRows.find((line: string) => line.includes("WRITE_SPACE_INDENT"))?.indexOf("WRITE_SPACE_INDENT") ?? -1;
      const tabIndentColumn = tabbedWriteRows.find((line: string) => line.includes("WRITE_TAB_INDENT"))?.indexOf("WRITE_TAB_INDENT") ?? -1;
      if (spaceIndentColumn < 0 || tabIndentColumn !== spaceIndentColumn) {
        throw new Error(`new-file Write did not preserve tab indentation: ${JSON.stringify({ spaceIndentColumn, tabIndentColumn, tabbedWriteRows })}`);
      }
    }

    {
      const applyPatch = fakePi.tools.get("apply_patch");
      if (typeof applyPatch?.renderCall !== "function") throw new Error("Apply Patch renderer was not registered");
      const shortPatchText = [
        "*** Begin Patch",
        "*** Add File: apply-short-visible.ts",
        "+const first = 1;",
        "+const second = 2;",
        "*** End Patch",
      ].join("\n");
      const shortApplyPatchExecution = new ToolExecutionComponent(
        "apply_patch",
        "apply_patch_short_fully_visible_fixture",
        { patchText: shortPatchText },
        {},
        applyPatch,
        { mode: "fullscreen", requestRender() {} } as any,
        process.cwd(),
      ) as any;
      shortApplyPatchExecution.markExecutionStarted();
      shortApplyPatchExecution.setArgsComplete();
      await waitFor(
        () => shortApplyPatchExecution.render(120).some((line: string) => {
          const text = plain(line);
          return text.includes("Create apply-short-visible.ts") && text.includes("+2");
        }),
        "fully visible short Apply Patch preview",
      );
      const shortApplyPatchRows = shortApplyPatchExecution.render(120).map((line: string) => plain(line));
      const shortApplySummaryRow = shortApplyPatchRows.findIndex(
        (line: string) => line.includes("Create apply-short-visible.ts") && line.includes("+2"),
      );
      const shortApplySummaryActions = shortApplySummaryRow < 0
        ? []
        : Array.from({ length: 120 }, (_, x) => shortApplyPatchExecution.clickActionAtPoint(x, shortApplySummaryRow))
          .filter((action) => action !== undefined);
      if (shortApplySummaryRow < 0 || shortApplySummaryActions.length > 0) {
        throw new Error(`fully visible short Apply Patch exposed a no-op summary action: ${JSON.stringify({ shortApplyPatchRows, shortApplySummaryActions })}`);
      }
      shortApplyPatchExecution.setExpanded(true);
      await waitFor(
        () => shortApplyPatchExecution.render(120).some((line: string) => plain(line).includes("const second = 2;")),
        "programmatically expanded short Apply Patch preview",
      );
      const expandedShortApplyRows = shortApplyPatchExecution.render(120).map((line: string) => plain(line));
      if (expandedShortApplyRows.some((line: string) => line.includes("click to collapse"))) {
        throw new Error(`fully visible short Apply Patch added a no-op collapse anchor: ${JSON.stringify(expandedShortApplyRows)}`);
      }
    }

    {
      const applyPatch = fakePi.tools.get("apply_patch");
      if (typeof applyPatch?.renderCall !== "function") throw new Error("Apply Patch renderer was not registered");
      const patchText = [
        "*** Begin Patch",
        "*** Add File: apply-single-final.ts",
        ...Array.from({ length: 40 }, (_, index) => `+apply patch line ${index + 1}`),
        "*** End Patch",
      ].join("\n");
      const applyPatchExecution = new ToolExecutionComponent(
        "apply_patch",
        "apply_patch_single_final_fixture",
        { patchText },
        {},
        applyPatch,
        { mode: "fullscreen", requestRender() {} } as any,
        process.cwd(),
      ) as any;
      applyPatchExecution.markExecutionStarted();
      applyPatchExecution.setArgsComplete();
      await waitFor(
        () => applyPatchExecution.render(120).some((line: string) => plain(line).includes("more diff lines")),
        "collapsed single-file Apply Patch preview",
      );
      const collapsedApplyPatchRows = applyPatchExecution.render(120).map((line: string) => plain(line));
      const applyPatchSummaryRow = collapsedApplyPatchRows.findIndex(
        (line: string) => line.includes("Create apply-single-final.ts") && line.includes("+40"),
      );
      const applyPatchSummaryX = applyPatchSummaryRow < 0
        ? -1
        : Array.from({ length: 120 }, (_, x) => x).find(
          (x) => applyPatchExecution.clickActionAtPoint(x, applyPatchSummaryRow) === "expand",
        ) ?? -1;
      if (
        applyPatchSummaryX < 0
        || !applyPatchExecution.activateClickAction(
          applyPatchExecution.clickActionAtPoint(applyPatchSummaryX, applyPatchSummaryRow),
        )
      ) {
        throw new Error(`single-file Apply Patch summary was not clickable: ${JSON.stringify({
          rows: collapsedApplyPatchRows,
          semantics: applyPatchExecution.callRendererComponent?.getSemanticRows?.().map((row: any) => ({
            ...row,
            text: plain(row.text),
          })),
        })}`);
      }
      const collapseText = "Output ends here • click to collapse";
      await waitFor(
        () => applyPatchExecution.render(120).some((line: string) => plain(line).includes(collapseText)),
        "normal expanded single-file Apply Patch bottom collapse anchor",
      );
      const expandedApplyPatchRows = applyPatchExecution.render(120).map((line: string) => plain(line));
      if (expandedApplyPatchRows.some((line: string) => line.includes("more diff lines"))) {
        throw new Error(`fully rendered single-file Apply Patch retained a hidden-diff row: ${JSON.stringify(expandedApplyPatchRows)}`);
      }
    }

    {
      const applyPatch = fakePi.tools.get("apply_patch");
      if (typeof applyPatch?.renderCall !== "function") throw new Error("Apply Patch renderer was not registered");
      const filePatch = (pathName: string) => [
        `*** Add File: ${pathName}`,
        ...Array.from({ length: 40 }, (_, index) => `+${pathName} line ${index + 1}`),
      ];
      const patchText = [
        "*** Begin Patch",
        ...filePatch("apply-multi-a.ts"),
        ...filePatch("apply-multi-b.ts"),
        "*** End Patch",
      ].join("\n");
      const multiApplyPatchExecution = new ToolExecutionComponent(
        "apply_patch",
        "apply_patch_multi_final_fixture",
        { patchText },
        {},
        applyPatch,
        { mode: "fullscreen", requestRender() {} } as any,
        process.cwd(),
      ) as any;
      multiApplyPatchExecution.markExecutionStarted();
      multiApplyPatchExecution.setArgsComplete();
      await waitFor(
        () => multiApplyPatchExecution.render(120).some((line: string) => plain(line).includes("2 files")),
        "collapsed multi-file Apply Patch preview",
      );
      multiApplyPatchExecution.updateResult({
        content: [{ type: "text", text: "Done!" }],
        details: {},
        isError: false,
      }, false);
      const collapsedMultiApplyRows = multiApplyPatchExecution.render(120).map((line: string) => plain(line));
      const collapsedMultiApplyContent = collapsedMultiApplyRows.filter((line: string) => line.trim().length > 0);
      const collapsedApplyHunkRows = collapsedMultiApplyContent.filter((line: string) => line.includes("hunks"));
      const collapsedApplyHunkRow = collapsedMultiApplyContent.findIndex((line: string) => line.includes("hunks"));
      const firstApplyBlockRow = collapsedMultiApplyContent.findIndex((line: string) => line.includes("Create apply-multi-a.ts"));
      const collapsedApplyBlockHeadings = collapsedMultiApplyContent.filter((line: string) => line.includes("Create apply-multi-"));
      const collapsedApplyLocalRemainders = collapsedMultiApplyContent.filter((line: string) => line.includes("more diff lines"));
      if (
        collapsedApplyHunkRows.length !== 1
        || collapsedApplyHunkRow < 0
        || collapsedApplyHunkRow >= firstApplyBlockRow
        || collapsedApplyBlockHeadings.some((line: string) => !/^\s*├ Create apply-multi-/.test(line))
        || collapsedApplyLocalRemainders.length !== 2
        || !/^\s*│ …/.test(collapsedApplyLocalRemainders[0] ?? "")
        || !/^\s*└ …/.test(collapsedApplyLocalRemainders[1] ?? "")
        || collapsedMultiApplyContent.at(-1) !== collapsedApplyLocalRemainders[1]
      ) {
        throw new Error(`collapsed multi-file Apply Patch did not follow aggregate/block/terminal branch grammar: ${JSON.stringify(collapsedMultiApplyContent)}`);
      }
      const multiApplySummaryRow = collapsedMultiApplyRows.findIndex(
        (line: string) => line.includes("2 files") && line.includes("+80"),
      );
      const multiApplySummaryX = multiApplySummaryRow < 0
        ? -1
        : Array.from({ length: 120 }, (_, x) => x).find(
          (x) => multiApplyPatchExecution.clickActionAtPoint(x, multiApplySummaryRow) === "expand",
        ) ?? -1;
      if (
        multiApplySummaryX < 0
        || !multiApplyPatchExecution.activateClickAction(
          multiApplyPatchExecution.clickActionAtPoint(multiApplySummaryX, multiApplySummaryRow),
        )
      ) {
        throw new Error(`multi-file Apply Patch summary was not clickable: ${JSON.stringify(collapsedMultiApplyRows)}`);
      }
      const collapseText = "Output ends here • click to collapse";
      await waitFor(
        () => multiApplyPatchExecution.render(120).some((line: string) => plain(line).includes(collapseText)),
        "normal expanded multi-file Apply Patch bottom collapse anchor",
      );
      const expandedMultiApplyRows = multiApplyPatchExecution.render(120).map((line: string) => plain(line));
      const expandedMultiApplyContent = expandedMultiApplyRows.filter((line: string) => line.trim().length > 0);
      const expandedApplyHunkRows = expandedMultiApplyContent.filter((line: string) => line.includes("hunks"));
      const expandedApplyBlockHeadings = expandedMultiApplyContent.filter((line: string) => line.includes("Create apply-multi-"));
      const expandedApplyTerminal = expandedMultiApplyContent.at(-1) ?? "";
      if (
        expandedApplyHunkRows.length !== 1
        || expandedApplyBlockHeadings.some((line: string) => !/^\s*├ Create apply-multi-/.test(line))
        || !/^\s*└ Output ends here/.test(expandedApplyTerminal)
      ) {
        throw new Error(`expanded multi-file Apply Patch did not keep one summary and one terminal collapse row: ${JSON.stringify(expandedMultiApplyContent)}`);
      }
    }

    {
      const restoredEditArgs = {
        path: "restored-edit-fixture.ts",
        oldText: "old restored value",
        newText: "new restored value",
      };
      const restoredEditExecution = new ToolExecutionComponent(
        "edit",
        "restored_edit_fixture",
        restoredEditArgs,
        {},
        edit,
        { mode: "fullscreen", requestRender() {} } as any,
        process.cwd(),
      ) as any;
      restoredEditExecution.updateResult({
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
      }, false);
      const restoredEditRows = restoredEditExecution.render(120).map((line: string) => plain(line));
      if (
        restoredEditRows.filter((line: string) => line.includes("1 hunk")).length !== 1
        || !restoredEditRows.some((line: string) => /^└ .*\+1.*-1.*1 hunk/.test(line))
        || !restoredEditRows.find((line: string) => line.trim())?.startsWith("● Edit")
      ) {
        throw new Error(`restored completed Edit was indented or lost its original result summary: ${JSON.stringify(restoredEditRows)}`);
      }
    }

    {
      const addedOnlyEditExecution = new ToolExecutionComponent(
        "edit",
        "added_only_edit_fixture",
        {
          path: "missing-added-only-edit-fixture.ts",
          oldText: "anchor line",
          newText: [
            "anchor line",
            ...Array.from(
              { length: 12 },
              (_, index) => `added line ${index + 1} ${"wide content ".repeat(16)}`,
            ),
          ].join("\n"),
        },
        {},
        edit,
        { mode: "fullscreen", requestRender() {} } as any,
        process.cwd(),
      ) as any;
      addedOnlyEditExecution.markExecutionStarted();
      addedOnlyEditExecution.setArgsComplete();
      addedOnlyEditExecution.render(120);
      await waitFor(
        () => addedOnlyEditExecution.rendererState?._ptAsyncRenderPending !== true
          && addedOnlyEditExecution.rendererState?._ptTree?.blocks?.[0]?.content,
        "added-only Edit preview",
      );
      const firstAddedOnlyDiffRow = plain(
        addedOnlyEditExecution.rendererState?._ptTree?.blocks?.[0]?.content?.split("\n")?.[0] ?? "",
      );
      const addedOnlyRows = addedOnlyEditExecution.render(120).map((line: string) => plain(line));
      const addedOnlySummaryRow = addedOnlyRows.findIndex((line: string) => line.includes("1 hunk"));
      const physicalRowAfterAddedOnlySummary = addedOnlyRows[addedOnlySummaryRow + 1] ?? "";
      if (
        !/^─+$/.test(firstAddedOnlyDiffRow.trim())
        || !/^│ ─+\s*$/.test(physicalRowAfterAddedOnlySummary)
      ) {
        throw new Error(`single unified Edit did not place its top border directly after the summary: ${JSON.stringify({ logicalRuleWidth: firstAddedOnlyDiffRow.length, physicalRowAfterAddedOnlySummary, addedOnlyRows })}`);
      }
    }

    {
      const shortEditWidth = 180;
      let shortEditRenderRequests = 0;
      const shortEditExecution = new ToolExecutionComponent(
        "edit",
        "edit_short_fully_visible_fixture",
        {
          path: "missing-short-edit-fixture.ts",
          oldText: "const value = 1;",
          newText: "const value = 2;",
        },
        {},
        edit,
        { mode: "fullscreen", requestRender() { shortEditRenderRequests++; } } as any,
        process.cwd(),
      ) as any;
      shortEditExecution.markExecutionStarted();
      shortEditExecution.setArgsComplete();
      await waitFor(
        () => shortEditExecution.render(shortEditWidth).some((line: string) => {
          const text = plain(line);
          return text.includes("+1") && text.includes("-1");
        }),
        "fully visible short Edit preview",
      );
      const shortEditRows = shortEditExecution.render(shortEditWidth).map((line: string) => plain(line));
      const shortEditSummaryRow = shortEditRows.findIndex(
        (line: string) => line.includes("+1") && line.includes("-1"),
      );
      const shortEditSummaryActions = shortEditSummaryRow < 0
        ? []
        : Array.from({ length: shortEditWidth }, (_, x) => shortEditExecution.clickActionAtPoint(x, shortEditSummaryRow))
          .filter((action) => action !== undefined);
      if (
        shortEditSummaryRow < 0
        || shortEditSummaryActions.length > 0
        || shortEditRows.some((line: string) => line.includes("click to collapse"))
      ) {
        throw new Error(`fully visible short Edit exposed a no-op click control: ${JSON.stringify({ shortEditRows, shortEditSummaryActions })}`);
      }
      shortEditExecution.updateResult({
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
      }, false);
      await waitFor(
        () => {
          const rows = shortEditExecution.render(shortEditWidth).map((line: string) => plain(line));
          return rows.filter((line: string) => line.includes("+1") && line.includes("-1")).length === 1
            && rows.filter((line: string) => line.includes("1 hunk")).length === 1;
        },
        "complete fully visible short Edit execution",
      );
      const completeShortEditRows = shortEditExecution.render(shortEditWidth).map((line: string) => plain(line));
      const completeShortEditTree = shortEditExecution.rendererState?._ptTree;
      const firstShortEditDiffRow = plain(
        completeShortEditTree?.blocks?.[0]?.content?.split("\n")?.[0] ?? "",
      );
      const completeShortEditSummaryRow = completeShortEditRows.findIndex((line: string) => line.includes("1 hunk"));
      const physicalRowAfterShortEditSummary = completeShortEditRows[completeShortEditSummaryRow + 1] ?? "";
      if (
        !completeShortEditTree?.summary?.trim()
        || !firstShortEditDiffRow.includes("old")
        || !firstShortEditDiffRow.includes("new")
        || !firstShortEditDiffRow.includes("┊")
        || !/^│ old.*┊new/.test(physicalRowAfterShortEditSummary)
      ) {
        throw new Error(`single split Edit inserted a physical gap above its diff: ${JSON.stringify(completeShortEditRows)}`);
      }
      const shortEditAnchorPoints = completeShortEditRows.flatMap((_line: string, y: number) => {
        const x = Array.from({ length: shortEditWidth }, (_, candidate) => candidate).find(
          (candidate) => shortEditExecution.clickAnchorAtPoint(candidate, y) !== undefined,
        );
        return x === undefined ? [] : [{ x, y }];
      });
      if (shortEditAnchorPoints.length < 1) {
        throw new Error(`complete short Edit did not retain its inert header anchor: ${JSON.stringify(completeShortEditRows)}`);
      }
      const rowsBeforeNoOpClicks = shortEditExecution.render(shortEditWidth);
      const renderRequestsBeforeNoOpClicks = shortEditRenderRequests;
      for (const point of shortEditAnchorPoints) {
        const anchor = shortEditExecution.clickAnchorAtPoint(point.x, point.y);
        if (!anchor) throw new Error(`short Edit anchor vanished before activation: ${JSON.stringify(point)}`);
        if (shortEditExecution.activateClickAction(anchor.action, anchor.viewportAnchor)) {
          throw new Error(`fully visible short Edit activated a no-op anchor: ${JSON.stringify({ point, anchor })}`);
        }
      }
      if (
        shortEditExecution.expanded === true
        || shortEditRenderRequests !== renderRequestsBeforeNoOpClicks
        || JSON.stringify(shortEditExecution.render(shortEditWidth)) !== JSON.stringify(rowsBeforeNoOpClicks)
      ) {
        throw new Error(`fully visible short Edit repainted after no-op clicks: ${JSON.stringify({ shortEditRenderRequests, renderRequestsBeforeNoOpClicks })}`);
      }
      shortEditExecution.setExpanded(true);
      await waitFor(
        () => shortEditExecution.render(shortEditWidth).some((line: string) => plain(line).includes("const value = 2;")),
        "programmatically expanded short Edit preview",
      );
      const expandedShortEditRows = shortEditExecution.render(shortEditWidth).map((line: string) => plain(line));
      if (expandedShortEditRows.some((line: string) => line.includes("click to collapse"))) {
        throw new Error(`fully visible short Edit added a no-op collapse anchor after expansion: ${JSON.stringify(expandedShortEditRows)}`);
      }
    }

    {
      const postEditDir = mkdtempSync(join(tmpdir(), "pi-cc-tools-post-edit-lines-"));
      try {
        const sourceLines = Array.from({ length: 420 }, (_, index) => `ORIGINAL_${index + 1}`);
        const operation = (prefix: string, start: number, end: number) => ({
          oldText: Array.from({ length: end - start + 1 }, (_, index) => `ORIGINAL_${start + index}`).join("\n"),
          newText: Array.from({ length: end - start + 1 }, (_, index) => `${prefix}_${start + index}`).join("\n"),
        });
        const operations = [operation("MULTI_A", 101, 140), operation("MULTI_B", 351, 390)];
        for (const { prefix, start, end } of [
          { prefix: "MULTI_A", start: 101, end: 140 },
          { prefix: "MULTI_B", start: 351, end: 390 },
        ]) {
          for (let line = start; line <= end; line++) sourceLines[line - 1] = `${prefix}_${line}`;
        }
        const postEditPath = join(postEditDir, "post-edit-lines.txt");
        writeFileSync(postEditPath, `${sourceLines.join("\n")}\n`);
        const postEditExecution = new ToolExecutionComponent(
          "edit",
          "post_edit_line_number_fixture",
          { path: postEditPath, edits: operations },
          {},
          edit,
          { mode: "fullscreen", requestRender() {} } as any,
          process.cwd(),
        ) as any;
        postEditExecution.markExecutionStarted();
        postEditExecution.setArgsComplete();
        await waitFor(
          () => {
            postEditExecution.render(180);
            return postEditExecution.rendererState?._ptAsyncRenderPending !== true
              && postEditExecution.rendererState?._ptTree?.blocks?.length === 2;
          },
          "post-write multi-Edit localization",
        );
        const tree = postEditExecution.rendererState?._ptTree;
        const expectedBlocks = [
          { token: "MULTI_A_101", line: 101 },
          { token: "MULTI_B_351", line: 351 },
        ];
        for (const [index, expected] of expectedBlocks.entries()) {
          const heading = plain(tree.blocks[index]?.heading ?? "");
          const contentRows = plain(tree.blocks[index]?.content ?? "").split("\n");
          const row = contentRows.find((line: string) => line.includes(expected.token)) ?? "";
          if (
            !heading.includes(`at line ${expected.line}`)
            || !new RegExp(`\\b${expected.line}\\+`).test(row)
          ) {
            throw new Error(`post-write multi-Edit lost source line ${expected.line}: ${JSON.stringify({ heading, row })}`);
          }
        }

        const retainedLines = Array.from({ length: 140 }, (_, index) => `RETAINED_${index + 1}`);
        const retainedOperations = [
          {
            oldText: "RETAINED_27",
            newText: ["RETAINED_27", "FIRST_INSERT_1", "FIRST_INSERT_2", "FIRST_INSERT_3", "FIRST_INSERT_4", "FIRST_INSERT_5"].join("\n"),
          },
          {
            oldText: "RETAINED_83",
            newText: ["RETAINED_83", "SECOND_INSERT_1", "SECOND_INSERT_2", "SECOND_INSERT_3", "SECOND_INSERT_4", "SECOND_INSERT_5", "SECOND_INSERT_6"].join("\n"),
          },
        ];
        for (const operation of [...retainedOperations].reverse()) {
          const index = retainedLines.indexOf(operation.oldText);
          retainedLines.splice(index, 1, ...operation.newText.split("\n"));
        }
        const retainedPath = join(postEditDir, "retained-prefix-lines.txt");
        writeFileSync(retainedPath, `${retainedLines.join("\n")}\n`);
        const retainedExecution = new ToolExecutionComponent(
          "edit",
          "post_edit_retained_prefix_fixture",
          { path: retainedPath, edits: retainedOperations },
          {},
          edit,
          { mode: "fullscreen", requestRender() {} } as any,
          process.cwd(),
        ) as any;
        retainedExecution.markExecutionStarted();
        retainedExecution.setArgsComplete();
        await waitFor(
          () => {
            retainedExecution.render(180);
            return retainedExecution.rendererState?._ptAsyncRenderPending !== true
              && retainedExecution.rendererState?._ptTree?.blocks?.length === 2;
          },
          "post-write retained-prefix multi-Edit localization",
        );
        const retainedTree = retainedExecution.rendererState?._ptTree;
        const secondHeading = plain(retainedTree.blocks[1]?.heading ?? "");
        const secondRows = plain(retainedTree.blocks[1]?.content ?? "").split("\n");
        const secondAnchorRow = secondRows.find((line: string) => line.includes("RETAINED_83")) ?? "";
        if (
          !secondHeading.includes("at line 88")
          || !/\b83-/.test(secondAnchorRow)
          || !/\b88\+/.test(secondAnchorRow)
        ) {
          throw new Error(`retained-prefix multi-Edit shifted block 2 twice: ${JSON.stringify({ secondHeading, secondAnchorRow })}`);
        }
      } finally {
        rmSync(postEditDir, { recursive: true, force: true });
      }
    }

    {
      const editLines = (prefix: string) => Array.from({ length: 80 }, (_, index) => `${prefix} ${index + 1}`).join("\n");
      const asyncEditExecution = new ToolExecutionComponent(
        "edit",
        "edit_async_detail_fixture",
        {
          path: "missing-async-detail-fixture.ts",
          oldText: editLines("old async line"),
          newText: editLines("new async line"),
        },
        {},
        edit,
        { mode: "fullscreen", requestRender() {} } as any,
        process.cwd(),
      ) as any;
      asyncEditExecution.markExecutionStarted();
      asyncEditExecution.setArgsComplete();
      await waitFor(
        () => asyncEditExecution.render(120).some((line: string) => plain(line).includes("more diff lines")),
        "collapsed async Edit preview",
      );
      const collapsedAsyncEditRows = asyncEditExecution.render(120).map((line: string) => plain(line));
      const asyncEditSummaryRow = collapsedAsyncEditRows.findIndex(
        (line: string) => line.includes("+80") && line.includes("-80"),
      );
      const asyncEditSummaryX = asyncEditSummaryRow < 0
        ? -1
        : Array.from({ length: 120 }, (_, x) => x).find(
          (x) => asyncEditExecution.clickActionAtPoint(x, asyncEditSummaryRow) === "expand",
        ) ?? -1;
      if (
        asyncEditSummaryX < 0
        || !asyncEditExecution.activateClickAction(
          asyncEditExecution.clickActionAtPoint(asyncEditSummaryX, asyncEditSummaryRow),
        )
      ) {
        throw new Error(`async Edit summary was not clickable: ${JSON.stringify(collapsedAsyncEditRows)}`);
      }
      const immediateExpandedEditRows = asyncEditExecution.render(120).map((line: string) => plain(line));
      if (
        immediateExpandedEditRows.some((line: string) => line.includes("rendering"))
        || !immediateExpandedEditRows.some((line: string) => line.includes("old async line 1"))
      ) {
        throw new Error(`Edit replaced its stable preview during async expansion: ${JSON.stringify(immediateExpandedEditRows)}`);
      }
      await waitFor(
        () => asyncEditExecution.rendererState?._ptAsyncRenderPending !== true
          && asyncEditExecution.render(120).some((line: string, row: number) => (
            plain(line).includes("more diff lines")
            && Array.from({ length: 120 }, (_, x) => x).some(
              (x) => asyncEditExecution.clickActionAtPoint(x, row) === "detail",
            )
          )),
        "normal expanded async Edit preview",
      );
      const normalAsyncEditRows = asyncEditExecution.render(120).map((line: string) => plain(line));
      const asyncEditDetailRow = normalAsyncEditRows.findIndex((line: string, row: number) => (
        line.includes("more diff lines")
        && Array.from({ length: 120 }, (_, x) => x).some(
          (x) => asyncEditExecution.clickActionAtPoint(x, row) === "detail",
        )
      ));
      if (asyncEditDetailRow < 0 || !asyncEditExecution.activateClickAction("detail")) {
        throw new Error(`normal async Edit preview lacked a detail action: ${JSON.stringify(normalAsyncEditRows)}`);
      }
      const immediateDetailedEditRows = asyncEditExecution.render(120).map((line: string) => plain(line));
      if (
        immediateDetailedEditRows.some((line: string) => line.includes("rendering"))
        || !immediateDetailedEditRows.some((line: string) => line.includes("old async line 1"))
      ) {
        throw new Error(`Edit replaced its stable preview during async detail expansion: ${JSON.stringify(immediateDetailedEditRows)}`);
      }
      const collapseText = "Output ends here • click to collapse";
      await waitFor(
        () => asyncEditExecution.render(120).some((line: string) => plain(line).includes(collapseText)),
        "async Edit level-1 bottom collapse anchor",
      );
      const detailedAsyncEditRows = asyncEditExecution.render(120).map((line: string) => plain(line));
      if (detailedAsyncEditRows.some((line: string) => line.includes("more diff lines"))) {
        throw new Error(`async Edit level 1 did not retain its configured 200-line budget: ${JSON.stringify(detailedAsyncEditRows)}`);
      }
      if (!asyncEditExecution.activateClickAction("expand", "bottom")) {
        throw new Error("async Edit bottom anchor did not start collapse");
      }
      const immediateCollapsedEditRows = asyncEditExecution.render(120).map((line: string) => plain(line));
      if (
        immediateCollapsedEditRows.some((line: string) => line.includes("rendering"))
        || !immediateCollapsedEditRows.some((line: string) => line.includes("old async line 80"))
      ) {
        throw new Error(`Edit replaced its stable preview during async bottom collapse: ${JSON.stringify(immediateCollapsedEditRows)}`);
      }
      if (asyncEditExecution.activateClickAction("expand", "bottom")) {
        throw new Error("pending Edit bottom anchor re-expanded the execution");
      }
      await waitFor(
        () => asyncEditExecution.render(120).some((line: string) => plain(line).includes("more diff lines")),
        "async Edit bottom collapse completion",
      );
    }

    {
      const editAnchorWidth = 180;
      const splitLines = (prefix: string, editIndex: number) => Array.from(
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
      const editAnchorExecution = new ToolExecutionComponent(
        "edit",
        "edit_anchor_fixture",
        editAnchorArgs,
        {},
        edit,
        { mode: "fullscreen", requestRender() {} } as any,
        process.cwd(),
      ) as any;
      editAnchorExecution.markExecutionStarted();
      editAnchorExecution.setArgsComplete();
      await waitFor(
        () => editAnchorExecution.render(editAnchorWidth).some((line: string) => plain(line).includes("more edit block")),
        "collapsed multi-Edit preview",
      );
      editAnchorExecution.updateResult({
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
      }, false);
      await waitFor(
        () => editAnchorExecution.rendererState?._ptAsyncRenderPending !== true
          && editAnchorExecution.render(editAnchorWidth).some((line: string) => plain(line).includes("more edit block")),
        "settled collapsed multi-Edit preview",
      );

      const collapsedEditRows = editAnchorExecution.render(editAnchorWidth).map((line: string) => plain(line));
      const collapsedEditContentRows = collapsedEditRows.filter((line: string) => line.trim().length > 0);
      const collapsedHunkRows = collapsedEditContentRows.filter((line: string) => line.includes("hunks"));
      const collapsedHunkRow = collapsedEditContentRows.findIndex((line: string) => line.includes("hunks"));
      const firstEditBlockRow = collapsedEditContentRows.findIndex((line: string) => line.includes("Edit 1/4"));
      const collapsedBlockHeadings = collapsedEditContentRows.filter((line: string) => /Edit \d\/4/.test(line));
      const collapsedLocalRemainders = collapsedEditContentRows.filter((line: string) => line.includes("more diff lines"));
      const collapsedTerminalRow = collapsedEditContentRows.at(-1) ?? "";
      if (
        collapsedHunkRows.length !== 1
        || collapsedHunkRow < 0
        || collapsedHunkRow >= firstEditBlockRow
        || collapsedBlockHeadings.some((line: string) => !/^\s*├ Edit \d\/4/.test(line))
        || collapsedLocalRemainders.length === 0
        || collapsedLocalRemainders.some((line: string) => !/^\s*│ …/.test(line))
        || !/^\s*└ … 1 more edit block/.test(collapsedTerminalRow)
      ) {
        throw new Error(`collapsed multi-Edit did not follow aggregate/block/terminal branch grammar: ${JSON.stringify(collapsedEditContentRows)}`);
      }
      const editSummaryRow = collapsedEditRows.findIndex((line: string) => line.includes("4 edits +"));
      const editSummaryX = editSummaryRow < 0
        ? -1
        : Array.from({ length: editAnchorWidth }, (_, x) => x).find(
          (x) => editAnchorExecution.clickActionAtPoint(x, editSummaryRow) === "expand",
        ) ?? -1;
      if (
        editSummaryRow < 0
        || editSummaryX < 0
        || !editAnchorExecution.activateClickAction(
          editAnchorExecution.clickActionAtPoint(editSummaryX, editSummaryRow),
        )
      ) {
        throw new Error(`multi-Edit aggregate summary was not a clickable expansion anchor: ${JSON.stringify(collapsedEditRows)}`);
      }

      const collapseText = "Output ends here • click to collapse";
      await waitFor(
        () => editAnchorExecution.render(editAnchorWidth).some((line: string) => plain(line).includes(collapseText)),
        "expanded multi-Edit bottom collapse anchor",
      );
      const expandedEditRows = editAnchorExecution.render(editAnchorWidth).map((line: string) => plain(line));
      const expandedEditContentRows = expandedEditRows.filter((line: string) => line.trim().length > 0);
      const expandedHunkRows = expandedEditContentRows.filter((line: string) => line.includes("hunks"));
      const expandedBlockHeadings = expandedEditContentRows.filter((line: string) => /Edit \d\/4/.test(line));
      const expandedTerminalRow = expandedEditContentRows.at(-1) ?? "";
      const editCollapseRow = expandedEditRows.findIndex((line: string) => line.includes(collapseText));
      const editCollapseStart = editCollapseRow < 0 ? -1 : expandedEditRows[editCollapseRow].indexOf(collapseText);
      const fullCollapseTarget = editCollapseStart >= 0 && Array.from(
        { length: collapseText.length },
        (_, offset) => editAnchorExecution.clickActionAtPoint(editCollapseStart + offset, editCollapseRow),
      ).every((action) => action === "expand");
      if (
        editCollapseRow < 0
        || !fullCollapseTarget
        || expandedHunkRows.length !== 1
        || expandedBlockHeadings.some((line: string) => !/^\s*├ Edit \d\/4/.test(line))
        || !expandedTerminalRow.includes(collapseText)
        || !/^\s*└ Output ends here/.test(expandedTerminalRow)
        || expandedEditRows.some((line: string) => line.includes("more diff lines"))
      ) {
        throw new Error(`fully rendered multi-Edit split diff lacked its canonical bottom collapse row: ${JSON.stringify(expandedEditRows)}`);
      }
    }

    const makeGroupedReadExecution = (id: string, filePath: string, mode?: "fullscreen") => {
      const component = new ToolExecutionComponent(
        "read",
        id,
        { path: filePath },
        {},
        readDefinition,
        { ...(mode ? { mode } : {}), requestRender() {} } as any,
        process.cwd(),
      ) as any;
      component.markExecutionStarted();
      component.setArgsComplete();
      component.updateResult({ content: [{ type: "text", text: cappedOutput }], isError: false }, false);
      return component;
    };
    const groupedFirst = makeGroupedReadExecution("read_group_fixture_1", "group-a.ts");
    const groupedSecond = makeGroupedReadExecution("read_group_fixture_2", "group-b.ts");
    const genericGroupParent = new Container();
    genericGroupParent.addChild(groupedFirst);
    genericGroupParent.addChild(groupedSecond);
    if ((genericGroupParent as any).children.length !== 1) {
      throw new Error("generic grouped-renderer setup did not create a tool group");
    }
    genericGroupParent.render(120);
    const genericGroup = (genericGroupParent as any).children[0];
    const regularCollapsedGroup = genericGroupParent.render(120).join("\n").replace(/\x1b\[[0-9;]*m/g, "");
    if (regularCollapsedGroup.includes("click any for details")) {
      throw new Error("regular TUI mode advertised inactive tool-group click anchors");
    }

    groupedFirst.ui.mode = "fullscreen";
    groupedSecond.ui.mode = "fullscreen";
    genericGroup.invalidate();
    const clickableGroupRaw = genericGroupParent.render(120).join("\n");
    const clickableGroup = plain(clickableGroupRaw);
    if (!clickableGroup.includes("click any for details")) {
      throw new Error("fullscreen collapsed tool group did not show click guidance");
    }
    const styledGroupGuidance = `${theme.fg("muted", " • ")}${theme.fg("dim", "click")}${theme.fg("muted", " any for details")}`;
    if (!clickableGroupRaw.includes(styledGroupGuidance)) {
      throw new Error("tool-group click guidance did not dim only `click`");
    }
    const groupedHeaderAnchor = genericGroup.clickAnchorAtPoint(5, 2);
    if (
      genericGroup.clickAnchorAtPoint(4, 2) !== undefined
      || groupedHeaderAnchor?.tool !== groupedFirst
      || groupedHeaderAnchor?.viewportAnchor !== "top"
    ) {
      throw new Error("tool-group click anchor did not preserve its target, edge, or content-only span");
    }
    if (!genericGroup.toggleToolAtPoint(5, 2)) {
      throw new Error("first tool-group click anchor did not toggle its execution");
    }
    const locallyExpandedGroup = plain(genericGroupParent.render(120).join("\n"));
    if (!locallyExpandedGroup.includes("result line 8") || !groupedFirst.expanded || groupedSecond.expanded) {
      throw new Error("tool-group click did not expand only the selected execution");
    }

    genericGroup.setExpanded(true);
    const groupedThird = makeGroupedReadExecution("read_group_fixture_3", "group-c.ts", "fullscreen");
    genericGroupParent.addChild(groupedThird);
    if (!groupedThird.expanded) {
      throw new Error("new grouped execution did not inherit global expanded mode");
    }
    const expandedGroupLines = genericGroupParent.render(120).map((line: string) => plain(line));
    const expandedGroupHeader = expandedGroupLines.find((line: string) => line.includes("to collapse") || line.includes("to toggle"));
    if (!expandedGroupHeader?.includes("to collapse") || expandedGroupHeader.includes("to toggle")) {
      throw new Error(`expanded tool group did not describe its collapse action: ${JSON.stringify(expandedGroupHeader)}`);
    }
    genericGroup.setExpanded(false);
    if (groupedFirst.expanded || groupedSecond.expanded || groupedThird.expanded) {
      throw new Error("global collapse did not reset all per-execution expansion state");
    }
    const resetGroup = plain(genericGroupParent.render(120).join("\n"));
    if (!resetGroup.includes("click any for details") || resetGroup.includes("result line 1")) {
      throw new Error("global collapse did not restore compact clickable group rows");
    }

    if (reportedDefects.length > 0) {
      throw new Error(`reported Side Quests banner regressions:\n- ${reportedDefects.join("\n- ")}`);
    }
    console.log("OK  renderer summaries, payloads, indicators, click detail layers, async diffs, and grouped controls");
  },
);
