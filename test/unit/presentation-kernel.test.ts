import assert from "node:assert/strict";
import test from "node:test";

import { presentationKernel } from "../../extensions/presentation-kernel/index.ts";

const plainPaletteIdentity = {};
const plainTheme = {
  palette: {
    cache: {
      identity: plainPaletteIdentity,
      name: "plain",
      fingerprint: "plain-v1",
    },
    adaptive: false,
    defaults: {
      branch: "",
      muted: "",
      dim: "",
      semanticDim: "",
      warning: "",
      success: "",
      error: "",
      accent: "",
      title: "",
      rule: "",
      statusSuccess: "",
      statusError: "",
      statusPending: "",
    },
    adaptiveColors: {
      branch: "",
      muted: "",
      dim: "",
      semanticDim: "",
      warning: "",
      success: "",
      error: "",
      accent: "",
      title: "",
      rule: "",
      statusSuccess: "",
      statusError: "",
      statusPending: "",
    },
    overrides: {},
  },
  control: {
    foregroundReset: "",
    branchReset: "",
    bold: "",
    boldReset: "",
  },
  expandHint: "ctrl+o to expand",
} as const;

const coloredTheme = {
  ...plainTheme,
  palette: {
    ...plainTheme.palette,
    cache: { identity: {}, name: "colored", fingerprint: "colored-v1" },
    defaults: {
      ...plainTheme.palette.defaults,
      branch: "\x1b[31m",
      muted: "\x1b[32m",
      semanticDim: "\x1b[33m",
    },
  },
  control: {
    ...plainTheme.control,
    foregroundReset: "\x1b[0m",
    branchReset: "\x1b[0m",
  },
} as const;

const dimTheme = {
  ...plainTheme,
  palette: {
    ...plainTheme.palette,
    cache: { identity: {}, name: "dim", fingerprint: "dim-v1" },
    defaults: { ...plainTheme.palette.defaults, semanticDim: "\x1b[90m" },
  },
  control: { ...plainTheme.control, foregroundReset: "\x1b[39m" },
} as const;

test("call presentation owns status and header grammar", () => {
  const frame = presentationKernel.present(
    {
      surface: "call",
      title: "Read",
      subject: [{ text: "target.txt", tone: "accent" }],
      status: "success",
    },
    {
      width: 24,
      padding: 0,
      expansion: "collapsed",
      clickActions: true,
      theme: plainTheme,
    },
  );

  assert.deepEqual(frame, {
    rows: [
      {
        text: "● Read target.txt       ",
        actions: [
          {
            behavior: "toggle",
            origin: "execution-header",
            viewport: "top",
            span: { start: 0, end: 17 },
          },
        ],
      },
    ],
  });
});

test("pending call selects its activity glyph", () => {
  const frame = presentationKernel.present(
    {
      surface: "call",
      title: "Agent",
      subject: [{ text: "work", tone: "accent" }],
      status: "pending",
      activity: { kind: "breathe", frame: 2 },
    },
    {
      width: 20,
      padding: 0,
      expansion: "collapsed",
      clickActions: true,
      theme: plainTheme,
    },
  );

  assert.equal(frame.rows[0]?.text, "· Agent work        ");
});

test("subjectless call titles wrap within narrow frames", () => {
  const frame = presentationKernel.present(
    {
      surface: "call",
      title: "Get Subagent Result",
      status: "success",
    },
    {
      width: 12,
      padding: 0,
      expansion: "collapsed",
      clickActions: true,
      theme: plainTheme,
    },
  );

  assert.ok(frame.rows.length > 1);
  assert.ok(frame.rows.every((row) => row.text.length <= 12));
  assert.equal(
    frame.rows.map((row) => row.text.trim()).join(" "),
    "● Get Subagent Result",
  );
});

