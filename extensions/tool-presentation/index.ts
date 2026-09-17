import type {
  DiffEvidence,
  DiffPresentationModule,
  DiffPresentationRequest,
  DiffPresentationSnapshot,
  DiffSource,
} from "../diff-presentation/index.ts";
import type {
  PresentationPaletteRequest,
  SemanticCallPresentation,
  SemanticDetail,
  SemanticPresentation,
  SemanticResultPresentation,
  SemanticSummary,
  SemanticText,
} from "../presentation-kernel/index.ts";

export type ToolFamily = "tool-native" | "openai" | "mcp" | "mutation";
export type PresentationToolFamily = Exclude<ToolFamily, "mutation">;
export type MutationToolName = "write" | "edit" | "apply_patch";

export interface ToolIdentity {
  readonly family: PresentationToolFamily;
  readonly name: string;
  readonly label: string;
}

export interface ToolLifecycleSnapshot {
  readonly status: SemanticCallPresentation["status"];
  readonly activity?: SemanticCallPresentation["activity"];
  readonly partial: boolean;
  readonly argsComplete: boolean;
  readonly liveLineCount?: number;
  readonly elapsedMs?: number;
}

export interface ToolResultBlock {
  readonly type: string;
  readonly text?: string;
  readonly data?: string;
  readonly mimeType?: string;
}

export interface ToolResultSnapshot {
  readonly content: readonly ToolResultBlock[];
  readonly details?: unknown;
  readonly error: boolean;
  readonly partial: boolean;
}

export interface ToolPresentationPolicy {
  readonly outputMode?: "hidden" | "summary" | "preview";
  readonly patchFiles?: readonly string[];
  readonly preserveBlankLines?: boolean;
  readonly bashRewrite?: RtkRewriteRecord;
  readonly showCallDetail?: boolean;
  readonly showCollapsedResultDetail?: boolean;
}

interface ToolPresentationRequestBase {
  readonly tool: ToolIdentity;
  readonly cwd: string;
  readonly args: unknown;
  readonly lifecycle: ToolLifecycleSnapshot;
  readonly policy?: ToolPresentationPolicy;
}

export type ToolPresentationRequest =
  | Readonly<
      ToolPresentationRequestBase & {
        surface: "call";
      }
    >
  | Readonly<
      ToolPresentationRequestBase & {
        surface: "result";
        result: ToolResultSnapshot;
      }
    >;

export interface ToolMutationCaptureRequest {
  readonly surface: "mutation-capture";
  readonly tool: Readonly<{ family: "mutation"; name: MutationToolName }>;
  readonly cwd: string;
  readonly args: unknown;
  readonly before?: string | null;
}

export interface ToolMutationPresentationRequest {
  readonly surface: "mutation-presentation";
  readonly tool: Readonly<{ family: "mutation"; name: MutationToolName }>;
  readonly phase: "call" | "result";
  readonly cwd: string;
  readonly args: unknown;
  readonly evidence?: unknown;
  readonly resultDetails?: unknown;
  readonly request: Omit<
    DiffPresentationRequest,
    "surface" | "source" | "evidence"
  >;
}

export interface ToolOutputCollection {
  readonly text: string;
  readonly lines: readonly string[];
  readonly total: number;
}

export interface ToolPresentationMetadata {
  readonly output?: ToolOutputCollection;
  readonly bash?: Readonly<{
    command: BashCommandPresentation;
    duration?: string;
    lastOutputLine?: string;
  }>;
  readonly sideQuest?: SideQuestPresentation &
    Readonly<{ label: "Spawned" | "Resumed" | "Answered" | "Steered" }>;
}

export type ToolPresentationDecision =
  | Readonly<{
      kind: "present";
      presentation: SemanticPresentation;
      metadata?: ToolPresentationMetadata;
    }>
  | Readonly<{
      kind: "suppress";
      reason: "mutation-call-owns-companion-result" | "policy-hidden";
    }>;

export interface BashCommandPresentation {
  readonly headline: string;
  readonly sourceLines: readonly string[];
  readonly sourceLineCount: number;
}

export interface RtkRewriteRecord {
  readonly original: string;
  readonly rewritten: string;
  readonly notice: string;
}

export type SideQuestResultStatus =
  "spawned" | "resumed" | "answered" | "steered";

export interface SideQuestPresentation {
  readonly version: 1;
  readonly surface: "agent";
  readonly resultStatus: SideQuestResultStatus;
  readonly statuses: readonly string[];
}

export interface ToolMutationPresentationDecision {
  readonly kind: "mutation";
  readonly snapshot: DiffPresentationSnapshot;
}

export interface ToolPresentationDependencies {
  readonly mutations?: Pick<DiffPresentationModule, "capture" | "present">;
}

export interface ToolPresentationModule {
  present(request: ToolPresentationRequest): ToolPresentationDecision;
  present(
    request: ToolMutationCaptureRequest,
  ): Promise<DiffEvidence | undefined>;
  present(
    request: ToolMutationPresentationRequest,
  ): ToolMutationPresentationDecision;
}

interface FamilyPresentationAdapter {
  readonly family: PresentationToolFamily;
  present(request: ToolPresentationRequest): ToolPresentationDecision;
}

interface MutationPresentationAdapter {
  capture(
    request: ToolMutationCaptureRequest,
  ): Promise<DiffEvidence | undefined>;
  present(
    request: ToolMutationPresentationRequest,
  ): ToolMutationPresentationDecision;
}

const NATIVE_TITLES: Readonly<Record<string, string>> = Object.freeze({
  read: "Read",
  bash: "Bash",
  grep: "Grep",
  find: "Find",
  ls: "List",
});

