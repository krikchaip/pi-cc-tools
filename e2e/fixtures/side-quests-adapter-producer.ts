import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  CustomMessageComponent,
  ToolExecutionComponent,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Container } from "@earendil-works/pi-tui";

const LONG_PROMPT = Array.from(
  { length: 7 },
  (_, index) => `SIDE_QUEST_PROMPT_${index + 1}`,
).join("\n");
const SHORT_PROMPT = "SHORT_AGENT_PROMPT_1\nSHORT_AGENT_PROMPT_2";
const ASK_PARENT_PROMPT = Array.from({ length: 30 }, (_, index) => `ASK_PARENT_PROMPT_${index + 1}`).join(" ");
const WRAP_UP_RESULT = Array.from({ length: 30 }, (_, index) => `WRAP_UP_RESULT_${index + 1}`).join(" ");

const agentDefinition = {
  name: "Agent",
  label: "Agent",
  description: "Side Quests real-renderer E2E fixture",
  parameters: {},
  async execute() {
    return { content: [] };
  },
} as any;

function settledAgent(
  id: string,
  prompt: string,
  requestRender: () => void,
  cwd: string,
): any {
  const tool = new ToolExecutionComponent(
    "Agent",
    id,
    {
      description: `Side Quests ${id} fixture`,
      inherit_context: true,
      interactive: true,
      prompt,
    },
    {},
    agentDefinition,
    { mode: "fullscreen", requestRender } as any,
    cwd,
  ) as any;

  tool.markExecutionStarted();
  tool.setArgsComplete();
  tool.updateResult({
    content: [{ type: "text", text: "Subagent launched." }],
    details: {
      operation: "launched",
      sessionPath: `/tmp/side-quests-e2e/${id}/session.jsonl`,
      sideQuestPresentation: {
        version: 1,
        surface: "agent",
        statuses: ["inherited", "interactive"],
      },
    },
    isError: false,
  }, false);
  return tool;
}

function section(label: string, rows: string[]): string[] {
  return [`${label}_BEGIN`, ...rows, `${label}_END`];
}

