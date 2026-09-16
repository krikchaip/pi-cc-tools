import assert from "node:assert/strict";
import test from "node:test";

import { createToolPresentationModule } from "../../extensions/tool-presentation/index.ts";

const presentations = createToolPresentationModule();

function presentBashCall(
  command: string,
  elapsedMs?: number,
  showCallDetail = false,
) {
  const decision = presentations.present({
    surface: "call",
    tool: { family: "tool-native", name: "bash", label: "Bash" },
    cwd: "/workspace",
    args: { command },
    lifecycle: {
      status: "pending",
      partial: true,
      argsComplete: true,
      ...(typeof elapsedMs === "number" ? { elapsedMs } : {}),
    },
    policy: { showCallDetail },
  });
  assert.equal(decision.kind, "present");
  if (decision.kind !== "present" || decision.presentation.surface !== "call") {
    throw new Error("Bash call was not presented");
  }
  return { presentation: decision.presentation, metadata: decision.metadata };
}

function presentBashOutput(text: string) {
  const decision = presentations.present({
    surface: "result",
    tool: { family: "tool-native", name: "bash", label: "Bash" },
    cwd: "/workspace",
    args: { command: "fixture" },
    lifecycle: { status: "pending", partial: true, argsComplete: true },
    result: {
      content: [{ type: "text", text }],
      details: {},
      error: false,
      partial: true,
    },
  });
  assert.equal(decision.kind, "present");
  if (decision.kind !== "present")
    throw new Error("Bash output was not presented");
  return decision;
}

test("headlines a script by its first operative line", () => {
  const decision = presentBashCall(`set -euo pipefail
SESSION="validation-session"
EVIDENCE="/tmp/evidence"
printf 'Starting validation in %s\\n' "$WORKSPACE"
for phase in hashing indexing verifying; do
  printf 'Running %s\\n' "$phase"
done`);

  assert.equal(
    decision.metadata?.bash?.command.headline,
    `printf 'Starting validation in %s\\n' "$WORKSPACE" · 7 lines`,
  );
});

test("skips standalone shell structure when choosing a headline", () => {
  const decision = presentBashCall(`context_file=/tmp/context
{
echo '# Current source tree'
find src -type f | sort
}`);

  assert.equal(
    decision.metadata?.bash?.command.headline,
    "echo '# Current source tree' · 5 lines",
  );
});

test("describes visible source without repeating its headline", () => {
  const command = presentBashCall("git status --short", undefined, true);
  const script = presentBashCall("echo one\necho two", undefined, true);
  assert.deepEqual(command.presentation.subject, [
    { text: "command", tone: "accent" },
  ]);
  assert.deepEqual(script.presentation.subject, [
    { text: "script · 2 lines", tone: "accent" },
  ]);
});

test("formats live and completed durations compactly", () => {
  for (const [elapsedMs, expected] of [
    [400, "<1s"],
    [12_900, "12s"],
    [64_000, "1m 04s"],
    [3_780_000, "1h 03m"],
  ] as const) {
    assert.equal(
      presentBashCall("fixture", elapsedMs).metadata?.bash?.duration,
      expected,
    );
  }
});

test("selects the latest non-empty Bash output line", () => {
  assert.equal(
    presentBashOutput("building\n\n  testing target 3  \n").metadata?.bash
      ?.lastOutputLine,
    "testing target 3",
  );
  assert.equal(
    presentBashOutput("\n\t\n").metadata?.bash?.lastOutputLine,
    undefined,
  );
});

test("treats carriage-return progress as live output and removes terminal escapes", () => {
  assert.equal(
    presentBashOutput(
      "\u001b[32mCompiling\u001b[0m\r\u001b]0;tests\u0007Running suite 4/9\r",
    ).metadata?.bash?.lastOutputLine,
    "Running suite 4/9",
  );
});

test("supplies multiline scripts as semantic call detail", () => {
  const decision = presentBashCall(
    `context_file=/tmp/context
{
echo '# Current source tree'
find src -type f | sort
}`,
    undefined,
    true,
  );

  assert.deepEqual(
    decision.presentation.detail?.rows.map((row: any) => row.content[0].text),
    [
      "context_file=/tmp/context",
      "{",
      "echo '# Current source tree'",
      "find src -type f | sort",
      "}",
    ],
  );
});

test("keeps heredocs as ordinary semantic source rows", () => {
  const decision = presentBashCall(
    `cat <<'END' | review-command
  Review this code.
  Check error handling.
END
jq '.result' result.json`,
    undefined,
    true,
  );

  assert.equal(
    decision.metadata?.bash?.command.headline,
    "cat <<'END' | review-command · 5 lines",
  );
  assert.deepEqual(
    decision.presentation.detail?.rows.map((row: any) => row.content[0].text),
    [
      "cat <<'END' | review-command",
      "  Review this code.",
      "  Check error handling.",
      "END",
      "jq '.result' result.json",
    ],
  );
});

test("normalizes line endings and unsafe control characters without changing indentation", () => {
  const decision = presentBashCall(
    "\r\n\tprintf 'one'\x00\r\n  printf 'two'\r\n\r\n",
    undefined,
    true,
  );

  assert.deepEqual(decision.metadata?.bash?.command.sourceLines, [
    "   printf 'one'",
    "  printf 'two'",
  ]);
  assert.equal(
    decision.metadata?.bash?.command.headline,
    "printf 'one' · 2 lines",
  );
});
