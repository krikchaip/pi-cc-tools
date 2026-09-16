import assert from "node:assert/strict";
import test from "node:test";

import type { DiffPresentationRequest, DiffSource } from "../../extensions/diff-presentation/index.ts";
import { createToolPresentationModule } from "../../extensions/tool-presentation/index.ts";

const presentations = createToolPresentationModule();

const settled = {
  status: "success",
  partial: false,
  argsComplete: true,
} as const;

test("normalizes a native call through one explicit-family seam", () => {
  const decision = presentations.present({
    surface: "call",
    tool: { family: "tool-native", name: "grep", label: "Grep" },
    cwd: "/workspace",
    args: { pattern: "needle", path: "src" },
    lifecycle: {
      status: "pending",
      activity: { kind: "blink", visible: true },
      partial: true,
      argsComplete: true,
    },
  });

  assert.deepEqual(decision, {
    kind: "present",
    presentation: {
      surface: "call",
      title: "Grep",
      subject: [{ text: '"needle" in src', tone: "accent" }],
      status: "pending",
      activity: { kind: "blink", visible: true },
    },
  });
});

test("preserves the legacy skill label and name roles", () => {
  const decision = presentations.present({
    surface: "call",
    tool: { family: "tool-native", name: "read", label: "Read" },
    cwd: "/workspace",
    args: { path: "/workspace/skills/grilling/SKILL.md" },
    lifecycle: settled,
  });

  assert.deepEqual(decision, {
    kind: "present",
    presentation: {
      surface: "call",
      title: "[skill]",
      titleTone: "message-label",
      subject: [{ text: "grilling", tone: "message-text" }],
      status: "success",
    },
  });
});

test("normalizes Bash calls as accent prefix previews with muted expanded detail", () => {
  const command = `printf '%s\\n' ${"x".repeat(200)} BASH_HIDDEN_TAIL`;
  const collapsed = presentations.present({
    surface: "call",
    tool: { family: "tool-native", name: "bash", label: "Bash" },
    cwd: "/workspace",
    args: { command },
    lifecycle: settled,
  });

  assert.equal(collapsed.kind, "present");
  if (collapsed.kind !== "present" || collapsed.presentation.surface !== "call") return;
  assert.equal(collapsed.presentation.subjectOverflow, "truncate-end");
  assert.equal(collapsed.presentation.subject?.[0]?.text.endsWith("..."), true);
  assert.equal(collapsed.presentation.subject?.[0]?.text.includes("BASH_HIDDEN_TAIL"), false);

  const expanded = presentations.present({
    surface: "call",
    tool: { family: "tool-native", name: "bash", label: "Bash" },
    cwd: "/workspace",
    args: { command },
    lifecycle: settled,
    policy: { showCallDetail: true },
  });
  assert.equal(expanded.kind, "present");
  if (expanded.kind !== "present" || expanded.presentation.surface !== "call") return;
  assert.deepEqual(expanded.presentation.detail?.rows[0], {
    content: [{ text: command, tone: "muted" }],
  });
});

test("normalizes native result meaning without terminal chrome", () => {
  const decision = presentations.present({
    surface: "result",
    tool: { family: "tool-native", name: "read", label: "Read" },
    cwd: "/workspace",
    args: { path: "notes.txt" },
    lifecycle: settled,
    result: {
      content: [{ type: "text", text: "first\nsecond" }],
      details: {},
      error: false,
      partial: false,
    },
  });

  assert.equal(decision.kind, "present");
  if (decision.kind !== "present") return;
  assert.deepEqual(decision.presentation, {
    surface: "result",
    outcome: "success",
    summary: {
      count: 2,
      unit: { one: "lines", other: "lines" },
      label: "loaded",
      expandable: true,
    },
    detail: {
      rows: [
        { content: [{ text: "first", tone: "dim" }] },
        { content: [{ text: "second", tone: "dim" }] },
      ],
      totalRows: 2,
    },
  });
  assert.equal(JSON.stringify(decision).includes("\u001b"), false);
});

