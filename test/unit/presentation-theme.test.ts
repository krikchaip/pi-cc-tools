import assert from "node:assert/strict";
import test from "node:test";

import {
  CHROME_STYLE_DEFAULTS,
  createPresentationThemeAdapter,
} from "../../extensions/tool-presentation/index.ts";

function theme(
  foregrounds: Readonly<Record<string, string>>,
  backgrounds: Readonly<Record<string, string>> = {},
  name = "fixture",
) {
  return {
    name,
    getFgAnsi(key: string) {
      return foregrounds[key] ?? "";
    },
    getBgAnsi(key: string) {
      return backgrounds[key] ?? "";
    },
  };
}

const fixedBranch = {
  mode: "fixed",
  gray: 72,
  outlineBrighten: 64,
} as const;

const themedBranch = {
  ...fixedBranch,
  mode: "theme",
} as const;

test("parses truecolor and xterm-256 ANSI colors", () => {
  const adapter = createPresentationThemeAdapter();

  assert.deepEqual(
    adapter.parseAnsiRgb("\x1b[38;2;12;34;56m"),
    { r: 12, g: 34, b: 56 },
  );
  assert.deepEqual(
    adapter.parseAnsiRgb("\x1b[48;5;196m"),
    { r: 255, g: 0, b: 0 },
  );
  assert.equal(adapter.parseAnsiRgb("not ANSI"), null);
});

test("safe theme reads contain missing and throwing theme methods", () => {
  const adapter = createPresentationThemeAdapter();
  const throwingTheme = {
    getFgAnsi() {
      throw new Error("bad theme");
    },
  };

  assert.equal(adapter.safeForeground(undefined, "dim"), null);
  assert.equal(adapter.safeForeground(throwingTheme, "dim"), null);
  assert.equal(adapter.safeBackground({}, "selectedBg"), null);
});

test("attenuates bright chrome on light panels only", () => {
  const adapter = createPresentationThemeAdapter();
  const lightTheme = theme(
    { dim: "\x1b[38;2;240;240;240m" },
    { toolSuccessBg: "\x1b[48;2;250;250;250m" },
  );
  const darkTheme = theme(
    { dim: "\x1b[38;2;240;240;240m" },
    { toolSuccessBg: "\x1b[48;2;20;20;20m" },
  );

  assert.equal(adapter.isLightBackground(lightTheme), true);
  assert.equal(
    adapter.chromeForeground(lightTheme, true),
    "\x1b[38;2;118;118;118m",
  );
  assert.equal(
    adapter.chromeForeground(darkTheme, true),
    "\x1b[38;2;240;240;240m",
  );
  assert.equal(adapter.chromeForeground(lightTheme, false), null);

  const transparentToolPanel = theme(
    { dim: "\x1b[38;2;0;255;255m", text: "\x1b[38;2;31;35;40m" },
    {
      toolSuccessBg: "\x1b[49m",
      userMessageBg: "\x1b[49m",
      selectedBg: "\x1b[48;2;160;160;160m",
    },
  );
  assert.equal(adapter.isLightBackground(transparentToolPanel), false);
  assert.equal(
    adapter.chromeForeground(transparentToolPanel, true),
    "\x1b[38;2;0;255;255m",
  );
});

test("selects fixed, explicit-theme, and fallback branch colors without retained state", () => {
  const adapter = createPresentationThemeAdapter();
  const darkTheme = theme(
    { dim: "\x1b[38;2;91;92;93m" },
    { selectedBg: "\x1b[48;2;10;10;10m" },
  );

  assert.equal(adapter.branchAnsi(fixedBranch, darkTheme), "\x1b[38;2;72;72;72m");
  assert.equal(adapter.branchAnsi(themedBranch, darkTheme), "\x1b[38;2;91;92;93m");
  assert.equal(adapter.branchAnsi(themedBranch), "\x1b[38;2;72;72;72m");
});

test("brightens outline chrome from the selected branch", () => {
  const adapter = createPresentationThemeAdapter();

  assert.equal(
    adapter.outlineAnsi(fixedBranch),
    "\x1b[38;2;136;136;136m",
  );
  assert.equal(
    adapter.outlineAnsi({ ...fixedBranch, gray: 240, outlineBrighten: 64 }),
    "\x1b[38;2;255;255;255m",
  );
});

test("builds a complete palette request with overrides and a theme fingerprint", () => {
  const adapter = createPresentationThemeAdapter();
  const firstTheme = theme({
    muted: "muted-v1",
    warning: "warning",
    success: "success",
    error: "error",
    accent: "accent",
    toolTitle: "title",
    customMessageLabel: "message-label",
    customMessageText: "message-text",
    dim: "dim",
    thinkingText: "thinking-v1",
  });
  const input = {
    theme: firstTheme,
    adaptive: true,
    branch: themedBranch,
    adaptiveRule: "adaptive-rule",
    overrides: { dim: "configured-dim", rule: "configured-rule" },
  } as const;

  const request = adapter.paletteRequest(input);
  assert.equal(request.cache.identity, firstTheme);
  assert.equal(request.cache.name, "fixture");
  assert.match(request.cache.fingerprint, /thinking-v1/);
  assert.equal(request.adaptive, true);
  assert.equal(request.defaults.dim, CHROME_STYLE_DEFAULTS.dim);
  assert.equal(request.adaptiveColors.dim, "muted-v1");
  assert.equal(request.adaptiveColors.messageLabel, "message-label");
  assert.equal(request.adaptiveColors.messageText, "message-text");
  assert.equal(request.adaptiveColors.rule, "adaptive-rule");
  assert.deepEqual(request.overrides, input.overrides);

  const changed = adapter.paletteRequest({
    ...input,
    theme: theme({
      muted: "muted-v2",
      thinkingText: "thinking-v2",
    }),
  });
  assert.notEqual(changed.cache.fingerprint, request.cache.fingerprint);
});