const CONTROL_CHAR_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
const ANSI_ESCAPE_RE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g;
const BASH_HEADLINE_SKIP_RE =
  /^(?:#|set(?:\s|$)|cd(?:\s|$)|(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=|(?:\{|\}|do|done|then|fi|esac)$)/;

function normalizeBashHeadline(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

function summarizeBash(text: string, max = 180): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 3))}...`;
}

function bashCommand(command: string): BashCommandPresentation {
  const sourceLines = command
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_CHAR_RE, "")
    .replace(/\t/g, "   ")
    .split("\n");
  while (sourceLines.length > 1 && sourceLines[0].trim() === "")
    sourceLines.shift();
  while (sourceLines.length > 1 && sourceLines.at(-1)?.trim() === "")
    sourceLines.pop();
  const nonBlank = sourceLines.map(normalizeBashHeadline).filter(Boolean);
  const operative =
    nonBlank.find((line) => !BASH_HEADLINE_SKIP_RE.test(line)) ??
    nonBlank[0] ??
    "command";
  let headline = summarizeBash(operative);
  if (sourceLines.length > 1) headline += ` · ${sourceLines.length} lines`;
  return { headline, sourceLines, sourceLineCount: sourceLines.length };
}

function formatBashDuration(ms: number): string {
  const safeMs = Math.max(0, Number.isFinite(ms) ? ms : 0);
  if (safeMs < 1_000) return "<1s";
  const totalSeconds = Math.floor(safeMs / 1_000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60)
    return `${totalMinutes}m ${String(seconds).padStart(2, "0")}s`;
  const hours = Math.floor(totalMinutes / 60);
  return `${hours}h ${String(totalMinutes % 60).padStart(2, "0")}m`;
}

function lastBashOutputLine(output: string): string | undefined {
  const lines = output.replace(/\r\n?/g, "\n").split("\n");
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index]
      .replace(ANSI_ESCAPE_RE, "")
      .replace(CONTROL_CHAR_RE, "")
      .trim();
    if (line) return line;
  }
  return undefined;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function sideQuestPresentation(
  value: unknown,
): SideQuestPresentation | undefined {
  const source = record(value);
  const directDetails = record(source.details);
  const nestedDetails = record(record(source.result).details);
  const details =
    Object.keys(directDetails).length > 0 ? directDetails : nestedDetails;
  const presentation = record(details.sideQuestPresentation);
  if (
    presentation.version !== 1 ||
    presentation.surface !== "agent" ||
    !Array.isArray(presentation.statuses) ||
    !presentation.statuses.every((status) => typeof status === "string")
  )
    return undefined;

  const reported = presentation.resultStatus;
  let resultStatus: SideQuestResultStatus | undefined;
  if (
    reported === "spawned" ||
    reported === "resumed" ||
    reported === "answered" ||
    reported === "steered"
  ) {
    resultStatus = reported;
  } else if (details.continuationKind === "answer") resultStatus = "answered";
  else if (details.operation === "continued") resultStatus = "steered";
  else if (details.operation === "reopened") resultStatus = "resumed";
  else if (details.operation === "launched") resultStatus = "spawned";
  if (!resultStatus) return undefined;
  return {
    version: 1,
    surface: "agent",
    resultStatus,
    statuses: presentation.statuses as string[],
  };
}

function sideQuestResultLabel(
  presentation: SideQuestPresentation,
): "Spawned" | "Resumed" | "Answered" | "Steered" {
  if (presentation.resultStatus === "answered") return "Answered";
  if (presentation.resultStatus === "resumed") return "Resumed";
  if (presentation.resultStatus === "steered") return "Steered";
  return "Spawned";
}

function stringArg(args: unknown, ...keys: string[]): string {
  const values = record(args);
  for (const key of keys) {
    const value = values[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function rawStringArg(args: unknown, key: string): string {
  const value = record(args)[key];
  return typeof value === "string" ? value : "";
}

function summarize(text: string, max = 72): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 3))}...`;
}

function stringArrayArg(args: unknown, ...keys: string[]): string[] {
  const values = record(args);
  for (const key of keys) {
    const value = values[key];
    if (Array.isArray(value)) {
      return value.filter(
        (item): item is string => typeof item === "string" && item.length > 0,
      );
    }
  }
  return [];
}

function textContent(result: unknown): string {
  const content = record(result).content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (block): block is ToolResultBlock & { readonly text: string } =>
        record(block).type === "text" && typeof record(block).text === "string",
    )
    .map((block) => block.text)
    .join("\n")
    .replace(/\r\n?/g, "\n");
}

function collectOutput(
  result: unknown,
  options: Readonly<{ tailLimit?: number; preserveBlankLines?: boolean }> = {},
): ToolOutputCollection {
  const text = textContent(result);
  if (text.length === 0) return { text, lines: [], total: 0 };
  const keepTail =
    typeof options.tailLimit === "number" && Number.isFinite(options.tailLimit);
  const limit = keepTail ? Math.max(0, Math.floor(options.tailLimit ?? 0)) : 0;
  const lines: string[] = [];
  let total = 0;
  for (const line of text.split("\n")) {
    if (options.preserveBlankLines !== true && line.trim().length === 0)
      continue;
    total++;
    if (!keepTail) lines.push(line);
    else if (limit > 0) {
      if (lines.length === limit) lines.shift();
      lines.push(line);
    }
  }
  return { text, lines, total };
}

function outputLines(result: ToolResultSnapshot): readonly string[] {
  return collectOutput(result, { preserveBlankLines: true }).lines;
}

function resultWasTruncated(result: ToolResultSnapshot): boolean {
  const truncation = record(record(result.details).truncation);
  return truncation.truncated === true;
}

function detail(
  lines: readonly string[],
  tone: "accent" | "dim" | "error" | "muted" = "dim",
): SemanticDetail {
  return {
    rows: lines.map((line) => ({
      content: [{ text: line, tone }],
    })),
    totalRows: lines.length,
  };
}

interface CallPresentationOptions {
  readonly titleTone?: SemanticCallPresentation["titleTone"];
  readonly detail?: SemanticDetail;
  readonly metadata?: ToolPresentationMetadata;
  readonly subjectOverflow?: SemanticCallPresentation["subjectOverflow"];
}

function callPresentation(
  request: Extract<ToolPresentationRequest, { readonly surface: "call" }>,
  title: string,
  subject?: SemanticText,
  options: CallPresentationOptions = {},
): ToolPresentationDecision {
  const liveLineCount = request.lifecycle.liveLineCount;
  const fullSubject: SemanticText = [
    ...(subject ?? []),
    ...(typeof liveLineCount === "number" && liveLineCount > 0
      ? [
          {
            text: `${subject?.length ? " " : ""}(${liveLineCount} ${liveLineCount === 1 ? "line" : "lines"})`,
            tone: "muted" as const,
          },
        ]
      : []),
  ];
  return {
    kind: "present",
    presentation: {
      surface: "call",
      title,
      ...(options.titleTone ? { titleTone: options.titleTone } : {}),
      ...(fullSubject.length > 0 ? { subject: fullSubject } : {}),
      status: request.lifecycle.status,
      ...(request.lifecycle.activity
        ? { activity: request.lifecycle.activity }
        : {}),
      ...(options.detail ? { detail: options.detail } : {}),
      ...(options.subjectOverflow
        ? { subjectOverflow: options.subjectOverflow }
        : {}),
    },
    ...(options.metadata ? { metadata: options.metadata } : {}),
  };
}

function resultPresentation(
  request: Extract<ToolPresentationRequest, { readonly surface: "result" }>,
  presentation: Omit<SemanticResultPresentation, "surface" | "outcome">,
): ToolPresentationDecision {
  const output = collectOutput(request.result, {
    preserveBlankLines: request.policy?.preserveBlankLines,
  });
  const sideQuest =
    request.tool.name === "Agent"
      ? sideQuestPresentation({ details: request.result.details })
      : undefined;
  return {
    kind: "present",
    presentation: {
      surface: "result",
      outcome: request.result.error ? "error" : "success",
      ...presentation,
    },
    metadata: {
      output,
      ...(request.tool.name === "bash"
        ? {
            bash: {
              command: bashCommand(rawStringArg(request.args, "command")),
              lastOutputLine: lastBashOutputLine(output.text),
            },
          }
        : {}),
      ...(sideQuest
        ? {
            sideQuest: { ...sideQuest, label: sideQuestResultLabel(sideQuest) },
          }
        : {}),
    },
  };
}

