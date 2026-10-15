import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk/core";
import type {
  ModelUsage,
  NativeAgentEvent,
  NativeAgentRequest,
  NativeAgentResult,
} from "@zcode/contracts";

/** Anthropic 的 input_tokens 不含 cache；Core 的 inputTokens 始终包含缓存输入。 */
function nativeUsage(usage: {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}): ModelUsage {
  const read = usage.cache_read_input_tokens ?? 0;
  const write = usage.cache_creation_input_tokens ?? 0;
  return {
    inputTokens: usage.input_tokens + read + write,
    outputTokens: usage.output_tokens,
    cacheReadTokens: read,
    cacheWriteTokens: write,
  };
}

export class ClaudeStreamProjection {
  result?: NativeAgentResult;
  private currentMessageId = "";
  private readonly text = new Map<string, string>();
  private readonly declaredTools = new Set<string>();
  private readonly streamedText = new Set<string>();
  private model?: string;
  private readonly completed = new Set<string>();
  private readonly streamUsage = new Map<string, { usage: ModelUsage; final: boolean }>();
  private readonly pending = new Map<
    string,
    Extract<NativeAgentEvent, { type: "model-complete" }>
  >();
  constructor(private readonly request: NativeAgentRequest) {}

  async accept(message: SDKMessage): Promise<void> {
    if (message.type === "system" && message.subtype === "init") {
      this.model = message.model;
      await this.request.onEvent({
        type: "session",
        sessionId: message.session_id,
        model: message.model,
      });
    } else if (message.type === "stream_event" && !message.parent_tool_use_id) {
      const event = message.event;
      if (event.type === "message_start") {
        await this.flushCompletions(event.message.id);
        this.currentMessageId = event.message.id;
        this.streamUsage.set(event.message.id, {
          usage: nativeUsage(event.message.usage),
          final: false,
        });
      } else if (event.type === "message_delta") {
        const state = this.streamUsage.get(this.currentMessageId);
        if (state) {
          const previous = state.usage;
          const read = event.usage.cache_read_input_tokens ?? previous.cacheReadTokens ?? 0;
          const write = event.usage.cache_creation_input_tokens ?? previous.cacheWriteTokens ?? 0;
          state.usage = nativeUsage({
            input_tokens:
              event.usage.input_tokens ??
              Math.max(
                0,
                (previous.inputTokens ?? 0) -
                  (previous.cacheReadTokens ?? 0) -
                  (previous.cacheWriteTokens ?? 0),
              ),
            output_tokens: event.usage.output_tokens,
            cache_read_input_tokens: read,
            cache_creation_input_tokens: write,
          });
          state.final = true;
          const pending = this.pending.get(this.currentMessageId);
          if (pending) pending.usage = state.usage;
        }
      } else if (event.type === "message_stop") {
        await this.flushCompletions();
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          this.streamedText.add(this.currentMessageId);
          await this.appendText(this.currentMessageId, event.delta.text);
        } else if (event.delta.type === "thinking_delta")
          await this.request.onEvent({
            type: "reasoning",
            messageId: this.currentMessageId,
            delta: event.delta.thinking,
          });
      }
    } else if (message.type === "assistant" && !message.parent_tool_use_id) {
      const id = message.message.id;
      await this.flushCompletions(id);
      const full = message.message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
      // assistant 是单个内容块，不能拿它与整个请求的累计文本做前缀校验。
      // 有流式正文时只投影 delta；非流式兼容路径补充尚未交付的内容。
      if (full && !this.streamedText.has(id)) {
        const previous = this.text.get(id) ?? "";
        const delta = full.startsWith(previous) ? full.slice(previous.length) : full;
        if (delta) await this.appendText(id, delta);
      }
      for (const block of message.message.content) {
        if (block.type !== "tool_use" || this.declaredTools.has(block.id)) continue;
        this.declaredTools.add(block.id);
        await this.request.onEvent({
          type: "tool-start",
          messageId: id,
          toolCallId: block.id,
          name: block.name,
          input:
            typeof block.input === "object" && block.input !== null
              ? (block.input as Record<string, unknown>)
              : {},
        });
      }
      const usage = message.message.usage;
      // 一个 SDK message.id 可分成文本与多个工具块，usage 只能在请求收口时交付一次。
      if (usage && !this.completed.has(id))
        this.pending.set(id, {
          type: "model-complete",
          messageId: id,
          content: this.text.get(id) ?? "",
          usage: this.streamUsage.get(id)?.final
            ? this.streamUsage.get(id)!.usage
            : nativeUsage(usage),
        });
    } else if (
      message.type === "user" &&
      !message.parent_tool_use_id &&
      Array.isArray(message.message.content)
    ) {
      // 工具结果可能与最后的模型块交错；未收到最终 usage 的流不能提前结算。
      await this.flushCompletions(undefined, true);
      for (const block of message.message.content) {
        if (block.type !== "tool_result") continue;
        const output =
          typeof block.content === "string"
            ? block.content
            : (block.content ?? [])
                .map((part) => (part.type === "text" ? part.text : JSON.stringify(part)))
                .join("\n");
        await this.request.onEvent({
          type: "tool-result",
          toolCallId: block.tool_use_id,
          output,
          isError: block.is_error === true,
        });
      }
    } else if (message.type === "result") {
      await this.flushCompletions();
      if (message.subtype !== "success" || message.is_error) {
        throw new Error(message.subtype === "success" ? message.result : message.errors.join("\n"));
      }
      this.result = {
        sessionId: message.session_id,
        response: message.result,
        model: this.model,
        costUsd: message.total_cost_usd,
        ...(message.usage
          ? {
              usage: nativeUsage(message.usage),
            }
          : {}),
      };
    }
  }

  private async flushCompletions(exceptId?: string, settledOnly = false) {
    for (const [id, event] of this.pending) {
      if (id === exceptId || (settledOnly && this.streamUsage.get(id)?.final === false)) continue;
      this.pending.delete(id);
      this.completed.add(id);
      await this.request.onEvent(event);
    }
  }

  private async appendText(messageId: string, delta: string) {
    if (!messageId) throw new Error("SDK text arrived before message_start");
    this.text.set(messageId, (this.text.get(messageId) ?? "") + delta);
    await this.request.onEvent({ type: "text", messageId, delta });
  }
}