test("shared palette applies overrides and reuses an exact cache key", () => {
  presentationKernel.resetPalette();
  const identity = {};
  const request = {
    cache: {
      identity,
      name: "dark-cavern",
      fingerprint: "theme-v1",
    },
    adaptive: true,
    defaults: {
      branch: "default-branch",
      muted: "default-muted",
      dim: "default-dim",
      semanticDim: "default-semantic-dim",
      warning: "default-warning",
      success: "default-success-tone",
      error: "default-error-tone",
      accent: "default-accent",
      title: "default-title",
      rule: "default-rule",
      statusSuccess: "default-success",
      statusError: "default-error",
      statusPending: "default-pending",
    },
    adaptiveColors: {
      branch: "theme-branch",
      muted: "theme-muted",
      dim: "theme-dim",
      semanticDim: "theme-semantic-dim",
      warning: "theme-warning",
      success: "theme-success-tone",
      error: "theme-error-tone",
      accent: "theme-accent",
      title: "theme-title",
      rule: "theme-rule",
      statusSuccess: "theme-success",
      statusError: "theme-error",
      statusPending: "theme-pending",
    },
    overrides: {
      dim: "configured-dim",
      rule: "configured-rule",
    },
  } as const;

  const first = presentationKernel.resolvePalette(request);
  const second = presentationKernel.resolvePalette(request);

  assert.deepEqual(first, {
    colors: {
      branch: "theme-branch",
      muted: "theme-muted",
      dim: "configured-dim",
      semanticDim: "theme-semantic-dim",
      warning: "theme-warning",
      success: "theme-success-tone",
      error: "theme-error-tone",
      accent: "theme-accent",
      title: "theme-title",
      rule: "configured-rule",
      statusSuccess: "theme-success",
      statusError: "theme-error",
      statusPending: "theme-pending",
    },
    changed: true,
  });
  assert.equal(second.colors, first.colors);
  assert.equal(second.changed, false);
});

test("collapsed result summary presents one exact row and toggle action", () => {
  const frame = presentationKernel.present(
    {
      surface: "result",
      summary: {
        count: 15,
        unit: "line",
        label: "loaded",
        expandable: true,
      },
    },
    {
      width: 48,
      padding: 1,
      expansion: "collapsed",
      clickActions: true,
      theme: plainTheme,
    },
  );

  assert.deepEqual(frame, {
    rows: [
      {
        text: " └ 15 lines loaded • click to expand            ",
        actions: [
          {
            behavior: "toggle",
            origin: "result-summary",
            viewport: "top",
            span: { start: 3, end: 36 },
          },
        ],
      },
    ],
  });
});

test("result without detail omits expansion grammar", () => {
  const frame = presentationKernel.present(
    {
      surface: "result",
      summary: {
        count: 0,
        unit: "line",
        label: "loaded",
        expandable: false,
      },
    },
    {
      width: 24,
      padding: 0,
      expansion: "collapsed",
      clickActions: true,
      theme: plainTheme,
    },
  );

  assert.deepEqual(frame.rows, [
    { text: "└ 0 lines loaded        ", actions: [] },
  ]);
});

test("regular mode presents its key and preserves semantic capability", () => {
  const frame = presentationKernel.present(
    {
      surface: "result",
      summary: {
        count: 15,
        unit: "line",
        label: "loaded",
        expandable: true,
      },
    },
    {
      width: 48,
      padding: 1,
      expansion: "collapsed",
      clickActions: false,
      theme: plainTheme,
    },
  );

  assert.deepEqual(frame, {
    rows: [
      {
        text: " └ 15 lines loaded • ctrl+o to expand           ",
        actions: [
          {
            behavior: "toggle",
            origin: "result-summary",
            viewport: "top",
            span: { start: 3, end: 37 },
          },
        ],
      },
    ],
  });
});

test("click summary keeps status grammar in semantic style segments", () => {
  const frame = presentationKernel.present(
    {
      surface: "result",
      summary: {
        count: 15,
        unit: "line",
        label: "loaded",
        expandable: true,
      },
    },
    {
      width: 48,
      padding: 1,
      expansion: "collapsed",
      clickActions: true,
      theme: coloredTheme,
    },
  );

  assert.equal(
    frame.rows[0]?.text,
    " \x1b[31m└\x1b[0m \x1b[32m15 lines loaded\x1b[0m\x1b[32m • \x1b[0m\x1b[33mclick\x1b[0m\x1b[32m to expand\x1b[0m            ",
  );
});

test("narrow summary wraps with stable continuation actions", () => {
  const frame = presentationKernel.present(
    {
      surface: "result",
      summary: {
        count: 15,
        unit: "line",
        label: "loaded",
        expandable: true,
      },
    },
    {
      width: 24,
      padding: 0,
      expansion: "collapsed",
      clickActions: true,
      theme: plainTheme,
    },
  );

  assert.deepEqual(frame, {
    rows: [
      {
        text: "└ 15 lines loaded •     ",
        actions: [
          {
            behavior: "toggle",
            origin: "result-summary",
            viewport: "top",
            span: { start: 2, end: 19 },
          },
        ],
      },
      {
        text: "  click to expand       ",
        actions: [
          {
            behavior: "toggle",
            origin: "result-summary",
            viewport: "top",
            span: { start: 2, end: 17 },
          },
        ],
      },
    ],
  });
});

