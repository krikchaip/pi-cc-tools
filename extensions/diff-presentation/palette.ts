import type { BundledTheme } from "shiki";

import type {
  DiffPresentationSettings,
  DiffSharedForegrounds,
  DiffTheme,
} from "./types.ts";

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const RESET = "\x1b[0m";
const TRANSPARENT_BG = "\x1b[49m";
const TRANSPARENT_RESET = `${RESET}${TRANSPARENT_BG}`;

export interface DiffColors {
  readonly fgAdd: string;
  readonly fgDel: string;
  readonly fgCtx: string;
}

interface DiffPreset {
  readonly shikiTheme?: string;
  readonly bgAdd?: string;
  readonly bgDel?: string;
  readonly bgAddHighlight?: string;
  readonly bgDelHighlight?: string;
  readonly bgGutterAdd?: string;
  readonly bgGutterDel?: string;
  readonly bgEmpty?: string;
  readonly fgAdd?: string;
  readonly fgDel?: string;
  readonly fgDim?: string;
  readonly fgLnum?: string;
  readonly fgRule?: string;
  readonly fgStripe?: string;
  readonly fgSafeMuted?: string;
}

const DIFF_PRESETS: Readonly<Record<string, DiffPreset>> = {
  default: {
    bgAdd: "#162620",
    bgDel: "#2d1919",
    bgAddHighlight: "#234b32",
    bgDelHighlight: "#502323",
    bgGutterAdd: "#12201a",
    bgGutterDel: "#261616",
    bgEmpty: "#121212",
    fgDim: "#505050",
    fgLnum: "#646464",
    fgRule: "#323232",
    fgStripe: "#282828",
    fgSafeMuted: "#8b949e",
  },
  midnight: {
    bgAdd: "#0d1a12",
    bgDel: "#1a0d0d",
    bgAddHighlight: "#1a3825",
    bgDelHighlight: "#381a1a",
    bgGutterAdd: "#091208",
    bgGutterDel: "#120908",
    bgEmpty: "#080808",
    fgDim: "#404040",
    fgLnum: "#505050",
    fgRule: "#282828",
    fgStripe: "#1e1e1e",
    fgSafeMuted: "#8b949e",
  },
  neon: {
    bgAdd: "#1a3320",
    bgDel: "#331a16",
    bgAddHighlight: "#2d5c3a",
    bgDelHighlight: "#5c2d2d",
    bgGutterAdd: "#142818",
    bgGutterDel: "#28120e",
    bgEmpty: "#141414",
    fgDim: "#606060",
    fgLnum: "#787878",
    fgRule: "#404040",
    fgStripe: "#303030",
    fgSafeMuted: "#9da5ae",
  },
};

interface ResolvedDiffConfiguration {
  readonly hasThemeSelection: boolean;
  readonly explicitBackground: boolean;
  color(name: keyof DiffPreset): string | undefined;
}

function resolveDiffConfiguration(
  settings: DiffPresentationSettings,
): ResolvedDiffConfiguration {
  const preset = settings.diffTheme
    ? DIFF_PRESETS[settings.diffTheme]
    : undefined;
  const overrides = settings.diffColors ?? {};
  return {
    hasThemeSelection: Boolean(settings.diffTheme),
    explicitBackground: Boolean(preset) || Object.keys(overrides).length > 0,
    color(name) {
      return overrides[name] ?? preset?.[name];
    },
  };
}

export function configuredSharedForegrounds(
  settings: DiffPresentationSettings,
): DiffSharedForegrounds {
  const configuration = resolveDiffConfiguration(settings);
  const dim = hexToFgAnsi(configuration.color("fgDim") ?? "") || undefined;
  const rule = hexToFgAnsi(configuration.color("fgRule") ?? "") || undefined;
  return { dim, rule };
}

const CUBE_VALUES = [0, 95, 135, 175, 215, 255];
const UNIVERSAL_DIFF_ADD_FG = { r: 110, g: 210, b: 130 };
const UNIVERSAL_DIFF_DEL_FG = { r: 225, g: 110, b: 110 };
const ADDITION_TINT_TARGET = { r: 84, g: 190, b: 118 };
const DELETION_TINT_TARGET = { r: 232, g: 95, b: 122 };
const FALLBACK_BASE_BG_DARK = { r: 32, g: 35, b: 42 };
const FALLBACK_BASE_BG_LIGHT = { r: 232, g: 233, b: 236 };

