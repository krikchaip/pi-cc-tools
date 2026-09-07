import { ToolExecutionComponent, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";

const LEGACY_WRAP_MARK = "\uE000";
const ZERO_WIDTH_WRAP_MARK = "\u200B";
const CALL_FALLBACK = `GENERIC_CALL_FALLBACK_SHOULD_NOT_RENDER ${LEGACY_WRAP_MARK}legacy-call ${ZERO_WIDTH_WRAP_MARK}zero-width-call`;
const RESULT_FALLBACK = `GENERIC_RESULT_FALLBACK_SHOULD_NOT_RENDER ${LEGACY_WRAP_MARK}legacy-result ${ZERO_WIDTH_WRAP_MARK}zero-width-result`;

const definition = {
  name: "custom_renderer_probe",
  label: "Custom renderer probe",
  description: "Proves that an existing custom tool renderer wins over the generic fallback.",
  parameters: {},
  async execute() {
    return { content: [{ type: "text", text: RESULT_FALLBACK }] };
  },
  renderCall(_args: unknown, theme: any) {
    return new Text(
      theme.fg("accent", "CUSTOM_CALL_RENDERER_OK")
        + " call-alpha call-beta call-gamma call-delta call-epsilon call-zeta call-eta call-theta call-iota call-kappa CALL_WRAP_END",
      0,
      0,
    );
  },
  renderResult(_result: unknown, _options: unknown, theme: any) {
    return new Text(
      theme.fg("success", "CUSTOM_RESULT_RENDERER_OK")
        + " result-alpha result-beta result-gamma result-delta result-epsilon result-zeta result-eta result-theta result-iota RESULT_WRAP_END",
      0,
      0,
    );
  },
} as any;

export default function fixture(pi: ExtensionAPI): void {
  pi.registerTool(definition);

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;

    const tool = new ToolExecutionComponent(
      definition.name,
      "custom-renderer-preservation",
      { path: CALL_FALLBACK },
      {},
      definition,
      { requestRender() {} } as any,
      ctx.cwd,
    );
    tool.markExecutionStarted();
    tool.setArgsComplete();
    tool.updateResult({ content: [{ type: "text", text: RESULT_FALLBACK }] } as any, false);
    tool.setExpanded(true);

    const group = new Container();
    group.addChild(tool);
    group.render(72);

    setTimeout(() => {
      void ctx.ui.custom<void>((_tui, theme, _keys, done) => ({
        render: (width: number) => [theme.bold("CUSTOM RENDERER PRESERVATION E2E"), ...group.render(width)],
        handleInput: (data: string) => {
          if (data === "\u001b") done();
        },
        invalidate: () => group.invalidate(),
      }));
    }, 200);
  });
}