test("summary selects adapter-supplied number forms", () => {
  const frame = presentationKernel.present(
    {
      surface: "result",
      summary: {
        count: 1,
        unit: { one: "lines", other: "lines" },
        label: "loaded",
        expandable: true,
      },
    },
    {
      width: 40,
      padding: 0,
      expansion: "collapsed",
      clickActions: true,
      theme: plainTheme,
    },
  );

  assert.deepEqual(frame.rows[0], {
    text: "└ 1 lines loaded • click to expand      ",
    actions: [
      {
        behavior: "toggle",
        origin: "result-summary",
        viewport: "top",
        span: { start: 2, end: 34 },
      },
    ],
  });
});

test("expanded Level 0 presents its normal preview and detail action", () => {
  const frame = presentationKernel.present(
    {
      surface: "result",
      summary: {
        count: 4,
        unit: "line",
        label: "loaded",
        expandable: true,
      },
      detail: {
        rows: ["alpha", "beta", "gamma", "delta"].map((text) => [
          { text, tone: "dim" as const },
        ]),
        totalRows: 4,
      },
    },
    {
      width: 60,
      padding: 0,
      expansion: "expanded",
      detail: 0,
      preview: { normal: 2, expanded: 3, extra: 4 },
      clickActions: true,
      theme: plainTheme,
    },
  );

  assert.deepEqual(
    frame.rows.map((row) => row.text.trimEnd()),
    [
      "├ 4 lines loaded",
      "│ alpha",
      "│ beta",
      "└ … (2 more lines • click for more detail)",
    ],
  );
  assert.deepEqual(
    frame.rows.map((row) => row.actions),
    [
      [
        {
          behavior: "toggle",
          origin: "result-summary",
          viewport: "top",
          span: { start: 2, end: 16 },
        },
      ],
      [],
      [],
      [
        {
          behavior: "next-detail",
          origin: "result-detail",
          viewport: "top",
          span: { start: 2, end: 42 },
        },
      ],
    ],
  );
});

test("kernel validates raw preview settings and owns the fallback", () => {
  const rows = Array.from({ length: 10 }, (_, index) => [
    { text: `row-${index + 1}`, tone: "dim" as const },
  ]);
  const presentation = {
    surface: "result" as const,
    summary: {
      count: rows.length,
      unit: "line",
      label: "loaded",
      expandable: true,
    },
    detail: { rows, totalRows: rows.length },
  };
  const invalid = presentationKernel.present(presentation, {
    width: 60,
    padding: 0,
    expansion: "expanded",
    detail: 0,
    preview: { normal: Number.NaN },
    clickActions: true,
    theme: plainTheme,
  });
  const floored = presentationKernel.present(presentation, {
    width: 60,
    padding: 0,
    expansion: "expanded",
    detail: 0,
    preview: { normal: 2.9 },
    clickActions: true,
    theme: plainTheme,
  });

  assert.match(invalid.rows.map((row) => row.text).join("\n"), /row-8/);
  assert.doesNotMatch(invalid.rows.map((row) => row.text).join("\n"), /row-9/);
  assert.match(floored.rows.map((row) => row.text).join("\n"), /row-2/);
  assert.doesNotMatch(floored.rows.map((row) => row.text).join("\n"), /row-3/);
});

test("expanded Level 1 selects the expanded preview limit", () => {
  const frame = presentationKernel.present(
    {
      surface: "result",
      summary: {
        count: 4,
        unit: "line",
        label: "loaded",
        expandable: true,
      },
      detail: {
        rows: ["alpha", "beta", "gamma", "delta"].map((text) => [
          { text, tone: "dim" as const },
        ]),
        totalRows: 4,
      },
    },
    {
      width: 60,
      padding: 0,
      expansion: "expanded",
      detail: 1,
      preview: { normal: 2, expanded: 3, extra: 4 },
      clickActions: true,
      theme: plainTheme,
    },
  );

  assert.deepEqual(
    frame.rows.map((row) => row.text.trimEnd()),
    [
      "├ 4 lines loaded",
      "│ alpha",
      "│ beta",
      "│ gamma",
      "│ … (1 more lines • click for more detail)",
      "└ (display capped at 3 lines • click for more detail)",
    ],
  );
});

