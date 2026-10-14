// ============================================================
// Context Builder Types
// ============================================================

import type {
  EnvInfo,
  Model,
  ModelInputMessage,
  ProjectContext,
  ResolvedUserInstructions,
  SkillLoadOutcome,
  UserInstructionsOptions,
} from "@zcode/contracts";
import type { AutoCompactPolicyConfig } from "../compact/index.js";
import type { AgentProfile } from "../subagent/profile.js";

export type {
  EnvInfo,
  PackageManager,
  ProjectContext,
  ProjectType,
  ResolvedUserInstructionSource,
  ResolvedUserInstructions,
  UserInstructionsOptions,
} from "@zcode/contracts";

// -----------------------------------------------
// Context Source
// -----------------------------------------------

export type ContextSource =
  | "cli_prefix" // CLI / 产品身份前缀
  | "identity" // Agent 基础描述
  | "env_info" // 环境信息 (cwd, platform, git repo boolean)
  | "system_context" // git snapshot context
  | "skills" // 可用 skills
  | "tools" // 工具定义
  | "request_user_context" // request-level user context provider-visible 组合块
  | "memory" // 长期 memory read path
  | "current_date" // 当前日期
  | "main_system_prompt" // 设置中的主代理正文，保留自动注入
  | "custom_system_prompt" // 自定义 stable system body
  | "workflow_actor_identity" // 动态工作流子代理身份：契约 + persona 叠加
  | "subagent_agent_prompt" // 子 agent 专属身份/任务 prompt
  | "subagent_notes" // 子 agent 通用操作提醒
  | "subagent_environment" // 子 agent 环境和模型上下文
  | "dynamic_behavior" // 动态行为边界
  | "delivering_work" // 交付范围与完成度纪律（Claude harness parity）
  | "session_guidance" // 当前可用内置能力指导
  | "output_style" // 输出风格
  | "context_management" // 长上下文管理提示
  | "thinkrail" // ThinkRail 常驻规则（spec ground truth + workflow 路由）
  | "desktop_context"; // ZCode Desktop 渲染与交互协议

export type ContextInjectionTarget = "system" | "meta_user";

export type ContextCacheHint = "stable" | "dynamic";

export type PresentationSurface = "terminal" | "zcode_desktop";

// -----------------------------------------------
// Context Section
// -----------------------------------------------

export interface ContextSection {
  name: string; // 人类可读的 section 名称
  source: ContextSource; // 来源标识
  injectionTarget: ContextInjectionTarget; // 注入位置
  cacheHint: ContextCacheHint; // 缓存稳定性提示
  chars: number; // 字符数
  tokens: number; // 估算 token 数
  content: string; // 完整内容
  preview: string; // 前 100 字符预览
}

export type ContextMetaUserAttachmentSource = "skills_listing" | "context_prefix";

export interface ContextMetaUserAttachment {
  source: ContextMetaUserAttachmentSource;
  content: string;
}

// -----------------------------------------------
// Context Build Result
// -----------------------------------------------

export interface ContextBuildResult {
  sections: ContextSection[];
  totalChars: number;
  totalTokens: number;
  systemMessages: ModelInputMessage[]; // ContextBuilder 只组装 system messages
  metaUserAttachments: ContextMetaUserAttachment[]; // 未包裹 <system-reminder> 的 meta user body
}

export interface OutputStylePromptConfig {
  name: string;
  prompt: string;
  keepCodingInstructions?: boolean;
}

// -----------------------------------------------
// Context Builder Config
// -----------------------------------------------

export interface ContextBuilderConfig {
  workingDirectory: string;
  envInfo: EnvInfo;
  /** 当前步骤的执行对象，不进入 Context Source 或持久化环境快照。 */
  model?: Model;
  presentationSurface?: PresentationSurface;
  genUiOutputDirectory?: string;
  currentDate?: string;
  userInstructions?: ResolvedUserInstructions;
  projectContext?: ProjectContext;
  memoryRoot?: string;
  memoryIndexContent?: string;
  skills?: SkillLoadOutcome;
  agentProfiles?: readonly AgentProfile[];
  embeddedSearchEnabled?: boolean;
  skillMetadataBudget?: number;
  customSystemPrompt?: string;
  /** 主代理设置只替换稳定正文；工作流 actor 与子代理不使用。 */
  mainSystemPrompt?: string;
  /**
   * 动态工作流子代理（workflow child）的身份输入。在场即走 builder 的第三条路径：
   * 基座段（CLI prefix、安全行、Harness、memory）+ 工作流子代理契约 + persona 叠加，
   * 而不是像 `customSystemPrompt` 那样整段替换。与 `customSystemPrompt` 互斥。
   */
  workflowActor?: WorkflowActorContext;
  language?: string;
  outputStyle?: OutputStylePromptConfig;
  compact?: AutoCompactPolicyConfig;
  guidanceToolNames?: readonly string[];

  /**
   * ThinkRail 常驻规则的渲染条件（docs/thinkrail/design.md D3）。缺席 = 不渲染：
   * 测试与「不参与该特性」的调用方无需显式传 false。
   *
   * 三条条件在 ContextBuilder 之外算好（工具表与工作区事实都在那边），这里只做合取；
   * 规则的原文由 caller 传入而不是在 context 层硬编码，这样正文与领域包同源、可被单测直接断言。
   */
  thinkrail?: ThinkrailSectionInput;
}

export interface ThinkrailSectionInput {
  /** 用户开关（`runtimeFeatures.thinkrail`）。 */
  readonly enabled: boolean;
  /** 工作区是否真的存在至少一个 spec（`workspaceHasSpec` 的结论，调用点记忆化）。 */
  readonly hasSpec: boolean;
  readonly specRule: string;
  readonly workflowRule: string;
}

/**
 * 工作流子代理的身份输入：有效名（匿名缺席）、作者写的 persona system prompt（可缺席）。
 * 没有工具档位：每个子代理都有完整工作工具集，契约只有一份文本。
 */
export interface WorkflowActorContext {
  name?: string;
  persona?: string;
}

export type ContextUserInstructionsRequest = UserInstructionsOptions;
