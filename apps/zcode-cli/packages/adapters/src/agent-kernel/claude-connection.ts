import type { NativeAgentRequest, ModelSelection } from "@zcode/contracts";
import type { query, Options } from "@anthropic-ai/claude-agent-sdk/core";

export interface ClaudeSdkConnection {
  model: string;
  apiKey: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  gateway?: boolean;
}

export interface ClaudeModelConnectionLease {
  resolveConnection(
    selection: ModelSelection | undefined,
  ): ClaudeSdkConnection | Promise<ClaudeSdkConnection>;
  close(): Promise<void>;
}

export function formatClaudeSystemPromptExtension(prompt: string): string {
  return prompt
    .replaceAll("spec-graph skill", "thinkrail:spec-graph skill")
    .replaceAll("choosing-a-workflow", "thinkrail:choosing-a-workflow")
    .replaceAll("spec_grep", "mcp__zcode_thinkrail__spec_grep")
    .replaceAll("spec_get", "mcp__zcode_thinkrail__spec_get")
    .replaceAll("spec_graph", "mcp__zcode_thinkrail__spec_graph");
}

export interface ClaudeAgentKernelOptions {
  openConnection?(request: NativeAgentRequest): Promise<ClaudeModelConnectionLease | undefined>;
  resolveConnection(
    selection: ModelSelection | undefined,
  ): ClaudeSdkConnection | Promise<ClaudeSdkConnection>;
  /** 仅由应用资源解析器提供，指向 SDK 配套运行时；缺省由 SDK 解析自己的平台依赖。 */
  sdkRuntimePath?: string;
  skillPluginCacheRoot?: string;
  stateDirectory?: string;
  env?: NodeJS.ProcessEnv;
  query?: typeof query;
}

export const toClaudeToolName = (name: string) =>
  name.startsWith("spec_") ? `mcp__zcode_thinkrail__${name}` : name;

export async function resolveClaudeAgents(
  request: NativeAgentRequest,
  connection: ClaudeSdkConnection,
  resolveConnection: ClaudeAgentKernelOptions["resolveConnection"],
): Promise<Options["agents"]> {
  const agents = request.agents
    ? Object.fromEntries(
        await Promise.all(
          Object.entries(request.agents).map(async ([name, profile]) => {
            const { modelSelection, ...definition } = profile;
            let agentConnection: ClaudeSdkConnection | undefined;
            if (modelSelection) {
              try {
                agentConnection = await resolveConnection(modelSelection);
              } catch (error) {
                // 无效的子代理配置不能伪装成主模型连接错误；保留原因和显式选择，不做降级。
                throw new Error(
                  `Claude SDK subagent ${name} has an invalid model connection: ${error instanceof Error ? error.message : String(error)}`,
                  { cause: error },
                );
              }
            }
            if (
              agentConnection &&
              (agentConnection.baseUrl !== connection.baseUrl ||
                agentConnection.apiKey !== connection.apiKey ||
                JSON.stringify(agentConnection.headers ?? {}) !==
                  JSON.stringify(connection.headers ?? {}))
            ) {
              throw new Error(
                `Claude SDK subagent ${name} requires the same API connection as its parent`,
              );
            }
            return [
              name,
              {
                ...definition,
                tools: definition.tools?.map(toClaudeToolName),
                disallowedTools: definition.disallowedTools?.map(toClaudeToolName),
                ...(agentConnection ? { model: agentConnection.model } : {}),
              },
            ];
          }),
        ),
      )
    : undefined;
  return agents;
}

export function createClaudeEnvironment(
  options: ClaudeAgentKernelOptions,
  connection: ClaudeSdkConnection,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...(options.env ?? process.env),
    ANTHROPIC_API_KEY: connection.apiKey,
    ANTHROPIC_MODEL: connection.model,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    DISABLE_TELEMETRY: "1",
    DISABLE_ERROR_REPORTING: "1",
  };
  // 用户已移除遥测能力；外部 shell 配置不能让随包 SDK 重新创建 OTLP 或错误上报出口。
  for (const key of Object.keys(env)) {
    if (
      key.startsWith("OTEL_") ||
      key.startsWith("ZCODE_TELEMETRY_") ||
      key === "CLAUDE_CODE_ENABLE_TELEMETRY"
    )
      delete env[key];
  }
  env.OTEL_SDK_DISABLED = "true";
  // 凭据属于 ZCode 的连接配置，不能借用外部 CLI 的登录或其他供应商环境。
  for (const key of [
    "CLAUDE_CODE_OAUTH_TOKEN",
    "ANTHROPIC_AUTH_TOKEN",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
    "CLAUDE_CODE_SUBAGENT_MODEL",
  ])
    delete env[key];
  if (connection.gateway) {
    // SDK 的快速/默认模型也必须在同一受控 lease 中，不能借用供应商默认值或外部账号。
    for (const key of [
      "ANTHROPIC_SMALL_FAST_MODEL",
      "ANTHROPIC_DEFAULT_HAIKU_MODEL",
      "ANTHROPIC_DEFAULT_SONNET_MODEL",
      "ANTHROPIC_DEFAULT_OPUS_MODEL",
    ])
      env[key] = connection.model;
  }
  if (options.stateDirectory) env.CLAUDE_CONFIG_DIR = options.stateDirectory;
  if (connection.baseUrl) env.ANTHROPIC_BASE_URL = connection.baseUrl;
  else delete env.ANTHROPIC_BASE_URL;
  env.ANTHROPIC_CUSTOM_HEADERS = Object.entries(connection.headers ?? {})
    .map(([key, value]) => {
      if (/[\r\n]/u.test(key + value)) throw new Error("Invalid SDK connection header");
      return `${key}: ${value}`;
    })
    .join("\n");
  return env;
}
