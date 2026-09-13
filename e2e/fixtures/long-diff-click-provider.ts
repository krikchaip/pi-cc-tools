// The Pi host provides pi-ai to runtime extensions. This repository does not install it directly.
// @ts-expect-error -- resolved by the real Pi host used by this E2E fixture.
import { createAssistantMessageEventStream, type AssistantMessage, type Context, type Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const TOOL_CALL_ID = "long-create-click-call";
const CONTENT = Array.from(
  { length: 180 },
  (_, index) => {
    const number = String(index + 1).padStart(3, "0");
    return `export const item${number} = "LONG_CREATE_${number}";`;
  },
).join("\n");

function assistantMessage(model: Model<any>): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "pending",
    timestamp: Date.now(),
  };
}

function streamLongCreate(model: Model<any>, context: Context) {
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    void (async () => {
      const output = assistantMessage(model);
      stream.push({ type: "start", partial: output });
      const hasResult = context.messages.some(
        (message: { role: string; toolCallId?: string }) =>
          message.role === "toolResult" && message.toolCallId === TOOL_CALL_ID,
      );
      if (!hasResult) {
        const finalArguments = { path: "long-create.ts", content: CONTENT };
        const serialized = JSON.stringify(finalArguments);
        const toolCall = {
          type: "toolCall" as const,
          id: TOOL_CALL_ID,
          name: "write",
          arguments: {},
        };
        output.content.push(toolCall);
        stream.push({ type: "toolcall_start", contentIndex: 0, partial: output });
        const chunkSize = 96;
        for (let offset = 0; offset < serialized.length; offset += chunkSize) {
          const delta = serialized.slice(offset, offset + chunkSize);
          const progress = Math.min(1, (offset + delta.length) / serialized.length);
          toolCall.arguments = {
            path: finalArguments.path,
            content: CONTENT.slice(0, Math.floor(CONTENT.length * progress)),
          };
          stream.push({ type: "toolcall_delta", contentIndex: 0, delta, partial: output });
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
        toolCall.arguments = finalArguments;
        stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: output });
        output.stopReason = "toolUse";
      } else {
        const text = "E2E_LONG_CREATE_COMPLETE";
        output.content.push({ type: "text", text });
        stream.push({ type: "text_start", contentIndex: 0, partial: output });
        stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: output });
        stream.push({ type: "text_end", contentIndex: 0, content: text, partial: output });
        output.stopReason = "stop";
      }
      stream.push({ type: "done", reason: output.stopReason, message: output });
      stream.end();
    })();
  });
  return stream;
}

export default function fixture(pi: ExtensionAPI): void {
  pi.registerProvider("long-diff-click-e2e", {
    api: "long-diff-click-e2e-api",
    baseUrl: "http://long-diff-click.invalid",
    apiKey: "e2e-local",
    streamSimple: streamLongCreate,
    models: [
      {
        id: "deterministic-long-create",
        name: "Deterministic long Create",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 4096,
        maxTokens: 1024,
      },
    ],
  });
}
