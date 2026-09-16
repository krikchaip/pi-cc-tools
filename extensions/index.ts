import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { installClickExpansion } from "./click-expansion/index";
import {
  createDiffPresentationModule,
  type DiffTheme,
} from "./diff-presentation/index";
import { createToolPresentationModule } from "./tool-presentation/index";
import * as chrome from "./pi-host/chrome.ts";
import * as clickRouting from "./pi-host/click-routing.ts";
import { installPiHost } from "./pi-host/registration.ts";
import * as toolExecution from "./pi-host/tool-execution.ts";

export { clampLineWidth } from "./pi-host/chrome.ts";

export default function (pi: ExtensionAPI): void {
  const diffPresentationModule = createDiffPresentationModule({
    readSettings: chrome.readSettings,
    chrome: {
      markResultSummary: toolExecution.markResultSummary,
      branch(content, view, options) {
        const theme = view.theme as Theme;
        return options.final
          ? toolExecution.withFinalBranchBlock(content, theme)
          : toolExecution.withBranch(
              content,
              theme,
              false,
              options.continued === true,
            );
      },
      tree(summary, blocks, terminalAction, view) {
        return toolExecution.renderDiffOutputTree(
          summary,
          blocks.map((block) => ({
            heading: block.heading,
            content: block.content,
          })),
          terminalAction,
          view.theme as Theme,
        );
      },
      detailHint(view, hasMore) {
        return clickRouting.toolOutputDetailHint(
          view.theme as Theme,
          view.expanded,
          hasMore,
          view.localDetail < 2,
          true,
        );
      },
      collapseHint(view) {
        return clickRouting.localCollapseActionHint(view.theme as Theme);
      },
    },
    displayPath: toolExecution.shortPath,
    moveArrow: () => `${chrome.BORDER_COLOR}→${chrome.TRANSPARENT_RESET}`,
    isLightTheme: (theme: DiffTheme) =>
      toolExecution.isLightThemeBackground(theme),
    resolveRuleAnsi: (theme: DiffTheme) =>
      toolExecution.resolveThemeChromeFg(theme) ??
      toolExecution.safeFgAnsi(theme, "borderMuted") ??
      undefined,
  });
  const toolPresentationModule = createToolPresentationModule({
    mutations: diffPresentationModule,
  });
  const initialClickExpansion = installClickExpansion({
    enabled: clickRouting.clickExpansionEnabled(),
  });

  installPiHost(pi, {
    presentation: { diffPresentationModule, toolPresentationModule },
    clickExpansion: {
      initial: initialClickExpansion,
      create(enabled) {
        return installClickExpansion({ enabled });
      },
    },
  });
}