test("expanded Level 2 presents a final collapse action", () => {
  const frame = presentationKernel.present(
    {
      surface: "result",
      summary: {
        count: 4,
        unit: "line",
        label: "loaded",
        expandable: true,
      },
      detail: {
        rows: ["alpha", "beta", "gamma", "delta"].map((text) => [
          { text, tone: "dim" as const },
        ]),
        totalRows: 4,
      },
    },
    {
      width: 60,
      padding: 0,
      expansion: "expanded",
      detail: 2,
      preview: { normal: 2, expanded: 3, extra: 4 },
      clickActions: true,
      theme: plainTheme,
    },
  );

  assert.deepEqual(
    frame.rows.map((row) => row.text.trimEnd()),
    [
      "├ 4 lines loaded",
      "│ alpha",
      "│ beta",
      "│ gamma",
      "│ delta",
      "└ Output ends here • click to collapse",
    ],
  );
  assert.deepEqual(frame.rows.at(-1)?.actions, [
    {
      behavior: "toggle",
      origin: "result-summary",
      viewport: "bottom",
      span: { start: 2, end: 38 },
    },
  ]);
});

test("expanded payload wraps at body width with a stable indent", () => {
  const frame = presentationKernel.present(
    {
      surface: "result",
      summary: {
        count: 4,
        unit: "line",
        label: "loaded",
        expandable: true,
      },
      detail: {
        rows: [
          "short",
          "a very long payload line that must wrap",
          "third",
          "fourth",
        ].map((text) => [{ text, tone: "dim" as const }]),
        totalRows: 4,
      },
    },
    {
      width: 24,
      padding: 0,
      expansion: "expanded",
      detail: 0,
      preview: { normal: 8, expanded: 10, extra: 15 },
      clickActions: true,
      theme: plainTheme,
    },
  );

  assert.deepEqual(
    frame.rows.map((row) => row.text.trimEnd()),
    [
      "└ 4 lines loaded",
      "  short",
      "  a very long payload",
      "  line that must wrap",
      "  third",
      "  fourth",
    ],
  );
  assert.equal(
    frame.rows.every((row) => row.text.length === 24),
    true,
  );
});

test("wrapped final collapse keeps one action on the click row", () => {
  const frame = presentationKernel.present(
    {
      surface: "result",
      summary: {
        count: 2,
        unit: "line",
        label: "loaded",
        expandable: true,
      },
      detail: {
        rows: ["alpha", "beta"].map((text) => [{ text, tone: "dim" as const }]),
        totalRows: 2,
      },
    },
    {
      width: 24,
      padding: 0,
      expansion: "expanded",
      detail: 2,
      preview: { normal: 1, expanded: 1, extra: 2 },
      clickActions: true,
      theme: plainTheme,
    },
  );

  assert.deepEqual(
    frame.rows.slice(-2).map((row) => ({
      text: row.text.trimEnd(),
      actions: row.actions,
    })),
    [
      { text: "└ Output ends here •", actions: [] },
      {
        text: "  click to collapse",
        actions: [
          {
            behavior: "toggle",
            origin: "result-summary",
            viewport: "top",
            span: { start: 2, end: 19 },
          },
        ],
      },
    ],
  );
});

test("expanded payload uses four-column tab stops", () => {
  const frame = presentationKernel.present(
    {
      surface: "result",
      summary: {
        count: 3,
        unit: "line",
        label: "loaded",
        expandable: true,
      },
      detail: {
        rows: ["x", "\talpha", " \t  beta"].map((text) => [
          { text, tone: "dim" as const },
        ]),
        totalRows: 3,
      },
    },
    {
      width: 40,
      padding: 0,
      expansion: "expanded",
      detail: 0,
      preview: { normal: 8, expanded: 10, extra: 15 },
      clickActions: true,
      theme: plainTheme,
    },
  );

  assert.deepEqual(
    frame.rows.map((row) => row.text.trimEnd()),
    ["└ 3 lines loaded", "  x", "      alpha", "        beta"],
  );
});

test("expanded payload keeps indentation inside leading ANSI state", () => {
  const frame = presentationKernel.present(
    {
      surface: "result",
      summary: {
        count: 1,
        unit: "line",
        label: "loaded",
        expandable: true,
      },
      detail: {
        rows: [[{ text: "  \x1b[31mINDENT_ANSI\x1b[0m", tone: "dim" }]],
        totalRows: 1,
      },
    },
    {
      width: 40,
      padding: 0,
      expansion: "expanded",
      detail: 0,
      preview: { normal: 8, expanded: 10, extra: 15 },
      clickActions: true,
      theme: dimTheme,
    },
  );

  assert.ok(frame.rows[1]?.text.includes("\x1b[90m\x1b[31m  INDENT_ANSI"));
});
