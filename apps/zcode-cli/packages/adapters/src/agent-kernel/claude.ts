import { randomUUID } from "node:crypto";
import {
  query,
  tool,
  createSdkMcpServer,
  type SDKMessage,
  type Options,
} from "@anthropic-ai/claude-agent-sdk/core";
import { z } from "zod";
import { prepareClaudeSkillPlugins } from "./skills.js";
import { nativeSdkPrompt } from "./prompt.js";
import type {
  NativeAgentKernelPort,
  NativeAgentRequest,
  NativeAgentResult,
} from "@zcode/contracts";

import {
  createClaudeEnvironment,
  resolveClaudeAgents,
  toClaudeToolName,
  formatClaudeSystemPromptExtension,
  type ClaudeAgentKernelOptions,
} from "./claude-connection.js";
export { formatClaudeSystemPromptExtension } from "./claude-connection.js";
export type {
  ClaudeAgentKernelOptions,
  ClaudeSdkConnection,
  ClaudeModelConnectionLease,
} from "./claude-connection.js";

/** 真正使用 SDK Agent 循环，不把 SDK 当作另一个 Model adapter。 */
export class ClaudeAgentKernel implements NativeAgentKernelPort {
  readonly builtInAgents = ["general-purpose", "Explore"] as const;
  readonly formatSystemPromptExtension = formatClaudeSystemPromptExtension;
  constructor(private readonly options: ClaudeAgentKernelOptions) {}

  async run(request: NativeAgentRequest): Promise<NativeAgentResult> {
    request.signal.throwIfAborted();
    const lease = await this.options.openConnection?.(request);
    try {
      return await this.runConnected(
        request,
        lease?.resolveConnection ?? this.options.resolveConnection,
      );
    } finally {
      await lease?.close();
    }
  }