type Rgb = { r: number; g: number; b: number };

export class DiffPalette {
  private key = "";
  private onLight = false;
  private shikiTheme: BundledTheme =
    (process.env.DIFF_THEME as BundledTheme | undefined) ?? "github-dark";
  private resetAnsi = RESET;
  private bgAdd = TRANSPARENT_BG;
  private bgDel = TRANSPARENT_BG;
  private bgAddWord = TRANSPARENT_BG;
  private bgDelWord = TRANSPARENT_BG;
  private bgGutterAdd = TRANSPARENT_BG;
  private bgGutterDel = TRANSPARENT_BG;
  private bgEmpty = TRANSPARENT_BG;
  private bgBase = TRANSPARENT_BG;
  private fgAdd = "\x1b[38;2;100;180;120m";
  private fgDel = "\x1b[38;2;200;100;100m";
  private fgDim = "\x1b[38;2;80;80;80m";
  private fgLnum = "\x1b[38;2;100;100;100m";
  private fgRule = "\x1b[38;2;50;50;50m";
  private fgStripe = "\x1b[38;2;40;40;40m";
  private fgSafeMuted = "\x1b[38;2;139;148;158m";
  private readonly clearHighlights: () => void;
  private readonly isLightTheme: (theme: DiffTheme) => boolean;
  private readonly resolveRuleAnsi?: (theme: DiffTheme) => string | undefined;

  constructor(
    clearHighlights: () => void,
    isLightTheme: (theme: DiffTheme) => boolean,
    resolveRuleAnsi?: (theme: DiffTheme) => string | undefined,
  ) {
    this.clearHighlights = clearHighlights;
    this.isLightTheme = isLightTheme;
    this.resolveRuleAnsi = resolveRuleAnsi;
  }

  apply(theme: DiffTheme, settings: DiffPresentationSettings): void {
    const key = JSON.stringify([
      settings.diffTheme,
      settings.diffColors,
      settings.themeAdaptive,
      theme.name ?? "",
      themeFingerprint(theme),
      this.resolveRuleAnsi?.(theme) ?? "",
    ]);
    if (key === this.key) return;
    this.key = key;
    this.resetValues();

    const configuration = resolveDiffConfiguration(settings);
    const explicitForeground = new Set<keyof DiffPreset>();
    const applyBg = (
      name: keyof DiffPreset,
      set: (ansi: string) => void,
    ): void => {
      const ansi = hexToBgAnsi(configuration.color(name) ?? "");
      if (ansi) set(ansi);
    };
    const applyFg = (
      name: keyof DiffPreset,
      set: (ansi: string) => void,
    ): void => {
      const ansi = hexToFgAnsi(configuration.color(name) ?? "");
      if (!ansi) return;
      set(ansi);
      explicitForeground.add(name);
    };
    applyBg("bgAdd", (v) => {
      this.bgAdd = v;
    });
    applyBg("bgDel", (v) => {
      this.bgDel = v;
    });
    applyBg("bgAddHighlight", (v) => {
      this.bgAddWord = v;
    });
    applyBg("bgDelHighlight", (v) => {
      this.bgDelWord = v;
    });
    applyBg("bgGutterAdd", (v) => {
      this.bgGutterAdd = v;
    });
    applyBg("bgGutterDel", (v) => {
      this.bgGutterDel = v;
    });
    applyBg("bgEmpty", (v) => {
      this.bgEmpty = v;
    });
    applyFg("fgAdd", (v) => {
      this.fgAdd = v;
    });
    applyFg("fgDel", (v) => {
      this.fgDel = v;
    });
    applyFg("fgDim", (v) => {
      this.fgDim = v;
    });
    applyFg("fgLnum", (v) => {
      this.fgLnum = v;
    });
    applyFg("fgRule", (v) => {
      this.fgRule = v;
    });
    applyFg("fgStripe", (v) => {
      this.fgStripe = v;
    });
    applyFg("fgSafeMuted", (v) => {
      this.fgSafeMuted = v;
    });

    const adaptive = settings.themeAdaptive !== false;
    this.onLight = adaptive && this.isLightTheme(theme);
    if (adaptive) {
      const muted = safeFgAnsi(theme, "muted");
      const rule =
        this.resolveRuleAnsi?.(theme) ?? safeFgAnsi(theme, "borderMuted");
      if (!explicitForeground.has("fgDim") && muted) this.fgDim = muted;
      if (!explicitForeground.has("fgLnum") && muted) this.fgLnum = muted;
      if (!explicitForeground.has("fgRule") && rule) this.fgRule = rule;
      if (!explicitForeground.has("fgStripe") && rule) this.fgStripe = rule;
      if (!explicitForeground.has("fgSafeMuted") && muted)
        this.fgSafeMuted = muted;
      if (!configuration.explicitBackground) this.deriveBackgrounds(theme);
    }
    const selectedShiki = configuration.color("shikiTheme");
    if (selectedShiki) this.shikiTheme = selectedShiki as BundledTheme;
    else if (!process.env.DIFF_THEME && !configuration.hasThemeSelection)
      this.shikiTheme = this.onLight ? "github-light" : "github-dark";
    this.clearHighlights();
  }