test("uses text summaries for family grammar that is not a count sentence", () => {
  const decision = presentations.present({
    surface: "result",
    tool: { family: "tool-native", name: "bash", label: "Bash" },
    cwd: "/workspace",
    args: { command: "printf 'one\\ntwo\\n'" },
    lifecycle: settled,
    result: {
      content: [{ type: "text", text: "one\ntwo" }],
      details: {},
      error: false,
      partial: false,
    },
  });

  assert.equal(decision.kind, "present");
  if (decision.kind !== "present") return;
  assert.deepEqual(decision.presentation, {
    surface: "result",
    outcome: "success",
    summary: {
      text: [
        { text: "Done", tone: "success" },
        { text: " (2 lines)", tone: "muted" },
      ],
      expandable: true,
    },
    detail: {
      rows: [
        { content: [{ text: "one", tone: "dim" }] },
        { content: [{ text: "two", tone: "dim" }] },
      ],
      totalRows: 2,
    },
  });
});

test("preserves legacy Bash count grammar for one output row", () => {
  const decision = presentations.present({
    surface: "result",
    tool: { family: "tool-native", name: "bash", label: "Bash" },
    cwd: "/workspace",
    args: { command: "true" },
    lifecycle: settled,
    result: {
      content: [{ type: "text", text: "(no output)" }],
      details: {},
      error: false,
      partial: false,
    },
  });

  assert.equal(decision.kind, "present");
  if (decision.kind !== "present" || decision.presentation.surface !== "result") return;
  assert.deepEqual(decision.presentation.summary, {
    text: [
      { text: "Done", tone: "success" },
      { text: " (1 lines)", tone: "muted" },
    ],
    expandable: true,
  });
});

test("dispatches MCP by explicit family instead of its tool name", () => {
  const decision = presentations.present({
    surface: "result",
    tool: { family: "mcp", name: "github_gateway", label: "GitHub" },
    cwd: "/workspace",
    args: { tool: "get_repository" },
    lifecycle: settled,
    result: {
      content: [{ type: "text", text: '{"ok":true,"count":2}' }],
      details: {},
      error: false,
      partial: false,
    },
  });

  assert.equal(decision.kind, "present");
  if (decision.kind !== "present" || decision.presentation.surface !== "result") return;
  assert.deepEqual(decision.presentation.summary, {
    text: [
      { text: "Responded", tone: "success" },
      { text: " ", tone: "plain" },
      { text: "[object] (2 fields)", tone: "muted" },
    ],
    expandable: true,
  });
  assert.deepEqual(decision.presentation.detail, {
    rows: [
      {
        content: [
          { text: "ok   ", tone: "dim" },
          { text: "  ", tone: "dim" },
          { text: "true", tone: "dim" },
        ],
        tree: { depth: 0, position: "middle", continuations: [] },
      },
      {
        content: [
          { text: "count", tone: "dim" },
          { text: "  ", tone: "dim" },
          { text: "2", tone: "dim" },
        ],
        tree: { depth: 0, position: "last", continuations: [] },
      },
    ],
    totalRows: 2,
  });
});

test("keeps provider truncation as semantic warning data", () => {
  const decision = presentations.present({
    surface: "result",
    tool: { family: "tool-native", name: "grep", label: "Grep" },
    cwd: "/workspace",
    args: { pattern: "needle" },
    lifecycle: settled,
    result: {
      content: [{ type: "text", text: "a.ts:1:needle\nb.ts:2:needle" }],
      details: { truncation: { truncated: true } },
      error: false,
      partial: false,
    },
  });

  assert.equal(decision.kind, "present");
  if (decision.kind !== "present" || decision.presentation.surface !== "result") return;
  assert.deepEqual(decision.presentation.summary, {
    text: [
      { text: "2 matches", tone: "muted" },
      { text: " (truncated)", tone: "warning" },
    ],
    expandable: true,
  });
});

test("keeps OpenAI call metadata as separate semantic tones", () => {
  const decision = presentations.present({
    surface: "call",
    tool: { family: "openai", name: "fetch_content", label: "Fetch Content" },
    cwd: "/workspace",
    args: { urls: ["https://one.example", "https://two.example"] },
    lifecycle: {
      status: "pending",
      partial: true,
      argsComplete: true,
    },
  });

  assert.equal(decision.kind, "present");
  if (decision.kind !== "present" || decision.presentation.surface !== "call") return;
  assert.deepEqual(decision.presentation.subject, [
    { text: "https://one.example", tone: "accent" },
    { text: " ", tone: "plain" },
    { text: "(+1 urls)", tone: "muted" },
  ]);
});