  private async runConnected(
    request: NativeAgentRequest,
    resolveConnection: ClaudeAgentKernelOptions["resolveConnection"],
  ): Promise<NativeAgentResult> {
    request.signal.throwIfAborted();
    const connection = await resolveConnection(request.modelSelection);
    const pluginRoots = [
      ...new Set([
        ...request.pluginRoots,
        ...(request.skills && this.options.skillPluginCacheRoot
          ? await prepareClaudeSkillPlugins(request.skills, this.options.skillPluginCacheRoot)
          : []),
      ]),
    ];
    const agents = await resolveClaudeAgents(request, connection, resolveConnection);
    request.signal.throwIfAborted();
    if (!connection.apiKey.trim())
      throw new Error("Configure an API key for the Claude SDK model connection");
    const abort = new AbortController();
    const cancel = () => abort.abort(request.signal.reason);
    if (request.signal.aborted) cancel();
    else request.signal.addEventListener("abort", cancel, { once: true });
    const bridgeNames = new Set(
      request.tools.map((entry) => `mcp__zcode_thinkrail__${entry.name}`),
    );
    const env = createClaudeEnvironment(this.options, connection);
    // SDK 独立配置目录不会读取 ZCode 的预算；使用本轮已解析策略，不能继承外部 CLI 值。
    if (request.skillListingPolicy)
      env.SLASH_COMMAND_TOOL_CHAR_BUDGET = String(request.skillListingPolicy.characterBudget);
    const nativeOptions: Options = {
      ...(request.skillListingPolicy
        ? {
            settings: JSON.stringify({
              skillListingMaxDescChars: request.skillListingPolicy.maxDescriptionChars,
            }),
          }
        : {}),
      cwd: request.cwd,
      model: connection.model,
      env,
      abortController: abort,
      // 用户覆盖只替换基座；ThinkRail/会话扩展仍独立拼接，SDK 动态技能发现继续保留。
      // SDK 整会话快照会忽略 resume 的新 append；正文已按本轮冻结，禁用跨轮旧快照。
      systemPrompt: request.baseSystemPrompt?.trim()
        ? {
            type: "custom",
            prompt: [request.baseSystemPrompt.trim(), request.appendSystemPrompt]
              .filter(Boolean)
              .join("\n\n"),
            snapshot: false,
          }
        : {
            type: "preset",
            preset: "claude_code",
            append: request.appendSystemPrompt,
            snapshot: false,
          },
      includePartialMessages: true,
      settingSources: ["project", "local"],
      // 原因：verbatimPrompts 会跳过首轮 skills/rules 附加，不能开启此选项。
      verbatimPrompts: false,
      plugins: pluginRoots.map((path) => ({ type: "local" as const, path })),
      ...(this.options.sdkRuntimePath
        ? { pathToClaudeCodeExecutable: this.options.sdkRuntimePath }
        : {}),
      ...(request.resumeSessionId ? { resume: request.resumeSessionId } : {}),
      // SDK bypassPermissions 会在 canUseTool 之前放行询问；yolo 的自动批准由回调承担，保留 UI 询问。
      permissionMode:
        request.planEnabled || request.mode === "plan"
          ? "plan"
          : request.mode === "edit"
            ? "acceptEdits"
            : "default",
      allowDangerouslySkipPermissions: false,
      ...(request.toolAllowlist
        ? { tools: request.toolAllowlist.filter((name) => !name.startsWith("spec_")) }
        : {}),
      ...(request.toolDenylist
        ? { disallowedTools: request.toolDenylist.map(toClaudeToolName) }
        : {}),
      agents,
      canUseTool: async (name, input, options) => {
        // MCP 桥交给 ZCode executor 做校验/审批，避免对同一写操作双重询问。
        if (bridgeNames.has(name) || (request.mode === "yolo" && name !== "AskUserQuestion"))
          return { behavior: "allow", updatedInput: input };
        const result = await request.requestPermission({
          name,
          input,
          toolCallId: options.toolUseID ?? randomUUID(),
        });
        return result.allowed
          ? { behavior: "allow", updatedInput: result.input ?? input }
          : { behavior: "deny", message: result.reason ?? "Permission denied" };
      },
      mcpServers: request.tools.length
        ? {
            zcode_thinkrail: createSdkMcpServer({
              name: "zcode_thinkrail",
              tools: request.tools.map((entry) => {
                const schema = z.fromJSONSchema(entry.inputSchema);
                if (!(schema instanceof z.ZodObject))
                  throw new Error(`SDK bridge requires an object schema: ${entry.name}`);
                return tool(entry.name, entry.description, schema.shape, async (input) => ({
                  content: [
                    { type: "text" as const, text: await entry.execute(input, request.signal) },
                  ],
                }));
              }),
            }),
          }
        : undefined,
    };
    let stream: ReturnType<typeof query> | undefined;
    try {
      stream = (this.options.query ?? query)({
        prompt: nativeSdkPrompt(request),
        options: nativeOptions,
      });
      const state = new ClaudeStreamProjection(request);
      for await (const message of stream) await state.accept(message);
      if (!state.result) throw new Error("Claude SDK stream ended without a result");
      // 协议桥上游的价格不归 SDK 所有；不能把 Claude 定价估算当成其它 Provider 的实际费用。
      return connection.gateway ? { ...state.result, costUsd: undefined } : state.result;
    } finally {
      request.signal.removeEventListener("abort", cancel);
      stream?.close();
    }
  }
}

class ClaudeStreamProjection {
  result?: NativeAgentResult;
  private currentMessageId = "";
  private readonly text = new Map<string, string>();
  private readonly declaredTools = new Set<string>();
  private model?: string;
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
      if (event.type === "message_start") this.currentMessageId = event.message.id;
      else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta")
          await this.appendText(this.currentMessageId, event.delta.text);
        else if (event.delta.type === "thinking_delta")
          await this.request.onEvent({
            type: "reasoning",
            messageId: this.currentMessageId,
            delta: event.delta.thinking,
          });
      }
    } else if (message.type === "assistant" && !message.parent_tool_use_id) {
      const id = message.message.id;
      const full = message.message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
      const previous = this.text.get(id) ?? "";
      if (full && !full.startsWith(previous))
        throw new Error("Claude SDK streamed text differs from completed message");
      if (full.length > previous.length) await this.appendText(id, full.slice(previous.length));
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
      if (usage)
        await this.request.onEvent({
          type: "model-complete",
          messageId: id,
          content: full,
          usage: {
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
            cacheReadTokens: usage.cache_read_input_tokens ?? 0,
            cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
          },
        });
    } else if (
      message.type === "user" &&
      !message.parent_tool_use_id &&
      Array.isArray(message.message.content)
    ) {
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
              usage: {
                inputTokens: message.usage.input_tokens,
                outputTokens: message.usage.output_tokens,
                cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
                cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
              },
            }
          : {}),
      };
    }
  }

  private async appendText(messageId: string, delta: string) {
    if (!messageId) throw new Error("SDK text arrived before message_start");
    this.text.set(messageId, (this.text.get(messageId) ?? "") + delta);
    await this.request.onEvent({ type: "text", messageId, delta });
  }
}
