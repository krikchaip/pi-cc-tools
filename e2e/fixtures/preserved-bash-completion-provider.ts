// The Pi host provides pi-ai to runtime extensions. This repository does not install it directly.
// @ts-expect-error -- resolved by the real Pi host used by this E2E fixture.
import { createAssistantMessageEventStream, type AssistantMessage, type Context, type Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const TOOL_CALL_ID = "preserved-bash-completion-call";
const COMMAND = "for i in 1 2 3 4 5 6 7 8; do printf 'BASH_PRESERVED_%02d\\n' \"$i\"; sleep 0.35; done";

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

function streamDeterministicBash(model: Model<any>, context: Context) {
  const stream = createAssistantMessageEventStream();
  const output = assistantMessage(model);
  queueMicrotask(() => {
    stream.push({ type: "start", partial: output });
    const hasResult = context.messages.some(
      (message: { role: string; toolCallId?: string }) =>
        message.role === "toolResult" && message.toolCallId === TOOL_CALL_ID,
    );
    if (!hasResult) {
      const toolCall = {
        type: "toolCall" as const,
        id: TOOL_CALL_ID,
        name: "bash",
        arguments: { command: COMMAND },
      };
      output.content.push(toolCall);
      stream.push({ type: "toolcall_start", contentIndex: 0, partial: output });
      stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: output });
      output.stopReason = "toolUse";
      stream.push({ type: "done", reason: output.stopReason, message: output });
      stream.end();
      return;
    }

    // Keep the completed Bash row visible before later assistant text releases
    // its preserved preview. The E2E captures this bounded transition window.
    setTimeout(() => {
      const text = "E2E_BASH_PRESERVED_COMPLETE";
      output.content.push({ type: "text", text });
      stream.push({ type: "text_start", contentIndex: 0, partial: output });
      stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: output });
      stream.push({ type: "text_end", contentIndex: 0, content: text, partial: output });
      output.stopReason = "stop";
      stream.push({ type: "done", reason: output.stopReason, message: output });
      stream.end();
    }, 6000);
  });
  return stream;
}

export default function fixture(pi: ExtensionAPI): void {
  pi.registerProvider("preserved-bash-completion-e2e", {
    api: "preserved-bash-completion-e2e-api",
    baseUrl: "http://preserved-bash-completion.invalid",
    apiKey: "e2e-local",
    streamSimple: streamDeterministicBash,
    models: [
      {
        id: "deterministic-bash",
        name: "Deterministic preserved Bash",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 4096,
        maxTokens: 1024,
      },
    ],
  });
}
