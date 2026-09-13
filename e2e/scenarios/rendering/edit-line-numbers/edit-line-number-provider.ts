// The Pi host provides pi-ai to runtime extensions. This repository does not install it directly.
// @ts-expect-error -- resolved by the real Pi host used by this E2E fixture.
import { createAssistantMessageEventStream, type AssistantMessage, type Context, type Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const TOOL_CALL_ID = "edit-line-number-call";

function sourceLines(start: number, end: number): string {
    return Array.from({ length: end - start + 1 }, (_, index) => `ORIGINAL_${start + index}`).join("\n");
}

function replacementLines(prefix: string, start: number, end: number): string {
    return Array.from({ length: end - start + 1 }, (_, index) => `${prefix}_${start + index}`).join("\n");
}

function editArguments(modelId: string) {
    if (modelId === "single-edit-lines") {
        return {
            path: "edit-line-numbers.txt",
            edits: [
                {
                    oldText: sourceLines(201, 236),
                    newText: replacementLines("SINGLE", 201, 236),
                },
            ],
        };
    }
    const starts = [27, 83, 119, 180];
    const additions = [5, 6, 8, 3];
    return {
        path: "edit-line-numbers.txt",
        edits: starts.map((start, index) => {
            const anchor = `ORIGINAL_${String(start).padStart(3, "0")}`;
            return {
            oldText: anchor,
            newText: [
                anchor,
                ...Array.from(
                    { length: additions[index] },
                    (_, line) => `MULTI_${index + 1}_INSERT_${line + 1}`,
                ),
            ].join("\n"),
        };
        }),
    };
}

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
                arguments: editArguments(model.id),
            };
            output.content.push(toolCall);
            stream.push({ type: "toolcall_start", contentIndex: 0, partial: output });
            stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: output });
            output.stopReason = "toolUse";
        } else {
            const text = "E2E_EDIT_LINE_NUMBERS_COMPLETE";
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
    pi.registerProvider("edit-line-number-e2e", {
        api: "edit-line-number-e2e-api",
        baseUrl: "http://edit-line-number.invalid",
        apiKey: "e2e-local",
        streamSimple: streamDeterministicEdit,
        models: [
            {
                id: "single-edit-lines",
                name: "Single Edit line numbers",
                reasoning: false,
                input: ["text"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 4096,
                maxTokens: 1024,
            },
            {
                id: "multi-edit-lines",
                name: "Multiple Edit line numbers",
                reasoning: false,
                input: ["text"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 4096,
                maxTokens: 1024,
            },
        ],
    });
}
