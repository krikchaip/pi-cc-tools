import { withRendererHarness } from "./harness.ts";

const baseSettings = {
  clickExpansion: true,
  expandedPreviewMaxLines: 10,
  extraExpandedPreviewMaxLines: 15,
  toolBranchColorMode: "theme",
};

await withRendererHarness(
  {
    name: "renderer-theme-palette",
    stubTools: [],
    piSettings: {
      ...baseSettings,
      themeAdaptive: true,
      diffTheme: "midnight",
    },
  },
  async ({ fakePi, toolExecution, toolGroup, writePiSettings }) => {
    const { Text } =
      await import("../../node_modules/@earendil-works/pi-tui/dist/index.js");
    const { Theme, getResolvedThemeColors, getThemeByName, setThemeInstance } =
      await import("../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js");

    const resolved = getResolvedThemeColors("light") as Record<string, string>;
    const backgroundKeys = new Set([
      "selectedBg",
      "userMessageBg",
      "customMessageBg",
      "toolPendingBg",
      "toolSuccessBg",
      "toolErrorBg",
    ]);
    const foregroundColors: Record<string, string> = {};
    const backgroundColors: Record<string, string> = {};
    for (const [key, value] of Object.entries(resolved)) {
      (backgroundKeys.has(key) ? backgroundColors : foregroundColors)[key] =
        value;
    }
    foregroundColors.muted = "#f000f0";
    foregroundColors.dim = "#00ffff";
    foregroundColors.borderMuted = "#ff8800";
    backgroundColors.toolSuccessBg = "#a0a0a0";
    backgroundColors.userMessageBg = "#a0a0a0";
    backgroundColors.selectedBg = "#a0a0a0";
    const adaptiveTheme = new Theme(
      foregroundColors,
      backgroundColors,
      "truecolor",
      {
        name: "candidate-5-theme-palette",
      },
    );
    const defaultTheme = getThemeByName("dark");
    const list = fakePi.tools.get("ls");
    const ccTheme = fakePi.commands.get("cc-theme");
    if (!ccTheme) throw new Error("cc-theme command was not registered");

    let fixtureSequence = 0;
    const renderList = (label: string, theme: any): string => {
      fixtureSequence += 1;
      const context = {
        state: {},
        args: { path: "." },
        argsComplete: true,
        cwd: process.cwd(),
        expanded: true,
        isError: false,
        lastComponent: undefined,
      };
      list.renderCall({ path: "." }, theme, context);
      return list
        .renderResult(
          {
            content: [
              { type: "text", text: `${label}-${fixtureSequence}.txt\nbeta/` },
            ],
          },
          { expanded: true, isPartial: false },
          theme,
          context,
        )
        .render(120)
        .join("\n");
    };

    const emptyDefinition = {
      name: "theme-empty",
      label: "Theme Empty",
      description: "Renderer theme fixture",
      parameters: {},
      renderCall: () => new Text(""),
      renderResult: () => new Text(""),
    };
    const renderEmptyGroup = (label: string): string => {
      fixtureSequence += 1;
      return toolGroup([
        {
          tool: "theme-empty",
          id: `${label}_${fixtureSequence}_1`,
          definition: emptyDefinition,
          interaction: "fullscreen",
          result: { content: [], isError: false },
          expanded: true,
        },
        {
          tool: "theme-empty",
          id: `${label}_${fixtureSequence}_2`,
          definition: emptyDefinition,
          interaction: "fullscreen",
          result: { content: [], isError: false },
          expanded: true,
        },
      ])
        .observe(120)
        .rawRows.join("\n");
    };

    const assertHostPalette = (
      label: string,
      theme: any,
      ruleAnsi: string,
      dimAnsi: string,
    ): void => {
      const listRaw = renderList(label, theme);
      if (!listRaw.includes(`${ruleAnsi}├──`)) {
        throw new Error(
          `${label} did not preserve List rule: ${JSON.stringify(listRaw)}`,
        );
      }
      const groupRaw = renderEmptyGroup(label);
      if (!groupRaw.includes(`${dimAnsi}theme-empty`)) {
        throw new Error(
          `${label} did not preserve grouped fallback text: ${JSON.stringify(groupRaw)}`,
        );
      }
    };

    const commandContext = (theme: any) => ({
      hasUI: true,
      ui: {
        theme,
        notify() {},
      },
    });
    const setAdaptive = async (
      mode: "on" | "off",
      theme: any,
    ): Promise<void> => {
      await ccTheme.handler(mode, commandContext(theme));
    };
    const assertConfiguredPaletteAcrossAdaptiveModes = async (
      label: string,
      ruleAnsi: string,
      dimAnsi: string,
    ): Promise<void> => {
      for (const mode of ["off", "on"] as const) {
        await setAdaptive(mode, adaptiveTheme);
        assertHostPalette(
          `${label} with adaptive ${mode}`,
          adaptiveTheme,
          ruleAnsi,
          dimAnsi,
        );
      }
    };

    setThemeInstance(adaptiveTheme);
    try {
      const midnightRule = "\x1b[38;2;40;40;40m";
      const midnightDim = "\x1b[38;2;64;64;64m";
      assertHostPalette(
        "initial midnight preset",
        adaptiveTheme,
        midnightRule,
        midnightDim,
      );
      await assertConfiguredPaletteAcrossAdaptiveModes(
        "midnight preset",
        midnightRule,
        midnightDim,
      );

      writePiSettings({
        ...baseSettings,
        themeAdaptive: true,
        diffTheme: "midnight",
        diffColors: {
          fgDim: "#112233",
          fgRule: "#445566",
        },
      });
      const directRule = "\x1b[38;2;68;85;102m";
      const directDim = "\x1b[38;2;17;34;51m";
      assertHostPalette(
        "direct foreground overrides preset",
        adaptiveTheme,
        directRule,
        directDim,
      );
      await assertConfiguredPaletteAcrossAdaptiveModes(
        "direct overrides",
        directRule,
        directDim,
      );

      const adaptiveRule = "\x1b[38;2;64;255;255m";
      const adaptiveDim = "\x1b[38;2;240;0;240m";
      writePiSettings({
        ...baseSettings,
        themeAdaptive: true,
      });
      assertHostPalette(
        "direct config adaptive on",
        adaptiveTheme,
        adaptiveRule,
        adaptiveDim,
      );
      const readDefinition = fakePi.tools.get("read");
      const readSummaryRaw = toolExecution({
        tool: "read",
        id: "semantic_dim_palette",
        args: { path: "palette.txt" },
        definition: readDefinition,
        interaction: "fullscreen",
        result: {
          content: [{
            type: "text",
            text: Array.from({ length: 15 }, (_, index) => `line ${index + 1}`).join("\n"),
          }],
          isError: false,
        },
      }).observe(120).rawRows.join("\n");
      if (
        !readSummaryRaw.includes("\x1b[38;2;240;0;240m15 lines loaded")
        || !readSummaryRaw.includes("\x1b[38;2;0;255;255mclick")
      ) {
        throw new Error(
          `Read summary conflated muted text and semantic dim: ${JSON.stringify(readSummaryRaw)}`,
        );
      }
      writePiSettings({
        ...baseSettings,
        themeAdaptive: false,
      });
      assertHostPalette(
        "direct config adaptive off",
        adaptiveTheme,
        "\x1b[38;2;50;50;50m",
        "\x1b[38;2;80;80;80m",
      );
      writePiSettings({
        ...baseSettings,
        themeAdaptive: true,
      });
      assertHostPalette(
        "direct config adaptive on again",
        adaptiveTheme,
        adaptiveRule,
        adaptiveDim,
      );

      const renderThresholdBranch = (
        label: string,
        panel: number | undefined,
        foreground: number,
      ): string => {
        const channel = (value: number) => value.toString(16).padStart(2, "0");
        const gray = (value: number) =>
          `#${channel(value)}${channel(value)}${channel(value)}`;
        const thresholdForeground: Record<string, string> = {
          ...foregroundColors,
          dim: "#ffffff",
          muted: "#ffffff",
          text: gray(foreground),
        };
        const thresholdBackground: Record<string, string> =
          panel === undefined
            ? {}
            : {
                toolSuccessBg: gray(panel),
                userMessageBg: gray(panel),
                selectedBg: gray(panel),
              };
        const thresholdTheme = new Theme(
          thresholdForeground,
          thresholdBackground,
          "truecolor",
          {
            name: `candidate-5-threshold-${label}`,
          },
        );
        setThemeInstance(thresholdTheme);
        renderList(`threshold_${label}`, thresholdTheme);
        return renderEmptyGroup(`threshold_${label}`);
      };
      const thresholdCases = [
        ["panel-165", 165, 31, "\x1b[38;2;255;255;255m├"],
        ["panel-166", 166, 31, "\x1b[38;2;118;118;118m├"],
        ["foreground-94", undefined, 94, "\x1b[38;2;118;118;118m├"],
        ["foreground-95", undefined, 95, "\x1b[38;2;255;255;255m├"],
      ] as const;
      for (const [label, panel, foreground, expected] of thresholdCases) {
        const raw = renderThresholdBranch(label, panel, foreground);
        if (!raw.includes(expected)) {
          throw new Error(
            `theme threshold ${label} changed classification: ${JSON.stringify(raw)}`,
          );
        }
      }

      console.log(
        "OK  preset/direct foregrounds, adaptive transitions, host palette seams, and light thresholds",
      );
    } finally {
      writePiSettings({
        ...baseSettings,
        themeAdaptive: true,
      });
      if (defaultTheme) {
        setThemeInstance(defaultTheme);
        await setAdaptive("on", defaultTheme);
      }
    }
  },
);
