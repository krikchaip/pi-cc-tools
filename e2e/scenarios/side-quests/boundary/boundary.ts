import {
  assertSideQuestsRenderer,
  clickPattern,
  extension,
  fixture,
  repaint,
  sideQuestsRenderer,
  sideQuestsViewportFamily,
} from "../family.ts";

interface BoundaryCase {
  readonly id: "result" | "ask" | "continuation" | "wrap";
  readonly heading: string;
  readonly sentinel: string;
  readonly unrelated?: string;
  readonly ready: string;
  readonly grouping: boolean;
}

export function boundaryScenario(testCase: BoundaryCase) {
  return sideQuestsViewportFamily.scenario({
    name: `${testCase.heading} clicks stop at the painted top boundary`,
    start: {
      mode: "session",
      session: {
        path: fixture(`boundary/${testCase.id}/side-quests-click-boundary-${testCase.id}.jsonl`),
        replaceCwd: "/tmp/pi-cc-tools-side-quests-click-boundary",
      },
      extensions: [fixture("boundary/side-quests-click-boundary-session-extension.ts"), extension],
      args: ["--provider", "side-quests-boundary-e2e", "--model", "historical-session"],
      environment: { SIDE_QUESTS_RENDERER: sideQuestsRenderer },
      settings: {
        quietStartup: true,
        theme: "dark",
        outputPad: 0,
        clickExpansion: true,
        groupToolCalls: testCase.grouping,
      },
    },
    async run(terminal) {
      assertSideQuestsRenderer();
      await terminal.expect("ready", { visible: [testCase.ready] });
      let frame = await repaint(terminal, "initial-repaint", testCase.heading);
      if (testCase.id === "wrap") {
        await terminal.expect("scrolled-transcript", {
          visible: [testCase.heading],
          absent: ["SCROLL_PREFILL_01"],
        });
      }

      await clickPattern(terminal, "separator-click", frame, testCase.heading, -2);
      frame = await terminal.expect("separator-ignored", {
        visible: [testCase.heading],
        absent: [testCase.sentinel, ...(testCase.unrelated ? [testCase.unrelated] : [])],
        stableForMs: 700,
      });

      await clickPattern(terminal, "painted-padding-click", frame, testCase.heading, -1);
      await terminal.expect("expanded-from-painted-padding", {
        visible: [testCase.sentinel],
        absent: testCase.unrelated ? [testCase.unrelated] : [],
      });
    },
  });
}
