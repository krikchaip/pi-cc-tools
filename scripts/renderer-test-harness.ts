import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initTheme, theme } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";

initTheme("dark", false);

interface RendererHarnessConfig {
  name: string;
  stubTools: string[];
  agentSettings?: Record<string, unknown>;
  piSettings?: Record<string, unknown>;
}

interface RendererHarness {
  fakePi: any;
  theme: typeof theme;
  ToolExecutionComponent: any;
  Container: any;
  tempAgentDir: string;
  tempPiDir: string;
  emitLifecycle(name: string): Promise<void>;
  writeAgentSettings(settings: Record<string, unknown>): void;
  writePiSettings(settings: Record<string, unknown>): void;
}

export async function withRendererHarness(
  config: RendererHarnessConfig,
  run: (harness: RendererHarness) => Promise<void>,
): Promise<void> {
  const realHome = process.env.HOME;
  const realAgentDir = process.env.PI_CODING_AGENT_DIR;
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), `pi-cc-tools-${config.name}-`));
  const tempAgentDir = path.join(tempHome, "agent");
  const tempPiDir = path.join(tempHome, ".pi");
  fs.mkdirSync(tempAgentDir);
  fs.mkdirSync(tempPiDir);

  const writeAgentSettings = (settings: Record<string, unknown>): void => {
    fs.writeFileSync(path.join(tempAgentDir, "settings.json"), JSON.stringify(settings));
  };
  const writePiSettings = (settings: Record<string, unknown>): void => {
    fs.writeFileSync(path.join(tempPiDir, "settings.json"), JSON.stringify(settings));
  };
  writeAgentSettings(config.agentSettings ?? { outputPad: 0 });
  writePiSettings(config.piSettings ?? {
    clickExpansion: true,
    expandedPreviewMaxLines: 10,
    extraExpandedPreviewMaxLines: 15,
  });
  process.env.HOME = tempHome;
  process.env.PI_CODING_AGENT_DIR = tempAgentDir;

  const fakePi = {
    tools: new Map<string, any>(),
    handlers: new Map<string, any[]>(),
    registerTool(definition: any) { this.tools.set(definition.name, definition); },
    registerCommand() {},
    registerShortcut() {},
    on(name: string, handler: any) { this.handlers.set(name, [...(this.handlers.get(name) ?? []), handler]); },
    getThinkingLevel() { return "off"; },
    getAllTools() { return [...this.tools.values()]; },
  };

  for (const name of config.stubTools) {
    fakePi.registerTool({
      name,
      label: name === "mcp" ? "MCP" : name,
      description: name === "mcp" ? "MCP gateway" : name,
      parameters: {},
      async execute() { return { content: [] }; },
    });
  }

  const emitLifecycle = async (name: string): Promise<void> => {
    for (const handler of fakePi.handlers.get(name) ?? []) {
      await handler({}, { hasUI: false });
    }
  };

  try {
    const extension = await import("../extensions/index.ts");
    extension.default(fakePi as any);
    await emitLifecycle("session_start");
    const { ToolExecutionComponent } = await import(
      "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/tool-execution.js"
    );
    const { Container } = await import("../node_modules/@earendil-works/pi-tui/dist/tui.js");
    try {
      await run({
        fakePi,
        theme,
        ToolExecutionComponent,
        Container,
        tempAgentDir,
        tempPiDir,
        emitLifecycle,
        writeAgentSettings,
        writePiSettings,
      });
    } finally {
      await emitLifecycle("agent_end");
      await Promise.resolve();
    }
  } finally {
    if (realHome === undefined) delete process.env.HOME;
    else process.env.HOME = realHome;
    if (realAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = realAgentDir;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
}

export function plain(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

export function assertResultSummaryAnchor(
  fakePi: any,
  name: string,
  result: any,
  expanded: boolean,
  expectedSummary: string,
  ctxOverrides: Record<string, unknown> = {},
): void {
  const definition = fakePi.tools.get(name);
  if (typeof definition?.renderResult !== "function") {
    throw new Error(`${name} renderer was not registered`);
  }
  const component = definition.renderResult(
    result,
    { expanded, isPartial: false },
    theme,
    {
      state: {},
      args: {},
      argsComplete: true,
      cwd: process.cwd(),
      expanded,
      isError: false,
      lastComponent: undefined,
      ...ctxOverrides,
    },
  );
  const rows = component.render(120).map((line: string) => plain(line));
  const semanticRows = component.getSemanticRows?.().map((row: any) => ({ ...row, text: plain(row.text) })) ?? [];
  const summaryIndex = rows.findIndex((line: string) => line.includes(expectedSummary));
  if (summaryIndex < 0) {
    throw new Error(`${name} did not render result summary ${JSON.stringify(expectedSummary)}: ${JSON.stringify(rows)}`);
  }
  if (!semanticRows.some((row: any) => row.line === summaryIndex && row.action === "expand")) {
    throw new Error(`${name} result summary was not a stable expansion anchor: ${JSON.stringify({ rows, semanticRows })}`);
  }
}

export function assertPayloadRowInert(
  fakePi: any,
  name: string,
  result: any,
  expectedPayload: string,
  ctxOverrides: Record<string, unknown> = {},
): void {
  const definition = fakePi.tools.get(name);
  const component = definition.renderResult(
    result,
    { expanded: true, isPartial: false },
    theme,
    { state: {}, args: {}, cwd: process.cwd(), expanded: true, isError: false, lastComponent: undefined, ...ctxOverrides },
  );
  const rows = component.render(120).map((line: string) => plain(line));
  const payloadRow = rows.findIndex((line: string) => line.includes(expectedPayload));
  const semanticRows = component.getSemanticRows?.() ?? [];
  if (payloadRow < 0 || semanticRows.some((row: any) => row.line === payloadRow)) {
    throw new Error(`${name} raw payload row was clickable: ${JSON.stringify({ rows, semanticRows })}`);
  }
}

function indicatorLine(raw: string, anchor: string): string {
  const index = raw.lastIndexOf(anchor);
  if (index < 0) throw new Error(`expansion indicator did not render ${JSON.stringify(anchor)}`);
  const start = raw.lastIndexOf("\n", index) + 1;
  const end = raw.indexOf("\n", index);
  return raw.slice(start, end < 0 ? undefined : end);
}

export function assertCollapsedIndicator(raw: string, anchor: string, checkClosingParenthesis = false): void {
  const line = indicatorLine(raw, anchor);
  const plainLine = plain(line);
  if (!plainLine.includes("to expand") || plainLine.includes("to toggle")) {
    throw new Error(`collapsed expansion indicator did not describe its state: ${JSON.stringify(plainLine)}`);
  }
  if (checkClosingParenthesis) {
    const anchorIndex = line.lastIndexOf(anchor);
    const openingIndex = line.lastIndexOf("(", anchorIndex);
    const closingIndex = line.indexOf(")", anchorIndex);
    const foregroundBefore = (index: number): string | undefined => (
      [...line.slice(0, index).matchAll(/\x1b\[38;(?:2;\d+;\d+;\d+|5;\d+)m/g)].at(-1)?.[0]
    );
    const openingForeground = foregroundBefore(openingIndex);
    const closingForeground = foregroundBefore(closingIndex);
    if (openingIndex < 0 || closingIndex < 0 || !openingForeground || closingForeground !== openingForeground) {
      throw new Error(`expansion indicator closing parenthesis color bled: ${JSON.stringify({ plain: plainLine, openingForeground, closingForeground })}`);
    }
  }
}

export function assertExpandedIndicator(raw: string, anchor: string): void {
  const plainLine = plain(indicatorLine(raw, anchor));
  if (!plainLine.includes("to collapse") || plainLine.includes("to expand") || plainLine.includes("to toggle")) {
    throw new Error(`expanded expansion indicator did not describe its state: ${JSON.stringify(plainLine)}`);
  }
}

export async function waitFor(
  ready: () => boolean,
  description = "asynchronous tool preview rendering",
): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!ready() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  if (!ready()) throw new Error(`timed out waiting for ${description}`);
}