test("normalizes task-list status and rows", () => {
  const decision = presentations.present({
    surface: "result",
    tool: { family: "openai", name: "TaskList", label: "Task List" },
    cwd: "/workspace",
    args: {},
    lifecycle: settled,
    result: {
      content: [{ type: "text", text: "#1 [in_progress] Refactor adapter\n#2 [completed] Add tests" }],
      details: {},
      error: false,
      partial: false,
    },
  });

  assert.equal(decision.kind, "present");
  if (decision.kind !== "present" || decision.presentation.surface !== "result") return;
  assert.deepEqual(decision.presentation.detail?.rows[0], {
    content: [
      { text: "#1", tone: "accent" },
      { text: " ", tone: "plain" },
      { text: "in_progress", tone: "warning" },
      { text: " ", tone: "plain" },
      { text: "Refactor adapter", tone: "dim" },
    ],
  });
});

test("keeps one-line OpenAI success grammar for the expanded view", () => {
  const decision = presentations.present({
    surface: "result",
    tool: { family: "openai", name: "TaskCreate", label: "Task Create" },
    cwd: "/workspace",
    args: {},
    lifecycle: settled,
    result: {
      content: [{ type: "text", text: "Task #12 created successfully: Refactor adapter" }],
      details: {},
      error: false,
      partial: false,
    },
  });

  assert.equal(decision.kind, "present");
  if (decision.kind !== "present" || decision.presentation.surface !== "result") return;
  assert.deepEqual(decision.presentation.expandedSummary, {
    text: [
      { text: "Created task", tone: "success" },
      { text: " ", tone: "plain" },
      { text: "#12", tone: "accent" },
      { text: " ", tone: "plain" },
      { text: "Refactor adapter", tone: "muted" },
    ],
    expandable: false,
  });
});

test("normalizes Side Quest metadata through the single facade", () => {
  const decision = presentations.present({
    surface: "result",
    tool: { family: "openai", name: "Agent", label: "Agent" },
    cwd: "/workspace",
    args: {},
    lifecycle: settled,
    result: {
      content: [],
      details: {
        operation: "reopened",
        sideQuestPresentation: {
          version: 1,
          surface: "agent",
          statuses: ["working", "reviewing"],
        },
      },
      error: false,
      partial: false,
    },
  });

  assert.equal(decision.kind, "present");
  if (decision.kind !== "present") return;
  assert.deepEqual(decision.metadata?.sideQuest, {
    version: 1,
    surface: "agent",
    resultStatus: "resumed",
    statuses: ["working", "reviewing"],
    label: "Resumed",
  });
});

test("normalizes Side Quest results through the OpenAI family adapter", () => {
  const decision = presentations.present({
    surface: "result",
    tool: { family: "openai", name: "Agent", label: "Agent" },
    cwd: "/workspace",
    args: { prompt: "Inspect the adapter\nReport risks" },
    lifecycle: settled,
    result: {
      content: [{ type: "text", text: "unused provider output" }],
      details: {
        sessionPath: "/tmp/side-quest.jsonl",
        sideQuestPresentation: {
          version: 1,
          surface: "agent",
          resultStatus: "answered",
          statuses: ["done"],
        },
      },
      error: false,
      partial: false,
    },
  });

  assert.equal(decision.kind, "present");
  if (decision.kind !== "present" || decision.presentation.surface !== "result") return;
  assert.deepEqual(decision.presentation.summary, {
    text: [
      { text: "Answered", tone: "success" },
      { text: " [done]", tone: "muted" },
    ],
    expandable: true,
  });
  assert.deepEqual(decision.presentation.detail, {
    rows: [
      { content: [{ text: "session path: /tmp/side-quest.jsonl", tone: "dim" }] },
      { content: [{ text: "", tone: "plain" }] },
      { content: [{ text: "Inspect the adapter", tone: "dim" }] },
      { content: [{ text: "Report risks", tone: "dim" }] },
    ],
    totalRows: 4,
    pinnedRows: 2,
    action: "progressive",
  });
});

test("keeps native Read truncation as semantic warning data", () => {
  const decision = presentations.present({
    surface: "result",
    tool: { family: "tool-native", name: "read", label: "Read" },
    cwd: "/workspace",
    args: { path: "large.txt" },
    lifecycle: settled,
    result: {
      content: [{ type: "text", text: "first\nsecond" }],
      details: { truncation: { truncated: true } },
      error: false,
      partial: false,
    },
  });

  assert.equal(decision.kind, "present");
  if (decision.kind !== "present" || decision.presentation.surface !== "result") return;
  assert.deepEqual(decision.presentation.summary, {
    text: [
      { text: "2 lines loaded", tone: "muted" },
      { text: " (truncated)", tone: "warning" },
    ],
    expandable: true,
  });
});

