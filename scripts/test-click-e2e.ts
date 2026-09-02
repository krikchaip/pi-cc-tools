import { constants, accessSync } from "node:fs";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";

const expectFiles = [
  "e2e/expect/click-viewport-anchors.expect",
  "e2e/expect/collapse-scroll-position.expect",
  "e2e/expect/tool-group-click.expect",
];

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function supportsFullscreenMode(path: string): boolean {
  const result = spawnSync(path, ["--help"], { encoding: "utf8" });
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`.includes("--tui-mode");
}

function resolvePiBin(): string {
  if (process.env.PI_BIN) return process.env.PI_BIN;
  const candidates = [...new Set(
    (process.env.PATH ?? "")
      .split(delimiter)
      .filter(Boolean)
      .map((entry) => join(entry, "pi"))
      .filter(isExecutable),
  )];
  const compatible = candidates.find(supportsFullscreenMode);
  if (compatible) return compatible;
  throw new Error(
    `No Pi executable with --tui-mode was found. Checked: ${candidates.join(", ") || "an empty PATH"}. Set PI_BIN explicitly.`,
  );
}

const piBin = resolvePiBin();
for (const file of expectFiles) {
  const result = spawnSync("expect", [file], {
    stdio: "inherit",
    env: { ...process.env, PI_BIN: piBin },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
