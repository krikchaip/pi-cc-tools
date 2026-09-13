import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const suites = ["unit", "renderers", "harness"] as const;
type TestSuite = typeof suites[number];

interface TestCase {
  readonly suite: TestSuite;
  readonly name: string;
  readonly file: string;
  readonly runtime: "node-test" | "bun";
}

const requestedSuite = optionValue("--suite") as TestSuite | undefined;
const requestedTest = optionValue("--test");
const listOnly = process.argv.includes("--list");

if (requestedSuite && !suites.includes(requestedSuite)) {
  throw new Error(`Unknown test suite ${requestedSuite}; expected one of: ${suites.join(", ")}`);
}

const tests = (await discoverTests())
  .filter((test) => !requestedSuite || test.suite === requestedSuite)
  .filter((test) => !requestedTest || test.name === requestedTest || `${test.suite}/${test.name}` === requestedTest);

if (tests.length === 0) {
  throw new Error(`No tests matched${requestedSuite ? ` suite ${requestedSuite}` : ""}${requestedTest ? ` test ${requestedTest}` : ""}`);
}
if (requestedTest && !requestedSuite && tests.length > 1) {
  throw new Error(`Test name ${requestedTest} is ambiguous; add --suite`);
}

if (listOnly) {
  for (const test of tests) console.log(`${test.suite}/${test.name}`);
  process.exit(0);
}

console.log(`TESTS ${tests.length}`);
let failures = 0;
for (const test of tests) {
  const label = `${test.suite}/${test.name}`;
  console.log(`RUN ${label}`);
  const startedAt = performance.now();
  const result = test.runtime === "node-test"
    ? spawnSync(process.execPath, [
        "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
        "--experimental-strip-types",
        "--test",
        test.file,
      ], { stdio: "inherit" })
    : spawnSync("bun", [test.file], { stdio: "inherit" });
  const durationMs = Math.round(performance.now() - startedAt);

  if (result.error || result.status !== 0) {
    failures += 1;
    console.error(`FAIL ${label} ${durationMs}ms${result.error ? `: ${result.error.message}` : ""}`);
  } else {
    console.log(`PASS ${label} ${durationMs}ms`);
  }
}

if (failures > 0) {
  console.error(`TEST_FAILURES ${failures}`);
  process.exitCode = 1;
}

async function discoverTests(): Promise<TestCase[]> {
  const tests: TestCase[] = [];
  for (const suite of ["unit", "renderers"] as const) {
    const directory = path.resolve("test", suite);
    for (const file of await discoverFiles(directory)) {
      tests.push({
        suite,
        name: path.basename(file, ".test.ts"),
        file,
        runtime: suite === "unit" ? "node-test" : "bun",
      });
    }
  }
  tests.push({
    suite: "harness",
    name: "terminal-session",
    file: path.resolve("e2e/terminal-session.test.ts"),
    runtime: "node-test",
  });
  return tests.sort((left, right) => `${left.suite}/${left.name}`.localeCompare(`${right.suite}/${right.name}`));
}

async function discoverFiles(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await discoverFiles(entryPath));
    else if (entry.isFile() && entry.name.endsWith(".test.ts")) found.push(entryPath);
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
