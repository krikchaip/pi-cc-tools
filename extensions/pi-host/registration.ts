import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import {
  SettingsManager,
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
} from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_TOOL_BRANCH_GRAY } from "../tool-presentation/index";

import {
  applyToolBackgroundMode,
  bustSpinnerSettingsCache,
  readSettings,
  setToolBackgroundOverride,
  toolBackgroundMode,
  writeSettingsKey,
} from "./chrome.ts";
import * as clickRouting from "./click-routing.ts";
import * as grouping from "./grouping.ts";
import * as toolExecution from "./tool-execution.ts";
import * as toolFamily from "./tool-family.ts";
import * as transcript from "./transcript.ts";
import type { PiHostDependencies } from "./ports.ts";

// ===========================================================================
// Extension
// ===========================================================================

export function installPiHost(
  pi: ExtensionAPI,
  dependencies: PiHostDependencies,
) {
  const { presentation } = dependencies;
  clickRouting.connectClickRoutingHost({
    grouping,
    toolExecution,
    toolFamily,
    presentation,
  });
  grouping.connectGroupingHost({
    clickRouting,
    toolExecution,
    toolFamily,
    transcript,
    presentation,
  });
  toolExecution.connectToolExecutionHost({
    clickRouting,
    grouping,
    toolFamily,
    transcript,
    presentation,
  });
  toolFamily.connectToolFamilyHost({
    clickRouting,
    grouping,
    toolExecution,
    transcript,
    presentation,
  });
  transcript.connectTranscriptHost({
    clickRouting,
    grouping,
    toolExecution,
    toolFamily,
  });
  toolExecution.initializeToolBranchColor();
  clickRouting.setClickExpansionModule(dependencies.clickExpansion.initial);
  transcript.patchTerminalWriteTagScrubber();
  transcript.patchToolExecutionBackgroundSync();
  transcript.patchToolRenderCacheInvalidation();
  transcript.patchReadImageExpansion();
  grouping.patchContainerParentTracking();
  grouping.installToolGroupMouseAdapter();
  grouping.patchGlobalToolBorders();
  grouping.patchBuiltinTranscriptExpansion();
  transcript.patchCustomMessageRender();
  transcript.patchUserMessageRender();
  transcript.patchAssistantMessages();
  transcript.patchToolExecutionRenderers();
  grouping.refreshRetainedToolGroupClickHandlers();
  toolFamily.registerThinkingLabels(pi);
  clickRouting.syncExtraToolDetailMode();

  pi.registerShortcut("ctrl+shift+o", {
    description: "Toggle extra tool output detail",
    handler: async (ctx) => {
      clickRouting.setExtraToolDetailMode(
        !clickRouting.extraToolOutputExpanded,
      );
      if (ctx.hasUI) {
        ctx.ui.setToolsExpanded(ctx.ui.getToolsExpanded());
        ctx.ui.notify(
          `Extra tool detail: ${clickRouting.extraToolOutputExpanded ? "on" : "off"}`,
          "info",
        );
      }
    },
  });

  // /cc-tools command — control tool chrome, grouping, and detail level.
  const TOOL_MODES = ["outlines", "transparent", "default"] as const;
  const TOOL_BOOL_MODES = ["on", "off", "toggle", "status"] as const;
  const TOOL_SUBCOMMANDS = [
    ...TOOL_MODES,
    "group",
    "detail",
    "click",
    "thinking",
    "branch",
    "status",
  ] as const;
  const booleanMode = (
    raw: string | undefined,
    current: boolean,
  ): boolean | "status" | undefined => {
    const mode = raw || "toggle";
    if (mode === "on") return true;
    if (mode === "off") return false;
    if (mode === "toggle") return !current;
    if (mode === "status") return "status";
    return undefined;
  };
  const notifyToolStatus = (ctx: any): void => {
    if (!ctx.hasUI) return;
    const branchMode = toolExecution.toolBranchColorModeFixed()
      ? "fixed"
      : "theme";
    const branchGray = toolExecution.getConfiguredToolBranchGray();
    const theme = ctx.ui?.theme;
    const chromeHint =
      branchMode === "theme" && theme
        ? toolExecution.resolveThemeChromeFg(theme)
          ? " (attenuated on light themes)"
          : " (fallback gray if theme keys missing)"
        : "";
    const branchLine =
      branchMode === "fixed"
        ? `Branch color: fixed rgb(${branchGray})`
        : `Branch color: theme${chromeHint}`;
    ctx.ui.notify(
      [
        `Tool style: ${toolBackgroundMode}`,
        `Tool grouping: ${grouping.toolGroupingEnabled() ? "on" : "off"}`,
        `Click expansion: ${clickRouting.clickExpansionEnabled() ? "on" : "off"}`,
        `Thinking: ${grouping.getThinkingMode()}`,
        `Extra detail: ${clickRouting.extraToolOutputExpanded ? "on" : "off"} (${clickRouting.themedRawKeyHint(theme, "ctrl+shift+o", "toggle")})`,
        branchLine,
        `  /cc-tools branch <0-255> | theme | fixed | reset`,
      ].join("\n"),
      "info",
    );
  };
  pi.registerCommand("cc-tools", {
    description:
      "Control tool UI: style, grouping, click expansion, and extra detail",
    getArgumentCompletions(prefix) {
      const parts = prefix.trimStart().split(/\s+/);
      const first = parts[0] ?? "";
      if (parts.length <= 1) {
        return TOOL_SUBCOMMANDS.filter((m) => m.startsWith(first)).map((m) => ({
          value: m,
          label: m,
          description:
            m === "group"
              ? "Toggle grouped adjacent/concurrent tool rows"
              : m === "thinking"
                ? "Thinking display: live (default) or full"
                : m === "detail"
                  ? "Toggle Ctrl+Shift+O extra-detail mode"
                  : m === "click"
                    ? "Toggle local click expansion in fullscreen mode"
                    : m === "branch"
                      ? "├ └ │ gray (0-255), theme, fixed, or reset"
                      : m === "status"
                        ? "Show tool UI settings"
                        : m === "outlines"
                          ? "Horizontal rules around each tool (default)"
                          : m === "transparent"
                            ? "No borders or backgrounds"
                            : "Pi built-in tool backgrounds",
        }));
      }
      if (first === "branch") {
        const second = parts[1] ?? "";
        const opts = ["theme", "fixed", "reset", "status"];
        return opts
          .filter((o) => o.startsWith(second))
          .map((o) => ({
            value: `branch ${o}`,
            label: o,
            description: "Branch connector color",
          }));
      }
      if (first === "thinking") {
        const second = parts[1] ?? "";
        return ["live", "full", "status"]
          .filter((m) => m.startsWith(second))
          .map((m) => ({
            value: `thinking ${m}`,
            label: m,
            description: `${m} thinking display`,
          }));
      }
      if (
        first === "group" ||
        first === "detail" ||
        first === "extra" ||
        first === "click"
      ) {
        const second = parts[1] ?? "";
        return TOOL_BOOL_MODES.filter((m) => m.startsWith(second)).map((m) => ({
          value: `${first} ${m}`,
          label: m,
          description: `${m} ${first}`,
        }));
      }
      return [];
    },
    async handler(args, ctx) {
      const parts = args.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const sub = parts[0] ?? "";
      if (!sub || sub === "status") {
        notifyToolStatus(ctx);
        return;
      }

      if (sub === "group") {
        const next = booleanMode(parts[1], grouping.toolGroupingEnabled());
        if (next === undefined) {
          if (ctx.hasUI)
            ctx.ui.notify(
              `Usage: /cc-tools group ${TOOL_BOOL_MODES.join("|")}`,
              "error",
            );
          return;
        }
        if (next === "status") {
          if (ctx.hasUI)
            ctx.ui.notify(
              `Tool grouping: ${grouping.toolGroupingEnabled() ? "on" : "off"}`,
              "info",
            );
          return;
        }
        grouping.setToolGroupingEnabled(next);
        if (!next) grouping.ungroupActiveToolGroups();
        if (ctx.hasUI) {
          ctx.ui.setToolsExpanded(ctx.ui.getToolsExpanded());
          ctx.ui.notify(
            `Tool grouping: ${next ? "on" : "off"}${next ? " (future adjacent tool rows)" : ""}`,
            "info",
          );
        }
        return;
      }

      if (sub === "click") {
        const current = clickRouting.clickExpansionEnabled();
        const next = booleanMode(parts[1], current);
        if (next === undefined) {
          if (ctx.hasUI)
            ctx.ui.notify(
              `Usage: /cc-tools click ${TOOL_BOOL_MODES.join("|")}`,
              "error",
            );
          return;
        }
        if (next === "status") {
          if (ctx.hasUI)
            ctx.ui.notify(`Click expansion: ${current ? "on" : "off"}`, "info");
          return;
        }
        writeSettingsKey("clickExpansion", next);
        clickRouting.setClickExpansionModule(
          dependencies.clickExpansion.create(next),
        );
        if (!next)
          grouping.resetLocalClickStates(
            grouping.clickRuntime.activeInteractiveMode,
            true,
          );
        else grouping.clickRuntime.visualEpoch++;
        if (ctx.hasUI) {
          (ctx.ui as any).invalidate?.();
          (ctx.ui as any).requestRender?.();
          ctx.ui.notify(`Click expansion: ${next ? "on" : "off"}`, "info");
        }
        return;
      }

      if (sub === "branch") {
        const arg = parts[1] ?? "status";
        if (arg === "status" || !arg) {
          notifyToolStatus(ctx);
          return;
        }
        if (arg === "reset") {
          writeSettingsKey("toolBranchRgbGray", undefined);
          writeSettingsKey("toolBranchColorMode", undefined);
          if (ctx.hasUI) toolExecution.refreshAllToolBranchVisuals(ctx);
          if (ctx.hasUI)
            ctx.ui.notify(
              `Branch color → fixed rgb(${DEFAULT_TOOL_BRANCH_GRAY}) (default)`,
              "info",
            );
          return;
        }
        if (arg === "theme") {
          writeSettingsKey("toolBranchColorMode", "theme");
          if (ctx.hasUI) toolExecution.refreshAllToolBranchVisuals(ctx);
          if (ctx.hasUI)
            ctx.ui.notify("Branch color → follow pi theme (dim/muted)", "info");
          return;
        }
        if (arg === "fixed") {
          writeSettingsKey("toolBranchColorMode", "fixed");
          if (ctx.hasUI) toolExecution.refreshAllToolBranchVisuals(ctx);
          if (ctx.hasUI)
            ctx.ui.notify(
              `Branch color → fixed rgb(${toolExecution.getConfiguredToolBranchGray()})`,
              "info",
            );
          return;
        }
        const gray = Number.parseInt(arg, 10);
        if (!Number.isFinite(gray) || gray < 0 || gray > 255) {
          if (ctx.hasUI)
            ctx.ui.notify(
              "Usage: /cc-tools branch <0-255> | theme | fixed | reset",
              "error",
            );
          return;
        }
        writeSettingsKey("toolBranchRgbGray", gray);
        writeSettingsKey("toolBranchColorMode", "fixed");
        if (ctx.hasUI) toolExecution.refreshAllToolBranchVisuals(ctx);
        if (ctx.hasUI)
          ctx.ui.notify(`Branch color → fixed rgb(${gray})`, "info");
        return;
      }

      if (sub === "thinking") {
        const arg = (parts[1] ?? "status").toLowerCase();
        if (arg === "status" || !arg) {
          if (ctx.hasUI)
            ctx.ui.notify(
              `Thinking: ${grouping.getThinkingMode()} (live = only streaming thinking expands; full = always expanded)`,
              "info",
            );
          return;
        }
        if (arg !== "live" && arg !== "full") {
          if (ctx.hasUI)
            ctx.ui.notify(
              "Usage: /cc-tools thinking live|full|status",
              "error",
            );
          return;
        }
        writeSettingsKey("thinkingMode", arg);
        if (ctx.hasUI) {
          ctx.ui.setToolsExpanded(ctx.ui.getToolsExpanded());
          ctx.ui.notify(
            `Thinking → ${arg}${arg === "live" ? " (only the active thinking expands)" : " (thinking always expanded)"}`,
            "info",
          );
        }
        return;
      }

      if (sub === "detail" || sub === "extra") {
        const next = booleanMode(
          parts[1],
          clickRouting.extraToolOutputExpanded,
        );
        if (next === undefined) {
          if (ctx.hasUI)
            ctx.ui.notify(
              `Usage: /cc-tools detail ${TOOL_BOOL_MODES.join("|")}`,
              "error",
            );
          return;
        }
        if (next === "status") {
          if (ctx.hasUI)
            ctx.ui.notify(
              `Extra tool detail: ${clickRouting.extraToolOutputExpanded ? "on" : "off"}`,
              "info",
            );
          return;
        }
        clickRouting.setExtraToolDetailMode(next);
        if (ctx.hasUI) {
          ctx.ui.setToolsExpanded(ctx.ui.getToolsExpanded());
          ctx.ui.notify(
            `Extra tool detail: ${clickRouting.extraToolOutputExpanded ? "on" : "off"}`,
            "info",
          );
        }
        return;
      }

      if (!(TOOL_MODES as readonly string[]).includes(sub)) {
        if (ctx.hasUI)
          ctx.ui.notify(
            `Unknown option "${sub}". Try /cc-tools status, /cc-tools click toggle, or /cc-tools thinking live.`,
            "error",
          );
        return;
      }
      setToolBackgroundOverride(sub as typeof toolBackgroundMode);
      writeSettingsKey("toolBackground", sub);
      if (ctx.hasUI) {
        applyToolBackgroundMode(ctx.ui.theme);
        ctx.ui.notify(`Tool style → ${sub}`, "info");
      }
    },
  });

  // /cc-theme command — toggle pi-theme-adaptive coloring at runtime.
  const THEME_MODES = ["on", "off", "toggle", "status"] as const;
  pi.registerCommand("cc-theme", {
    description:
      "Toggle whether tool borders / branch rules / diff colors follow the active pi theme",
    getArgumentCompletions(prefix) {
      return THEME_MODES.filter((m) => m.startsWith(prefix)).map((m) => ({
        value: m,
        label: m,
        description:
          m === "on"
            ? "Derive borders, branch rules, dim text and diff tints from the active pi theme (default)"
            : m === "off"
              ? "Keep the fixed Claude-style palette regardless of theme"
              : m === "toggle"
                ? "Flip between on and off"
                : "Show the current setting and a preview of the derived colors",
      }));
    },
    async handler(args, ctx) {
      const raw = args.trim().toLowerCase();
      const current = toolExecution.themeAdaptiveEnabled();

      if (!raw || raw === "status") {
        if (!ctx.hasUI) return;
        const theme = ctx.ui.theme as any;
        const themeName = theme?.name ?? "unknown";
        const state = current ? "on" : "off";
        if (raw === "status" && current) {
          const settings = readSettings();
          const verbKey = settings.spinnerVerbColor || "borderAccent";
          const statusKey = settings.spinnerStatusColor || "muted";
          const verbAnsi =
            toolExecution.safeFgAnsi(theme, verbKey) ??
            toolExecution.safeFgAnsi(theme, "accent");
          const statusAnsi =
            toolExecution.safeFgAnsi(theme, statusKey) ??
            toolExecution.safeFgAnsi(theme, "muted");
          const chromePreview = toolExecution.resolveThemeChromeFg(theme);
          // Print a short preview of what we derived.
          const preview = [
            `chrome      : ${chromePreview ? `${chromePreview}─┌ User ├─\x1b[39m` : "(unchanged)"}`,
            `  (user box, tool rules, branches)`,
            `muted text  : ${toolExecution.safeFgAnsi(theme, "muted") ? `${toolExecution.safeFgAnsi(theme, "muted")}example dim text\x1b[39m` : "(unchanged)"}`,
            `diff add    : ${toolExecution.safeFgAnsi(theme, "toolDiffAdded") ? `${toolExecution.safeFgAnsi(theme, "toolDiffAdded")}+ added line\x1b[39m` : "(unchanged)"}`,
            `diff del    : ${toolExecution.safeFgAnsi(theme, "toolDiffRemoved") ? `${toolExecution.safeFgAnsi(theme, "toolDiffRemoved")}- removed line\x1b[39m` : "(unchanged)"}`,
            `spinner verb: ${verbAnsi ? `${verbAnsi}Cooking…\x1b[39m` : "(unchanged)"} (key: ${verbKey})`,
            `spinner stat: ${statusAnsi ? `${statusAnsi}(thinking · ↓ 10 tokens · 2s)\x1b[39m` : "(unchanged)"} (key: ${statusKey})`,
          ].join("\n  ");
          ctx.ui.notify(
            `Theme adaptive: ${state} (theme "${themeName}")\n  ${preview}`,
            "info",
          );
        } else {
          ctx.ui.notify(
            `Theme adaptive: ${state} (theme "${themeName}")`,
            "info",
          );
        }
        return;
      }

      let next: boolean;
      if (raw === "on") next = true;
      else if (raw === "off") next = false;
      else if (raw === "toggle") next = !current;
      else {
        if (ctx.hasUI)
          ctx.ui.notify(
            `Unknown option "${raw}". Options: ${THEME_MODES.join(", ")}`,
            "error",
          );
        return;
      }

      writeSettingsKey("themeAdaptive", next);
      bustSpinnerSettingsCache();
      // Invalidate caches so the next render re-derives from the active
      // theme (or falls back to the fixed Claude palette).
      toolExecution.invalidateThemePaletteCache();
      dependencies.presentation.diffPresentationModule.reset();
      if (next) {
        if (ctx.hasUI) toolExecution.applyThemePaletteIfNeeded(ctx.ui.theme);
      } else {
        toolExecution.resetThemePalette();
      }
      if (ctx.hasUI) {
        const label = next
          ? "on — colors follow pi theme"
          : "off — fixed Claude palette";
        ctx.ui.notify(`Theme adaptive: ${label}`, "info");
      }
    },
  });

  // /cc-spinner command — pick which theme color keys drive the spinner verb
  // and status suffix.
  const COMMON_COLOR_KEYS: readonly string[] = [
    "accent",
    "borderAccent",
    "success",
    "error",
    "warning",
    "muted",
    "dim",
    "text",
    "thinkingText",
    "toolTitle",
    "mdHeading",
    "mdCode",
    "mdLink",
    "mdListBullet",
    "bashMode",
    "thinkingLow",
    "thinkingMedium",
    "thinkingHigh",
    "thinkingXhigh",
    "syntaxKeyword",
    "syntaxFunction",
    "syntaxString",
    "syntaxType",
  ];
  pi.registerCommand("cc-spinner", {
    description:
      "Set the spinner verb or status theme color, or preview current values",
    getArgumentCompletions(prefix) {
      const subCommands = ["verb", "status", "reset", "preview"];
      const parts = prefix.split(/\s+/);
      if (parts.length <= 1) {
        return subCommands
          .filter((c) => c.startsWith(parts[0] ?? ""))
          .map((c) => ({
            value: c,
            label: c,
            description:
              c === "verb"
                ? "Set the color key used for the spinner verb (e.g. 'Cooking…')"
                : c === "status"
                  ? "Set the color key used for the spinner status suffix"
                  : c === "reset"
                    ? "Reset both verb and status to defaults (borderAccent, muted)"
                    : "Preview every theme color key with its current sample",
          }));
      }
      // Second arg: color key completions for verb/status.
      if (parts[0] === "verb" || parts[0] === "status") {
        const keyPrefix = (parts[1] ?? "").toLowerCase();
        return COMMON_COLOR_KEYS.filter((k) =>
          k.toLowerCase().startsWith(keyPrefix),
        ).map((k) => ({
          value: k,
          label: k,
          description: `theme.fg("${k}", …)`,
        }));
      }
      return [];
    },
    async handler(args, ctx) {
      const parts = args
        .trim()
        .split(/\s+/)
        .filter((p) => p.length > 0);
      const sub = (parts[0] ?? "").toLowerCase();
      const theme = ctx.hasUI ? (ctx.ui.theme as any) : null;
      const settings = readSettings();
      const currentVerb = settings.spinnerVerbColor || "borderAccent";
      const currentStatus = settings.spinnerStatusColor || "muted";

      if (!sub || sub === "preview") {
        if (!ctx.hasUI) return;
        if (!theme) {
          ctx.ui.notify(
            `Spinner verb: ${currentVerb}, status: ${currentStatus} (no theme)`,
            "info",
          );
          return;
        }
        const lines: string[] = [
          `Current: verb=${currentVerb}, status=${currentStatus}`,
          "",
          "Preview of common theme keys (pick one for verb or status):",
        ];
        for (const key of COMMON_COLOR_KEYS) {
          const ansi = toolExecution.safeFgAnsi(theme, key);
          const marker =
            key === currentVerb
              ? "(verb)"
              : key === currentStatus
                ? "(status)"
                : "";
          const sample = ansi ? `${ansi}Cooking…\x1b[39m` : "(unmapped)";
          lines.push(`  ${key.padEnd(16)} ${sample} ${marker}`);
        }
        ctx.ui.notify(lines.join("\n"), "info");
        return;
      }

      if (sub === "reset") {
        writeSettingsKey("spinnerVerbColor", undefined);
        writeSettingsKey("spinnerStatusColor", undefined);
        bustSpinnerSettingsCache();
        if (ctx.hasUI)
          ctx.ui.notify(
            "Spinner colors reset to defaults (verb=borderAccent, status=muted)",
            "info",
          );
        return;
      }

      if (sub !== "verb" && sub !== "status") {
        if (ctx.hasUI)
          ctx.ui.notify(
            `Usage: /cc-spinner verb <key> | status <key> | reset | preview`,
            "error",
          );
        return;
      }

      const key = parts[1];
      if (!key) {
        if (ctx.hasUI)
          ctx.ui.notify(
            `Missing color key. Try /cc-spinner preview to see available keys.`,
            "error",
          );
        return;
      }

      // Validate the key resolves to *some* color in the active theme;
      // accept anyway if the user insists so themes with custom keys work.
      const ansi = theme ? toolExecution.safeFgAnsi(theme, key) : null;
      const settingKey =
        sub === "verb" ? "spinnerVerbColor" : "spinnerStatusColor";
      writeSettingsKey(settingKey, key);
      bustSpinnerSettingsCache();
      if (ctx.hasUI) {
        const sample = ansi
          ? `${ansi}sample\x1b[39m`
          : "(key unmapped in current theme)";
        ctx.ui.notify(`Spinner ${sub} → ${key} ${sample}`, "info");
      }
    },
  });

  pi.on("session_start", async (event, ctx) => {
    toolExecution.clearBashHostState();
    if (!ctx.hasUI) return;
    toolExecution.patchUiNotifications(ctx.ui);
    // Session switch (/resume, /new) can leave tool chrome from the previous
    // theme; rebind from ctx.ui.theme (other extensions may setTheme in the
    // same tick — deferred passes pick up the final theme without coupling).
    toolExecution.rebindUiChromeToTheme(ctx);
    toolExecution.scheduleDeferredChromeRebind(ctx, 0);
    const reason = (event as { reason?: string })?.reason;
    if (reason === "resume" || reason === "new" || reason === "fork") {
      toolExecution.scheduleDeferredChromeRebind(ctx, 48);
      // Chat history rebuild can run after session_start; re-sync transparent tool bgs.
      toolExecution.scheduleDeferredChromeRebind(ctx, 120);
    }
  });

  pi.on("turn_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    toolExecution.patchUiNotifications(ctx.ui);
    applyToolBackgroundMode(ctx.ui.theme);
    toolExecution.applyThemePaletteIfNeeded(ctx.ui.theme);
  });

  pi.on("message_update", async (event) => {
    const content = (event as any)?.message?.content;
    const hasText =
      Array.isArray(content) &&
      content.some(
        (block: any) =>
          block?.type === "text" &&
          typeof block.text === "string" &&
          block.text.trim().length > 0,
      );
    if (hasText) toolExecution.clearPreservedBashPreviews();
  });

  pi.on("tool_execution_start", async (event) => {
    toolExecution.clearPreservedBashPreviews();
    if ((event as any)?.toolName === "bash")
      toolExecution.trackBashOriginal(
        (event as any)?.toolCallId,
        (event as any)?.args,
      );
  });

  const cwd = process.cwd();
  const sp = (path: string) => toolExecution.shortPath(cwd, path);

  const readTool = createReadTool(cwd);
  pi.registerTool({
    name: "read",
    label: "read",
    description: readTool.description,
    parameters: readTool.parameters,
    async execute(toolCallId, params, signal, onUpdate) {
      return readTool.execute(toolCallId, params, signal, onUpdate);
    },
    renderCall(args, theme, ctx) {
      toolExecution.syncToolCallStatus(ctx);
      return toolExecution.makeToolFamilyCallText(
        "tool-native",
        "read",
        "Read",
        args,
        theme,
        ctx,
      );
    },
    renderResult(result, { expanded, isPartial }, theme, ctx) {
      if (isPartial) {
        return toolFamily.makeToolFamilyStreamText(
          "tool-native",
          "read",
          "Read",
          ctx.args,
          result,
          expanded,
          theme,
          ctx,
        );
      }
      toolExecution.clearBlinkTimer(ctx);
      toolExecution.setToolStatus(ctx, ctx.isError ? "error" : "success");
      if (toolFamily.getFirstImageBlock(result))
        return toolFamily.renderReadImageResult(result, expanded, theme, ctx);
      const content = result.content.find(
        (block: any) => block?.type === "text",
      );
      if (content?.type !== "text")
        return toolExecution.makeText(
          ctx.lastComponent,
          toolExecution.withToolErrorIndent(
            theme.fg("error", "No text content"),
          ),
        );
      return toolExecution.makeSettledToolFamilyResultText(
        "tool-native",
        "read",
        "Read",
        result,
        expanded,
        theme,
        ctx,
      );
    },
  });

  const shellPath = SettingsManager.create(cwd).getShellPath();
  const bashTool = createBashTool(cwd, { shellPath });
  pi.registerTool({
    name: "bash",
    label: "bash",
    description: bashTool.description,
    parameters: bashTool.parameters,
    async execute(toolCallId, params, signal, onUpdate) {
      return bashTool.execute(toolCallId, params, signal, onUpdate);
    },
    renderCall(args, theme, ctx) {
      toolExecution.syncToolCallStatus(ctx);
      toolExecution.syncBashDuration(ctx);
      const rewrite = toolExecution.bashRewriteFor(ctx.toolCallId, args);
      return toolExecution.makeToolFamilyCallText(
        "tool-native",
        "bash",
        "Bash",
        args,
        theme,
        ctx,
        false,
        {
          showCallDetail:
            ctx.expanded === true && toolExecution.shouldRevealCallArgs(ctx),
          showCollapsedCallDetail:
            ctx.expanded !== true &&
            toolExecution.shouldRevealCallArgs(ctx) &&
            (ctx.state?._toolStatus === "pending" ||
              (ctx.state?._toolStatus === "error" &&
                toolExecution.lineCount(
                  typeof args?.command === "string" ? args.command : "",
                ) > 1)),
          ...(rewrite ? { bashRewrite: rewrite } : {}),
        },
        toolExecution.bashElapsedMs(ctx),
      );
    },
    renderResult(result, { expanded, isPartial }, theme, ctx) {
      toolExecution.syncBashDuration(ctx, isPartial);
      const rewrite = toolExecution.bashRewriteFor(ctx.toolCallId, ctx.args);
      if (isPartial)
        return toolFamily.makeToolFamilyStreamText(
          "tool-native",
          "bash",
          "Bash",
          ctx.args,
          result,
          expanded,
          theme,
          ctx,
        );
      const hasOutput = transcript
        .resultTextContent(result)
        .split("\n")
        .some((line) => line.trim());
      if (hasOutput && ctx.state?._bashPreviewReleased !== true) {
        toolExecution.preserveBashPreview(ctx.toolCallId, () =>
          clickRouting.safeInvalidate(ctx),
        );
        if (ctx.state) ctx.state._bashPreviewReleased = true;
      }
      const showCollapsedResultDetail =
        !expanded &&
        !toolExecution.progressiveLocalControlsEnabled() &&
        typeof ctx.toolCallId === "string" &&
        toolExecution.BASH_PREVIEW_INVALIDATORS.has(ctx.toolCallId);
      return toolExecution.makeSettledToolFamilyResultText(
        "tool-native",
        "bash",
        "Bash",
        result,
        expanded,
        theme,
        ctx,
        {
          normalPreview: showCollapsedResultDetail
            ? toolExecution.liveToolPreviewLimit()
            : toolExecution.bashCollapsedLimit(),
          policy: {
            preserveBlankLines: expanded,
            showCollapsedResultDetail,
            ...(rewrite ? { bashRewrite: rewrite } : {}),
          },
        },
      );
    },
  });

  const registerNativeTextTool = (definition: {
    name: "grep" | "find" | "ls";
    label: "Grep" | "Find" | "List";
    tool: any;
  }): void => {
    const { name, label, tool } = definition;
    pi.registerTool({
      name,
      label: name,
      description: tool.description,
      parameters: tool.parameters,
      async execute(toolCallId, params, signal, onUpdate) {
        return tool.execute(toolCallId, params, signal, onUpdate);
      },
      renderCall(args, theme, ctx) {
        toolExecution.syncToolCallStatus(ctx);
        return toolExecution.makeToolFamilyCallText(
          "tool-native",
          name,
          label,
          args,
          theme,
          ctx,
        );
      },
      renderResult(result, { expanded, isPartial }, theme, ctx) {
        if (isPartial)
          return toolFamily.makeToolFamilyStreamText(
            "tool-native",
            name,
            label,
            ctx.args,
            result,
            expanded,
            theme,
            ctx,
          );
        return toolExecution.makeSettledToolFamilyResultText(
          "tool-native",
          name,
          label,
          result,
          expanded,
          theme,
          ctx,
        );
      },
    });
  };
  registerNativeTextTool({
    name: "grep",
    label: "Grep",
    tool: createGrepTool(cwd),
  });
  registerNativeTextTool({
    name: "find",
    label: "Find",
    tool: createFindTool(cwd),
  });
  registerNativeTextTool({
    name: "ls",
    label: "List",
    tool: createLsTool(cwd),
  });

  const writeTool = createWriteTool(cwd);
  pi.registerTool({
    name: "write",
    label: "write",
    description: writeTool.description,
    parameters: writeTool.parameters,
    async execute(toolCallId, params, signal, onUpdate, _ctx) {
      const fp = params.path ?? (params as any).file_path ?? "";
      const fullPath = fp ? resolve(cwd, fp) : "";
      const existedBefore =
        !!fullPath && toolExecution.fileExistsForTool(cwd, fp);
      toolExecution.WRITE_EXISTED_BEFORE.set(toolCallId, existedBefore);
      let old: string | null = null;
      try {
        if (fullPath && existedBefore) old = readFileSync(fullPath, "utf-8");
      } catch {
        old = null;
      }
      const evidence = await toolFamily.captureMutationDiff(
        "write",
        cwd,
        params,
        old,
      );
      const result = await writeTool.execute(
        toolCallId,
        params,
        signal,
        onUpdate,
      );
      toolFamily.attachDiffEvidence(result, evidence);
      return result;
    },
    renderCall(args, theme, ctx) {
      const fp = args?.path ?? (args as any)?.file_path ?? "";
      const revealSummary =
        toolExecution.shouldRevealCallArgs(ctx) ||
        (!!fp && toolExecution.hasOwnArg(args, "content"));
      toolExecution.syncToolCallStatus(ctx);
      const wasNew = toolExecution.getWriteWasNewFile(
        ctx,
        cwd,
        fp,
        revealSummary,
      );
      const label = wasNew === true ? "Create" : "Write";
      const summary = toolExecution.stableCallSummary(
        ctx,
        "_callSummary",
        () => {
          const base = sp(fp);
          return toolExecution.shouldRevealCallArgs(ctx)
            ? `${base} ${theme.fg("muted", `(${toolExecution.lineCount(args.content ?? "")} lines)`)}`
            : base;
        },
        revealSummary,
      );
      const hdr = toolExecution.toolHeader(
        label,
        summary,
        theme,
        toolExecution.toolStatusDot(ctx, theme),
        toolExecution.liveLineCountTrailing(ctx, theme),
      );
      return toolExecution.makeText(ctx.lastComponent, hdr);
    },
    renderResult(result, { expanded, isPartial }, theme, ctx) {
      if (isPartial) {
        return toolFamily.makeToolFamilyStreamText(
          "tool-native",
          "write",
          "Write",
          ctx.args,
          result,
          expanded,
          theme,
          ctx,
        );
      }
      toolExecution.clearBlinkTimer(ctx);
      toolExecution.setToolStatus(ctx, ctx.isError ? "error" : "success");
      if (typeof ctx?.toolCallId === "string")
        toolExecution.WRITE_EXISTED_BEFORE.delete(ctx.toolCallId);
      if (ctx.isError) {
        const e =
          result.content
            ?.filter((c: any) => c.type === "text")
            .map((c: any) => c.text || "")
            .join("\n") ?? "Error";
        return toolExecution.makeText(
          ctx.lastComponent,
          toolExecution.withToolErrorIndent(theme.fg("error", e)),
        );
      }
      const details = (result as any).details;
      const presentation = toolFamily.presentMutationDiff(
        ctx,
        theme,
        "write",
        "result",
        ctx.args,
        details?.diffEvidence,
        2,
        true,
        details,
      );
      if (!presentation.body) {
        return toolExecution.makeText(
          ctx.lastComponent,
          toolExecution.withBranch(
            toolExecution.markResultSummary(theme.fg("success", "Written")),
            theme,
          ),
        );
      }
      return toolExecution.makeResponsiveDiffText(
        ctx,
        ctx.lastComponent,
        presentation.body,
      );
    },
  });

  const editTool = createEditTool(cwd);
  pi.registerTool({
    name: "edit",
    label: "edit",
    description: editTool.description,
    parameters: editTool.parameters,
    async execute(toolCallId, params, signal, onUpdate, _ctx) {
      const evidence = await toolFamily.captureMutationDiff(
        "edit",
        cwd,
        params,
      );
      const result = await editTool.execute(
        toolCallId,
        params,
        signal,
        onUpdate,
      );
      toolFamily.attachDiffEvidence(result, evidence);
      return result;
    },
    renderCall(args, theme, ctx) {
      const fp = args?.path ?? (args as any)?.file_path ?? "";
      const operations = toolFamily.getEditOperations(args);
      const revealSummary =
        toolExecution.shouldRevealCallArgs(ctx) ||
        (!!fp && toolExecution.hasOwnArg(args, "edits"));
      const summary = toolExecution.stableCallSummary(
        ctx,
        "_callSummary",
        () =>
          toolExecution.shouldRevealCallArgs(ctx) && operations.length > 1
            ? `${sp(fp)} ${theme.fg("muted", `(${operations.length} edits)`)}`
            : sp(fp),
        revealSummary,
      );
      toolExecution.syncToolCallStatus(ctx);
      const hdr = toolExecution.toolHeader(
        "Edit",
        summary,
        theme,
        toolExecution.toolStatusDot(ctx, theme),
        toolExecution.liveLineCountTrailing(ctx, theme),
      );
      if (!(ctx.argsComplete && operations.length > 0))
        return toolExecution.makeText(ctx.lastComponent, hdr);
      const presentation = toolFamily.presentMutationDiff(
        ctx,
        theme,
        "edit",
        "call",
        args,
        undefined,
        3,
      );
      return toolExecution.makeResponsiveDiffText(
        ctx,
        ctx.lastComponent,
        presentation.body ? `${hdr}\n${presentation.body}` : hdr,
      );
    },
    renderResult(result, { expanded, isPartial }, theme, ctx) {
      if (isPartial) {
        return toolFamily.makeToolFamilyStreamText(
          "tool-native",
          "edit",
          "Edit",
          ctx.args,
          result,
          expanded,
          theme,
          ctx,
        );
      }
      toolExecution.clearBlinkTimer(ctx);
      toolExecution.setToolStatus(ctx, ctx.isError ? "error" : "success");
      if (ctx.isError) {
        const e =
          result.content
            ?.filter((c: any) => c.type === "text")
            .map((c: any) => c.text || "")
            .join("\n") ?? "Error";
        return toolExecution.makeText(
          ctx.lastComponent,
          toolExecution.withToolErrorIndent(theme.fg("error", e)),
        );
      }
      const evidence = (result as any).details?.diffEvidence;
      if (!evidence && toolFamily.getEditOperations(ctx.args).length === 0) {
        return toolExecution.makeText(
          ctx.lastComponent,
          toolExecution.withBranch(
            toolExecution.markResultSummary(theme.fg("success", "Applied")),
            theme,
          ),
        );
      }
      const presentation = toolFamily.presentMutationDiff(
        ctx,
        theme,
        "edit",
        "result",
        ctx.args,
        evidence,
        3,
        true,
        (result as any).details,
      );
      return toolExecution.makeResponsiveDiffText(
        ctx,
        ctx.lastComponent,
        presentation.body,
      );
    },
  });

  const wrappedOpenAiTools = new Set<string>();
  const registerOpenAiToolOverrides = (): void => {
    let allTools: unknown[] = [];
    try {
      allTools =
        typeof (pi as any).getAllTools === "function"
          ? (pi as any).getAllTools()
          : [];
    } catch {
      allTools = [];
    }
    for (const tool of allTools) {
      if (!toolFamily.isOpenAiToolCandidate(tool)) continue;
      const record = tool as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name : "";
      if (!name || wrappedOpenAiTools.has(name)) continue;
      const execute =
        typeof record.execute === "function" ? (record.execute as any) : null;
      if (!execute) continue;
      const rawLabel =
        typeof record.label === "string" ? record.label.trim() : "";
      const label =
        rawLabel && rawLabel !== name && !rawLabel.includes("_")
          ? rawLabel
          : toolFamily.humanizeToolName(name);
      const description =
        typeof record.description === "string" ? record.description : label;
      (pi as any).registerTool({
        name,
        label,
        description,
        parameters: record.parameters,
        prepareArguments:
          typeof record.prepareArguments === "function"
            ? record.prepareArguments
            : undefined,
        async execute(
          toolCallId: string,
          params: any,
          signal: AbortSignal | undefined,
          onUpdate: any,
          ctx: any,
        ) {
          const evidence =
            name === "apply_patch"
              ? await toolFamily.captureMutationDiff(
                  "apply_patch",
                  ctx?.cwd ?? cwd,
                  params,
                )
              : undefined;
          const result = await Promise.resolve(
            execute(toolCallId, params, signal, onUpdate, ctx),
          );
          toolFamily.attachDiffEvidence(result, evidence);
          return result;
        },
        renderCall(args: any, theme: Theme, ctx: any) {
          if (name === "apply_patch")
            return toolFamily.renderApplyPatchCall(args, theme, ctx);
          return toolFamily.renderGenericToolCall(
            name,
            args,
            theme,
            ctx,
            label,
          );
        },
        renderResult(
          result: any,
          { expanded, isPartial }: any,
          theme: Theme,
          ctx: any,
        ) {
          if (name === "apply_patch")
            return toolFamily.renderApplyPatchResult(
              result,
              isPartial,
              theme,
              ctx,
            );
          return toolFamily.renderOpenAiToolResult(
            name,
            result,
            expanded,
            isPartial,
            theme,
            ctx,
          );
        },
      });
      wrappedOpenAiTools.add(name);
    }
  };

  const wrappedMcpTools = new Set<string>();
  const registerMcpToolOverrides = (): void => {
    let allTools: unknown[] = [];
    try {
      allTools =
        typeof (pi as any).getAllTools === "function"
          ? (pi as any).getAllTools()
          : [];
    } catch {
      allTools = [];
    }
    for (const tool of allTools) {
      if (!toolFamily.isMcpToolCandidate(tool)) continue;
      const record = tool as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name : "";
      if (!name || wrappedMcpTools.has(name)) continue;
      const execute =
        typeof record.execute === "function" ? (record.execute as any) : null;
      if (!execute) continue;
      const label =
        typeof record.label === "string"
          ? record.label
          : name === "mcp"
            ? "MCP"
            : `MCP ${name}`;
      const description =
        typeof record.description === "string"
          ? record.description
          : "MCP tool";
      (pi as any).registerTool({
        name,
        label,
        description,
        renderShell: "self",
        parameters: record.parameters,
        prepareArguments:
          typeof record.prepareArguments === "function"
            ? record.prepareArguments
            : undefined,
        async execute(
          toolCallId: string,
          params: any,
          signal: AbortSignal | undefined,
          onUpdate: any,
          ctx: any,
        ) {
          return await Promise.resolve(
            execute(toolCallId, params, signal, onUpdate, ctx),
          );
        },
        renderCall(args: any, theme: Theme, ctx: any) {
          return toolFamily.renderGenericToolCall(name, args, theme, ctx);
        },
        renderResult(
          result: any,
          { expanded, isPartial }: any,
          theme: Theme,
          ctx: any,
        ) {
          return toolFamily.renderMcpToolResult(
            result,
            expanded,
            isPartial,
            theme,
            ctx,
          );
        },
      });
      wrappedMcpTools.add(name);
    }
  };

  pi.on("session_start", async () => {
    registerOpenAiToolOverrides();
    registerMcpToolOverrides();
  });
  pi.on("before_agent_start", async () => {
    registerOpenAiToolOverrides();
    registerMcpToolOverrides();
  });

  // Streaming activity keeps the blink timer alive. Do NOT clear blink contexts
  // on turn_end — a turn ends when the assistant message finishes, BEFORE its
  // tools run. agent_end / agent_settled are the real "work finished" signals.
  pi.on("turn_start", async () => {
    toolExecution.markBlinkActivity();
  });
  pi.on("message_start", async () => {
    toolExecution.markBlinkActivity();
  });
  pi.on("message_update", async () => {
    toolExecution.markBlinkActivity();
  });
  pi.on("tool_execution_start", async () => {
    toolExecution.markBlinkActivity();
  });
  // Partial tool output is the main long-running signal (bash streams for minutes).
  pi.on("tool_execution_update", async () => {
    toolExecution.markBlinkActivity();
  });
  pi.on("tool_execution_end", async () => {
    toolExecution.markBlinkActivity();
  });
  // agent_end fires when a low-level run finishes (tools for that assistant message
  // are done). registerThinkingLabels clears transcriptTiming.currentAgentWorkStartMs on the same
  // event; defer so we only wipe blink state once the work marker is gone.
  // Do not use agent_settled here — older peer types don't include it, and the
  // live-agent heartbeat already keeps quiet long tools blinking until agent_end.
  pi.on("agent_end", async () => {
    queueMicrotask(() => {
      if (transcript.transcriptTiming.currentAgentWorkStartMs !== undefined) {
        toolExecution.markBlinkActivity();
        return;
      }
      toolExecution._clearAllBlinkContexts();
    });
  });
  // Session rebuild (resume/reload/fork) must not leave history partials blinking.
  pi.on("session_start", async () => {
    toolExecution._clearAllBlinkContexts();
    dependencies.presentation.diffPresentationModule.reset();
  });
  pi.on("session_shutdown", async () => {
    toolExecution._clearAllBlinkContexts();
    toolExecution.clearAllBashDurationContexts();
    toolExecution.clearBashHostState();
    toolExecution.WRITE_EXISTED_BEFORE.clear();
    dependencies.presentation.diffPresentationModule.reset();
    toolExecution.invalidateThemePaletteCache();
    toolExecution.bumpToolBranchVisualEpoch();
  });
}