function hasExactPaintedVerticalPadding(rows: string[]): boolean {
  if (rows.length < 4) return false;
  const plain = rows.map((line) => line.replace(/\x1b\[[0-9;]*m/g, ""));
  const painted = rows.map((line) => line.includes("\x1b[48;"));
  return !painted[0]
    && plain[0].trim().length === 0
    && painted.slice(1).every(Boolean)
    && plain[1].trim().length === 0
    && plain[2].trim().length > 0
    && plain.at(-2)!.trim().length > 0
    && plain.at(-1)!.trim().length === 0;
}

/**
 * Adds deterministic Side Quests surfaces to a custom fullscreen view.
 * The actual Side Quests renderer modules own all tested presentation.
 */
export default async function sideQuestsAdapterProducer(
  pi: ExtensionAPI,
): Promise<void> {
  const rendererPath = process.env.SIDE_QUESTS_RENDERER;
  if (!rendererPath) throw new Error("SIDE_QUESTS_RENDERER is required");
  const rendererDirectory = path.dirname(rendererPath);
  const importRenderer = (name: string): Promise<any> =>
    import(pathToFileURL(path.join(rendererDirectory, name)).href);
  const { AgentRenderer } = await importRenderer("agent-renderer.ts");
  const { SideQuestResultRenderer, RESULT_MESSAGE_TYPE } = await importRenderer(
    "side-quest-result-renderer.ts",
  );
  const { ContinuationRenderer, CONTINUATION_MESSAGE_TYPE } = await importRenderer(
    "continuation-renderer.ts",
  );
  const { WrapUpRenderer } = await importRenderer("wrap-up-renderer.ts");

  const messageRenderers = new Map<string, any>();
  const capturePi = {
    on: pi.on.bind(pi),
    registerMessageRenderer(type: string, renderer: any) {
      messageRenderers.set(type, renderer);
      pi.registerMessageRenderer(type, renderer);
    },
  } as any;
  AgentRenderer.register(pi);
  SideQuestResultRenderer.register(capturePi);
  ContinuationRenderer.register(capturePi);
  pi.registerTool(agentDefinition);

  const mode = process.env.SIDE_QUEST_E2E_MODE ?? "long";
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;

    setTimeout(() => {
      void ctx.ui.custom<void>((tui, theme, keybindings, done) => {
        let width = 100;
        const requestRender = () => tui.requestRender();
        const longTool = settledAgent(
          "click-adapter",
          LONG_PROMPT,
          requestRender,
          ctx.cwd,
        );
        const shortStandalone = settledAgent(
          "short-standalone",
          SHORT_PROMPT,
          requestRender,
          ctx.cwd,
        );
        shortStandalone.setExpanded(true);

        const shortGroupedFirst = settledAgent(
          "short-grouped-first",
          SHORT_PROMPT,
          requestRender,
          ctx.cwd,
        );
        const shortGroupedSecond = settledAgent(
          "short-grouped-second",
          SHORT_PROMPT,
          requestRender,
          ctx.cwd,
        );
        shortGroupedFirst.setExpanded(true);
        shortGroupedSecond.setExpanded(true);
        const shortGroup = new Container();
        shortGroup.addChild(shortGroupedFirst);
        shortGroup.addChild(shortGroupedSecond);
        const shortGroupConfirmed = (shortGroup as any).children?.length === 1
          && (shortGroup as any).children[0] !== shortGroupedFirst
          && (shortGroup as any).children[0] !== shortGroupedSecond;

        const resultRenderer = messageRenderers.get(RESULT_MESSAGE_TYPE);
        const continuationRenderer = messageRenderers.get(CONTINUATION_MESSAGE_TYPE);
        const resultMessage = new CustomMessageComponent(
          {
            role: "custom",
            customType: RESULT_MESSAGE_TYPE,
            content: "Subagent completed: banner regression fixture",
            details: {
              kind: "completed",
              subagentType: "general-purpose",
              description: "Banner regression fixture",
              response: "Completed output.",
              sessionPath: "/tmp/side-quests-e2e/result/session.jsonl",
            },
          } as any,
          resultRenderer,
        );
        const continuationMessage = new CustomMessageComponent(
          {
            role: "custom",
            customType: CONTINUATION_MESSAGE_TYPE,
            content: "Continue from the completed result.",
            details: {},
          } as any,
          continuationRenderer,
        );

        const askDefinition = {
          name: "ask_parent",
          label: "ask_parent",
          description: "Ask parent banner fixture",
          parameters: {},
          async execute() {
            return { content: [] };
          },
        } as any;
        const askParent = new ToolExecutionComponent(
          "ask_parent",
          "ask-parent-banner",
          { prompt: ASK_PARENT_PROMPT },
          {},
          askDefinition,
          { mode: "fullscreen", requestRender } as any,
          ctx.cwd,
        ) as any;
        askParent.markExecutionStarted();
        askParent.setArgsComplete();
        askParent.updateResult({
          content: [{ type: "text", text: "Question sent." }],
          isError: false,
        }, false);

        const wrapDefinition = {
          name: "subagent_done",
          label: "subagent_done",
          description: "Wrap-up banner fixture",
          parameters: {},
          renderShell: "self",
          renderCall: WrapUpRenderer.renderCall,
          renderResult: WrapUpRenderer.renderResult,
          async execute() {
            return { content: [] };
          },
        } as any;
        const wrapUp = new ToolExecutionComponent(
          "subagent_done",
          "wrap-up-banner",
          { result: WRAP_UP_RESULT },
          {},
          wrapDefinition,
          { mode: "fullscreen", requestRender } as any,
          ctx.cwd,
        ) as any;
        wrapUp.markExecutionStarted();
        wrapUp.setArgsComplete();
        wrapUp.updateResult({
          content: [{ type: "text", text: "Recorded." }],
          isError: false,
        }, false);
        if (mode === "ask-click") return askParent;
        if (mode === "wrap-click") return wrapUp;

        const visibleToolRows = (): string[] =>
          longTool.render(width).map((line: string) =>
            line.replace(/\x1b\[[0-9;]*m/g, "")
          );
        const wantedAction = (rows: string[]): string =>
          rows.some((line: string) => line.includes("Output ends here"))
            ? "collapse"
            : rows.some((line: string) => line.includes("click for more detail"))
              ? "more-detail"
              : "expand";

        const clickToolAction = (event: any): boolean => {
          if (typeof longTool.handleMouse !== "function") return false;
          const rows = visibleToolRows();
          const wanted = wantedAction(rows);
          const acceptedActions = wanted === "more-detail"
            ? ["detail", "detail-extra"]
            : ["expand"];
          const rowIndexes = Array.from({ length: rows.length }, (_, y) => y);
          if (wanted === "collapse") rowIndexes.reverse();
          for (const y of rowIndexes) {
            for (let x = 0; x < width; x++) {
              if (!acceptedActions.includes(longTool.clickActionAtPoint?.(x, y))) continue;
              longTool.handleMouse({
                ...event,
                type: "click",
                button: "left",
                clickCount: 1,
                dragged: false,
                url: undefined,
                x,
                y,
              });
              tui.requestRender();
              return true;
            }
          }
          return false;
        };

        return {
          render: (nextWidth: number) => {
            width = nextWidth;
            if (mode === "regressions") {
              const eventRows = resultMessage.render(nextWidth);
              const continuationRows = continuationMessage.render(nextWidth);
              const askParentRows = askParent.render(nextWidth);
              const wrapUpRows = wrapUp.render(nextWidth);
              return [
                "SIDE_QUEST_REGRESSION_E2E_READY",
                "FINAL_BANNER_SNAPSHOT_BEGIN",
                hasExactPaintedVerticalPadding(eventRows) ? "EVENT_PADDING_CONFIRMED" : "EVENT_PADDING_MISSING",
                hasExactPaintedVerticalPadding(continuationRows) ? "CONTINUATION_PADDING_CONFIRMED" : "CONTINUATION_PADDING_MISSING",
                hasExactPaintedVerticalPadding(askParentRows) ? "ASK_PARENT_PADDING_CONFIRMED" : "ASK_PARENT_PADDING_MISSING",
                hasExactPaintedVerticalPadding(wrapUpRows) ? "WRAP_UP_PADDING_CONFIRMED" : "WRAP_UP_PADDING_MISSING",
                ...section("EVENT_BANNER", eventRows),
                ...section("CONTINUATION_BANNER", continuationRows),
                ...section("ASK_PARENT_BANNER", askParentRows),
                ...section("WRAP_UP_BANNER", wrapUpRows),
                ...section("SHORT_STANDALONE", shortStandalone.render(nextWidth)),
                ...section("SHORT_GROUPED", [
                  shortGroupConfirmed ? "SHORT_GROUP_CONFIRMED" : "SHORT_GROUP_MISSING",
                  ...shortGroup.render(nextWidth),
                ]),
                "FINAL_BANNER_SNAPSHOT_END",
              ];
            }
            return ["SIDE_QUEST_E2E_READY", ...longTool.render(nextWidth)];
          },
          handleInput: (data: string) => {
            if (keybindings.matches(data, "app.tools.expand")) {
              longTool.setExpanded(!longTool.expanded);
              tui.requestRender();
              return;
            }
            if (keybindings.matches(data, "app.interrupt")) done();
          },
          handleMouse: (event: any) => {
            if (event.type === "click") clickToolAction(event);
            return undefined;
          },
          invalidate: () => longTool.invalidate(),
        };
      });
    }, 200);
  });
}