test("keeps Bash rewrite rows pinned outside the output preview", () => {
  const decision = presentations.present({
    surface: "result",
    tool: { family: "tool-native", name: "bash", label: "Bash" },
    cwd: "/workspace",
    args: { command: "grep needle file" },
    lifecycle: settled,
    policy: {
      preserveBlankLines: true,
      bashRewrite: {
        original: "grep needle file",
        rewritten: "rg needle file",
        notice: "RTK rewrite: grep needle file -> rg needle file",
      },
    },
    result: {
      content: [{ type: "text", text: "first\n\nsecond" }],
      details: { truncation: { truncated: true } },
      error: false,
      partial: false,
    },
  });

  assert.equal(decision.kind, "present");
  if (decision.kind !== "present" || decision.presentation.surface !== "result") return;
  assert.deepEqual(decision.presentation.summary, {
    text: [
      { text: "Done", tone: "success" },
      { text: " (3 lines)", tone: "muted" },
      { text: " [truncated]", tone: "warning" },
    ],
    expandable: true,
  });
  assert.equal(decision.presentation.detail?.pinnedRows, 3);
  assert.equal(decision.presentation.detail?.totalRows, 6);
  assert.deepEqual(decision.presentation.detail?.rows[1], {
    content: [
      { text: "original :", tone: "muted" },
      { text: " ", tone: "plain" },
      { text: "grep needle file", tone: "dim" },
    ],
  });
});

test("keeps native List rows as rule-colored tree arms", () => {
  const decision = presentations.present({
    surface: "result",
    tool: { family: "tool-native", name: "ls", label: "List" },
    cwd: "/workspace",
    args: { path: "." },
    lifecycle: settled,
    result: {
      content: [{ type: "text", text: "alpha.txt\nbeta/" }],
      details: {},
      error: false,
      partial: false,
    },
  });

  assert.equal(decision.kind, "present");
  if (decision.kind !== "present" || decision.presentation.surface !== "result") return;
  assert.deepEqual(decision.presentation.detail?.rows, [
    {
      content: [{ text: "alpha.txt", tone: "dim" }],
      icon: { kind: "file", path: "alpha.txt" },
      tree: { depth: 0, position: "middle", tone: "rule", arm: "──" },
    },
    {
      content: [{ text: "beta/", tone: "accent" }],
      icon: { kind: "directory" },
      tree: { depth: 0, position: "last", tone: "rule", arm: "──" },
    },
  ]);
});

test("marks native Find rows with semantic file icons", () => {
  const decision = presentations.present({
    surface: "result",
    tool: { family: "tool-native", name: "find", label: "Find" },
    cwd: "/workspace",
    args: { pattern: "*.ts" },
    lifecycle: settled,
    result: {
      content: [{ type: "text", text: "src/index.ts" }],
      details: {},
      error: false,
      partial: false,
    },
  });

  assert.equal(decision.kind, "present");
  if (decision.kind !== "present" || decision.presentation.surface !== "result") return;
  assert.deepEqual(decision.presentation.detail?.rows[0], {
    content: [{ text: "src/index.ts", tone: "dim" }],
    icon: { kind: "file", path: "src/index.ts" },
  });
});

test("returns normalized result output as facade metadata", () => {
  const decision = presentations.present({
    surface: "result",
    tool: { family: "tool-native", name: "read", label: "Read" },
    cwd: "/workspace",
    args: { path: "notes.txt" },
    lifecycle: settled,
    result: {
      content: [
        { type: "text", text: "first\r\n\r\nsecond" },
        { type: "image", data: "ignored" },
        { type: "text", text: "third\nfourth" },
      ],
      details: {},
      error: false,
      partial: false,
    },
  });

  assert.equal(decision.kind, "present");
  if (decision.kind !== "present") return;
  assert.deepEqual(decision.metadata?.output, {
    text: "first\n\nsecond\nthird\nfourth",
    lines: ["first", "second", "third", "fourth"],
    total: 4,
  });
  assert.deepEqual(Object.keys(presentations), ["present"]);
});

