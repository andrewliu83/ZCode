import { randomUUID } from "node:crypto";
import type {
  Model,
  ModelRequest,
  ModelResult,
  ModelUsage,
  ModelStreamEvent,
} from "@zcode/contracts";

export function gatewayUsage(usage: ModelUsage): Record<string, number> {
  return Object.fromEntries(
    [
      ["input_tokens", usage.inputTokens],
      ["output_tokens", usage.outputTokens],
      ["cache_read_input_tokens", usage.cacheReadTokens],
      ["cache_creation_input_tokens", usage.cacheWriteTokens],
    ].filter((entry): entry is [string, number] => typeof entry[1] === "number"),
  );
}
export function gatewayStopReason(reason: string): string {
  if (["tool-calls", "tool_calls", "tool_use"].includes(reason)) return "tool_use";
  if (["length", "max_tokens"].includes(reason)) return "max_tokens";
  if (["stop", "end_turn", "other"].includes(reason)) return "end_turn";
  throw new Error(`Unsupported model finish reason: ${reason}`);
}
export function gatewayMessage(result: ModelResult, model: string) {
  return {
    id: `msg_${randomUUID()}`,
    type: "message",
    role: "assistant",
    model,
    content: [
      ...(result.text ? [{ type: "text", text: result.text }] : []),
      ...(result.toolCalls ?? []).map((call) => ({
        type: "tool_use",
        id: call.id,
        name: call.name,
        input: call.input,
      })),
    ],
    stop_reason: gatewayStopReason(result.finishReason),
    stop_sequence: null,
    usage: gatewayUsage(result.usage),
  };
}
function encode(event: string, payload: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify({ type: event, ...payload })}\n\n`;
}

/** 不再运行工具；只向原生内核投影标准 Model 流及提交后的工具参数。 */
export async function* gatewayStream(
  model: Model,
  request: ModelRequest,
  alias: string,
): AsyncGenerator<string> {
  yield encode("message_start", {
    message: {
      id: `msg_${randomUUID()}`,
      type: "message",
      role: "assistant",
      model: alias,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  });
  const textBlocks = new Map<string, number>();
  const open = new Set<number>();
  let nextIndex = 0;
  let finished: Extract<ModelStreamEvent, { type: "finish" }> | undefined;
  for await (const event of model.streamText(request)) {
    if (event.type === "error") throw event.error;
    if (event.type === "text_start" || event.type === "text_delta") {
      const id = event.id ?? "text";
      if (!textBlocks.has(id)) {
        const index = nextIndex++;
        textBlocks.set(id, index);
        open.add(index);
        yield encode("content_block_start", { index, content_block: { type: "text", text: "" } });
      }
      if (event.type === "text_delta")
        yield encode("content_block_delta", {
          index: textBlocks.get(id),
          delta: { type: "text_delta", text: event.text },
        });
    } else if (event.type === "text_end") {
      const index = textBlocks.get(event.id);
      if (index !== undefined && open.delete(index)) yield encode("content_block_stop", { index });
    } else if (event.type === "tool_call") {
      for (const index of open) yield encode("content_block_stop", { index });
      open.clear();
      const index = nextIndex++;
      yield encode("content_block_start", {
        index,
        content_block: {
          type: "tool_use",
          id: event.toolCall.id,
          name: event.toolCall.name,
          input: {},
        },
      });
      yield encode("content_block_delta", {
        index,
        delta: {
          type: "input_json_delta",
          partial_json: JSON.stringify(event.toolCall.input ?? {}),
        },
      });
      yield encode("content_block_stop", { index });
    } else if (event.type === "finish") finished = event;
    // 上游 thinking 签名不能跨协议复用；不制造 Anthropic signed thinking block。
  }
  if (!finished) throw new Error("The model gateway stream ended without a terminal result");
  for (const index of open) yield encode("content_block_stop", { index });
  yield encode("message_delta", {
    delta: { stop_reason: gatewayStopReason(finished.finishReason), stop_sequence: null },
    usage: gatewayUsage(finished.usage),
  });
  yield encode("message_stop", {});
}
