import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { access, copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import * as nodePty from "node-pty";
import type { IPty } from "node-pty";
import type * as Xterm from "@xterm/headless";

const require = createRequire(import.meta.url);
const { Terminal } = require("@xterm/headless") as typeof Xterm;

export interface Viewport {
  columns: number;
  rows: number;
}

type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type FramePattern = string | RegExp;

export interface FrameExpectation {
  visible?: readonly FramePattern[];
  absent?: readonly FramePattern[];
  ordered?: readonly FramePattern[];
  raw?: readonly FramePattern[];
  rawAbsent?: readonly FramePattern[];
  deadlineMs?: number;
  stableForMs?: number;
}

export interface TerminalPoint {
  column: number;
  row: number;
}

export type TerminalAction =
  | { type: "write"; data: string }
  | { type: "key"; key: "escape" | "enter" | "ctrl-c" | "page-up" | "page-down" }
  | { type: "click"; at: TerminalPoint; button?: number }
  | { type: "wheel"; at: TerminalPoint; direction: "up" | "down" }
  | { type: "resize"; viewport: Viewport };

export interface FrameEvidence {
  readonly name: string;
  readonly lines: readonly string[];
  readonly text: string;
  readonly raw: string;
  find(pattern: FramePattern, occurrence?: number): TerminalPoint;
}

export interface TerminalSession {
  perform(action: TerminalAction): Promise<void>;
  expect(name: string, expectation: FrameExpectation): Promise<FrameEvidence>;
  evidence(name: string): Promise<FrameEvidence>;
  replaceSettings(settings: Readonly<Record<string, JsonValue>>): Promise<void>;
}

export type OwnedPathReference =
  | { readonly workspacePath: string }
  | { readonly sessionPath: true };
export type SessionReplacement = string | OwnedPathReference;

export type StagedFile =
  | { readonly path: string; readonly content: string; readonly source?: never }
  | { readonly path: string; readonly source: string; readonly content?: never };

export interface SessionFixture {
  path: string;
  replaceCwd?: string;
  replacements?: Readonly<Record<string, SessionReplacement>>;
  files?: readonly StagedFile[];
}

export type WorkspaceFile = StagedFile;

export interface ScenarioStart {
  mode: "no-session" | "session";
  transport?: "pty" | "tmux";
  session?: SessionFixture;
  workspace?: { readonly files: readonly WorkspaceFile[] };
  extensions?: readonly string[];
  loadExtensionsFromSettings?: boolean;
  args?: readonly string[];
  prompt?: string;
  tuiMode?: "fullscreen" | "inline";
  environment?: Readonly<Record<string, string | OwnedPathReference>>;
  settings?: Readonly<Record<string, JsonValue>>;
  agentSettings?: Readonly<Record<string, JsonValue>>;
  homeSettings?: Readonly<Record<string, JsonValue>>;
  keybindings?: Readonly<Record<string, JsonValue>>;
}

export interface ScenarioDefinition {
  readonly family: ScenarioFamilyDefinition;
  readonly name: string;
  readonly start: ScenarioStart;
  readonly knownRed?: {
    readonly reason: string;
    readonly error: FramePattern;
  };
  readonly run: (terminal: TerminalSession) => Promise<void>;
}

export interface ScenarioFamilyDefinition {
  readonly name: string;
  readonly viewport: Viewport;
  readonly deadlineMs: number;
  readonly scenarioDeadlineMs: number;
  readonly settings: Readonly<Record<string, JsonValue>>;
  readonly environment: Readonly<Record<string, string>>;
  readonly extensions: readonly string[];
}

export interface ScenarioFamilyBuilder {
  scenario(definition: Omit<ScenarioDefinition, "family">): ScenarioDefinition;
}

export interface DefineScenarioFamilyOptions {
  name: string;
  viewport: Viewport;
  deadlineMs?: number;
  scenarioDeadlineMs?: number;
  settings?: Readonly<Record<string, JsonValue>>;
  environment?: Readonly<Record<string, string>>;
  extensions?: readonly string[];
}

export interface RunScenarioOptions {
  artifactsRoot?: string;
  keepArtifacts?: "always" | "failures";
  piBin?: string;
  piArgumentPrefix?: readonly string[];
}

export interface ScenarioResult {
  readonly family: string;
  readonly name: string;
  readonly status: "passed" | "failed" | "known-red" | "unexpected-pass";
  readonly durationMs: number;
  readonly artifactsPath?: string;
  readonly error?: Error;
}

interface Snapshot {
  lines: string[];
  columnsByOffset: number[][];
  text: string;
}

const KEY_DATA: Record<Extract<TerminalAction, { type: "key" }>['key'], string> = {
  escape: "\u001b",
  enter: "\r",
  "ctrl-c": "\u0003",
  "page-up": "\u001b[5~",
  "page-down": "\u001b[6~",
};

const RESERVED_ENVIRONMENT_VARIABLES = new Set([
  "HOME",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  "PI_CODING_AGENT_DIR",
  "PI_OFFLINE",
  "PI_CC_E2E_OWNER_TOKEN",
  "PI_CC_E2E_SUPERVISOR_TOKEN",
]);

export function defineScenarioFamily(options: DefineScenarioFamilyOptions): ScenarioFamilyBuilder {
  validateName("scenario family", options.name);
  validateViewport(options.viewport);
  validateEnvironment("scenario family", options.environment);
  const family: ScenarioFamilyDefinition = Object.freeze({
    name: options.name,
    viewport: Object.freeze({ ...options.viewport }),
    deadlineMs: options.deadlineMs ?? 5_000,
    scenarioDeadlineMs: options.scenarioDeadlineMs ?? 60_000,
    settings: Object.freeze({ ...(options.settings ?? {}) }),
    environment: Object.freeze({ ...(options.environment ?? {}) }),
    extensions: Object.freeze([...(options.extensions ?? [])]),
  });

  if (!Number.isFinite(family.deadlineMs) || family.deadlineMs <= 0) {
    throw new TypeError("scenario family deadlineMs must be a positive finite number");
  }
  if (!Number.isFinite(family.scenarioDeadlineMs) || family.scenarioDeadlineMs <= 0) {
    throw new TypeError("scenario family scenarioDeadlineMs must be a positive finite number");
  }

  return Object.freeze({
    scenario(definition: Omit<ScenarioDefinition, "family">): ScenarioDefinition {
      validateName("scenario", definition.name);
      validateEnvironment("scenario", definition.start.environment);
      if (definition.start.mode === "session" && !definition.start.session) {
        throw new TypeError(`scenario ${definition.name} requires a session fixture`);
      }
      if (definition.start.mode === "no-session" && definition.start.session) {
        throw new TypeError(`scenario ${definition.name} cannot use a session fixture in no-session mode`);
      }
      if (definition.knownRed) {
        if (!definition.knownRed.reason.trim()) {
          throw new TypeError(`known-red scenario ${definition.name} requires a reason`);
        }
        if (typeof definition.knownRed.error === "string" && !definition.knownRed.error) {
          throw new TypeError(`known-red scenario ${definition.name} requires an error matcher`);
        }
      }
      const start = Object.freeze({
        ...definition.start,
        environment: definition.start.environment
          ? Object.freeze({ ...definition.start.environment })
          : undefined,
      });
      return Object.freeze({ ...definition, start, family });
    },
  });
}

export async function runScenario(
  scenario: ScenarioDefinition,
  options: RunScenarioOptions = {},
): Promise<ScenarioResult> {
  assertSupportedNode();
  const startedAt = performance.now();
  const artifactsRoot = path.resolve(options.artifactsRoot ?? path.join(os.tmpdir(), "pi-cc-tools-e2e"));
  await mkdir(artifactsRoot, { recursive: true });
  const artifactsPath = await mkdtemp(path.join(artifactsRoot, `${slug(scenario.family.name)}-${slug(scenario.name)}-`));
  const ledger = await prepareOwnedResources(artifactsPath, scenario);
  const piBin = options.piBin ?? process.env.PI_BIN ?? "pi";
  const keepArtifacts = options.keepArtifacts ?? (process.env.KEEP_E2E_ARTIFACTS === "1" ? "always" : "failures");

  let status: ScenarioResult["status"] = "failed";
  let error: Error | undefined;
  let failureKind: "infrastructure" | "scenario" | "cleanup" | undefined;
  let phase: "infrastructure" | "scenario" = "infrastructure";
  let session: LiveTerminalSession | undefined;
  let scenarioRun: Promise<void> | undefined;
  let cleanupLaunch: (() => void) | undefined;

  try {
    await assertExecutable(piBin);
    const launch = await buildLaunch(scenario, ledger, piBin, options.piArgumentPrefix ?? []);
    cleanupLaunch = launch.cleanup;
    session = new LiveTerminalSession({
      artifactsPath,
      command: launch.command,
      args: launch.args,
      cwd: ledger.workspace,
      env: buildEnvironment(scenario, ledger),
      viewport: scenario.family.viewport,
      deadlineMs: scenario.family.deadlineMs,
    });
    await session.start();
    phase = "scenario";
    const activeSession = session;
    scenarioRun = Promise.resolve().then(() => scenario.run(activeSession));
    await withScenarioDeadline(
      scenarioRun,
      scenario.family.scenarioDeadlineMs,
      `${scenario.family.name} / ${scenario.name}`,
    );
    status = "passed";
  } catch (caught) {
    error = toError(caught);
    failureKind = caught instanceof ScenarioDeadlineError ? "infrastructure" : phase;
    if (caught instanceof ScenarioDeadlineError && session) {
      try {
        await session.close();
      } catch (cleanupCaught) {
        const cleanupError = toError(cleanupCaught);
        error = new AggregateError([error, cleanupError], "scenario deadline and cleanup failed");
        failureKind = "cleanup";
      } finally {
        session = undefined;
      }
      const callbackSettled = scenarioRun
        ? await Promise.race([
            scenarioRun.then(() => true, () => true),
            delay(250).then(() => false),
          ])
        : true;
      if (!callbackSettled) {
        const containmentError = new Error("scenario callback did not settle within 250ms after terminal cleanup");
        error = new AggregateError(
          [error, containmentError],
          `${error.message}; ${containmentError.message}`,
        );
      }
    }
  } finally {
    try {
      await session?.close();
    } catch (caught) {
      const cleanupError = toError(caught);
      error = error ? new AggregateError([error, cleanupError], "scenario and cleanup failed") : cleanupError;
      failureKind = "cleanup";
      status = "failed";
    } finally {
      cleanupLaunch?.();
    }
  }

  if (scenario.knownRed) {
    if (
      status === "failed"
      && failureKind === "scenario"
      && error
      && hasPattern(error.message, scenario.knownRed.error)
    ) {
      status = "known-red";
    } else if (status === "passed") {
      status = "unexpected-pass";
      error = new Error(`known-red scenario passed: ${scenario.knownRed.reason}`);
    }
  }

  const durationMs = performance.now() - startedAt;
  await writeFile(
    path.join(artifactsPath, "result.json"),
    `${JSON.stringify({
      family: scenario.family.name,
      scenario: scenario.name,
      status,
      knownRed: scenario.knownRed,
      durationMs: Math.round(durationMs),
      error: error ? { name: error.name, message: error.message, stack: error.stack } : undefined,
    }, null, 2)}\n`,
  );
  if (status === "passed" && keepArtifacts !== "always") {
    await rm(artifactsPath, { recursive: true, force: true });
  }

  return {
    family: scenario.family.name,
    name: scenario.name,
    status,
    durationMs,
    artifactsPath: status !== "passed" || keepArtifacts === "always" ? artifactsPath : undefined,
    error,
  };
}

class LiveTerminalSession implements TerminalSession {
  readonly #artifactsPath: string;
  readonly #command: string;
  readonly #args: readonly string[];
  readonly #cwd: string;
  readonly #env: Record<string, string>;
  readonly #deadlineMs: number;
  #viewport: Viewport;
  #pty: IPty | undefined;
  #terminal: InstanceType<typeof Terminal>;
  #raw = "";
  #writeChain: Promise<void> = Promise.resolve();
  #probeTail = "";
  #exited = false;
  #exitCode: number | undefined;
  #resolveExit: (() => void) | undefined;
  #exitPromise = new Promise<void>((resolve) => {
    this.#resolveExit = resolve;
  });
  #fatalPrompt: string | undefined;
  #evidenceNames = new Set<string>();

  constructor(options: {
    artifactsPath: string;
    command: string;
    args: readonly string[];
    cwd: string;
    env: Record<string, string>;
    viewport: Viewport;
    deadlineMs: number;
  }) {
    this.#artifactsPath = options.artifactsPath;
    this.#command = options.command;
    this.#args = options.args;
    this.#cwd = options.cwd;
    this.#env = options.env;
    this.#viewport = { ...options.viewport };
    this.#deadlineMs = options.deadlineMs;
    this.#terminal = new Terminal({
      allowProposedApi: true,
      cols: this.#viewport.columns,
      rows: this.#viewport.rows,
      scrollback: 20_000,
    });
  }

  async start(): Promise<void> {
    const pty = nodePty.spawn(this.#command, [...this.#args], {
      name: "xterm-256color",
      cols: this.#viewport.columns,
      rows: this.#viewport.rows,
      cwd: this.#cwd,
      env: this.#env,
    });
    this.#pty = pty;
    pty.onData((data) => this.#acceptOutput(data));
    pty.onExit(({ exitCode }) => {
      this.#exited = true;
      this.#exitCode = exitCode;
      this.#resolveExit?.();
    });

    await writeFile(
      path.join(this.#artifactsPath, "launch.json"),
      `${JSON.stringify({ command: this.#command, args: this.#args, cwd: this.#cwd, viewport: this.#viewport }, null, 2)}\n`,
    );
  }

  async perform(action: TerminalAction): Promise<void> {
    const pty = this.#requirePty();
    if (action.type === "write") {
      pty.write(action.data);
      return;
    }
    if (action.type === "key") {
      pty.write(KEY_DATA[action.key]);
      return;
    }
    if (action.type === "click") {
      validatePoint(action.at, this.#viewport);
      const button = action.button ?? 0;
      pty.write(`\u001b[<${button};${action.at.column};${action.at.row}M\u001b[<${button};${action.at.column};${action.at.row}m`);
      return;
    }
    if (action.type === "wheel") {
      validatePoint(action.at, this.#viewport);
      const button = action.direction === "up" ? 64 : 65;
      pty.write(`\u001b[<${button};${action.at.column};${action.at.row}M`);
      return;
    }

    validateViewport(action.viewport);
    this.#viewport = { ...action.viewport };
    this.#terminal.resize(action.viewport.columns, action.viewport.rows);
    pty.resize(action.viewport.columns, action.viewport.rows);
  }

  async expect(name: string, expectation: FrameExpectation): Promise<FrameEvidence> {
    validateName("frame evidence", name);
    const deadlineMs = expectation.deadlineMs ?? this.#deadlineMs;
    const stableForMs = expectation.stableForMs ?? 60;
    if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) throw new TypeError("expectation deadlineMs must be positive");
    if (!Number.isFinite(stableForMs) || stableForMs < 0) throw new TypeError("expectation stableForMs cannot be negative");

    const deadline = performance.now() + deadlineMs;
    let matchingSince = 0;
    let matchingText = "";
    let matchingRawLength = -1;
    let lastReason = "no terminal frame received";

    while (performance.now() <= deadline) {
      await this.#writeChain;
      if (this.#fatalPrompt) throw new Error(this.#fatalPrompt);
      const snapshot = this.#snapshot();
      const match = matchExpectation(snapshot.text, this.#raw, expectation);
      lastReason = match.reason;

      if (match.ok) {
        const now = performance.now();
        if (snapshot.text !== matchingText || this.#raw.length !== matchingRawLength) {
          matchingText = snapshot.text;
          matchingRawLength = this.#raw.length;
          matchingSince = now;
        }
        if (now - matchingSince >= stableForMs) return this.#recordEvidence(name, snapshot);
      } else {
        matchingSince = 0;
        matchingText = "";
        matchingRawLength = -1;
      }

      if (this.#exited) {
        throw new Error(`terminal exited with code ${this.#exitCode ?? "unknown"} before ${name}: ${lastReason}`);
      }
      await delay(Math.min(20, Math.max(1, deadline - performance.now())));
    }

    await this.#writeChain;
    const snapshot = this.#snapshot();
    await this.#recordEvidence(`${name}-timeout`, snapshot);
    throw new Error(`timed out after ${deadlineMs}ms waiting for ${name}: ${lastReason}`);
  }

  async evidence(name: string): Promise<FrameEvidence> {
    validateName("frame evidence", name);
    await this.#writeChain;
    return this.#recordEvidence(name, this.#snapshot());
  }

  async replaceSettings(settings: Readonly<Record<string, JsonValue>>): Promise<void> {
    const content = `${JSON.stringify(settings, null, 2)}\n`;
    await Promise.all([
      writeFileAtomically(path.join(this.#env.PI_CODING_AGENT_DIR!, "settings.json"), content),
      writeFileAtomically(path.join(this.#env.HOME!, ".pi", "settings.json"), content),
    ]);
  }

  async close(): Promise<void> {
    const pty = this.#pty;
    if (!pty) {
      this.#terminal.dispose();
      return;
    }
    const ownerToken = this.#env.PI_CC_E2E_OWNER_TOKEN!;

    if (!this.#exited) {
      try {
        pty.write("\u0003\u0003");
      } catch {}
      await Promise.race([this.#waitForExit(), delay(250)]);
    }

    signalOwnedProcesses("PI_CC_E2E_OWNER_TOKEN", ownerToken, "SIGTERM");
    if (!this.#exited) await Promise.race([this.#waitForExit(), delay(500)]);

    signalOwnedProcesses("PI_CC_E2E_OWNER_TOKEN", ownerToken, "SIGKILL");
    if (!this.#exited) await Promise.race([this.#waitForExit(), delay(500)]);

    await delay(25);
    signalOwnedProcesses("PI_CC_E2E_OWNER_TOKEN", ownerToken, "SIGKILL");

    await this.#writeChain;
    await writeFile(path.join(this.#artifactsPath, "terminal.raw.ansi"), this.#raw);
    this.#terminal.dispose();
    this.#pty = undefined;
  }

  #acceptOutput(data: string): void {
    this.#raw += data;
    if (this.#raw.includes("Trust project folder?")) {
      this.#fatalPrompt = "unexpected project trust prompt";
    } else if (this.#raw.includes("Install missing project packages?")) {
      this.#fatalPrompt = "unexpected package installation prompt";
    }
    this.#respondToProbes(data);
    this.#writeChain = this.#writeChain.then(
      () => new Promise<void>((resolve) => this.#terminal.write(data, resolve)),
    );
  }

  #respondToProbes(data: string): void {
    const previousLength = this.#probeTail.length;
    const combined = this.#probeTail + data;
    const probes = [
      { request: "\u001b[c", response: "\u001b[?1;2c" },
      { request: "\u001b[?u", response: "\u001b[?0u" },
    ];
    for (const probe of probes) {
      let index = combined.indexOf(probe.request);
      while (index !== -1) {
        if (index + probe.request.length > previousLength) this.#pty?.write(probe.response);
        index = combined.indexOf(probe.request, index + 1);
      }
    }
    this.#probeTail = combined.slice(-3);
  }

  #snapshot(): Snapshot {
    const buffer = this.#terminal.buffer.active;
    const lines: string[] = [];
    const columnsByOffset: number[][] = [];
    for (let row = 0; row < this.#viewport.rows; row += 1) {
      const line = buffer.getLine(buffer.viewportY + row);
      if (!line) {
        lines.push("");
        columnsByOffset.push([]);
        continue;
      }
      let text = "";
      const columns: number[] = [];
      for (let column = 0; column < this.#viewport.columns; column += 1) {
        const cell = line.getCell(column);
        if (!cell || cell.getWidth() === 0) continue;
        const chars = cell.getChars() || " ";
        for (let offset = 0; offset < chars.length; offset += 1) columns[text.length + offset] = column + 1;
        text += chars;
      }
      lines.push(text.trimEnd());
      columnsByOffset.push(columns);
    }
    return { lines, columnsByOffset, text: lines.join("\n") };
  }

  async #recordEvidence(name: string, snapshot: Snapshot): Promise<FrameEvidence> {
    if (this.#evidenceNames.has(name)) throw new Error(`duplicate frame evidence name: ${name}`);
    this.#evidenceNames.add(name);
    await Promise.all([
      writeFile(path.join(this.#artifactsPath, `${slug(name)}.screen.txt`), `${snapshot.text}\n`),
      writeFile(path.join(this.#artifactsPath, `${slug(name)}.raw.ansi`), this.#raw),
    ]);
    return new RecordedFrameEvidence(name, snapshot, this.#raw);
  }

  #requirePty(): IPty {
    if (!this.#pty) throw new Error("terminal session is not running");
    if (this.#exited) throw new Error(`terminal session already exited with code ${this.#exitCode ?? "unknown"}`);
    return this.#pty;
  }

  #waitForExit(): Promise<void> {
    return this.#exitPromise;
  }
}

class RecordedFrameEvidence implements FrameEvidence {
  readonly name: string;
  readonly lines: readonly string[];
  readonly text: string;
  readonly raw: string;
  readonly #columnsByOffset: readonly number[][];

  constructor(name: string, snapshot: Snapshot, raw: string) {
    this.name = name;
    this.lines = Object.freeze([...snapshot.lines]);
    this.text = snapshot.text;
    this.raw = raw;
    this.#columnsByOffset = snapshot.columnsByOffset;
  }

  find(pattern: FramePattern, occurrence = 1): TerminalPoint {
    if (!Number.isInteger(occurrence) || occurrence <= 0) throw new TypeError("occurrence must be a positive integer");
    let remaining = occurrence;
    for (let row = 0; row < this.lines.length; row += 1) {
      const index = findPattern(this.lines[row] ?? "", pattern);
      if (index === -1) continue;
      remaining -= 1;
      if (remaining === 0) {
        return { column: this.#columnsByOffset[row]?.[index] ?? index + 1, row: row + 1 };
      }
    }
    throw new Error(`frame ${this.name} does not contain occurrence ${occurrence} of ${String(pattern)}`);
  }
}

interface OwnedResources {
  home: string;
  agent: string;
  workspace: string;
  sessionPath?: string;
  cache: string;
  data: string;
  state: string;
  config: string;
}

async function prepareOwnedResources(artifactsPath: string, scenario: ScenarioDefinition): Promise<OwnedResources> {
  const ledger: OwnedResources = {
    home: path.join(artifactsPath, "home"),
    agent: path.join(artifactsPath, "agent"),
    workspace: path.join(artifactsPath, "workspace"),
    cache: path.join(artifactsPath, "cache"),
    data: path.join(artifactsPath, "data"),
    state: path.join(artifactsPath, "state"),
    config: path.join(artifactsPath, "config"),
  };
  await Promise.all(Object.values(ledger).map((directory) => mkdir(directory, { recursive: true })));
  await mkdir(path.join(ledger.home, ".pi"), { recursive: true });

  const settings = { ...scenario.family.settings, ...(scenario.start.settings ?? {}) };
  const agentSettings = { ...settings, ...(scenario.start.agentSettings ?? {}) };
  const homeSettings = { ...settings, ...(scenario.start.homeSettings ?? {}) };
  const configWrites: Promise<void>[] = [
    writeFile(path.join(ledger.agent, "settings.json"), `${JSON.stringify(agentSettings, null, 2)}\n`),
    writeFile(path.join(ledger.home, ".pi", "settings.json"), `${JSON.stringify(homeSettings, null, 2)}\n`),
  ];
  if (scenario.start.keybindings) {
    configWrites.push(
      writeFile(path.join(ledger.agent, "keybindings.json"), `${JSON.stringify(scenario.start.keybindings, null, 2)}\n`),
    );
  }
  await Promise.all(configWrites);
  await stageWorkspaceFiles(ledger.workspace, scenario.start.workspace?.files ?? []);

  if (scenario.start.mode === "session") {
    const fixture = scenario.start.session;
    if (!fixture) throw new TypeError(`scenario ${scenario.name} requires a session fixture`);
    const sessionDirectory = path.join(artifactsPath, "session");
    await mkdir(sessionDirectory, { recursive: true });
    ledger.sessionPath = path.join(sessionDirectory, "session.jsonl");
    let content = await readFile(fixture.path, "utf8");
    if (fixture.replaceCwd) content = content.split(fixture.replaceCwd).join(ledger.workspace);
    content = replaceSessionValues(content, fixture.replacements ?? {}, ledger);
    await writeFile(ledger.sessionPath, content);
    await stageSessionFiles(sessionDirectory, fixture.files ?? [], fixture.replacements ?? {}, ledger);
  }

  await writeFile(path.join(artifactsPath, "ownership.json"), `${JSON.stringify(ledger, null, 2)}\n`);
  return ledger;
}

async function stageWorkspaceFiles(workspace: string, files: readonly WorkspaceFile[]): Promise<void> {
  const targets = new Set<string>();
  for (const file of files) {
    const target = resolveWorkspacePath(workspace, file.path, "workspace file path");
    if (target === path.resolve(workspace)) {
      throw new TypeError(`workspace file path must name a file: ${JSON.stringify(file.path)}`);
    }
    if (targets.has(target)) {
      throw new TypeError(`workspace file path is duplicated: ${JSON.stringify(file.path)}`);
    }
    targets.add(target);
    await mkdir(path.dirname(target), { recursive: true });
    if (file.source !== undefined) await copyFile(file.source, target);
    else await writeFile(target, file.content);
  }
}

async function stageSessionFiles(
  sessionDirectory: string,
  files: readonly StagedFile[],
  replacements: Readonly<Record<string, SessionReplacement>>,
  ledger: OwnedResources,
): Promise<void> {
  const targets = new Set<string>();
  for (const file of files) {
    const target = resolveOwnedFilePath(sessionDirectory, file.path, "session sibling file path");
    if (target === ledger.sessionPath) {
      throw new TypeError(`session sibling file cannot overwrite session.jsonl: ${JSON.stringify(file.path)}`);
    }
    if (targets.has(target)) {
      throw new TypeError(`session sibling file path is duplicated: ${JSON.stringify(file.path)}`);
    }
    targets.add(target);
    await mkdir(path.dirname(target), { recursive: true });
    if (file.source !== undefined) await copyFile(file.source, target);
    else await writeFile(target, replaceSessionValues(file.content, replacements, ledger));
  }
}

function replaceSessionValues(
  content: string,
  replacements: Readonly<Record<string, SessionReplacement>>,
  ledger: OwnedResources,
): string {
  let replaced = content;
  for (const [token, replacement] of Object.entries(replacements)) {
    replaced = replaced.split(token).join(resolveOwnedPathReference(replacement, ledger));
  }
  return replaced;
}

function resolveOwnedPathReference(reference: string | OwnedPathReference, ledger: OwnedResources): string {
  if (typeof reference === "string") return reference;
  if ("sessionPath" in reference) {
    if (!ledger.sessionPath) throw new TypeError("session path reference requires a session fixture");
    return ledger.sessionPath;
  }
  return resolveWorkspacePath(ledger.workspace, reference.workspacePath, "session workspace path");
}

function resolveOwnedFilePath(root: string, relativePath: string, label: string): string {
  const ownedRoot = path.resolve(root);
  const target = path.resolve(ownedRoot, relativePath);
  if (!relativePath || target === ownedRoot || !target.startsWith(`${ownedRoot}${path.sep}`)) {
    throw new TypeError(`${label} must name a file inside its owned directory: ${JSON.stringify(relativePath)}`);
  }
  return target;
}

function resolveWorkspacePath(workspace: string, relativePath: string, label: string): string {
  const ownedRoot = path.resolve(workspace);
  const target = path.resolve(ownedRoot, relativePath);
  if (!relativePath || (target !== ownedRoot && !target.startsWith(`${ownedRoot}${path.sep}`))) {
    throw new TypeError(`${label} must stay inside the owned workspace: ${JSON.stringify(relativePath)}`);
  }
  return target;
}

async function writeFileAtomically(target: string, content: string): Promise<void> {
  const temporary = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await writeFile(temporary, content);
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

interface LaunchSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly cleanup?: () => void;
}

async function buildLaunch(
  scenario: ScenarioDefinition,
  ledger: OwnedResources,
  piBin: string,
  prefix: readonly string[],
): Promise<LaunchSpec> {
  const piArgs = await buildCommand(scenario, ledger, prefix);
  if ((scenario.start.transport ?? "pty") === "pty") return { command: piBin, args: piArgs };

  const tmuxBin = process.env.TMUX_BIN ?? "tmux";
  await assertExecutable(tmuxBin);
  const scenarioToken = path.basename(path.dirname(ledger.workspace)).slice(-8);
  const socketName = `pi-cc-e2e-${process.pid}-${scenarioToken}`;
  const configPath = path.join(path.dirname(ledger.workspace), "tmux.conf");
  await writeFile(configPath, [
    "set-option -g mouse on",
    "set-option -g status off",
    "set-option -g default-terminal tmux-256color",
    "set-option -g exit-empty on",
    "set-option -g remain-on-exit off",
    "",
  ].join("\n"));
  const shellCommand = [piBin, ...piArgs].map(shellQuote).join(" ");
  const args = [
    "-L", socketName,
    "-f", configPath,
    "new-session",
    "-s", "terminal-session",
    "-x", String(scenario.family.viewport.columns),
    "-y", String(scenario.family.viewport.rows),
    "-c", ledger.workspace,
    shellCommand,
  ];
  return {
    command: tmuxBin,
    args,
    cleanup() {
      try {
        execFileSync(tmuxBin, ["-L", socketName, "kill-server"], { stdio: "ignore" });
      } catch {}
    },
  };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

async function buildCommand(
  scenario: ScenarioDefinition,
  ledger: OwnedResources,
  prefix: readonly string[],
): Promise<string[]> {
  const args = [...prefix];
  if (scenario.start.mode === "session") args.push("--session", ledger.sessionPath!);
  else args.push("--no-session");
  args.push("--no-context-files", "--no-prompt-templates", "--no-themes");
  if (!scenario.start.loadExtensionsFromSettings) args.push("--no-extensions");
  args.push("--no-skills");
  for (const extension of [...scenario.family.extensions, ...(scenario.start.extensions ?? [])]) {
    args.push("-e", extension);
  }
  args.push(...(scenario.start.args ?? []));
  args.push("--tui-mode", scenario.start.tuiMode ?? "fullscreen");
  if (scenario.start.prompt !== undefined) args.push(scenario.start.prompt);
  return args;
}

function buildEnvironment(scenario: ScenarioDefinition, ledger: OwnedResources): Record<string, string> {
  validateEnvironment("scenario", scenario.start.environment);
  const inherited = ["PATH", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "LC_CTYPE", "TERMINFO", "TERMINFO_DIRS"];
  const env: Record<string, string> = {};
  for (const name of inherited) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  const scenarioEnvironment = Object.fromEntries(
    Object.entries(scenario.start.environment ?? {}).map(([name, value]) => [
      name,
      resolveOwnedPathReference(value, ledger),
    ]),
  );
  return {
    ...env,
    HOME: ledger.home,
    XDG_CACHE_HOME: ledger.cache,
    XDG_CONFIG_HOME: ledger.config,
    XDG_DATA_HOME: ledger.data,
    XDG_STATE_HOME: ledger.state,
    PI_CODING_AGENT_DIR: ledger.agent,
    PI_OFFLINE: "1",
    PI_CC_E2E_OWNER_TOKEN: randomUUID(),
    ...(process.env.PI_CC_E2E_SUPERVISOR_TOKEN
      ? { PI_CC_E2E_SUPERVISOR_TOKEN: process.env.PI_CC_E2E_SUPERVISOR_TOKEN }
      : {}),
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    COLUMNS: String(scenario.family.viewport.columns),
    LINES: String(scenario.family.viewport.rows),
    ...scenario.family.environment,
    ...scenarioEnvironment,
  };
}

function matchExpectation(screen: string, raw: string, expectation: FrameExpectation): { ok: boolean; reason: string } {
  for (const pattern of expectation.visible ?? []) {
    if (!hasPattern(screen, pattern)) return { ok: false, reason: `visible frame lacks ${String(pattern)}` };
  }
  for (const pattern of expectation.absent ?? []) {
    if (hasPattern(screen, pattern)) return { ok: false, reason: `visible frame contains forbidden ${String(pattern)}` };
  }
  let offset = 0;
  for (const pattern of expectation.ordered ?? []) {
    const index = findPattern(screen.slice(offset), pattern);
    if (index === -1) return { ok: false, reason: `visible frame lacks ordered ${String(pattern)}` };
    offset += index + matchedLength(screen.slice(offset), pattern);
  }
  for (const pattern of expectation.raw ?? []) {
    if (!hasPattern(raw, pattern)) return { ok: false, reason: `raw output lacks ${String(pattern)}` };
  }
  for (const pattern of expectation.rawAbsent ?? []) {
    if (hasPattern(raw, pattern)) return { ok: false, reason: `raw output contains forbidden ${String(pattern)}` };
  }
  return { ok: true, reason: "matched" };
}

function hasPattern(text: string, pattern: FramePattern): boolean {
  return findPattern(text, pattern) !== -1;
}

function findPattern(text: string, pattern: FramePattern): number {
  if (typeof pattern === "string") return text.indexOf(pattern);
  const flags = pattern.flags.replace("g", "").replace("y", "");
  return new RegExp(pattern.source, flags).exec(text)?.index ?? -1;
}

function matchedLength(text: string, pattern: FramePattern): number {
  if (typeof pattern === "string") return pattern.length;
  const flags = pattern.flags.replace("g", "").replace("y", "");
  return new RegExp(pattern.source, flags).exec(text)?.[0].length ?? 0;
}

function validateName(subject: string, name: string): void {
  if (!name.trim()) throw new TypeError(`${subject} name cannot be empty`);
}

function validateViewport(viewport: Viewport): void {
  if (!Number.isInteger(viewport.columns) || viewport.columns <= 0) throw new TypeError("viewport columns must be a positive integer");
  if (!Number.isInteger(viewport.rows) || viewport.rows <= 0) throw new TypeError("viewport rows must be a positive integer");
}

function validatePoint(point: TerminalPoint, viewport: Viewport): void {
  if (!Number.isInteger(point.column) || point.column < 1 || point.column > viewport.columns) {
    throw new RangeError(`terminal column must be between 1 and ${viewport.columns}`);
  }
  if (!Number.isInteger(point.row) || point.row < 1 || point.row > viewport.rows) {
    throw new RangeError(`terminal row must be between 1 and ${viewport.rows}`);
  }
}

function assertSupportedNode(): void {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if ((major ?? 0) < 22 || (major === 22 && (minor ?? 0) < 19)) {
    throw new Error(`terminal-session E2E requires Node >=22.19.0; found ${process.versions.node}`);
  }
}

async function assertExecutable(command: string): Promise<void> {
  if (!command.includes(path.sep)) return;
  try {
    await access(command, fsConstants.X_OK);
  } catch {
    throw new Error(`Pi executable is missing or not executable: ${command}`);
  }
}

function validateEnvironment(scope: string, environment: Readonly<Record<string, unknown>> | undefined): void {
  for (const name of Object.keys(environment ?? {})) {
    if (RESERVED_ENVIRONMENT_VARIABLES.has(name)) {
      throw new TypeError(`${scope} environment cannot override reserved variable ${name}`);
    }
  }
}

function validateSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "scenario";
}

function slug(value: string): string {
  return validateSlug(value);
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

class ScenarioDeadlineError extends Error {}

async function withScenarioDeadline<T>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new ScenarioDeadlineError(`scenario deadline exceeded after ${milliseconds}ms: ${label}`)),
      milliseconds,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function signalOwnedProcesses(
  environmentVariable: string,
  ownerToken: string,
  signal: NodeJS.Signals,
): void {
  const marker = `${environmentVariable}=${ownerToken}`;
  const output = execFileSync("ps", ["eww", "-axo", "pid=,lstart=,command="], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });

  for (const line of output.split("\n")) {
    if (!line.includes(marker)) continue;
    const match = /^\s*(\d+)\s+((?:\S+\s+){4}\S+)\s/.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    if (pid === process.pid || !processStillOwnsToken(pid, match[2], marker)) continue;
    try {
      process.kill(pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
}

function processStillOwnsToken(pid: number, startedAt: string, marker: string): boolean {
  try {
    const current = execFileSync("ps", ["eww", "-p", String(pid), "-o", "lstart=,command="], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    return current.includes(startedAt) && current.includes(marker);
  } catch {
    return false;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
