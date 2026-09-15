import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  initTheme,
  theme,
} from "../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";

initTheme("dark", false);

interface RendererHarnessConfig {
  name: string;
  stubTools: string[];
  agentSettings?: Record<string, unknown>;
  piSettings?: Record<string, unknown>;
  beforeExtension?: (context: {
    fakePi: any;
    ToolExecutionComponent: any;
  }) => void | Promise<void>;
}

export interface RendererViewportFixture {
  height: number;
  scrollTop: number;
  followingEnd: boolean;
  prefixRows?: number;
}

export interface ToolExecutionFixture {
  tool: string;
  id: string;
  args?: Record<string, unknown>;
  state?: Record<string, unknown>;
  definition?: any;
  interaction?: "regular" | "fullscreen";
  ui?: any;
  cwd?: string;
  result?: any;
  isPartial?: boolean;
  started?: boolean;
  argsComplete?: boolean;
  expanded?: boolean;
  viewport?: RendererViewportFixture;
  lockOwnResultRenderer?: boolean;
  retainedCallRendererVersion?: "pre-presentation-kernel";
}

export type RendererActionBehavior =
  "toggle" | "next-detail" | "toggle-max-detail";
export type RendererActionOrigin =
  "execution-header" | "result-summary" | "result-detail";

export interface RendererActionObservation {
  frame: number;
  behavior: RendererActionBehavior;
  origin: RendererActionOrigin;
  viewportAnchor?: string;
  row: number;
  start: number;
  end: number;
  text: string;
}

export interface RendererViewportObservation {
  scrollTop: number;
  height: number;
  followingEnd: boolean;
  subjectTop: number;
  subjectRows: number;
  visibleSubjectRows: number;
}

export interface RendererObservation {
  frame: number;
  rawRows: string[];
  rows: string[];
  text: string;
  actions: RendererActionObservation[];
  viewport?: RendererViewportObservation;
}

export interface RendererSettlementOptions {
  width?: number;
  timeoutMs?: number;
  description?: string;
}

export interface RendererActivationObservation {
  accepted: boolean;
  before: RendererObservation;
  after: RendererObservation;
}

export interface RendererResultUpdateOptions {
  partial?: boolean;
  width?: number;
}

export interface ObservedRenderer {
  observe(width?: number): RendererObservation;
  activate(action: RendererActionObservation): RendererActivationObservation;
  complete(
    result: any,
    options?: Pick<RendererResultUpdateOptions, "width">,
  ): RendererObservation;
  updateResult(
    result: any,
    options?: RendererResultUpdateOptions,
  ): RendererObservation;
  waitFor(
    ready: (observation: RendererObservation) => boolean,
    options?: RendererSettlementOptions,
  ): Promise<RendererObservation>;
}

export interface ObservedToolGroup extends ObservedRenderer {
  setExpanded(expanded: boolean, width?: number): RendererObservation;
  append(fixture: ToolExecutionFixture, width?: number): RendererObservation;
}

interface RendererHarness {
  fakePi: any;
  theme: typeof theme;
  ToolExecutionComponent: any;
  Container: any;
  tempAgentDir: string;
  tempPiDir: string;
  toolExecution(fixture: ToolExecutionFixture): ObservedRenderer;
  toolGroup(fixtures: readonly ToolExecutionFixture[]): ObservedToolGroup;
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
  const tempHome = fs.mkdtempSync(
    path.join(os.tmpdir(), `pi-cc-tools-${config.name}-`),
  );
  const tempAgentDir = path.join(tempHome, "agent");
  const tempPiDir = path.join(tempHome, ".pi");
  fs.mkdirSync(tempAgentDir);
  fs.mkdirSync(tempPiDir);

  const writeAgentSettings = (settings: Record<string, unknown>): void => {
    fs.writeFileSync(
      path.join(tempAgentDir, "settings.json"),
      JSON.stringify(settings),
    );
  };
  const writePiSettings = (settings: Record<string, unknown>): void => {
    fs.writeFileSync(
      path.join(tempPiDir, "settings.json"),
      JSON.stringify(settings),
    );
    const cache = (globalThis as any)[
      Symbol.for("pi-claude-style-tools:settings-cache")
    ];
    if (cache) cache.entry = null;
  };
  writeAgentSettings(config.agentSettings ?? { outputPad: 0 });
  writePiSettings(
    config.piSettings ?? {
      clickExpansion: true,
      expandedPreviewMaxLines: 10,
      extraExpandedPreviewMaxLines: 15,
    },
  );
  process.env.HOME = tempHome;
  process.env.PI_CODING_AGENT_DIR = tempAgentDir;