  reset(): void {
    this.key = "";
    this.resetValues();
  }

  colors(): DiffColors {
    return { fgAdd: this.fgAdd, fgDel: this.fgDel, fgCtx: this.fgDim };
  }
  get theme(): BundledTheme {
    return this.shikiTheme;
  }
  get light(): boolean {
    return this.onLight;
  }
  get rst(): string {
    return this.resetAnsi;
  }
  get addBg(): string {
    return this.bgAdd;
  }
  get delBg(): string {
    return this.bgDel;
  }
  get addWordBg(): string {
    return this.bgAddWord;
  }
  get delWordBg(): string {
    return this.bgDelWord;
  }
  get addGutterBg(): string {
    return this.bgGutterAdd;
  }
  get delGutterBg(): string {
    return this.bgGutterDel;
  }
  get emptyBg(): string {
    return this.bgEmpty;
  }
  get baseBg(): string {
    return this.bgBase;
  }
  get addFg(): string {
    return this.fgAdd;
  }
  get delFg(): string {
    return this.fgDel;
  }
  get dimFg(): string {
    return this.fgDim;
  }
  get lineNumberFg(): string {
    return this.fgLnum;
  }
  get ruleFg(): string {
    return this.fgRule;
  }
  get stripeFg(): string {
    return this.fgStripe;
  }
  get safeMutedFg(): string {
    return this.fgSafeMuted;
  }
  get divider(): string {
    return `${this.fgRule}│${this.resetAnsi}`;
  }

  private resetValues(): void {
    this.onLight = false;
    this.shikiTheme =
      (process.env.DIFF_THEME as BundledTheme | undefined) ?? "github-dark";
    this.resetAnsi = RESET;
    this.bgAdd = this.bgDel = this.bgAddWord = this.bgDelWord = TRANSPARENT_BG;
    this.bgGutterAdd =
      this.bgGutterDel =
      this.bgEmpty =
      this.bgBase =
        TRANSPARENT_BG;
    this.fgAdd = "\x1b[38;2;100;180;120m";
    this.fgDel = "\x1b[38;2;200;100;100m";
    this.fgDim = "\x1b[38;2;80;80;80m";
    this.fgLnum = "\x1b[38;2;100;100;100m";
    this.fgRule = "\x1b[38;2;50;50;50m";
    this.fgStripe = "\x1b[38;2;40;40;40m";
    this.fgSafeMuted = "\x1b[38;2;139;148;158m";
  }

  private deriveBackgrounds(theme: DiffTheme): void {
    const addFg = themeFgRgb(theme, "toolDiffAdded") ?? UNIVERSAL_DIFF_ADD_FG;
    const delFg = themeFgRgb(theme, "toolDiffRemoved") ?? UNIVERSAL_DIFF_DEL_FG;
    const base =
      themeBgRgb(theme, "toolSuccessBg") ??
      themeBgRgb(theme, "userMessageBg") ??
      (this.onLight ? FALLBACK_BASE_BG_LIGHT : FALLBACK_BASE_BG_DARK);
    const addTint = mixRgb(addFg, ADDITION_TINT_TARGET, 0.35);
    const delTint = mixRgb(delFg, DELETION_TINT_TARGET, 0.65);
    this.fgAdd = rgbToFgAnsi(addFg);
    this.fgDel = rgbToFgAnsi(delFg);
    this.bgAdd = rgbToBgAnsi(mixRgb(base, addTint, 0.24));
    this.bgDel = rgbToBgAnsi(mixRgb(base, delTint, 0.12));
    this.bgAddWord = rgbToBgAnsi(mixRgb(base, addTint, 0.44));
    this.bgDelWord = rgbToBgAnsi(mixRgb(base, delTint, 0.26));
    this.bgGutterAdd = rgbToBgAnsi(mixRgb(base, addTint, 0.14));
    this.bgGutterDel = rgbToBgAnsi(mixRgb(base, delTint, 0.08));
    this.bgEmpty = TRANSPARENT_BG;
    this.bgBase = TRANSPARENT_BG;
    this.resetAnsi = TRANSPARENT_RESET;
  }
}

