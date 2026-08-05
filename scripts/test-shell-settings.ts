import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(tmpdir(), `pi-cc-tools-shell-settings-${process.pid}`);
const agentDir = join(root, "agent");
const cwd = join(root, "project");
const shellPath = join(root, "configured-bash");
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const originalCwd = process.cwd();

mkdirSync(agentDir, { recursive: true });
mkdirSync(cwd, { recursive: true });
writeFileSync(
  shellPath,
  `#!/bin/sh\nprintf 'configured-shell\\n'\nexec /bin/bash "$@"\n`,
);
chmodSync(shellPath, 0o755);
writeFileSync(
  join(agentDir, "settings.json"),
  JSON.stringify({ shellPath }, null, 2),
);

process.env.PI_CODING_AGENT_DIR = agentDir;
process.chdir(cwd);

try {
  const createFakePi = () => {
    const tools = new Map<string, any>();
    return {
      tools,
      api: {
        registerTool(tool: any) {
          tools.set(tool.name, tool);
        },
        registerCommand() {},
        registerShortcut() {},
        on() {},
        getThinkingLevel() {
          return "off";
        },
        getAllTools() {
          return [...tools.values()];
        },
      },
    };
  };
  const executeBash = async (tools: Map<string, any>) => {
    const bash = tools.get("bash");
    if (!bash) throw new Error("plugin did not register its bash tool");
    const result = await bash.execute(
      "shell-settings-regression",
      { command: "printf 'command-body\\n'" },
      undefined,
      undefined,
    );
    return result.content?.[0]?.text;
  };

  const extension = await import("../extensions/index.ts");

  const configured = createFakePi();
  extension.default(configured.api as any);
  const configuredOutput = await executeBash(configured.tools);
  const configuredExpected = "configured-shell\ncommand-body\n";
  if (configuredOutput !== configuredExpected) {
    throw new Error(
      `plugin bash tool ignored Pi shellPath\nexpected: ${JSON.stringify(configuredExpected)}\nactual:   ${JSON.stringify(configuredOutput)}`,
    );
  }
  console.log("OK  bash tool respects Pi shellPath");

  const defaultAgentDir = join(root, "default-agent");
  const defaultCwd = join(root, "default-project");
  mkdirSync(defaultAgentDir, { recursive: true });
  mkdirSync(defaultCwd, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = defaultAgentDir;
  process.chdir(defaultCwd);

  const fallback = createFakePi();
  extension.default(fallback.api as any);
  const fallbackOutput = await executeBash(fallback.tools);
  const fallbackExpected = "command-body\n";
  if (fallbackOutput !== fallbackExpected) {
    throw new Error(
      `plugin changed Pi's default shell fallback\nexpected: ${JSON.stringify(fallbackExpected)}\nactual:   ${JSON.stringify(fallbackOutput)}`,
    );
  }
  console.log("OK  bash tool preserves Pi's default shell fallback");
} finally {
  process.chdir(originalCwd);
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  rmSync(root, { recursive: true, force: true });
}
