import type { SkillMetadata } from "../skills/index.js";
import type { CollaborationMode } from "./session.port.js";
import type { ModelUsage, ModelSelection, ModelMessageContentBlock } from "../model/index.js";

import type { AgentKernelId } from "@zcode/shared";
export type AgentKernelKind = AgentKernelId;

export interface NativeAgentTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: Record<string, unknown>, signal: AbortSignal): Promise<string>;
}

export type NativeAgentEvent =
  | { type: "session"; sessionId: string; model?: string }
  | { type: "text"; messageId: string; delta: string; done?: boolean }
  | { type: "reasoning"; messageId: string; delta: string; done?: boolean }
  | { type: "model-complete"; messageId: string; content: string; usage: ModelUsage }
  | {
      type: "tool-start";
      messageId: string;
      toolCallId: string;
      name: string;
      input: Record<string, unknown>;
    }
  | { type: "tool-result"; toolCallId: string; output: string; isError: boolean };

export interface NativeAgentRequest {
  prompt: string;
  inputContent?: readonly ModelMessageContentBlock[];
  modelSelection?: ModelSelection;
  modelInvocationContext?: import("../model/invocation-context.js").ModelInvocationContext;
  modelFactory?(selection: ModelSelection): import("../model/model.js").Model;
  cwd: string;
  resumeSessionId?: string;
  mode: CollaborationMode;
  planEnabled: boolean;
  baseSystemPrompt?: string;
  appendSystemPrompt: string;
  pluginRoots: string[];
  skills?: readonly SkillMetadata[];
  agents?: Record<
    string,
    {
      description: string;
      prompt: string;
      tools?: string[];
      disallowedTools?: string[];
      modelSelection?: ModelSelection;
      maxTurns?: number;
      skills?: string[];
      memory?: "user" | "project" | "local";
      permissionMode?:
        | "default"
        | "acceptEdits"
        | "bypassPermissions"
        | "plan"
        | "dontAsk"
        | "auto";
      background?: boolean;
    }
  >;
  toolAllowlist?: readonly string[];
  toolDenylist?: readonly string[];
  tools: NativeAgentTool[];
  signal: AbortSignal;
  onEvent(event: NativeAgentEvent): Promise<void>;
  requestPermission(input: {
    name: string;
    input: Record<string, unknown>;
    toolCallId: string;
  }): Promise<{ allowed: boolean; input?: Record<string, unknown>; reason?: string }>;
}

export interface NativeAgentResult {
  sessionId: string;
  response: string;
  model?: string;
  usage?: ModelUsage;
  costUsd?: number;
}

/** 各原生内核拥有内层 Agent 循环；CLI 只接收已执行事件，不再次执行原生工具。 */
export interface NativeAgentKernelPort {
  builtInAgents?: readonly string[];
  formatSystemPromptExtension?(prompt: string): string;
  run(request: NativeAgentRequest): Promise<NativeAgentResult>;
}
