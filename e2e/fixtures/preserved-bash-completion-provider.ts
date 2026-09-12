// The Pi host provides pi-ai to runtime extensions. This repository does not install it directly.
// @ts-expect-error -- resolved by the real Pi host used by this E2E fixture.
import { createAssistantMessageEventStream, type AssistantMessage, type Context, type Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const TOOL_CALL_ID = "preserved-bash-completion-call";
const OUTPUT_LINE_COUNT = 24;
const COMMAND_VALUES = Array.from({ length: OUTPUT_LINE_COUNT }, (_, index) => index + 1).join(" ");
const COMMAND = `for i in ${COMMAND_VALUES}; do printf 'BASH_PRESERVED_%02d\\n' "$i"; sleep 0.1; done`;

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
      if (process.env.ACTIVE_BASH_LONG_TRANSCRIPT === "1") {
        const text = Array.from(
          { length: 100 },
          (_, index) => `ACTIVE_BASH_HISTORY_${String(index + 1).padStart(3, "0")}`,
        ).join("\n");
        output.content.push({ type: "text", text });
        stream.push({ type: "text_start", contentIndex: 0, partial: output });
        stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: output });
        stream.push({ type: "text_end", contentIndex: 0, content: text, partial: output });
      }

      const toolCall = {
        type: "toolCall" as const,
        id: TOOL_CALL_ID,
        name: "bash",
        arguments: { command: COMMAND },
      };
      const contentIndex = output.content.length;
      output.content.push(toolCall);
      stream.push({ type: "toolcall_start", contentIndex, partial: output });
      stream.push({ type: "toolcall_end", contentIndex, toolCall, partial: output });
      output.stopReason = "toolUse";
      stream.push({ type: "done", reason: output.stopReason, message: output });
      stream.end();
      return;
    }

    const finish = () => {
      const text = "E2E_BASH_PRESERVED_COMPLETE";
      output.content.push({ type: "text", text });
      const contentIndex = output.content.length - 1;
      stream.push({ type: "text_start", contentIndex, partial: output });
      stream.push({ type: "text_delta", contentIndex, delta: text, partial: output });
      stream.push({ type: "text_end", contentIndex, content: text, partial: output });
      output.stopReason = "stop";
      stream.push({ type: "done", reason: output.stopReason, message: output });
      stream.end();
    };

    if (process.env.ACTIVE_BASH_THINKING_STREAM === "1") {
      const thinking = {
        type: "thinking" as const,
        thinking: "",
      };
      output.content.push(thinking);
      const contentIndex = output.content.length - 1;
      stream.push({ type: "thinking_start", contentIndex, partial: output });
      let ticks = 0;
      const timer = setInterval(() => {
        const delta = ticks === 0 ? "ACTIVE_BASH_THINKING_STREAM" : ".";
        thinking.thinking += delta;
        stream.push({ type: "thinking_delta", contentIndex, delta, partial: output });
        ticks += 1;
        if (ticks < 200) return;
        clearInterval(timer);
        stream.push({
          type: "thinking_end",
          contentIndex,
          content: thinking.thinking,
          partial: output,
        });
        finish();
      }, 50);
      return;
    }

    // Keep the completed Bash row visible before later assistant text releases
    // its preserved preview. The E2E captures this bounded transition window.
    setTimeout(finish, 6000);
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
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 4096,
        maxTokens: 1024,
      },
    ],
  });
}
