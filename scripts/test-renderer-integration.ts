import {
  assertCollapsedIndicator,
  assertExpandedIndicator,
  assertPayloadRowInert,
  assertResultSummaryAnchor,
  plain,
  waitFor,
  withRendererHarness,
} from "./renderer-test-harness.ts";

await withRendererHarness(
  {
    name: "renderer-integration",
    stubTools: ["apply_patch", "web_search", "TaskList"],
  },
  async ({ fakePi, theme, ToolExecutionComponent, Container, emitLifecycle, writePiSettings }) => {
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

    await emitLifecycle("agent_start");

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
      const collapsedMultiApplyRows = multiApplyPatchExecution.render(120).map((line: string) => plain(line));
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
    }

    {
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
        () => shortEditExecution.render(120).some((line: string) => {
          const text = plain(line);
          return text.includes("+1") && text.includes("-1");
        }),
        "fully visible short Edit preview",
      );
      const shortEditRows = shortEditExecution.render(120).map((line: string) => plain(line));
      const shortEditSummaryRow = shortEditRows.findIndex(
        (line: string) => line.includes("+1") && line.includes("-1"),
      );
      const shortEditSummaryActions = shortEditSummaryRow < 0
        ? []
        : Array.from({ length: 120 }, (_, x) => shortEditExecution.clickActionAtPoint(x, shortEditSummaryRow))
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
        () => shortEditExecution.render(120).filter((line: string) => {
          const text = plain(line);
          return text.includes("+1") && text.includes("-1");
        }).length === 2,
        "complete fully visible short Edit execution",
      );
      const completeShortEditRows = shortEditExecution.render(120).map((line: string) => plain(line));
      const shortEditAnchorPoints = completeShortEditRows.flatMap((_line: string, y: number) => {
        const x = Array.from({ length: 120 }, (_, candidate) => candidate).find(
          (candidate) => shortEditExecution.clickAnchorAtPoint(candidate, y) !== undefined,
        );
        return x === undefined ? [] : [{ x, y }];
      });
      if (shortEditAnchorPoints.length < 2) {
        throw new Error(`complete short Edit did not expose its header and result anchors: ${JSON.stringify(completeShortEditRows)}`);
      }
      const rowsBeforeNoOpClicks = shortEditExecution.render(120);
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
        || JSON.stringify(shortEditExecution.render(120)) !== JSON.stringify(rowsBeforeNoOpClicks)
      ) {
        throw new Error(`fully visible short Edit repainted after no-op clicks: ${JSON.stringify({ shortEditRenderRequests, renderRequestsBeforeNoOpClicks })}`);
      }
      shortEditExecution.setExpanded(true);
      await waitFor(
        () => shortEditExecution.render(120).some((line: string) => plain(line).includes("const value = 2;")),
        "programmatically expanded short Edit preview",
      );
      const expandedShortEditRows = shortEditExecution.render(120).map((line: string) => plain(line));
      if (expandedShortEditRows.some((line: string) => line.includes("click to collapse"))) {
        throw new Error(`fully visible short Edit added a no-op collapse anchor after expansion: ${JSON.stringify(expandedShortEditRows)}`);
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
      const splitLines = (prefix: string, editIndex: number) => Array.from(
        { length: 20 },
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
        () => editAnchorExecution.render(120).some((line: string) => plain(line).includes("more edit blocks")),
        "collapsed multi-Edit preview",
      );

      const collapsedEditRows = editAnchorExecution.render(120).map((line: string) => plain(line));
      const editSummaryRow = collapsedEditRows.findIndex((line: string) => line.includes("4 edits +"));
      const editSummaryX = editSummaryRow < 0
        ? -1
        : Array.from({ length: 120 }, (_, x) => x).find(
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
        () => editAnchorExecution.render(120).some((line: string) => plain(line).includes(collapseText)),
        "expanded multi-Edit bottom collapse anchor",
      );
      const expandedEditRows = editAnchorExecution.render(120).map((line: string) => plain(line));
      const editCollapseRow = expandedEditRows.findIndex((line: string) => line.includes(collapseText));
      const editCollapseStart = editCollapseRow < 0 ? -1 : expandedEditRows[editCollapseRow].indexOf(collapseText);
      const fullCollapseTarget = editCollapseStart >= 0 && Array.from(
        { length: collapseText.length },
        (_, offset) => editAnchorExecution.clickActionAtPoint(editCollapseStart + offset, editCollapseRow),
      ).every((action) => action === "expand");
      if (
        editCollapseRow < 0
        || !fullCollapseTarget
        || expandedEditRows.some((line: string) => line.includes("more diff lines"))
      ) {
        throw new Error(`fully rendered multi-Edit split diff lacked its full bottom collapse target: ${JSON.stringify(expandedEditRows)}`);
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

    console.log("OK  renderer summaries, payloads, indicators, click detail layers, async diffs, and grouped controls");
  },
);