function readSkillName(args: unknown): string | undefined {
  const parts = stringArg(args, "path", "file_path")
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean);
  return parts.at(-1) === "SKILL.md" ? (parts.at(-2) ?? "SKILL.md") : undefined;
}

function nativeCallSubject(
  name: string,
  args: unknown,
): SemanticText | undefined {
  if (name === "grep" || name === "find") {
    const pattern = summarize(stringArg(args, "pattern"), 40);
    const path = stringArg(args, "path");
    const text = `${pattern ? `"${pattern}"` : ""}${path ? ` in ${path}` : ""}`;
    return text ? [{ text, tone: "accent" }] : undefined;
  }
  if (name === "read") {
    const values = record(args);
    const path = stringArg(args, "path", "file_path");
    const ranges = [
      values.offset ? `offset=${String(values.offset)}` : "",
      values.limit ? `limit=${String(values.limit)}` : "",
    ].filter(Boolean);
    return path
      ? [
          { text: path, tone: "accent" },
          ...(ranges.length > 0
            ? [{ text: ` (${ranges.join(", ")})`, tone: "muted" as const }]
            : []),
        ]
      : undefined;
  }
  if (name === "ls") {
    return [{ text: stringArg(args, "path") || ".", tone: "accent" }];
  }
  return undefined;
}

const nativeAdapter: FamilyPresentationAdapter = Object.freeze({
  family: "tool-native",
  present(request: ToolPresentationRequest) {
    const title = NATIVE_TITLES[request.tool.name];
    if (!title) {
      throw new TypeError(
        `Invalid tool-native presentation name: ${request.tool.name}`,
      );
    }
    if (request.surface === "call") {
      if (request.tool.name !== "bash") {
        const skillName =
          request.tool.name === "read"
            ? readSkillName(request.args)
            : undefined;
        return callPresentation(
          request,
          skillName ? "[skill]" : request.tool.label || title,
          skillName
            ? [{ text: skillName, tone: "message-text" }]
            : nativeCallSubject(request.tool.name, request.args),
          skillName ? { titleTone: "message-label" } : undefined,
        );
      }
      const command = bashCommand(rawStringArg(request.args, "command"));
      const showDetail = request.policy?.showCallDetail === true;
      const rewrite = request.policy?.bashRewrite;
      const subject: SemanticText = [
        {
          text: showDetail
            ? command.sourceLineCount === 1
              ? "command"
              : `script · ${command.sourceLineCount} lines`
            : command.headline,
          tone: "accent",
        },
        ...(rewrite ? [{ text: " (RTK)", tone: "muted" as const }] : []),
        ...(typeof request.lifecycle.elapsedMs === "number"
          ? [
              {
                text: ` · ${formatBashDuration(request.lifecycle.elapsedMs)}`,
                tone: "muted" as const,
              },
            ]
          : []),
      ];
      return callPresentation(request, title, subject, {
        detail: showDetail
          ? detail(command.sourceLines, "muted")
          : undefined,
        metadata: {
          bash: {
            command,
            ...(typeof request.lifecycle.elapsedMs === "number"
              ? { duration: formatBashDuration(request.lifecycle.elapsedMs) }
              : {}),
          },
        },
        subjectOverflow: "truncate-end",
      });
    }

    const output = outputLines(request.result);
    const lines =
      request.tool.name === "grep" ||
      request.tool.name === "find" ||
      request.tool.name === "ls" ||
      (request.tool.name === "bash" &&
        request.policy?.preserveBlankLines !== true)
        ? output.filter((line) => line.trim().length > 0)
        : output;
    if (request.tool.name === "read") {
      const truncated = resultWasTruncated(request.result);
      return resultPresentation(request, {
        summary: truncated
          ? {
              text: [
                { text: `${lines.length} lines loaded`, tone: "muted" },
                { text: " (truncated)", tone: "warning" },
              ],
              expandable: true,
            }
          : {
              count: lines.length,
              unit: { one: "lines", other: "lines" },
              label: "loaded",
              expandable: true,
            },
        detail: detail(lines, request.result.error ? "error" : "dim"),
      });
    }
    if (request.tool.name === "bash") {
      const exitMatch = textContent(request.result).match(/exit code: (\d+)/);
      const exitCode = exitMatch ? Number.parseInt(exitMatch[1], 10) : 0;
      const rewrite = request.policy?.bashRewrite;
      const rewriteRows = rewrite
        ? [
            { content: [{ text: "RTK rewrite", tone: "muted" as const }] },
            {
              content: [
                { text: "original :", tone: "muted" as const },
                { text: " ", tone: "plain" as const },
                { text: rewrite.original, tone: "dim" as const },
              ],
            },
            {
              content: [
                { text: "rewritten:", tone: "muted" as const },
                { text: " ", tone: "plain" as const },
                { text: rewrite.rewritten, tone: "dim" as const },
              ],
            },
          ]
        : [];
      const outputRows =
        lines.length > 0
          ? detail(lines, request.result.error ? "error" : "dim").rows
          : [{ content: [{ text: "(no output)", tone: "muted" as const }] }];
      const rows = [...rewriteRows, ...outputRows];
      return resultPresentation(request, {
        summary: {
          text: [
            {
              text:
                request.result.error || exitCode !== 0
                  ? `Exit ${exitCode}`
                  : "Done",
              tone:
                request.result.error || exitCode !== 0 ? "error" : "success",
            },
            {
              text: ` (${lines.length} lines)`,
              tone: "muted",
            },
            ...(resultWasTruncated(request.result)
              ? [{ text: " [truncated]", tone: "warning" as const }]
              : []),
          ],
          expandable: lines.length > 0 || rewriteRows.length > 0,
        },
        detail: {
          rows,
          totalRows: rows.length,
          ...(rewriteRows.length > 0 ? { pinnedRows: rewriteRows.length } : {}),
        },
        ...(request.policy?.showCollapsedResultDetail
          ? { collapsedDetailPreview: "tail" as const }
          : {}),
      });
    }

    const labels: Readonly<
      Record<string, Readonly<{ one: string; other: string; empty: string }>>
    > = {
      grep: { one: "match", other: "matches", empty: "no matches" },
      find: { one: "file", other: "files", empty: "no files found" },
      ls: { one: "entry", other: "entries", empty: "empty directory" },
    };
    const labelsForTool = labels[request.tool.name];
    if (labelsForTool) {
      return resultPresentation(request, {
        summary:
          lines.length === 0
            ? {
                text: [{ text: labelsForTool.empty, tone: "muted" }],
                expandable: false,
              }
            : request.tool.name === "grep" && resultWasTruncated(request.result)
              ? {
                  text: [
                    {
                      text: `${lines.length} ${lines.length === 1 ? labelsForTool.one : labelsForTool.other}`,
                      tone: "muted",
                    },
                    { text: " (truncated)", tone: "warning" },
                  ],
                  expandable: true,
                }
              : {
                  count: lines.length,
                  unit: { one: labelsForTool.one, other: labelsForTool.other },
                  label: "",
                  expandable: true,
                },
        ...(lines.length > 0
          ? {
              detail:
                request.tool.name === "ls"
                  ? {
                      rows: lines.map((line, index) => ({
                        content: [
                          {
                            text: line,
                            tone: line.endsWith("/")
                              ? ("accent" as const)
                              : ("dim" as const),
                          },
                        ],
                        icon: line.endsWith("/")
                          ? { kind: "directory" as const }
                          : { kind: "file" as const, path: line },
                        tree: {
                          depth: 0,
                          position:
                            index === lines.length - 1
                              ? ("last" as const)
                              : ("middle" as const),
                          tone: "rule" as const,
                          arm: "──",
                        },
                      })),
                      totalRows: lines.length,
                    }
                  : request.tool.name === "find"
                    ? {
                        rows: lines.map((line) => ({
                          content: [{ text: line, tone: "dim" as const }],
                          icon: { kind: "file" as const, path: line },
                        })),
                        totalRows: lines.length,
                      }
                    : detail(lines),
            }
          : {}),
      });
    }

    throw new TypeError(
      `Unhandled tool-native presentation name: ${request.tool.name}`,
    );
  },
});

