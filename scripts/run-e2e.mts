import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  runScenario,
  signalOwnedProcesses,
  type ScenarioDefinition,
} from "../e2e/terminal-session.ts";

interface DiscoveredScenario {
  readonly file: string;
  readonly scenario: ScenarioDefinition;
}

const scenarioRoot = path.resolve("e2e/scenarios");
const requestedFamily = optionValue("--family");
const requestedScenario = optionValue("--scenario");
const workerFile = optionValue("--worker-file");
const piBin = selectPiBin(process.env.PI_BIN);

const version = spawnSync(piBin, ["--version"], { encoding: "utf8" });
if (version.error || version.status !== 0) {
  const detail = version.error?.message ?? (version.stderr.trim() || `exit ${version.status}`);
  throw new Error(`Pi preflight failed for ${piBin}: ${detail}. Set PI_BIN to an executable Pi path.`);
}

if (workerFile) {
  const scenario = await loadScenario(path.resolve(workerFile));
  const failed = await runAndReport(scenario, piBin);
  process.exit(failed ? 1 : 0);
}

const discovered: DiscoveredScenario[] = [];
for (const file of (await discoverScenarioFiles(scenarioRoot)).sort()) {
  const scenario = await loadScenario(file);
  if (requestedFamily && scenario.family.name !== requestedFamily) continue;
  if (requestedScenario && scenario.name !== requestedScenario) continue;
  discovered.push({ file, scenario });
}

if (discovered.length === 0) {
  throw new Error(`No E2E scenarios matched${requestedFamily ? ` family ${requestedFamily}` : ""}${requestedScenario ? ` scenario ${requestedScenario}` : ""}`);
}

console.log(`PI_VERSION ${version.stdout.trim()}`);
console.log(`SCENARIOS ${discovered.length}`);
let failures = 0;
const runnerPath = fileURLToPath(import.meta.url);
for (const { file, scenario } of discovered) {
  const supervisorToken = randomUUID();
  const worker = spawnSync(
    process.execPath,
    [...process.execArgv, runnerPath, "--worker-file", file],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PI_BIN: piBin,
        PI_CC_E2E_SUPERVISOR_TOKEN: supervisorToken,
      },
      stdio: "inherit",
      timeout: scenario.family.scenarioDeadlineMs + 5_000,
      killSignal: "SIGKILL",
    },
  );
  if (worker.error) {
    failures += 1;
    if ((worker.error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
      try {
        signalOwnedProcesses("PI_CC_E2E_SUPERVISOR_TOKEN", supervisorToken, "SIGTERM");
        signalOwnedProcesses("PI_CC_E2E_SUPERVISOR_TOKEN", supervisorToken, "SIGKILL");
      } catch (cleanupError) {
        console.error(`FAIL worker cleanup ${path.relative(process.cwd(), file)}: ${(cleanupError as Error).message}`);
      }
    }
    console.error(`FAIL worker ${path.relative(process.cwd(), file)}: ${worker.error.message}`);
  } else if (worker.status !== 0) {
    failures += 1;
  }
}

if (failures > 0) {
  console.error(`E2E_FAILURES ${failures}`);
  process.exitCode = 1;
}

async function loadScenario(file: string): Promise<ScenarioDefinition> {
  const imported = await import(pathToFileURL(file).href);
  const scenario = imported.default as ScenarioDefinition | undefined;
  if (!scenario?.family?.name || !scenario.name || typeof scenario.run !== "function") {
    throw new Error(`${path.relative(process.cwd(), file)} must default-export one scenario definition`);
  }
  return scenario;
}

async function runAndReport(scenario: ScenarioDefinition, executable: string): Promise<boolean> {
  const label = `${scenario.family.name} / ${scenario.name}`;
  process.stdout.write(`RUN ${label}\n`);
  const result = await runScenario(scenario, { piBin: executable });
  if (result.status === "passed") {
    console.log(`PASS ${label} ${Math.round(result.durationMs)}ms`);
    return false;
  }
  if (result.status === "known-red") {
    console.log(`KNOWN_RED ${label} ${Math.round(result.durationMs)}ms`);
    console.log(`REASON ${scenario.knownRed?.reason}`);
    console.log(`ARTIFACTS ${result.artifactsPath}`);
    return false;
  }

  console.error(`${result.status === "unexpected-pass" ? "UNEXPECTED_PASS" : "FAIL"} ${label} ${Math.round(result.durationMs)}ms`);
  console.error(result.error?.stack ?? result.error?.message ?? "unknown failure");
  console.error(`ARTIFACTS ${result.artifactsPath}`);
  return true;
}

async function discoverScenarioFiles(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await discoverScenarioFiles(entryPath));
    else if (entry.isFile() && entry.name.endsWith(".scenario.ts")) found.push(entryPath);
  }
  return found;
}

function optionValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function selectPiBin(explicit: string | undefined): string {
  const candidates = explicit
    ? [explicit]
    : [...new Set((process.env.PATH ?? "").split(path.delimiter).map((directory) => path.resolve(directory || ".", "pi")))];
  const rejected: string[] = [];

  for (const candidate of candidates) {
    const help = spawnSync(candidate, ["--help"], { encoding: "utf8" });
    if (help.error || help.status !== 0) continue;
    if (help.stdout.includes("--no-context-files") && help.stdout.includes("--tui-mode")) return candidate;
    rejected.push(candidate);
  }

  if (explicit) {
    throw new Error(`PI_BIN does not provide the required Pi E2E options: ${explicit}`);
  }
  throw new Error(
    `No compatible Pi executable found on PATH${rejected.length > 0 ? `; rejected: ${rejected.join(", ")}` : ""}`,
  );
}
