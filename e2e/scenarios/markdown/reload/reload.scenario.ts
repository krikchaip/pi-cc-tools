import assert from "node:assert/strict";

import { markdownFamily, restoredSession } from "../family.ts";

const family = markdownFamily({ columns: 100, rows: 32 });
const renderedTokens = [
  "● Reload fixture",
  "◉ Alpha",
  "◉ Beta",
  "╭· ts",
  "const answer = 42;",
] as const;
const stockTokens = [" - Alpha", " - Beta", "```ts"] as const;

function assertStyled(label: string, raw: string, token: string): void {
  const row = raw.split(/\r?\n/).find((candidate) => (
    candidate.replace(/\u001b\[[0-9;:]*m/g, "").includes(token)
  ));
  assert.ok(row, `${label}: raw output is missing ${JSON.stringify(token)}`);
  assert.match(row, /\u001b\[[0-9;:]*m/, `${label}: ${JSON.stringify(token)} lost ANSI styling`);
}

export default family.scenario({
  name: "assistant Markdown styling survives reload",
  start: restoredSession("reload/reload-markdown-session.jsonl"),
  async run(terminal) {
    const before = await terminal.expect("before-reload", {
      visible: renderedTokens,
      absent: stockTokens,
    });
    assertStyled(before.name, before.raw, "◉ Alpha");
    assertStyled(before.name, before.raw, "╭· ts");
    const reloadStart = before.raw.length;

    await terminal.perform({ type: "write", data: "/reload\r" });
    await terminal.expect("reload-complete", { visible: ["Reloaded keybindings"] });
    const after = await terminal.expect("after-reload", {
      visible: renderedTokens,
      absent: stockTokens,
    });
    const reloadOutput = after.raw.slice(reloadStart);
    assertStyled(after.name, reloadOutput, "◉ Alpha");
    assertStyled(after.name, reloadOutput, "╭· ts");
  },
});