function mcpJsonEntries(
  value: unknown[] | Record<string, unknown>,
): ReadonlyArray<readonly [string, unknown]> {
  return Array.isArray(value)
    ? value.map((child, index) => [`[${index + 1}]`, child] as const)
    : Object.entries(value);
}

function isMcpJsonContainer(
  value: unknown,
): value is unknown[] | Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function mcpContainerDescription(
  value: unknown[] | Record<string, unknown>,
): string {
  const count = Array.isArray(value) ? value.length : Object.keys(value).length;
  const kind = Array.isArray(value) ? "array" : "object";
  const unit = Array.isArray(value) ? "item" : "field";
  return `${kind} · ${count} ${unit}${count === 1 ? "" : "s"}`;
}

function mcpJsonPresentation(
  raw: string,
): Omit<SemanticResultPresentation, "surface" | "outcome"> | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isMcpJsonContainer(parsed)) {
      return {
        summary: {
          text: [
            { text: "Responded", tone: "success" },
            { text: " ", tone: "plain" },
            {
              text: `[${parsed === null ? "null" : typeof parsed}]`,
              tone: "muted",
            },
          ],
          expandable: true,
        },
        detail: detail([parsed === null ? "null" : String(parsed)]),
      };
    }

    const rows: SemanticDetail["rows"][number][] = [];
    const addChildren = (
      container: unknown[] | Record<string, unknown>,
      depth: number,
      continuations: readonly boolean[],
    ): void => {
      const entries = mcpJsonEntries(container);
      const keyWidth = Math.max(0, ...entries.map(([key]) => [...key].length));
      entries.forEach(([key, value], index) => {
        const last = index === entries.length - 1;
        rows.push({
          content: [
            { text: key.padEnd(keyWidth), tone: "dim" },
            { text: "  ", tone: "dim" },
            {
              text: isMcpJsonContainer(value)
                ? mcpContainerDescription(value)
                : value === null
                  ? "null"
                  : String(value),
              tone: "dim",
            },
          ],
          tree: {
            depth,
            position: last ? "last" : "middle",
            continuations,
          },
        });
        if (isMcpJsonContainer(value)) {
          addChildren(value, depth + 1, [...continuations, !last]);
        }
      });
    };
    addChildren(parsed, 0, []);

    const rootEntries = mcpJsonEntries(parsed);
    const rootKind = Array.isArray(parsed) ? "array" : "object";
    const rootUnit = Array.isArray(parsed) ? "item" : "field";
    return {
      summary: {
        text: [
          { text: "Responded", tone: "success" },
          { text: " ", tone: "plain" },
          {
            text: `[${rootKind}] (${rootEntries.length} ${rootUnit}${rootEntries.length === 1 ? "" : "s"})`,
            tone: "muted",
          },
        ],
        expandable: rows.length > 0,
      },
      ...(rows.length > 0 ? { detail: { rows, totalRows: rows.length } } : {}),
    };
  } catch {
    return undefined;
  }
}

function mcpResultDecision(
  request: Extract<ToolPresentationRequest, { readonly surface: "result" }>,
  presentation: Omit<SemanticResultPresentation, "surface" | "outcome">,
): ToolPresentationDecision {
  if (request.policy?.outputMode === "hidden")
    return { kind: "suppress", reason: "policy-hidden" };
  const normalized = {
    layout: "branch" as const,
    ...presentation,
  };
  if (request.policy?.outputMode === "summary") {
    return resultPresentation(request, {
      ...normalized,
      summary: { ...normalized.summary, expandable: false },
      detail: undefined,
      attachment: undefined,
    });
  }
  return resultPresentation(request, normalized);
}

function mcpTextDetail(lines: readonly string[]): SemanticDetail {
  const fields =
    lines.length >= 2
      ? lines.map((line) => {
          const separator = line.indexOf(":");
          const key = separator > 0 ? line.slice(0, separator).trim() : "";
          return /^[A-Za-z][A-Za-z0-9 _./-]*$/.test(key)
            ? { key, value: line.slice(separator + 1).trim() }
            : undefined;
        })
      : [];
  if (
    fields.length === lines.length &&
    fields.every((field) => field !== undefined)
  ) {
    const keyWidth = Math.max(...fields.map((field) => [...field.key].length));
    return {
      rows: fields.map(({ key, value }) => ({
        content: [
          { text: key.padEnd(keyWidth), tone: "dim" },
          { text: "  ", tone: "dim" },
          { text: value || " ", tone: "dim" },
        ],
      })),
      totalRows: fields.length,
    };
  }
  return detail(lines);
}

const mcpAdapter: FamilyPresentationAdapter = Object.freeze({
  family: "mcp",
  present(request: ToolPresentationRequest) {
    if (request.surface === "call") {
      const args = record(request.args);
      const tool = stringArg(args, "tool");
      const server = stringArg(args, "server");
      const subject = tool ? `${server ? `${server}:` : ""}${tool}` : "status";
      return callPresentation(request, request.tool.label || "MCP", [
        { text: subject, tone: "accent" },
      ]);
    }
    const image = request.result.content.find(
      (block) => block.type === "image",
    );
    if (!request.result.error && image) {
      const mimeType = image.mimeType || "image";
      return mcpResultDecision(request, {
        summary: {
          text: [
            { text: "Responded", tone: "success" },
            { text: " ", tone: "plain" },
            { text: `[image] (${mimeType})`, tone: "muted" },
          ],
          expandable: true,
        },
        attachment: { kind: "image" },
      });
    }
    const raw = textContent(request.result).trim();
    const lines = raw ? raw.split("\n") : [];
    if (!request.result.error && raw) {
      const json = mcpJsonPresentation(raw);
      if (json) return mcpResultDecision(request, json);
    }
    const summary: SemanticText = request.result.error
      ? [{ text: lines[0] || "Failed", tone: "error" }]
      : lines.length === 0
        ? [{ text: "Done", tone: "success" }]
        : [
            { text: "Responded", tone: "success" },
            { text: " ", tone: "plain" },
            {
              text: `(${lines.length} ${lines.length === 1 ? "line" : "lines"})`,
              tone: "muted",
            },
          ];
    const payloadLines = request.result.error ? lines.slice(1) : lines;
    return mcpResultDecision(request, {
      summary: { text: summary, expandable: payloadLines.length > 0 },
      ...(payloadLines.length > 0
        ? {
            detail: request.result.error
              ? detail(payloadLines, "error")
              : mcpTextDetail(payloadLines),
          }
        : {}),
    });
  },
});

