import { randomUUID } from "node:crypto";
import { query, tool, createSdkMcpServer, type Options } from "@anthropic-ai/claude-agent-sdk/core";
import { z } from "zod";
import { prepareClaudeSkillPlugins } from "./skills.js";
import { ClaudeStreamProjection } from "./claude-stream-projection.js";
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
      // 应用策略优先于项目设置；旧项目环境也不能重新开启 SDK 的上报。
      settings: JSON.stringify({
        ...(request.skillListingPolicy
          ? { skillListingMaxDescChars: request.skillListingPolicy.maxDescriptionChars }
          : {}),
        env: {
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
          CLAUDE_CODE_ENABLE_TELEMETRY: "0",
          DISABLE_TELEMETRY: "1",
          DISABLE_ERROR_REPORTING: "1",
          OTEL_SDK_DISABLED: "true",
        },
      }),
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
