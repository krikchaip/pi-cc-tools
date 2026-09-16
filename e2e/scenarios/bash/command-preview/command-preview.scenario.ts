import { bashFamily, fixture, requireRow } from "../family.ts";

const sourceToken = "BASH_PREVIEW_BEGIN";
const hiddenTail = "BASH_PREVIEW_HIDDEN_END";

export default bashFamily.scenario({
  name: "command preview stays one line and uses metadata color when expanded",
  start: {
    mode: "session",
    session: {
      path: fixture("command-preview/bash-command-preview-session.jsonl"),
      replaceCwd: "/tmp/pi-cc-tools-bash-command-preview",
    },
    settings: { groupToolCalls: false },
  },
  async run(terminal) {
    const issues: string[] = [];
    const collapsed = await terminal.expect("collapsed", {
      visible: [sourceToken, /click.*to expand/],
    });
    const headerRow = requireRow(collapsed, sourceToken);
    const doneRow = requireRow(collapsed, "Done");
    const header = collapsed.lines[headerRow]!.trimEnd();
    if (doneRow !== headerRow + 1) {
      issues.push(
        `collapsed command used ${doneRow - headerRow} rows before its result summary`,
      );
    }
    if (!/[.…]$/.test(header)) {
      issues.push(
        `collapsed command did not end its first row with an ellipsis: ${JSON.stringify(header)}`,
      );
    }
    if (collapsed.text.includes(hiddenTail)) {
      issues.push(
        "collapsed command exposed its hidden tail instead of keeping a prefix preview",
      );
    }
    const collapsedForeground = foregroundBefore(collapsed.raw, sourceToken);

    await terminal.perform({ type: "click", at: collapsed.find(sourceToken) });
    const expanded = await terminal.expect("expanded", {
      visible: [
        sourceToken,
        hiddenTail,
        "3 lines",
        "BASH_RESULT_BEGIN",
        "alpha",
        "beta",
        "BASH_RESULT_END",
      ],
      absent: ["^I"],
    });
    const expandedForeground = foregroundBefore(expanded.raw, sourceToken);
    const metadataForeground = foregroundBefore(expanded.raw, "3 lines");
    if (
      !collapsedForeground ||
      !expandedForeground ||
      collapsedForeground === expandedForeground
    ) {
      issues.push(
        `expanded command did not leave the collapsed accent: ${collapsedForeground ?? "unknown"} -> ${expandedForeground ?? "unknown"}`,
      );
    }
    if (
      !expandedForeground ||
      !metadataForeground ||
      expandedForeground !== metadataForeground
    ) {
      issues.push(
        `expanded command did not match metadata: ${expandedForeground ?? "unknown"} vs ${metadataForeground ?? "unknown"}`,
      );
    }

    if (issues.length > 0) {
      throw new Error(
        `Bash command preview parity regression:\n- ${issues.join("\n- ")}`,
      );
    }
  },
});

function foregroundBefore(raw: string, token: string): string | undefined {
  const tokenIndex = raw.lastIndexOf(token);
  if (tokenIndex === -1) return undefined;

  let foreground: string | undefined;
  for (const match of raw
    .slice(0, tokenIndex)
    .matchAll(/\u001b\[([0-9;:]*)m/g)) {
    const parameters = match[1]!
      .replaceAll(":", ";")
      .split(";")
      .map((value) => Number(value || "0"));
    for (let index = 0; index < parameters.length; index += 1) {
      const parameter = parameters[index]!;
      if (parameter === 0 || parameter === 39) foreground = undefined;
      if (parameter !== 38) continue;
      if (parameters[index + 1] === 2 && parameters.length > index + 4) {
        foreground = `rgb:${parameters[index + 2]},${parameters[index + 3]},${parameters[index + 4]}`;
        index += 4;
      } else if (parameters[index + 1] === 5 && parameters.length > index + 2) {
        foreground = `palette:${parameters[index + 2]}`;
        index += 2;
      }
    }
  }
  return foreground;
}