function oneOpenAiSubject(
  value: string,
  fallback: string,
  max = 72,
): SemanticText {
  return [
    {
      text: summarize(value || fallback, max),
      tone: value ? "accent" : "muted",
    },
  ];
}

function openAiCallSubject(name: string, args: unknown): SemanticText {
  if (name === "fetch_content") {
    const url = stringArg(args, "url");
    if (url) return [{ text: url, tone: "accent" }];
    const urls = stringArrayArg(args, "urls");
    if (urls.length === 0) return [{ text: "fetch content", tone: "muted" }];
    if (urls.length === 1) return [{ text: urls[0], tone: "accent" }];
    return [
      { text: urls[0], tone: "accent" },
      { text: " ", tone: "plain" },
      { text: `(+${urls.length - 1} urls)`, tone: "muted" },
    ];
  }
  if (name === "web_search") {
    const query = stringArg(args, "query");
    if (query) return oneOpenAiSubject(query, "", 72);
    const queries = stringArrayArg(args, "queries");
    if (queries.length === 0) return [{ text: "search web", tone: "muted" }];
    if (queries.length === 1) return oneOpenAiSubject(queries[0], "", 72);
    return [
      { text: summarize(queries[0], 48), tone: "accent" },
      { text: " ", tone: "plain" },
      { text: `(+${queries.length - 1} queries)`, tone: "muted" },
    ];
  }
  if (name === "questionnaire") {
    const questions = record(args).questions;
    const count = Array.isArray(questions) ? questions.length : 0;
    return [
      {
        text: count > 0 ? `${count} questions` : "questionnaire",
        tone: count > 0 ? "accent" : "muted",
      },
    ];
  }
  if (name === "TaskExecute") {
    const ids = stringArrayArg(args, "task_ids", "taskIds");
    if (ids.length === 0) return [{ text: "start tasks", tone: "muted" }];
    if (ids.length === 1) return [{ text: ids[0], tone: "accent" }];
    return [
      { text: ids[0], tone: "accent" },
      { text: " ", tone: "plain" },
      { text: `(+${ids.length - 1} tasks)`, tone: "muted" },
    ];
  }
  const rules: Readonly<Record<string, readonly [string[], string, number?]>> =
    {
      webfetch: [["url"], "fetch page"],
      get_search_content: [
        ["responseId", "response_id"],
        "load cached content",
      ],
      code_search: [["query"], "search code", 72],
      question: [["question"], "ask user", 72],
      context_tag: [["name"], "save point"],
      context_log: [[], "history"],
      context_checkout: [["target"], "checkout context"],
      annotate: [["url"], "current tab"],
      alpha_search: [["query"], "search papers", 72],
      alpha_get_paper: [["paper"], "paper"],
      alpha_ask_paper: [["paper"], "paper"],
      alpha_annotate_paper: [["paper"], "paper"],
      alpha_read_code: [["githubUrl", "github_url"], "repository"],
      Skill: [["name"], "run skill"],
      EnterPlanMode: [[], "enable read-only planning"],
      ExitPlanMode: [[], "present plan"],
      Agent: [["description", "prompt"], "launch agent", 72],
      get_subagent_result: [["agent_id"], "agent result"],
      steer_subagent: [["agent_id"], "steer agent"],
      TaskCreate: [["subject"], "create task", 72],
      TaskList: [[], "task list"],
      TaskGet: [["taskId", "task_id"], "task"],
      TaskUpdate: [["taskId", "task_id"], "task"],
      TaskOutput: [["task_id", "taskId"], "background task"],
      TaskStop: [["task_id", "taskId"], "background task"],
    };
  const rule = rules[name];
  if (rule)
    return oneOpenAiSubject(stringArg(args, ...rule[0]), rule[1], rule[2]);
  return oneOpenAiSubject(
    stringArg(
      args,
      "path",
      "file_path",
      "url",
      "query",
      "name",
      "subject",
      "tool",
      "description",
      "prompt",
    ),
    name.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
    72,
  );
}

interface OpenAiTask {
  readonly id: string;
  readonly status: string;
  readonly subject: string;
}

