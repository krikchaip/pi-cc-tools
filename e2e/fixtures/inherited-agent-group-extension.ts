import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

const definition = {
  name: "Agent",
  label: "Agent",
  description: "Self-contained grouped Agent history fixture",
  parameters: {},
  renderCall(args: any, theme: any) {
    return new Text(
      theme.fg("accent", `general-purpose :: ${String(args?.description ?? "Agent fixture")}`),
      0,
      0,
    );
  },
  renderResult(result: any, options: any, theme: any, ctx: any) {
    const resultText = Array.isArray(result?.content)
      ? result.content
          .filter((item: any) => item?.type === "text")
          .map((item: any) => String(item.text ?? ""))
          .join("\n")
      : "";
    const visible = options?.expanded === true
      ? String(ctx?.args?.prompt ?? resultText)
      : resultText.split("\n", 1)[0] ?? "";
    return new Text(theme.fg("muted", visible), 0, 0);
  },
  async execute() {
    return { content: [] };
  },
} as any;

export default function inheritedAgentGroupFixture(pi: ExtensionAPI): void {
  pi.registerTool(definition);
}