function safeFgAnsi(theme: DiffTheme, key: string): string | undefined {
  try {
    return theme.getFgAnsi?.(key) || undefined;
  } catch {
    return undefined;
  }
}
function safeBgAnsi(theme: DiffTheme, key: string): string | undefined {
  try {
    return theme.getBgAnsi?.(key) || undefined;
  } catch {
    return undefined;
  }
}
function themeFgRgb(theme: DiffTheme, key: string): Rgb | undefined {
  const ansi = safeFgAnsi(theme, key);
  return ansi ? parseAnsiRgb(ansi) : undefined;
}
function themeBgRgb(theme: DiffTheme, key: string): Rgb | undefined {
  const ansi = safeBgAnsi(theme, key);
  return ansi ? parseAnsiRgb(ansi) : undefined;
}
export function themeFingerprint(theme: DiffTheme): string {
  return [
    "success",
    "error",
    "borderMuted",
    "accent",
    "muted",
    "toolDiffAdded",
    "toolDiffRemoved",
  ]
    .map((key) => safeFgAnsi(theme, key) ?? "")
    .join("\u001f");
}
function parseAnsiRgb(ansi: string): Rgb | undefined {
  const trueColor = ansi.match(/\u001b\[(?:38|48);2;(\d+);(\d+);(\d+)m/);
  if (trueColor)
    return { r: +trueColor[1], g: +trueColor[2], b: +trueColor[3] };
  const indexed = ansi.match(/\u001b\[(?:38|48);5;(\d+)m/);
  return indexed ? xterm256ToRgb(+indexed[1]) : undefined;
}
function xterm256ToRgb(index: number): Rgb | undefined {
  if (!Number.isInteger(index) || index < 0 || index > 255) return undefined;
  const basic: Array<[number, number, number]> = [
    [0, 0, 0],
    [128, 0, 0],
    [0, 128, 0],
    [128, 128, 0],
    [0, 0, 128],
    [128, 0, 128],
    [0, 128, 128],
    [192, 192, 192],
    [128, 128, 128],
    [255, 0, 0],
    [0, 255, 0],
    [255, 255, 0],
    [0, 0, 255],
    [255, 0, 255],
    [0, 255, 255],
    [255, 255, 255],
  ];
  if (index < 16) {
    const [r, g, b] = basic[index];
    return { r, g, b };
  }
  if (index < 232) {
    const value = index - 16;
    return {
      r: CUBE_VALUES[Math.floor(value / 36) % 6],
      g: CUBE_VALUES[Math.floor(value / 6) % 6],
      b: CUBE_VALUES[value % 6],
    };
  }
  const level = 8 + (index - 232) * 10;
  return { r: level, g: level, b: level };
}
function hexToBgAnsi(hex: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(hex)
    ? `\x1b[48;2;${parseInt(hex.slice(1, 3), 16)};${parseInt(hex.slice(3, 5), 16)};${parseInt(hex.slice(5, 7), 16)}m`
    : "";
}
function hexToFgAnsi(hex: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(hex)
    ? `\x1b[38;2;${parseInt(hex.slice(1, 3), 16)};${parseInt(hex.slice(3, 5), 16)};${parseInt(hex.slice(5, 7), 16)}m`
    : "";
}
function rgbToBgAnsi(rgb: Rgb): string {
  return `\x1b[48;2;${Math.round(rgb.r)};${Math.round(rgb.g)};${Math.round(rgb.b)}m`;
}
function rgbToFgAnsi(rgb: Rgb): string {
  return `\x1b[38;2;${Math.round(rgb.r)};${Math.round(rgb.g)};${Math.round(rgb.b)}m`;
}
function mixRgb(from: Rgb, to: Rgb, ratio: number): Rgb {
  return {
    r: from.r + (to.r - from.r) * ratio,
    g: from.g + (to.g - from.g) * ratio,
    b: from.b + (to.b - from.b) * ratio,
  };
}