function parseOpenAiTask(line: string): OpenAiTask | undefined {
  const match = line.match(/^#(\d+) \[([^\]]+)\] (.+)$/);
  return match
    ? { id: match[1], status: match[2], subject: match[3] }
    : undefined;
}

function openAiTaskList(
  lines: readonly string[],
): Omit<SemanticResultPresentation, "surface" | "outcome"> {
  const tasks = lines
    .map(parseOpenAiTask)
    .filter((task): task is OpenAiTask => task !== undefined);
  if (tasks.length === 0) {
    return {
      summary: {
        text: [{ text: lines[0] || "no tasks", tone: "muted" }],
        expandable: lines.length > 1,
      },
      ...(lines.length > 1 ? { detail: detail(lines) } : {}),
    };
  }
  const counts = [
    ["in_progress", "in progress", "warning"],
    ["pending", "pending", "muted"],
    ["completed", "completed", "success"],
  ] as const;
  const summary: SemanticText[number][] = [
    { text: `${tasks.length} tasks`, tone: "muted" },
  ];
  for (const [status, label, tone] of counts) {
    const count = tasks.filter((task) => task.status === status).length;
    if (count === 0) continue;
    summary.push(
      { text: " ", tone: "plain" },
      { text: "•", tone: "muted" },
      { text: " ", tone: "plain" },
      { text: String(count), tone },
      { text: ` ${label}`, tone: "plain" },
    );
  }
  return {
    layout: "branch",
    summary: { text: summary, expandable: true },
    detail: {
      rows: tasks.map((task) => ({
        content: [
          { text: `#${task.id}`, tone: "accent" },
          { text: " ", tone: "plain" },
          {
            text: task.status,
            tone:
              task.status === "completed"
                ? "success"
                : task.status === "in_progress"
                  ? "warning"
                  : "muted",
          },
          { text: " ", tone: "plain" },
          { text: task.subject, tone: "dim" },
        ],
      })),
      totalRows: tasks.length,
    },
  };
}

function openAiSideQuestResult(
  request: Extract<ToolPresentationRequest, { readonly surface: "result" }>,
  presentation: SideQuestPresentation,
): Omit<SemanticResultPresentation, "surface" | "outcome"> {
  const details = record(request.result.details);
  const prompt = stringArg(request.args, "prompt").replace(/\r\n?/g, "\n");
  const promptLines = prompt ? prompt.split("\n") : [];
  const statuses =
    presentation.statuses.length > 0
      ? ` [${presentation.statuses.join(" | ")}]`
      : "";
  const pinnedRows = [
    {
      content: [
        {
          text: `session path: ${String(details.sessionPath ?? "Unavailable")}`,
          tone: "dim" as const,
        },
      ],
    },
    { content: [{ text: "", tone: "plain" as const }] },
  ];
  return {
    layout: "branch",
    summary: {
      text: [
        { text: sideQuestResultLabel(presentation), tone: "success" },
        ...(statuses ? [{ text: statuses, tone: "muted" as const }] : []),
      ],
      expandable: true,
    },
    detail: {
      rows: [
        ...pinnedRows,
        ...promptLines.map((line) => ({
          content: [{ text: line, tone: "dim" as const }],
        })),
      ],
      totalRows: pinnedRows.length + promptLines.length,
      pinnedRows: pinnedRows.length,
      action: "progressive",
    },
  };
}

function openAiSuccessSummary(name: string, line: string): SemanticSummary {
  const trimmed = line.trim();
  const successWith = (verb: string, rest: string): SemanticSummary => ({
    text: [
      { text: verb, tone: "success" },
      { text: " ", tone: "plain" },
      { text: rest, tone: "muted" },
    ],
    expandable: false,
  });
  if (!trimmed)
    return { text: [{ text: "Done", tone: "success" }], expandable: false };
  if (name === "TaskCreate") {
    const match = trimmed.match(/^Task #(\d+) created successfully: (.+)$/);
    if (match)
      return {
        text: [
          { text: "Created task", tone: "success" },
          { text: " ", tone: "plain" },
          { text: `#${match[1]}`, tone: "accent" },
          { text: " ", tone: "plain" },
          { text: match[2], tone: "muted" },
        ],
        expandable: false,
      };
  }
  if (name === "TaskUpdate") {
    const match = trimmed.match(/^Updated task #(\d+) (.+)$/);
    if (match)
      return {
        text: [
          { text: "Updated task", tone: "success" },
          { text: " ", tone: "plain" },
          { text: `#${match[1]}`, tone: "accent" },
          { text: " ", tone: "plain" },
          { text: match[2], tone: "muted" },
        ],
        expandable: false,
      };
  }
  if (name === "context_tag") {
    const match = trimmed.match(/^Created tag '([^']+)' at (.+)$/);
    if (match)
      return {
        text: [
          { text: "Created tag", tone: "success" },
          { text: " ", tone: "plain" },
          { text: match[1], tone: "accent" },
          { text: " ", tone: "plain" },
          { text: match[2], tone: "muted" },
        ],
        expandable: false,
      };
  }
  if (name === "TaskExecute") return successWith("Started", trimmed);
  if (name === "context_checkout")
    return successWith("Checked out", trimmed.replace(/^Checked out\s*/i, ""));
  if (name === "TaskStop") return successWith("Stopped", trimmed);
  return { text: [{ text: trimmed, tone: "muted" }], expandable: false };
}

const openAiAdapter: FamilyPresentationAdapter = Object.freeze({
  family: "openai",
  present(request: ToolPresentationRequest) {
    const title = request.tool.label || request.tool.name;
    if (request.surface === "call") {
      return callPresentation(
        request,
        title,
        openAiCallSubject(request.tool.name, request.args),
      );
    }

    const sideQuest =
      request.tool.name === "Agent"
        ? sideQuestPresentation({ details: request.result.details })
        : undefined;
    if (sideQuest)
      return resultPresentation(
        request,
        openAiSideQuestResult(request, sideQuest),
      );

    const raw = textContent(request.result).trim();
    const lines = raw ? raw.split("\n") : [];
    const patchFiles = request.policy?.patchFiles ?? [];
    if (lines.length === 0) {
      const text = request.result.error
        ? "Failed"
        : patchFiles.length > 0
          ? "Applied"
          : "Done";
      const suffix =
        patchFiles.length === 1
          ? patchFiles[0]
          : patchFiles.length > 1
            ? `${patchFiles.length} files`
            : "";
      return resultPresentation(request, {
        ...(request.result.error ? { layout: "indent" as const } : {}),
        summary: {
          text: [
            { text, tone: request.result.error ? "error" : "success" },
            ...(suffix
              ? [
                  { text: " ", tone: "plain" as const },
                  { text: suffix, tone: "muted" as const },
                ]
              : []),
          ],
          expandable: false,
        },
      });
    }
    if (!request.result.error && request.tool.name === "TaskList") {
      return resultPresentation(request, openAiTaskList(lines));
    }
    if (request.result.error) {
      const payload = lines.slice(1);
      return resultPresentation(request, {
        layout: "indent",
        summary: {
          text: [{ text: lines[0], tone: "error" }],
          expandable: payload.length > 0,
        },
        expandedSummary: {
          text: [{ text: lines[0], tone: "error" }],
          expandable: false,
        },
        ...(payload.length > 0
          ? { detail: { ...detail(payload, "error"), action: "none" as const } }
          : {}),
      });
    }
    const summary: SemanticSummary = {
      text: [
        {
          text: `${lines.length} ${lines.length === 1 ? "line" : "lines"} returned`,
          tone: "muted",
        },
      ],
      expandable: true,
    };
    return resultPresentation(request, {
      layout: "branch",
      summary,
      ...(lines.length === 1
        ? { expandedSummary: openAiSuccessSummary(request.tool.name, lines[0]) }
        : { detail: { ...detail(lines), action: "max" } }),
    });
  },
});

function streamDecision(
  request: Extract<ToolPresentationRequest, { readonly surface: "result" }>,
): ToolPresentationDecision {
  const output = collectOutput(request.result, { preserveBlankLines: true });
  return {
    kind: "present",
    presentation: {
      surface: "stream",
      detail: detail(output.lines, request.result.error ? "error" : "dim"),
      selection: "tail",
    },
    metadata: {
      output,
      ...(request.tool.name === "bash"
        ? {
            bash: {
              command: bashCommand(rawStringArg(request.args, "command")),
              lastOutputLine: lastBashOutputLine(output.text),
            },
          }
        : {}),
    },
  };
}

const ADAPTERS: Readonly<
  Record<PresentationToolFamily, FamilyPresentationAdapter>
> = Object.freeze({
  "tool-native": nativeAdapter,
  openai: openAiAdapter,
  mcp: mcpAdapter,
});

function mutationSource(
  tool: MutationToolName,
  cwd: string,
  args: unknown,
  before?: string | null,
): DiffSource {
  if (tool === "write") {
    return {
      kind: "write",
      path: rawStringArg(args, "path") || rawStringArg(args, "file_path"),
      before: before ?? null,
      after: rawStringArg(args, "content"),
    };
  }
  if (tool === "edit") {
    const argsRecord = record(args);
    const rawEdits = Array.isArray(argsRecord.edits)
      ? argsRecord.edits
      : [
          {
            oldText: argsRecord.oldText ?? argsRecord.old_text,
            newText: argsRecord.newText ?? argsRecord.new_text,
          },
        ];
    const edits = rawEdits.flatMap((edit) => {
      const value = record(edit);
      const oldText = value.oldText ?? value.old_text;
      const newText = value.newText ?? value.new_text;
      return typeof oldText === "string" && typeof newText === "string"
        ? [{ oldText, newText }]
        : [];
    });
    return {
      kind: "edit",
      path: rawStringArg(args, "path") || rawStringArg(args, "file_path"),
      edits,
      cwd,
    };
  }
  return {
    kind: "apply-patch",
    patchText:
      rawStringArg(args, "patchText") || rawStringArg(args, "patch_text"),
    cwd,
  };
}

function mutationSurface(
  tool: MutationToolName,
  phase: "call" | "result",
): DiffPresentationRequest["surface"] {
  if (tool === "write") {
    if (phase !== "result")
      throw new TypeError("Write diff presentation is result-only");
    return "write-result";
  }
  if (tool === "edit") return phase === "call" ? "edit-call" : "edit-result";
  return phase === "call" ? "apply-call" : "apply-result";
}

function writeFallbackSource(
  request: ToolMutationPresentationRequest,
): DiffSource | undefined {
  if (request.tool.name !== "write" || request.evidence) return undefined;
  const details = record(request.resultDetails);
  const content = rawStringArg(request.args, "content");
  if (details._type === "new")
    return mutationSource("write", request.cwd, request.args, null);
  if (details._type === "noChange")
    return mutationSource("write", request.cwd, request.args, content);
  return undefined;
}

function createMutationAdapter(
  mutations: Pick<DiffPresentationModule, "capture" | "present">,
): MutationPresentationAdapter {
  return Object.freeze<MutationPresentationAdapter>({
    capture(request: ToolMutationCaptureRequest) {
      return mutations.capture(
        mutationSource(
          request.tool.name,
          request.cwd,
          request.args,
          request.before,
        ),
      );
    },
    present(request: ToolMutationPresentationRequest) {
      const source =
        request.tool.name === "write"
          ? writeFallbackSource(request)
          : mutationSource(request.tool.name, request.cwd, request.args);
      return {
        kind: "mutation",
        snapshot: mutations.present({
          ...request.request,
          surface: mutationSurface(request.tool.name, request.phase),
          source,
          evidence: request.evidence,
        }),
      };
    },
  });
}

export function createToolPresentationModule(
  dependencies: ToolPresentationDependencies = {},
): ToolPresentationModule {
  const mutations = dependencies.mutations
    ? createMutationAdapter(dependencies.mutations)
    : undefined;

  function present(request: ToolPresentationRequest): ToolPresentationDecision;
  function present(
    request: ToolMutationCaptureRequest,
  ): Promise<DiffEvidence | undefined>;
  function present(
    request: ToolMutationPresentationRequest,
  ): ToolMutationPresentationDecision;
  function present(
    request:
      | ToolPresentationRequest
      | ToolMutationCaptureRequest
      | ToolMutationPresentationRequest,
  ):
    | ToolPresentationDecision
    | Promise<DiffEvidence | undefined>
    | ToolMutationPresentationDecision {
    if (!request.tool.name)
      throw new TypeError("Tool presentation name is required");
    if (request.surface === "mutation-capture") {
      if (!mutations)
        throw new TypeError("Mutation presentation dependency is required");
      return mutations.capture(request);
    }
    if (request.surface === "mutation-presentation") {
      if (!mutations)
        throw new TypeError("Mutation presentation dependency is required");
      return mutations.present(request);
    }
    if (request.surface === "result" && request.result.partial)
      return streamDecision(request);
    return ADAPTERS[request.tool.family].present(request);
  }

  return Object.freeze({ present });
}

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface PresentationThemeLike {
  readonly name?: unknown;
  getFgAnsi?(key: string): unknown;
  getBgAnsi?(key: string): unknown;
}

export interface PresentationBranchPolicy {
  readonly mode: "fixed" | "theme";
  readonly gray: unknown;
  readonly outlineBrighten: number;
}

export interface PresentationPaletteInput {
  readonly theme: PresentationThemeLike;
  readonly adaptive: boolean;
  readonly branch: PresentationBranchPolicy;
  readonly adaptiveRule: string;
  readonly overrides: Readonly<{ dim?: string; rule?: string }>;
}

export interface PresentationThemeAdapter {
  safeForeground(theme: unknown, key: string): string | null;
  safeBackground(theme: unknown, key: string): string | null;
  parseAnsiRgb(ansi: string): Rgb | null;
  isLightBackground(theme: unknown): boolean;
  chromeForeground(theme: unknown, adaptive: boolean): string | null;
  branchAnsi(policy: PresentationBranchPolicy, theme?: unknown): string;
  outlineAnsi(policy: PresentationBranchPolicy, theme?: unknown): string;
  paletteRequest(input: PresentationPaletteInput): PresentationPaletteRequest;
}

export const CHROME_STYLE_DEFAULTS = Object.freeze({
  border: "\x1b[38;5;238m",
  workedLine: "\x1b[38;2;140;140;140m",
  codeBlockLanguage: "\x1b[38;2;95;95;95m",
  statusSuccess: "\x1b[32m",
  statusError: "\x1b[31m",
  statusPending: "\x1b[90m",
  dim: "\x1b[38;2;80;80;80m",
  rule: "\x1b[38;2;50;50;50m",
});

export const DEFAULT_TOOL_BRANCH_GRAY = 72;

const CUBE_VALUES = [0, 95, 135, 175, 215, 255] as const;
const BASIC_COLORS: readonly (readonly [number, number, number])[] = [
  [0, 0, 0],
  [128, 0, 0],
  [0, 128, 0],
  [128, 128, 0],
  [0, 0, 128],
  [128, 0, 128],
  [0, 128, 128],
  [192, 192, 192],
  [128, 128, 128],
  [255, 0, 0],
  [0, 255, 0],
  [255, 255, 0],
  [0, 0, 255],
  [255, 0, 255],
  [0, 255, 255],
  [255, 255, 255],
];
const PALETTE_FINGERPRINT_KEYS = [
  "success",
  "error",
  "dim",
  "thinkingText",
  "borderMuted",
  "accent",
  "muted",
  "customMessageLabel",
  "customMessageText",
  "toolDiffAdded",
  "toolDiffRemoved",
] as const;

function themeLike(value: unknown): PresentationThemeLike | undefined {
  return typeof value === "object" && value !== null
    ? (value as PresentationThemeLike)
    : undefined;
}

function safeThemeAnsi(
  theme: unknown,
  method: "getFgAnsi" | "getBgAnsi",
  key: string,
): string | null {
  try {
    const candidate = themeLike(theme)?.[method];
    const ansi =
      typeof candidate === "function" ? candidate.call(theme, key) : undefined;
    return typeof ansi === "string" && ansi.length > 0 ? ansi : null;
  } catch {
    return null;
  }
}

function xterm256ToRgb(index: number): Rgb | null {
  if (!Number.isInteger(index) || index < 0 || index > 255) return null;
  if (index < 16) {
    const [r, g, b] = BASIC_COLORS[index];
    return { r, g, b };
  }
  if (index < 232) {
    const offset = index - 16;
    return {
      r: CUBE_VALUES[Math.floor(offset / 36) % 6],
      g: CUBE_VALUES[Math.floor(offset / 6) % 6],
      b: CUBE_VALUES[offset % 6],
    };
  }
  const level = 8 + (index - 232) * 10;
  return { r: level, g: level, b: level };
}

function parseAnsiRgb(ansi: string): Rgb | null {
  if (!ansi) return null;
  const escape = "\u001b";
  const trueColor = ansi.match(
    new RegExp(`${escape}\\[(?:38|48);2;(\\d+);(\\d+);(\\d+)m`),
  );
  if (trueColor) {
    return { r: +trueColor[1], g: +trueColor[2], b: +trueColor[3] };
  }
  const indexed = ansi.match(new RegExp(`${escape}\\[(?:38|48);5;(\\d+)m`));
  return indexed ? xterm256ToRgb(+indexed[1]) : null;
}

function luminance(rgb: Rgb): number {
  return (
    Math.round((0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) * 1e9) / 1e9
  );
}

function grayAnsi(value: unknown): string {
  const gray =
    typeof value === "number" && Number.isFinite(value)
      ? Math.max(0, Math.min(255, Math.round(value)))
      : DEFAULT_TOOL_BRANCH_GRAY;
  return `\x1b[38;2;${gray};${gray};${gray}m`;
}

function brightenAnsi(ansi: string, delta: number): string | null {
  const rgb = parseAnsiRgb(ansi);
  if (!rgb) return null;
  const safeDelta = Number.isFinite(delta) ? delta : 0;
  const bump = (channel: number) =>
    Math.max(0, Math.min(255, Math.round(channel + safeDelta)));
  return `\x1b[38;2;${bump(rgb.r)};${bump(rgb.g)};${bump(rgb.b)}m`;
}

export function createPresentationThemeAdapter(): PresentationThemeAdapter {
  const safeForeground = (theme: unknown, key: string): string | null =>
    safeThemeAnsi(theme, "getFgAnsi", key);
  const safeBackground = (theme: unknown, key: string): string | null =>
    safeThemeAnsi(theme, "getBgAnsi", key);
  const isLightBackground = (theme: unknown): boolean => {
    const panel = ["toolSuccessBg", "userMessageBg", "selectedBg"]
      .map((key) => safeBackground(theme, key))
      .map((ansi) => (ansi ? parseAnsiRgb(ansi) : null))
      .find((rgb): rgb is Rgb => rgb !== null);
    if (panel) return luminance(panel) > 165;
    const foregroundAnsi =
      safeForeground(theme, "text") ?? safeForeground(theme, "fg");
    const foreground = foregroundAnsi ? parseAnsiRgb(foregroundAnsi) : null;
    return foreground ? luminance(foreground) < 95 : false;
  };
  const attenuateChrome = (ansi: string, theme: unknown): string => {
    const rgb = parseAnsiRgb(ansi);
    if (!rgb || !isLightBackground(theme)) return ansi;
    const lightness = luminance(rgb);
    if (lightness <= 145) return ansi;
    const target = 118;
    const ratio = Math.min(1, (lightness - 130) / 110);
    const mix = (channel: number) =>
      Math.round(channel + (target - channel) * ratio);
    return `\x1b[38;2;${mix(rgb.r)};${mix(rgb.g)};${mix(rgb.b)}m`;
  };
  const chromeForeground = (
    theme: unknown,
    adaptive: boolean,
  ): string | null => {
    if (!theme || !adaptive) return null;
    const raw =
      safeForeground(theme, "dim") ??
      safeForeground(theme, "muted") ??
      safeForeground(theme, "borderMuted") ??
      safeForeground(theme, "thinkingText");
    return raw ? attenuateChrome(raw, theme) : null;
  };
  const branchAnsi = (
    policy: PresentationBranchPolicy,
    theme?: unknown,
  ): string => {
    if (policy.mode === "fixed") return grayAnsi(policy.gray);
    return chromeForeground(theme, true) ?? grayAnsi(policy.gray);
  };
  const outlineAnsi = (
    policy: PresentationBranchPolicy,
    theme?: unknown,
  ): string =>
    brightenAnsi(branchAnsi(policy, theme), policy.outlineBrighten) ??
    grayAnsi(DEFAULT_TOOL_BRANCH_GRAY + policy.outlineBrighten);
  const paletteFingerprint = (theme: unknown): string =>
    PALETTE_FINGERPRINT_KEYS.map(
      (key) => safeForeground(theme, key) ?? "",
    ).join("\u001f");
  const paletteRequest = (
    input: PresentationPaletteInput,
  ): PresentationPaletteRequest => {
    const muted = safeForeground(input.theme, "muted") ?? "";
    const warning = safeForeground(input.theme, "warning") ?? "";
    const success = safeForeground(input.theme, "success") ?? "";
    const error = safeForeground(input.theme, "error") ?? "";
    const accent = safeForeground(input.theme, "accent") ?? "";
    const title = safeForeground(input.theme, "toolTitle") ?? "";
    const messageLabel =
      safeForeground(input.theme, "customMessageLabel") ?? "";
    const messageText = safeForeground(input.theme, "customMessageText") ?? "";
    const semanticDim = safeForeground(input.theme, "dim") ?? "";
    const branch = branchAnsi(input.branch, input.theme);
    return {
      cache: {
        identity: input.theme,
        name: typeof input.theme.name === "string" ? input.theme.name : "",
        fingerprint: paletteFingerprint(input.theme),
      },
      adaptive: input.adaptive,
      defaults: {
        branch,
        muted,
        dim: CHROME_STYLE_DEFAULTS.dim,
        semanticDim,
        warning,
        success,
        error,
        accent,
        title,
        messageLabel,
        messageText,
        rule: CHROME_STYLE_DEFAULTS.rule,
        statusSuccess: CHROME_STYLE_DEFAULTS.statusSuccess,
        statusError: CHROME_STYLE_DEFAULTS.statusError,
        statusPending: CHROME_STYLE_DEFAULTS.statusPending,
      },
      adaptiveColors: {
        branch,
        muted,
        dim: muted || CHROME_STYLE_DEFAULTS.dim,
        semanticDim,
        warning,
        success,
        error,
        accent,
        title,
        messageLabel,
        messageText,
        rule: input.adaptiveRule,
        statusSuccess: success || CHROME_STYLE_DEFAULTS.statusSuccess,
        statusError: error || CHROME_STYLE_DEFAULTS.statusError,
        statusPending:
          semanticDim ||
          muted ||
          safeForeground(input.theme, "thinkingText") ||
          CHROME_STYLE_DEFAULTS.statusPending,
      },
      overrides: input.overrides,
    };
  };

  return Object.freeze({
    safeForeground,
    safeBackground,
    parseAnsiRgb,
    isLightBackground,
    chromeForeground,
    branchAnsi,
    outlineAnsi,
    paletteRequest,
  });
}
