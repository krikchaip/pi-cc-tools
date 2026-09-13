import assert from "node:assert/strict";

import { clickFamily, findAfterActions, fixture, repaint } from "../family.ts";

const viewport = { columns: 100, rows: 40 } as const;
const family = clickFamily(viewport);

export function builtinCollapseScenario(input: {
  name: string;
  fixture: string;
  collapsed: RegExp;
  detailPrefix: string;
}) {
  return family.scenario({
    name: input.name,
    start: {
      mode: "session",
      session: {
        path: fixture(`builtin-collapse/${input.fixture}`),
        replaceCwd: "/tmp/pi-cc-tools-builtin-viewport",
      },
    },
    async run(terminal) {
      await terminal.expect("ready", { visible: ["BUILTIN_VIEWPORT_AFTER_45"] });
      const collapsed = await findAfterActions(terminal, "find-collapsed", input.collapsed, "page-up", 6);
      await terminal.perform({ type: "click", at: collapsed.find(input.collapsed) });
      await terminal.expect("expanded", { visible: [`${input.detailPrefix}_01`] });

      await terminal.perform({ type: "key", key: "page-down" });
      const wholeBefore = await terminal.expect("whole-before", {
        visible: [new RegExp(`${input.detailPrefix}_[0-9]+`)],
        absent: [/BUILTIN_VIEWPORT_(?:BEFORE|AFTER)_/],
      });
      await terminal.perform({ type: "click", at: wholeBefore.find(new RegExp(`${input.detailPrefix}_[0-9]+`)) });
      const wholeAfter = await terminal.expect("whole-after", {
        visible: [input.collapsed, "BUILTIN_VIEWPORT_AFTER_01"],
      });
      assert.ok(wholeAfter.find(input.collapsed).row < wholeAfter.find("BUILTIN_VIEWPORT_AFTER_01").row);

      const recollapsed = await findAfterActions(terminal, "find-recollapsed", input.collapsed, "page-up", 6);
      await terminal.perform({ type: "click", at: recollapsed.find(input.collapsed) });
      await terminal.expect("reopened", { visible: [`${input.detailPrefix}_01`] });
      await terminal.perform({ type: "key", key: "page-down" });
      await terminal.perform({ type: "key", key: "page-down" });
      await findAfterActions(terminal, "find-bottom", "BUILTIN_VIEWPORT_AFTER_03", "wheel-down", 30);
      const bottomBefore = await repaint(terminal, viewport, "bottom-before");
      const detailPattern = new RegExp(`${input.detailPrefix}_[0-9]+`);
      assert.match(bottomBefore.text, detailPattern);
      for (const index of ["01", "02", "03"]) assert.match(bottomBefore.text, new RegExp(`BUILTIN_VIEWPORT_AFTER_${index}`));
      const followingRow = bottomBefore.find("BUILTIN_VIEWPORT_AFTER_01").row;
      let componentRow = 0;
      for (const [index, line] of bottomBefore.lines.entries()) {
        if (index + 1 >= followingRow) break;
        if (detailPattern.test(line) || /to collapse/.test(line)) componentRow = index + 1;
      }
      assert.ok(componentRow > 0, "expanded built-in has no visible component row before following transcript");
      await terminal.perform({ type: "click", at: { column: 50, row: componentRow } });
      const bottomAfter = await terminal.expect("bottom-after", {
        visible: [input.collapsed, "BUILTIN_VIEWPORT_AFTER_01"],
      });
      assert.ok(bottomAfter.find(input.collapsed).row < bottomAfter.find("BUILTIN_VIEWPORT_AFTER_01").row);
    },
  });
}