  const fakePi = {
    tools: new Map<string, any>(),
    commands: new Map<string, any>(),
    handlers: new Map<string, any[]>(),
    registerTool(definition: any) {
      this.tools.set(definition.name, definition);
    },
    registerCommand(name: string, definition: any) {
      this.commands.set(name, definition);
    },
    registerShortcut() {},
    on(name: string, handler: any) {
      this.handlers.set(name, [...(this.handlers.get(name) ?? []), handler]);
    },
    getThinkingLevel() {
      return "off";
    },
    getAllTools() {
      return [...this.tools.values()];
    },
  };

  for (const name of config.stubTools) {
    fakePi.registerTool({
      name,
      label: name === "mcp" ? "MCP" : name,
      description: name === "mcp" ? "MCP gateway" : name,
      parameters: {},
      async execute() {
        return { content: [] };
      },
    });
  }

  const emitLifecycle = async (name: string): Promise<void> => {
    for (const handler of fakePi.handlers.get(name) ?? []) {
      await handler({}, { hasUI: false });
    }
  };

  try {
    const { ToolExecutionComponent } =
      await import("../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/tool-execution.js");
    await config.beforeExtension?.({ fakePi, ToolExecutionComponent });
    const extension = await import("../../extensions/index.ts");
    extension.default(fakePi as any);
    await emitLifecycle("session_start");
    const { Container } =
      await import("../../node_modules/@earendil-works/pi-tui/dist/tui.js");
    const createToolExecution = (fixture: ToolExecutionFixture): any => {
      const definition = fixture.definition ?? fakePi.tools.get(fixture.tool);
      if (!definition)
        throw new Error(`${fixture.tool} renderer was not registered`);
      const component = new ToolExecutionComponent(
        fixture.tool,
        fixture.id,
        fixture.args ?? {},
        fixture.state ?? {},
        definition,
        fixture.ui ?? {
          ...(fixture.interaction === "fullscreen"
            ? { mode: "fullscreen" }
            : {}),
          requestRender() {},
        },
        fixture.cwd ?? process.cwd(),
      );
      if (fixture.started !== false) component.markExecutionStarted();
      if (fixture.argsComplete !== false) component.setArgsComplete();
      if (fixture.retainedCallRendererVersion === "pre-presentation-kernel") {
        const retained = (component as any).callRendererComponent;
        if (retained) {
          Object.defineProperty(retained, "getPresentationSurface", {
            configurable: true,
            value: undefined,
          });
        }
      }
      if (fixture.result !== undefined)
        component.updateResult(fixture.result, fixture.isPartial ?? false);
      if (fixture.expanded !== undefined)
        component.setExpanded(fixture.expanded);
      if (fixture.lockOwnResultRenderer) {
        Object.defineProperty(component, "getResultRenderer", {
          configurable: false,
          enumerable: false,
          writable: false,
          value(this: any): any {
            return this.toolDefinition?.renderResult;
          },
        });
      }
      return component;
    };
    const toolExecution = (fixture: ToolExecutionFixture): ObservedRenderer => {
      const component = createToolExecution(fixture);
      return observeRenderer(
        component,
        component,
        fixture.viewport
          ? createViewportObservationAdapter(component, fixture.viewport)
          : undefined,
      );
    };
    const toolGroup = (
      fixtures: readonly ToolExecutionFixture[],
    ): ObservedToolGroup => {
      if (fixtures.length < 2)
        throw new Error(
          "a renderer tool group requires at least two executions",
        );
      const parent = new Container();
      for (const fixture of fixtures)
        parent.addChild(createToolExecution(fixture));
      const children = (parent as any).children;
      const group = children?.[0];
      if (
        children?.length !== 1 ||
        group?.constructor?.name !== "ToolGroupComponent"
      ) {
        throw new Error(
          `Pi host did not form the requested renderer tool group: ${JSON.stringify(
            {
              parent: parent.constructor?.name,
              addChild: parent.addChild?.name,
              children: Array.isArray(children)
                ? children.map((child: any) => child?.constructor?.name)
                : typeof children,
              tools: fixtures.map((fixture) => fixture.tool),
            },
          )}`,
        );
      }
      const observed = observeRenderer(parent, group);
      return {
        ...observed,
        setExpanded(expanded: boolean, width?: number): RendererObservation {
          group.setExpanded(expanded);
          return observed.observe(width);
        },
        append(
          fixture: ToolExecutionFixture,
          width?: number,
        ): RendererObservation {
          parent.addChild(createToolExecution(fixture));
          return observed.observe(width);
        },
      };
    };
    try {
      await run({
        fakePi,
        theme,
        ToolExecutionComponent,
        Container,
        tempAgentDir,
        tempPiDir,
        toolExecution,
        toolGroup,
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

interface ViewportObservationAdapter {
  activate<T>(run: () => T, width: number): T;
  observe(subjectRows: number): RendererViewportObservation;
}

function createViewportObservationAdapter(
  component: any,
  fixture: RendererViewportFixture,
): ViewportObservationAdapter {
  const prefixRows = fixture.prefixRows ?? 0;
  const history = {
    render: () => Array.from({ length: prefixRows }, () => "history"),
  };
  const documentContainer = {
    render: (width: number) => [
      ...history.render(),
      ...component.render(width),
    ],
  };
  const scrollView = {
    scrollTop: fixture.scrollTop,
    viewportHeight: fixture.height,
    isFollowingEnd: fixture.followingEnd,
    scrollTo(target: number, options?: { disableFollow?: boolean }) {
      this.scrollTop = Math.max(0, target);
      if (options?.disableFollow !== undefined)
        this.isFollowingEnd = !options.disableFollow;
    },
  };
  const layoutBox = {
    component: documentContainer,
    rect: { x: 0, y: 0, width: 120, height: fixture.height },
    clip: { x: 0, y: 0, width: 120, height: fixture.height },
    children: [],
  };
  const renderer = {
    currentLayout: { root: layoutBox, primaryScrollView: scrollView },
    requestRender() {},
    renderNow() {},
  };
  const mode = {
    renderer,
    ui: {},
    documentContainer,
    headerContainer: { render: () => [] },
    loadedResourcesContainer: { render: () => [] },
    chatContainer: { children: [history, component] },
  };

  return {
    activate<T>(run: () => T, width: number): T {
      layoutBox.rect.width = width;
      layoutBox.clip.width = width;
      const runtime = (globalThis as any)[
        Symbol.for("pi-claude-style-tools:click-runtime")
      ];
      if (!runtime)
        throw new Error("click-expansion runtime was not installed");
      const previousMode = runtime.activeInteractiveMode;
      runtime.activeInteractiveMode = mode;
      try {
        return run();
      } finally {
        runtime.activeInteractiveMode = previousMode;
      }
    },
    observe(subjectRows: number): RendererViewportObservation {
      const visibleStart = Math.max(prefixRows, scrollView.scrollTop);
      const visibleEnd = Math.min(
        prefixRows + subjectRows,
        scrollView.scrollTop + scrollView.viewportHeight,
      );
      return {
        scrollTop: scrollView.scrollTop,
        height: scrollView.viewportHeight,
        followingEnd: scrollView.isFollowingEnd,
        subjectTop: prefixRows,
        subjectRows,
        visibleSubjectRows: Math.max(0, visibleEnd - visibleStart),
      };
    },
  };
}

export function observeRenderer(
  component: any,
  actionTarget = component,
  viewportAdapter?: ViewportObservationAdapter,
): ObservedRenderer {
  let width = 120;
  let frame = 0;
  let latest: RendererObservation | undefined;
  const compatibilityActions = new WeakMap<RendererActionObservation, string>();

  const observe = (nextWidth = width): RendererObservation => {
    width = nextWidth;
    frame += 1;
    const rawRows = component.render(width);
    const rows = rawRows.map((line: string) => plain(line));
    const actions: RendererActionObservation[] = [];

    for (let row = 0; row < rawRows.length; row++) {
      let active: RendererActionObservation | undefined;
      for (let x = 0; x <= width; x++) {
        const anchor =
          x < width ? actionTarget.clickAnchorAtPoint?.(x, row) : undefined;
        const fallbackAction =
          x < width ? actionTarget.clickActionAtPoint?.(x, row) : undefined;
        const action =
          typeof anchor?.action === "string"
            ? anchor.action
            : typeof fallbackAction === "string"
              ? fallbackAction
              : undefined;
        const behavior: RendererActionBehavior | undefined =
          action === "detail"
            ? "next-detail"
            : action === "detail-extra"
              ? "toggle-max-detail"
              : action === "header" || action === "expand"
                ? "toggle"
                : undefined;
        const origin: RendererActionOrigin | undefined =
          action === "header"
            ? "execution-header"
            : action === "expand"
              ? "result-summary"
              : action === "detail" || action === "detail-extra"
                ? "result-detail"
                : undefined;
        if (action && (!behavior || !origin)) {
          throw new Error(
            `unsupported renderer click action ${JSON.stringify(action)} at row ${row}, column ${x}`,
          );
        }
        const viewportAnchor =
          typeof anchor?.viewportAnchor === "string"
            ? anchor.viewportAnchor
            : undefined;
        if (
          behavior &&
          origin &&
          active?.behavior === behavior &&
          active.origin === origin &&
          active.viewportAnchor === viewportAnchor &&
          compatibilityActions.get(active) === action
        ) {
          active.end = x + 1;
          continue;
        }
        if (active) actions.push(active);
        active =
          behavior && origin
            ? {
                frame,
                behavior,
                origin,
                viewportAnchor,
                row,
                start: x,
                end: x + 1,
                text: rows[row] ?? "",
              }
            : undefined;
        if (active && action) compatibilityActions.set(active, action);
      }
    }

    latest = {
      frame,
      rawRows,
      rows,
      text: rows.join("\n"),
      actions,
      viewport: viewportAdapter?.observe(rows.length),
    };
    return latest;
  };

  const activate = (
    selected: RendererActionObservation,
  ): RendererActivationObservation => {
    const before = latest ?? observe(width);
    if (selected.frame !== before.frame) {
      throw new Error(
        `renderer action belongs to stale frame ${selected.frame}; latest frame is ${before.frame}`,
      );
    }
    const compatibilityAction = compatibilityActions.get(selected);
    if (!compatibilityAction)
      throw new Error(
        "renderer action does not belong to this observation adapter",
      );
    const dispatch = (): boolean => {
      if (typeof actionTarget.activateClickAction === "function") {
        return (
          actionTarget.activateClickAction(
            compatibilityAction,
            selected.viewportAnchor,
          ) === true
        );
      }
      if (typeof actionTarget.toggleToolAtPoint === "function") {
        return (
          actionTarget.toggleToolAtPoint(selected.start, selected.row) === true
        );
      }
      return false;
    };
    const accepted = viewportAdapter
      ? viewportAdapter.activate(dispatch, width)
      : dispatch();
    latest = undefined;
    return { accepted, before, after: observe(width) };
  };

  const complete = (
    result: any,
    options: Pick<RendererResultUpdateOptions, "width"> = {},
  ): RendererObservation => {
    if (
      typeof component.setArgsComplete !== "function" ||
      typeof component.updateResult !== "function"
    ) {
      throw new Error(
        "renderer observation does not support execution completion",
      );
    }
    component.setArgsComplete();
    component.updateResult(result, false);
    latest = undefined;
    return observe(options.width ?? width);
  };

  const updateResult = (
    result: any,
    options: RendererResultUpdateOptions = {},
  ): RendererObservation => {
    if (typeof component.updateResult !== "function") {
      throw new Error("renderer observation does not support result updates");
    }
    component.updateResult(result, options.partial ?? false);
    latest = undefined;
    return observe(options.width ?? width);
  };

  const waitForObservation = async (
    ready: (observation: RendererObservation) => boolean,
    options: RendererSettlementOptions = {},
  ): Promise<RendererObservation> => {
    const deadline = Date.now() + (options.timeoutMs ?? 5000);
    let observation = observe(options.width ?? width);
    while (!ready(observation) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      observation = observe(options.width ?? width);
    }
    if (!ready(observation)) {
      throw new Error(
        `timed out waiting for ${options.description ?? "renderer observation settlement"}: ${JSON.stringify(observation.rows)}`,
      );
    }
    return observation;
  };

  return {
    observe,
    activate,
    complete,
    updateResult,
    waitFor: waitForObservation,
  };
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
  const semanticRows =
    component
      .getSemanticRows?.()
      .map((row: any) => ({ ...row, text: plain(row.text) })) ?? [];
  const summaryIndex = rows.findIndex((line: string) =>
    line.includes(expectedSummary),
  );
  if (summaryIndex < 0) {
    throw new Error(
      `${name} did not render result summary ${JSON.stringify(expectedSummary)}: ${JSON.stringify(rows)}`,
    );
  }
  if (
    !semanticRows.some(
      (row: any) => row.line === summaryIndex && row.action === "expand",
    )
  ) {
    throw new Error(
      `${name} result summary was not a stable expansion anchor: ${JSON.stringify({ rows, semanticRows })}`,
    );
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
    {
      state: {},
      args: {},
      cwd: process.cwd(),
      expanded: true,
      isError: false,
      lastComponent: undefined,
      ...ctxOverrides,
    },
  );
  const rows = component.render(120).map((line: string) => plain(line));
  const payloadRow = rows.findIndex((line: string) =>
    line.includes(expectedPayload),
  );
  const semanticRows = component.getSemanticRows?.() ?? [];
  if (
    payloadRow < 0 ||
    semanticRows.some((row: any) => row.line === payloadRow)
  ) {
    throw new Error(
      `${name} raw payload row was clickable: ${JSON.stringify({ rows, semanticRows })}`,
    );
  }
}

function indicatorLine(raw: string, anchor: string): string {
  const index = raw.lastIndexOf(anchor);
  if (index < 0)
    throw new Error(
      `expansion indicator did not render ${JSON.stringify(anchor)}`,
    );
  const start = raw.lastIndexOf("\n", index) + 1;
  const end = raw.indexOf("\n", index);
  return raw.slice(start, end < 0 ? undefined : end);
}

export function assertCollapsedIndicator(
  raw: string,
  anchor: string,
  checkClosingParenthesis = false,
): void {
  const line = indicatorLine(raw, anchor);
  const plainLine = plain(line);
  if (!plainLine.includes("to expand") || plainLine.includes("to toggle")) {
    throw new Error(
      `collapsed expansion indicator did not describe its state: ${JSON.stringify(plainLine)}`,
    );
  }
  if (checkClosingParenthesis) {
    const anchorIndex = line.lastIndexOf(anchor);
    const openingIndex = line.lastIndexOf("(", anchorIndex);
    const closingIndex = line.indexOf(")", anchorIndex);
    const foregroundBefore = (index: number): string | undefined =>
      [
        ...line.slice(0, index).matchAll(/\x1b\[38;(?:2;\d+;\d+;\d+|5;\d+)m/g),
      ].at(-1)?.[0];
    const openingForeground = foregroundBefore(openingIndex);
    const closingForeground = foregroundBefore(closingIndex);
    if (
      openingIndex < 0 ||
      closingIndex < 0 ||
      !openingForeground ||
      closingForeground !== openingForeground
    ) {
      throw new Error(
        `expansion indicator closing parenthesis color bled: ${JSON.stringify({ plain: plainLine, openingForeground, closingForeground })}`,
      );
    }
  }
}

export function assertExpandedIndicator(raw: string, anchor: string): void {
  const plainLine = plain(indicatorLine(raw, anchor));
  if (
    !plainLine.includes("to collapse") ||
    plainLine.includes("to expand") ||
    plainLine.includes("to toggle")
  ) {
    throw new Error(
      `expanded expansion indicator did not describe its state: ${JSON.stringify(plainLine)}`,
    );
  }
}

export async function waitFor(
  ready: () => boolean,
  description = "asynchronous tool preview rendering",
): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!ready() && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 20));
  if (!ready()) throw new Error(`timed out waiting for ${description}`);
}
