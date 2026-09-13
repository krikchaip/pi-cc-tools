import assert from "node:assert/strict";

import {
  assertCleanTransition,
  assertFrozenRows,
  asyncDiffFamily,
  clickReady,
  findAfterPaging,
  fixture,
  repaint,
  settle,
} from "../family.ts";

const viewport = { columns: 100, rows: 40 } as const;
const topMarkers = /BEFORE_CREATE_[0-9]+|powerline-narrow\.expect/;
const bottomMarkers = /BETWEEN_TOOLS_[0-9]+|async-edit\.ts/;

export default asyncDiffFamily.scenario({
  name: "async Create diff anchors repaint without viewport flicker",
  knownRed: {
    reason: "The complete collapse paint redraws stable BETWEEN_TOOLS content; the legacy logger stopped at the footer marker before capturing the full synchronized paint.",
    error: /bottom collapse repainted stable content: BETWEEN_TOOLS_01/,
  },
  start: {
    mode: "session",
    session: {
      path: fixture("async-click/async-diff-click-session.jsonl"),
      replacements: { "Trust project folder?": "Trust project folder!" },
    },
  },
  async run(terminal) {
    await terminal.expect("missing-historical-cwd", {
      visible: ["cwd from session file does not exist", "Continue"],
    });
    await terminal.perform({ type: "key", key: "enter" });
    await terminal.expect("fixture-ready", { visible: ["AFTER_EDIT_FINAL"] });

    let positioned = (await findAfterPaging(
      terminal,
      "find-create-header",
      "powerline-narrow.expect",
      "page-up",
      8,
    )).frame;
    for (let wheel = 0; positioned.find(/^● Create/).row > 5; wheel += 1) {
      assert.ok(wheel < 9, "could not position the Create heading near the viewport top");
      await terminal.perform({ type: "wheel", direction: "down", at: { column: 50, row: 20 } });
      positioned = await settle(terminal, `position-create-header-${wheel}`);
    }

    const headerBefore = await repaint(terminal, "header-before-expand", viewport, "powerline-narrow.expect");
    const headerReady = await clickReady(terminal, "header-expand-ready", "● Create");
    const headerPoint = headerReady.find(/^● Create/);
    await terminal.perform({ type: "click", at: { column: 5, row: headerPoint.row } });
    const headerTransitionStart = headerReady.raw.length;
    const headerExpandedTransition = await terminal.expect("header-expand-transition", {
      visible: ["powerline-narrow.expect", /▌25\+/],
      absent: ["rendering diff", "(rendering", "calculating localized diff"],
    });
    assertCleanTransition(
      "header expansion",
      headerExpandedTransition.raw.slice(headerTransitionStart),
      true,
    );
    const headerExpanded = await repaint(terminal, "header-after-expand", viewport, "powerline-narrow.expect");
    assertFrozenRows("header expansion", headerBefore, headerExpanded, topMarkers);

    const headerCollapseReady = await clickReady(terminal, "header-collapse-ready", "● Create");
    const headerCollapseStart = headerCollapseReady.raw.length;
    const expandedHeaderPoint = headerCollapseReady.find(/^● Create/);
    await terminal.perform({ type: "click", at: { column: 5, row: expandedHeaderPoint.row } });
    const headerCollapsedTransition = await terminal.expect("header-collapse-transition", {
      visible: ["powerline-narrow.expect", "more diff lines"],
      absent: [/click.*to collapse/, "rendering diff", "(rendering", "calculating localized diff"],
    });
    assertCleanTransition(
      "header collapse",
      headerCollapsedTransition.raw.slice(headerCollapseStart),
      true,
    );
    const headerCollapsed = await repaint(terminal, "header-after-collapse", viewport, "powerline-narrow.expect");
    assertFrozenRows("header collapse", headerExpanded, headerCollapsed, topMarkers);

    const summaryBefore = await repaint(terminal, "summary-before-expand", viewport, "+33");
    const summaryExpandReady = await clickReady(terminal, "summary-expand-ready", "+33");
    const summaryPoint = summaryExpandReady.find("+33");
    const summaryExpandStart = summaryExpandReady.raw.length;
    await terminal.perform({ type: "click", at: summaryPoint });
    const summaryExpandedTransition = await terminal.expect("summary-expand-transition", {
      visible: ["powerline-narrow.expect", /▌25\+/],
      absent: ["rendering diff", "(rendering", "calculating localized diff"],
    });
    assertCleanTransition(
      "result-summary expansion",
      summaryExpandedTransition.raw.slice(summaryExpandStart),
      true,
    );
    const summaryExpanded = await repaint(terminal, "summary-after-expand", viewport, "powerline-narrow.expect");
    assertFrozenRows("result-summary expansion", summaryBefore, summaryExpanded, topMarkers);

    const summaryCollapseReady = await clickReady(terminal, "summary-collapse-ready", "powerline-narrow.expect");
    const summaryCollapseStart = summaryCollapseReady.raw.length;
    await terminal.perform({ type: "click", at: summaryPoint });
    const summaryCollapsedTransition = await terminal.expect("summary-collapse-transition", {
      visible: ["powerline-narrow.expect", "more diff lines"],
      absent: [/click.*to collapse/, "rendering diff", "(rendering", "calculating localized diff"],
    });
    assertCleanTransition(
      "result-summary collapse",
      summaryCollapsedTransition.raw.slice(summaryCollapseStart),
      true,
    );
    const summaryCollapsed = await repaint(terminal, "summary-after-collapse", viewport, "powerline-narrow.expect");
    assertFrozenRows("result-summary collapse", summaryExpanded, summaryCollapsed, topMarkers);

    const reopenReady = await clickReady(terminal, "summary-reopen-ready", "+33");
    await terminal.perform({ type: "click", at: reopenReady.find("+33") });
    await terminal.expect("reopened-from-summary", {
      visible: ["powerline-narrow.expect", /▌25\+/],
      absent: ["rendering diff", "(rendering", "calculating localized diff"],
    });
    const bottomSearch = await findAfterPaging(
      terminal,
      "find-bottom-collapse",
      /click.*to collapse/,
      "page-down",
      6,
    );
    const bottomBefore = await repaint(
      terminal,
      "bottom-before-collapse",
      viewport,
      /click.*to collapse/,
    );
    const bottomReady = await clickReady(terminal, "bottom-collapse-ready", /click.*to collapse/);
    const bottomCollapseStart = bottomReady.raw.length;
    await terminal.perform({ type: "click", at: bottomReady.find(/click.*to collapse/) });
    const bottomCollapsedTransition = await terminal.expect("bottom-collapse-transition", {
      visible: ["more diff lines"],
      absent: [/click.*to collapse/, "rendering diff", "(rendering", "calculating localized diff"],
      deadlineMs: 4_000,
      stableForMs: 0,
    });
    const bottomRaw = bottomCollapsedTransition.raw.slice(bottomCollapseStart);
    assertCleanTransition("bottom collapse", bottomRaw);
    for (const token of ["Output ends here", "BETWEEN_TOOLS_01", "async-edit.ts"]) {
      assert.ok(!bottomRaw.includes(token), `bottom collapse repainted stable content: ${token}`);
    }
    const bottomAfter = await repaint(terminal, "bottom-after-collapse", viewport, "more diff lines");
    assertFrozenRows("bottom collapse", bottomBefore, bottomAfter, bottomMarkers, 2);
    assert.ok(!bottomAfter.text.includes("click to collapse"), "bottom collapse retained its expansion footer");
    const anchorRows = bottomAfter.lines.filter((row) => row.includes("more diff lines"));
    assert.ok(
      anchorRows.some((row) => /^└ …/.test(row)),
      `bottom diff anchor must use one space after its branch indicator: ${JSON.stringify(anchorRows)}`,
    );
    assert.ok(bottomSearch.point.row >= 1, "bottom anchor search did not return a screen point");
  },
});
