import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function fixture(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;

    setTimeout(() => {
      void ctx.ui.custom<void>(
        (_tui, theme) => ({
          render: () => [theme.fg("dim", "PASSIVE_OVERLAY")],
          invalidate() {},
        }),
        {
          overlay: true,
          overlayOptions: {
            nonCapturing: true,
            anchor: "top-right",
            width: 20,
            margin: { top: 1, right: 1 },
          },
        },
      );
    }, 100);
  });
}
