import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { defineScenarioFamily, runScenario, type TerminalSession } from "./terminal-session.ts";

const fixture = fileURLToPath(new URL("./terminal-session-smoke.mjs", import.meta.url));
const descendantCleanupDeadlineMs = 500;

async function waitForDescendantThenRemainActive(
  terminal: TerminalSession,
  evidenceName: string,
  marker: RegExp,
): Promise<never> {
  await terminal.expect(evidenceName, {
    visible: [marker],
    deadlineMs: 4_000,
    stableForMs: 0,
  });
  return new Promise<never>(() => {});
}

test("runs a scenario through the terminal-session seam", async () => {
  const artifactsRoot = await mkdtemp(path.join(os.tmpdir(), "pi-cc-terminal-session-test-"));
  const family = defineScenarioFamily({
    name: "terminal-session-smoke",
    viewport: { columns: 60, rows: 20 },
    deadlineMs: 2_000,
    settings: { quietStartup: true },
  });
  const scenario = family.scenario({
    name: "probes actions and evidence",
    start: { mode: "no-session" },
    async run(terminal) {
      await terminal.expect("probe-ready", {
        visible: ["SMOKE READY", "HOME ", "AGENT "],
        raw: ["\u001b[c", "\u001b[?u"],
      });

      await terminal.perform({ type: "write", data: "hello\r" });
      const acknowledged = await terminal.expect("acknowledged", {
        visible: ["ACK hello"],
        raw: [/\u001b\[31mACK hello\u001b\[0m/],
      });
      const acknowledgement = acknowledged.find("ACK hello");
      assert.equal(acknowledgement.column, 1);

      await terminal.perform({ type: "click", at: { column: 5, row: acknowledgement.row } });
      await terminal.expect("clicked", { visible: [`CLICK 5 ${acknowledgement.row}`] });
      await terminal.evidence("final");
    },
  });

  try {
    const result = await runScenario(scenario, {
      artifactsRoot,
      keepArtifacts: "always",
      piBin: process.execPath,
      piArgumentPrefix: [fixture],
    });

    assert.equal(result.status, "passed", result.error?.stack);
    assert.ok(result.artifactsPath);
    assert.match(await readFile(path.join(result.artifactsPath, "probe-ready.screen.txt"), "utf8"), /SMOKE READY/);
    assert.match(await readFile(path.join(result.artifactsPath, "acknowledged.raw.ansi"), "utf8"), /\u001b\[31mACK hello/);
    assert.match(await readFile(path.join(result.artifactsPath, "final.screen.txt"), "utf8"), /CLICK 5 \d+/);
  } finally {
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("captures output and exit code from a process that exits during startup", async () => {
  const artifactsRoot = await mkdtemp(path.join(os.tmpdir(), "pi-cc-terminal-fast-exit-test-"));
  const family = defineScenarioFamily({
    name: "terminal-session-fast-exit",
    viewport: { columns: 40, rows: 12 },
    deadlineMs: 5_000,
  });
  const scenario = family.scenario({
    name: "early output and exit",
    start: { mode: "no-session" },
    async run(terminal) {
      await terminal.expect("after-fast-exit", { visible: ["NEVER_VISIBLE"], stableForMs: 0 });
    },
  });

  try {
    const result = await runScenario(scenario, {
      artifactsRoot,
      keepArtifacts: "always",
      piBin: "/bin/sh",
      piArgumentPrefix: ["-c", "printf '\\033[31mFAST_EXIT\\033[0m\\r\\n'; exit 23"],
    });
    assert.equal(result.status, "failed");
    assert.match(result.error?.message ?? "", /terminal exited with code 23/);
    assert.ok(result.artifactsPath);
    assert.match(await readFile(path.join(result.artifactsPath, "terminal.raw.ansi"), "utf8"), /FAST_EXIT/);
  } finally {
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("retains timeout evidence without retrying the scenario", async () => {
  const artifactsRoot = await mkdtemp(path.join(os.tmpdir(), "pi-cc-terminal-timeout-test-"));
  let runs = 0;
  const family = defineScenarioFamily({
    name: "terminal-session-timeout",
    viewport: { columns: 40, rows: 12 },
    deadlineMs: 2_000,
    scenarioDeadlineMs: 3_000,
  });
  const scenario = family.scenario({
    name: "bounded expectation",
    start: { mode: "no-session" },
    async run(terminal) {
      runs += 1;
      await terminal.expect("ready-before-timeout", { visible: ["SMOKE READY"], stableForMs: 0 });
      await terminal.expect("never-visible", {
        visible: ["NEVER_VISIBLE"],
        deadlineMs: 80,
        stableForMs: 0,
      });
    },
  });

  try {
    const result = await runScenario(scenario, {
      artifactsRoot,
      piBin: process.execPath,
      piArgumentPrefix: [fixture],
    });
    assert.equal(result.status, "failed");
    assert.match(result.error?.message ?? "", /timed out after 80ms/);
    assert.equal(runs, 1);
    assert.ok(result.artifactsPath);
    assert.match(await readFile(path.join(result.artifactsPath, "never-visible-timeout.screen.txt"), "utf8"), /SMOKE READY/);
  } finally {
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("contains a scenario callback after its deadline before returning", async () => {
  const artifactsRoot = await mkdtemp(path.join(os.tmpdir(), "pi-cc-terminal-deadline-containment-test-"));
  let callbackFinished = false;
  const family = defineScenarioFamily({
    name: "terminal-session-deadline-containment",
    viewport: { columns: 40, rows: 12 },
    scenarioDeadlineMs: 30,
  });
  const scenario = family.scenario({
    name: "late callback",
    start: { mode: "no-session" },
    async run() {
      await new Promise((resolve) => setTimeout(resolve, 150));
      callbackFinished = true;
    },
  });

  try {
    const result = await runScenario(scenario, {
      artifactsRoot,
      piBin: process.execPath,
      piArgumentPrefix: [fixture],
    });
    assert.equal(result.status, "failed");
    assert.match(result.error?.message ?? "", /scenario deadline exceeded after 30ms/);
    assert.equal(callbackFinished, true, "runScenario returned while the timed-out callback was still active");
  } finally {
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("returns after a bounded containment period for a never-settling callback", async () => {
  const artifactsRoot = await mkdtemp(path.join(os.tmpdir(), "pi-cc-terminal-never-settles-test-"));
  let markScenarioStarted!: () => void;
  const scenarioStarted = new Promise<void>((resolve) => {
    markScenarioStarted = resolve;
  });
  const family = defineScenarioFamily({
    name: "terminal-session-never-settles",
    viewport: { columns: 40, rows: 12 },
    scenarioDeadlineMs: 20,
  });
  const scenario = family.scenario({
    name: "never settles",
    start: { mode: "no-session" },
    async run() {
      markScenarioStarted();
      await new Promise(() => {});
    },
  });

  let containmentTimer: NodeJS.Timeout | undefined;
  try {
    const scenarioResult = runScenario(scenario, {
      artifactsRoot,
      piBin: process.execPath,
      piArgumentPrefix: [fixture],
    });
    const containmentLimit = scenarioStarted.then(
      () => new Promise<"still-running">((resolve) => {
        containmentTimer = setTimeout(() => resolve("still-running"), 3_000);
      }),
    );
    const outcome = await Promise.race([scenarioResult, containmentLimit]);
    if (outcome === "still-running") {
      assert.fail("runScenario stayed blocked by a never-settling callback");
    }
    assert.equal(outcome.status, "failed");
    assert.match(outcome.error?.message ?? "", /scenario deadline exceeded after 20ms/);
    assert.match(outcome.error?.message ?? "", /scenario callback did not settle within 250ms/);
  } finally {
    if (containmentTimer) clearTimeout(containmentTimer);
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("uses fresh owned paths and removes passing artifacts", async () => {
  const artifactsRoot = await mkdtemp(path.join(os.tmpdir(), "pi-cc-terminal-isolation-test-"));
  const family = defineScenarioFamily({
    name: "terminal-session-isolation",
    viewport: { columns: 60, rows: 20 },
  });
  const scenario = family.scenario({
    name: "fresh paths",
    start: { mode: "no-session" },
    async run(terminal) {
      await terminal.expect("ready", { visible: ["SMOKE READY", "HOME ", "AGENT "] });
    },
  });

  try {
    const first = await runScenario(scenario, {
      artifactsRoot,
      keepArtifacts: "always",
      piBin: process.execPath,
      piArgumentPrefix: [fixture],
    });
    const second = await runScenario(scenario, {
      artifactsRoot,
      keepArtifacts: "always",
      piBin: process.execPath,
      piArgumentPrefix: [fixture],
    });
    assert.equal(first.status, "passed", first.error?.stack);
    assert.equal(second.status, "passed", second.error?.stack);
    const firstOwnership = JSON.parse(await readFile(path.join(first.artifactsPath!, "ownership.json"), "utf8"));
    const secondOwnership = JSON.parse(await readFile(path.join(second.artifactsPath!, "ownership.json"), "utf8"));
    assert.notEqual(firstOwnership.home, secondOwnership.home);
    assert.notEqual(firstOwnership.agent, secondOwnership.agent);
    assert.notEqual(firstOwnership.workspace, secondOwnership.workspace);

    await rm(first.artifactsPath!, { recursive: true, force: true });
    await rm(second.artifactsPath!, { recursive: true, force: true });
    const cleaned = await runScenario(scenario, {
      artifactsRoot,
      piBin: process.execPath,
      piArgumentPrefix: [fixture],
    });
    assert.equal(cleaned.status, "passed", cleaned.error?.stack);
    assert.equal(cleaned.artifactsPath, undefined);
    assert.deepEqual(await readdir(artifactsRoot), []);
  } finally {
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("stops a hung scenario and its detached process descendants", async () => {
  const artifactsRoot = await mkdtemp(path.join(os.tmpdir(), "pi-cc-terminal-cleanup-test-"));
  const family = defineScenarioFamily({
    name: "terminal-session-cleanup",
    viewport: { columns: 40, rows: 12 },
    scenarioDeadlineMs: descendantCleanupDeadlineMs,
  });
  const scenario = family.scenario({
    name: "hung callback",
    start: {
      mode: "no-session",
      environment: {
        SMOKE_READY_IMMEDIATELY: "1",
        SMOKE_SPAWN_DETACHED_CHILD: "1",
      },
    },
    async run(terminal) {
      await waitForDescendantThenRemainActive(terminal, "detached-child-started", /CHILD_PID \d+/);
    },
  });
  let childPid: number | undefined;

  try {
    const result = await runScenario(scenario, {
      artifactsRoot,
      keepArtifacts: "always",
      piBin: process.execPath,
      piArgumentPrefix: [fixture],
    });
    assert.ok(result.artifactsPath);
    const raw = await readFile(path.join(result.artifactsPath, "terminal.raw.ansi"), "utf8");
    childPid = Number(/CHILD_PID (\d+)/.exec(raw)?.[1]);
    assert.ok(Number.isInteger(childPid));
    assert.equal(result.status, "failed");
    assert.match(
      result.error?.message ?? "",
      new RegExp(`scenario deadline.*${descendantCleanupDeadlineMs}ms`),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(isProcessAlive(childPid), false, `owned child ${childPid} survived cleanup`);
  } finally {
    if (childPid && isProcessAlive(childPid)) process.kill(childPid, "SIGKILL");
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("stops an owned grandchild after its intermediate parent exits", async () => {
  const artifactsRoot = await mkdtemp(path.join(os.tmpdir(), "pi-cc-terminal-daemon-cleanup-test-"));
  const daemonPidPath = path.join(artifactsRoot, "daemon.pid");
  const family = defineScenarioFamily({
    name: "terminal-session-daemon-cleanup",
    viewport: { columns: 40, rows: 12 },
    scenarioDeadlineMs: descendantCleanupDeadlineMs,
  });
  const scenario = family.scenario({
    name: "reparented grandchild",
    start: {
      mode: "no-session",
      environment: {
        SMOKE_READY_IMMEDIATELY: "1",
        SMOKE_SPAWN_DAEMON: "1",
        SMOKE_DAEMON_PID_FILE: daemonPidPath,
      },
    },
    async run(terminal) {
      await waitForDescendantThenRemainActive(terminal, "daemon-started", /DAEMON_PID \d+/);
    },
  });
  let daemonPid: number | undefined;

  try {
    const result = await runScenario(scenario, {
      artifactsRoot,
      piBin: process.execPath,
      piArgumentPrefix: [fixture],
    });
    daemonPid = Number(await readFile(daemonPidPath, "utf8"));
    assert.equal(result.status, "failed");
    assert.match(
      result.error?.message ?? "",
      new RegExp(`scenario deadline.*${descendantCleanupDeadlineMs}ms`),
    );
    assert.ok(Number.isInteger(daemonPid));
    assert.equal(isProcessAlive(daemonPid), false, `owned daemon ${daemonPid} survived cleanup`);
  } finally {
    if (daemonPid && isProcessAlive(daemonPid)) process.kill(daemonPid, "SIGKILL");
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("keeps known-red failures visible and rejects an unexpected pass", async () => {
  const artifactsRoot = await mkdtemp(path.join(os.tmpdir(), "pi-cc-terminal-known-red-test-"));
  const family = defineScenarioFamily({
    name: "terminal-session-known-red",
    viewport: { columns: 40, rows: 12 },
    deadlineMs: 5_000,
  });
  const expectedFailure = family.scenario({
    name: "expected failure",
    knownRed: {
      reason: "existing rendering defect",
      error: /DESIRED_RENDERING/,
    },
    start: { mode: "no-session" },
    async run(terminal) {
      await terminal.expect("desired-frame", {
        visible: ["DESIRED_RENDERING"],
        deadlineMs: 30,
        stableForMs: 0,
      });
    },
  });
  const unexpectedPass = family.scenario({
    name: "unexpected pass",
    knownRed: {
      reason: "existing rendering defect",
      error: /DESIRED_RENDERING/,
    },
    start: { mode: "no-session" },
    async run(terminal) {
      await terminal.expect("ready", { visible: ["SMOKE READY"], stableForMs: 0 });
    },
  });

  try {
    const red = await runScenario(expectedFailure, {
      artifactsRoot,
      piBin: process.execPath,
      piArgumentPrefix: [fixture],
    });
    const green = await runScenario(unexpectedPass, {
      artifactsRoot,
      piBin: process.execPath,
      piArgumentPrefix: [fixture],
    });
    const infrastructureFailure = await runScenario(expectedFailure, {
      artifactsRoot,
      piBin: path.join(artifactsRoot, "missing-pi"),
    });
    assert.equal(red.status, "known-red");
    assert.match(red.error?.message ?? "", /DESIRED_RENDERING/);
    assert.ok(red.artifactsPath);
    assert.equal(green.status, "unexpected-pass");
    assert.match(green.error?.message ?? "", /known-red scenario passed/);
    assert.ok(green.artifactsPath);
    assert.equal(infrastructureFailure.status, "failed");
    assert.match(infrastructureFailure.error?.message ?? "", /Pi executable is missing/);
  } finally {
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("stages inline and copied files in the owned workspace", async () => {
  const artifactsRoot = await mkdtemp(path.join(os.tmpdir(), "pi-cc-terminal-workspace-test-"));
  const family = defineScenarioFamily({
    name: "terminal-session-workspace",
    viewport: { columns: 40, rows: 12 },
  });
  const scenario = family.scenario({
    name: "staged files",
    start: {
      mode: "no-session",
      workspace: {
        files: [
          { path: "nested/inline.txt", content: "inline bytes\n" },
          { path: "copied/smoke.mjs", source: fixture },
        ],
      },
    },
    async run(terminal) {
      await terminal.expect("ready", { visible: ["SMOKE READY"] });
    },
  });

  try {
    const result = await runScenario(scenario, {
      artifactsRoot,
      keepArtifacts: "always",
      piBin: process.execPath,
      piArgumentPrefix: [fixture],
    });
    assert.equal(result.status, "passed", result.error?.stack);
    assert.ok(result.artifactsPath);
    assert.equal(await readFile(path.join(result.artifactsPath, "workspace/nested/inline.txt"), "utf8"), "inline bytes\n");
    assert.deepEqual(
      await readFile(path.join(result.artifactsPath, "workspace/copied/smoke.mjs")),
      await readFile(fixture),
    );
  } finally {
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("rejects workspace files outside the owned workspace", async () => {
  const artifactsRoot = await mkdtemp(path.join(os.tmpdir(), "pi-cc-terminal-workspace-path-test-"));
  const family = defineScenarioFamily({
    name: "terminal-session-workspace-path",
    viewport: { columns: 40, rows: 12 },
  });
  const scenario = family.scenario({
    name: "escaping file",
    start: {
      mode: "no-session",
      workspace: { files: [{ path: "../escaped.txt", content: "not allowed" }] },
    },
    async run() {},
  });

  try {
    await assert.rejects(
      runScenario(scenario, {
        artifactsRoot,
        piBin: process.execPath,
        piArgumentPrefix: [fixture],
      }),
      /workspace file path must stay inside the owned workspace/,
    );
  } finally {
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("rejects overrides of owned isolation environment variables", () => {
  assert.throws(
    () => defineScenarioFamily({
      name: "terminal-session-family-environment",
      viewport: { columns: 40, rows: 12 },
      environment: { HOME: "/tmp/not-owned" },
    }),
    /scenario family environment cannot override reserved variable HOME/,
  );

  const family = defineScenarioFamily({
    name: "terminal-session-scenario-environment",
    viewport: { columns: 40, rows: 12 },
  });
  assert.throws(
    () => family.scenario({
      name: "outside agent directory",
      start: {
        mode: "no-session",
        environment: { PI_CODING_AGENT_DIR: "/tmp/not-owned" },
      },
      async run() {},
    }),
    /scenario environment cannot override reserved variable PI_CODING_AGENT_DIR/,
  );

  const mutableEnvironment: Record<string, string> = {};
  const isolated = family.scenario({
    name: "snapshotted environment",
    start: { mode: "no-session", environment: mutableEnvironment },
    async run() {},
  });
  mutableEnvironment.HOME = "/tmp/mutated-outside";
  assert.equal(isolated.start.environment?.HOME, undefined);
});

test("rejects unsafe session sibling file paths", async () => {
  const artifactsRoot = await mkdtemp(path.join(os.tmpdir(), "pi-cc-terminal-session-file-path-test-"));
  const template = path.join(artifactsRoot, "template.jsonl");
  await writeFile(template, "{}\n");
  const family = defineScenarioFamily({
    name: "terminal-session-file-path",
    viewport: { columns: 40, rows: 12 },
  });

  try {
    for (const [filePath, expected] of [
      ["../escaped.json", /session sibling file path must name a file inside its owned directory/],
      ["session.jsonl", /session sibling file cannot overwrite session\.jsonl/],
    ] as const) {
      const scenario = family.scenario({
        name: `unsafe ${filePath}`,
        start: {
          mode: "session",
          session: { path: template, files: [{ path: filePath, content: "not allowed" }] },
        },
        async run() {},
      });
      await assert.rejects(
        runScenario(scenario, {
          artifactsRoot,
          piBin: process.execPath,
          piArgumentPrefix: [fixture],
        }),
        expected,
      );
    }
  } finally {
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("stages distinct agent and home settings with keybindings", async () => {
  const artifactsRoot = await mkdtemp(path.join(os.tmpdir(), "pi-cc-terminal-config-test-"));
  const family = defineScenarioFamily({
    name: "terminal-session-config",
    viewport: { columns: 40, rows: 12 },
    settings: { sharedFamily: true },
  });
  const scenario = family.scenario({
    name: "separate config stores",
    start: {
      mode: "no-session",
      settings: { sharedScenario: true },
      agentSettings: { agentOnly: "agent" },
      homeSettings: { homeOnly: "home" },
      keybindings: { "app.tools.expand": ["alt+j"] },
    },
    async run(terminal) {
      await terminal.expect("ready", { visible: ["SMOKE READY"] });
    },
  });

  try {
    const result = await runScenario(scenario, {
      artifactsRoot,
      keepArtifacts: "always",
      piBin: process.execPath,
      piArgumentPrefix: [fixture],
    });
    assert.equal(result.status, "passed", result.error?.stack);
    assert.ok(result.artifactsPath);
    const agentSettings = JSON.parse(await readFile(path.join(result.artifactsPath, "agent/settings.json"), "utf8"));
    const homeSettings = JSON.parse(await readFile(path.join(result.artifactsPath, "home/.pi/settings.json"), "utf8"));
    const keybindings = JSON.parse(await readFile(path.join(result.artifactsPath, "agent/keybindings.json"), "utf8"));
    assert.deepEqual(agentSettings, { sharedFamily: true, sharedScenario: true, agentOnly: "agent" });
    assert.deepEqual(homeSettings, { sharedFamily: true, sharedScenario: true, homeOnly: "home" });
    assert.deepEqual(keybindings, { "app.tools.expand": ["alt+j"] });
  } finally {
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("resolves session template values to owned workspace paths", async () => {
  const artifactsRoot = await mkdtemp(path.join(os.tmpdir(), "pi-cc-terminal-session-template-test-"));
  const template = path.join(artifactsRoot, "template.jsonl");
  await writeFile(template, '{"cwd":"__CWD__","target":"__TARGET__","session":"__SESSION__"}\n');
  const family = defineScenarioFamily({
    name: "terminal-session-template",
    viewport: { columns: 40, rows: 12 },
  });
  const scenario = family.scenario({
    name: "owned path replacements",
    start: {
      mode: "session",
      session: {
        path: template,
        replacements: {
          __CWD__: { workspacePath: "." },
          __TARGET__: { workspacePath: "skills/shape/SKILL.md" },
          __SESSION__: { sessionPath: true },
        },
        files: [{
          path: "manifest.json",
          content: '{"sessionPath":"__SESSION__","cwd":"__CWD__"}\n',
        }],
      },
      environment: { SESSION_REF: { sessionPath: true } },
    },
    async run(terminal) {
      await terminal.expect("ready", { visible: ["SESSION_REF_MATCH true"] });
    },
  });

  try {
    const result = await runScenario(scenario, {
      artifactsRoot,
      keepArtifacts: "always",
      piBin: process.execPath,
      piArgumentPrefix: [fixture],
    });
    assert.equal(result.status, "passed", result.error?.stack);
    assert.ok(result.artifactsPath);
    const ownership = JSON.parse(await readFile(path.join(result.artifactsPath, "ownership.json"), "utf8"));
    const session = JSON.parse(await readFile(ownership.sessionPath, "utf8"));
    const manifest = JSON.parse(await readFile(path.join(path.dirname(ownership.sessionPath), "manifest.json"), "utf8"));
    assert.equal(session.cwd, ownership.workspace);
    assert.equal(session.target, path.join(ownership.workspace, "skills/shape/SKILL.md"));
    assert.equal(session.session, ownership.sessionPath);
    assert.deepEqual(manifest, { sessionPath: ownership.sessionPath, cwd: ownership.workspace });
  } finally {
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("replaces both owned settings stores during a live scenario", async () => {
  const artifactsRoot = await mkdtemp(path.join(os.tmpdir(), "pi-cc-terminal-runtime-settings-test-"));
  const family = defineScenarioFamily({
    name: "terminal-session-runtime-settings",
    viewport: { columns: 40, rows: 12 },
    settings: { before: true },
  });
  const scenario = family.scenario({
    name: "runtime replacement",
    start: { mode: "no-session" },
    async run(terminal) {
      await terminal.expect("ready", { visible: ["SMOKE READY"] });
      await terminal.replaceSettings({ after: true });
    },
  });

  try {
    const result = await runScenario(scenario, {
      artifactsRoot,
      keepArtifacts: "always",
      piBin: process.execPath,
      piArgumentPrefix: [fixture],
    });
    assert.equal(result.status, "passed", result.error?.stack);
    assert.ok(result.artifactsPath);
    for (const relativePath of ["agent/settings.json", "home/.pi/settings.json"]) {
      const settings = JSON.parse(await readFile(path.join(result.artifactsPath, relativePath), "utf8"));
      assert.deepEqual(settings, { after: true });
    }
  } finally {
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("allows settings-managed extensions without enabling other resource discovery", async () => {
  const artifactsRoot = await mkdtemp(path.join(os.tmpdir(), "pi-cc-terminal-extension-settings-test-"));
  const family = defineScenarioFamily({
    name: "terminal-session-extension-settings",
    viewport: { columns: 40, rows: 12 },
  });
  const scenario = family.scenario({
    name: "settings-managed extensions",
    start: { mode: "no-session", loadExtensionsFromSettings: true },
    async run(terminal) {
      await terminal.expect("ready", { visible: ["SMOKE READY"] });
    },
  });

  try {
    const result = await runScenario(scenario, {
      artifactsRoot,
      keepArtifacts: "always",
      piBin: process.execPath,
      piArgumentPrefix: [fixture],
    });
    assert.equal(result.status, "passed", result.error?.stack);
    assert.ok(result.artifactsPath);
    const launch = JSON.parse(await readFile(path.join(result.artifactsPath, "launch.json"), "utf8"));
    assert.ok(!launch.args.includes("--no-extensions"));
    assert.ok(launch.args.includes("--no-skills"));
  } finally {
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("routes terminal actions through an owned tmux client", async () => {
  const artifactsRoot = await mkdtemp(path.join(os.tmpdir(), "pi-cc-terminal-tmux-test-"));
  const family = defineScenarioFamily({
    name: "terminal-session-tmux",
    viewport: { columns: 60, rows: 20 },
    deadlineMs: 2_000,
  });
  const scenario = family.scenario({
    name: "physical tmux mouse route",
    start: {
      mode: "no-session",
      transport: "tmux",
      environment: { SMOKE_READY_IMMEDIATELY: "1" },
    },
    async run(terminal) {
      const ready = await terminal.expect("ready", { visible: ["SMOKE READY"] });
      await terminal.perform({ type: "click", at: ready.find("SMOKE READY") });
      await terminal.expect("clicked-through-tmux", { visible: ["CLICK 1 1"] });
    },
  });

  try {
    const result = await runScenario(scenario, {
      artifactsRoot,
      keepArtifacts: "always",
      piBin: process.execPath,
      piArgumentPrefix: [fixture],
    });
    assert.equal(result.status, "passed", result.error?.stack);
    assert.ok(result.artifactsPath);
    const launch = JSON.parse(await readFile(path.join(result.artifactsPath, "launch.json"), "utf8"));
    assert.equal(path.basename(launch.command), "tmux");
  } finally {
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}