test("normalizes partial output as one family-independent tail stream", () => {
  const decision = presentations.present({
    surface: "result",
    tool: { family: "mcp", name: "github_gateway", label: "GitHub" },
    cwd: "/workspace",
    args: {},
    lifecycle: { status: "pending", partial: true, argsComplete: true },
    result: {
      content: [{ type: "text", text: "first\nsecond\nthird" }],
      details: {},
      error: true,
      partial: true,
    },
  });

  assert.equal(decision.kind, "present");
  if (decision.kind !== "present") return;
  assert.deepEqual(decision.presentation, {
    surface: "stream",
    detail: {
      rows: [
        { content: [{ text: "first", tone: "error" }] },
        { content: [{ text: "second", tone: "error" }] },
        { content: [{ text: "third", tone: "error" }] },
      ],
      totalRows: 3,
    },
    selection: "tail",
  });
  assert.equal(decision.metadata?.output?.total, 3);
});

test("routes mutation capture through diff-presentation with adapter-owned source mapping", async () => {
  const sources: DiffSource[] = [];
  const mutationPresentations = createToolPresentationModule({
    mutations: {
      async capture(source) {
        sources.push(source);
        return undefined;
      },
      present() {
        throw new Error("not used");
      },
    },
  });

  await mutationPresentations.present({
    surface: "mutation-capture",
    tool: { family: "mutation", name: "write" },
    cwd: "/workspace",
    args: { path: "notes.txt", content: "after" },
    before: "before",
  });
  await mutationPresentations.present({
    surface: "mutation-capture",
    tool: { family: "mutation", name: "edit" },
    cwd: "/workspace",
    args: { path: "src/a.ts", edits: [{ oldText: "  old", newText: "  new" }] },
  });
  await mutationPresentations.present({
    surface: "mutation-capture",
    tool: { family: "mutation", name: "apply_patch" },
    cwd: "/workspace",
    args: { patch_text: "*** Begin Patch\n*** End Patch" },
  });

  assert.deepEqual(sources, [
    { kind: "write", path: "notes.txt", before: "before", after: "after" },
    { kind: "edit", path: "src/a.ts", edits: [{ oldText: "  old", newText: "  new" }], cwd: "/workspace" },
    { kind: "apply-patch", patchText: "*** Begin Patch\n*** End Patch", cwd: "/workspace" },
  ]);
});

test("routes mutation presentation through diff-presentation with adapter-owned surfaces", () => {
  const requests: DiffPresentationRequest[] = [];
  const mutationPresentations = createToolPresentationModule({
    mutations: {
      async capture() {
        return undefined;
      },
      present(request) {
        requests.push(request);
        return {
          body: request.surface,
          affectedPaths: [],
          suppressCompanionResult: false,
          pending: false,
          settled: Promise.resolve(),
        };
      },
    },
  });
  const request = {
    owner: {},
    sourceComplete: true,
    view: {
      width: 80,
      expanded: false,
      localDetail: 0 as const,
      localClickControls: true,
      theme: { fg: (_color: string, text: string) => text },
    },
    settlement: { begin: () => ({ complete() {} }) },
  };

  const edit = mutationPresentations.present({
    surface: "mutation-presentation",
    tool: { family: "mutation", name: "edit" },
    phase: "call",
    cwd: "/workspace",
    args: { path: "src/a.ts", oldText: "old", newText: "new" },
    request,
  });
  mutationPresentations.present({
    surface: "mutation-presentation",
    tool: { family: "mutation", name: "apply_patch" },
    phase: "result",
    cwd: "/workspace",
    args: { patchText: "patch" },
    evidence: { opaque: true },
    request,
  });
  mutationPresentations.present({
    surface: "mutation-presentation",
    tool: { family: "mutation", name: "write" },
    phase: "result",
    cwd: "/workspace",
    args: { path: "new.txt", content: "content" },
    resultDetails: { _type: "new" },
    request,
  });

  assert.equal(edit.kind, "mutation");
  assert.equal(edit.snapshot.body, "edit-call");
  assert.deepEqual(
    requests.map(({ surface, source, evidence }) => ({ surface, source, evidence })),
    [
      {
        surface: "edit-call",
        source: { kind: "edit", path: "src/a.ts", edits: [{ oldText: "old", newText: "new" }], cwd: "/workspace" },
        evidence: undefined,
      },
      {
        surface: "apply-result",
        source: { kind: "apply-patch", patchText: "patch", cwd: "/workspace" },
        evidence: { opaque: true },
      },
      {
        surface: "write-result",
        source: { kind: "write", path: "new.txt", before: null, after: "content" },
        evidence: undefined,
      },
    ],
  );
});
