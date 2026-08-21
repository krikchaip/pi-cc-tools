import {
  type ExtensionAPI,
  type Theme,
  ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";

import ccTools from "../extensions/index.ts";

const errorLines = [
  "A parent question is already pending for this subagent.",
  "Wait for the correlated response before asking again.",
];
const pi = new Proxy(
  {},
  {
    get: () => () => undefined,
  },
) as ExtensionAPI;
const theme = {
  fg: (_color: string, text: string) => text,
} as Theme;

ccTools(pi);

const prototype = ToolExecutionComponent.prototype as unknown as {
  getResultRenderer(this: { toolName: string }): unknown;
};

for (const toolName of ["ask_parent", "custom_tool"]) {
  const renderer = prototype.getResultRenderer.call({ toolName }) as (
    result: unknown,
    options: unknown,
    theme: Theme,
    context: unknown,
  ) => { render(width: number): string[] };
  const component = renderer(
    { content: [{ type: "text", text: errorLines.join("\n") }] },
    { expanded: true, isPartial: false },
    theme,
    { isError: true, lastComponent: undefined, state: {} },
  );
  const output = component.render(200).join("\n");

  for (const errorLine of errorLines) {
    const occurrences = output.split(errorLine).length - 1;
    if (occurrences !== 1) {
      console.error(output.replaceAll("\u001b", "<ESC>"));
      throw new Error(
        `Expected one ${toolName} error line, received ${occurrences}: ${errorLine}`,
      );
    }
  }
}

console.log("PASS expanded generic errors render each line once");
