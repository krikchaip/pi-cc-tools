// The Pi host provides pi-ai to runtime extensions. This repository does not install it directly.
// @ts-expect-error -- resolved by the real Pi host used by this E2E fixture.
import { createAssistantMessageEventStream, type AssistantMessage, type Context, type Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const TOOL_CALL_ID = "single-edit-gap-call";
const EDIT_ARGS = {
    path: "single-edit-gap.ts",
    edits: [
        {
            oldText: "export const value = 'before';",
            newText: "export const value = 'after';",
        },
    ],
};

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

function streamDeterministicEdit(model: Model<any>, context: Context) {
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => {
        const output = assistantMessage(model);
        stream.push({ type: "start", partial: output });

        const hasEditResult = context.messages.some(
            (message: { role: string; toolCallId?: string }) =>
                message.role === "toolResult" && message.toolCallId === TOOL_CALL_ID,
        );
        if (!hasEditResult) {
            const toolCall = {
                type: "toolCall" as const,
                id: TOOL_CALL_ID,
                name: "edit",
                arguments: EDIT_ARGS,
            };
            output.content.push(toolCall);
            stream.push({ type: "toolcall_start", contentIndex: 0, partial: output });
            stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: output });
            output.stopReason = "toolUse";
        } else {
            const text = "E2E_SINGLE_EDIT_COMPLETE";
            output.content.push({ type: "text", text });
            stream.push({ type: "text_start", contentIndex: 0, partial: output });
            stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: output });
            stream.push({ type: "text_end", contentIndex: 0, content: text, partial: output });
            output.stopReason = "stop";
        }

        stream.push({ type: "done", reason: output.stopReason, message: output });
        stream.end();
    });
    return stream;
}

export default function (pi: ExtensionAPI) {
    pi.registerProvider("single-edit-gap-e2e", {
        api: "single-edit-gap-e2e-api",
        baseUrl: "http://single-edit-gap.invalid",
        apiKey: "e2e-local",
        streamSimple: streamDeterministicEdit,
        models: [
            {
                id: "deterministic-edit",
                name: "Deterministic single Edit",
                reasoning: false,
                input: ["text"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 4096,
                maxTokens: 1024,
            },
        ],
    });
}
