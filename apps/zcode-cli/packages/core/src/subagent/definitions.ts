import { normalizeAgentProfiles, type AgentProfile } from "./profile.js";
import { createThinkrailAgentProfiles } from "./thinkrail-presets.js";
import type { TraceContext } from "@zcode/contracts";

export interface AgentDefinitionsSnapshot {
  readonly activeAgents: readonly Readonly<AgentProfile>[];
}

/**
 * ThinkRail 总开关对内置 subagent 名单的加减（docs/thinkrail/design.md D2 / D6）。
 *
 * 五个预设只在开关打开时进入可选名单。关闭时不注册 —— 模型点了 `subagent_type: "fixer"` 会走
 * `resolveAgentProfileForRequest` 的未命中路径，那条例外**列出全部可用名**，模型能自己改选；
 * 静默降级成 general-purpose 才是真危险（用户以为在用一个受限的审查 agent，实际拿到了全权限）。
 *
 * 用户级同名 profile 仍然覆盖内置（`normalizeAgentProfiles` 的既有顺序：内置先放、用户后盖），
 * 所以关掉开关不会让用户自己写的 `agents/fixer.md` 失效 —— 这也正是判据只按
 * `source === "built-in"` 而不按名字白名单的原因：名字不足以区分「谁写的」。
 */
export function applyThinkrailAgentProfiles(options: {
  enabled: boolean;
}): (profile: AgentProfile) => boolean {
  if (options.enabled) return () => true;
  // Explore 同时是基础探索角色；关闭 ThinkRail 只能移除专用预设，不能删基础能力。
  const reserved = new Set(createThinkrailAgentProfiles().map((profile) => profile.name).filter(name => name !== "Explore"));
  return (profile) => !(profile.source === "built-in" && reserved.has(profile.name));
}

/** 同步读取已发布的内存快照；加载、覆盖和移除由提供方负责。 */
export type GetAgentDefinitions = () => AgentDefinitionsSnapshot;

export type LoadAgentDefinitions = (input: {
  signal: AbortSignal;
  traceContext: TraceContext;
  thinkrailEnabled?: boolean;
}) => Promise<AgentDefinitionsSnapshot>;

/** 新父上下文替换快照；加载失败由 turn 收尾，不能吞掉断连错误后继续请求模型。 */
export function createTurnAgentDefinitions(
  getInitial: GetAgentDefinitions,
  load?: LoadAgentDefinitions,
) {
  let snapshot: AgentDefinitionsSnapshot | undefined;
  return {
    get: (): AgentDefinitionsSnapshot => snapshot ?? getInitial(),
    async prepare(input: Parameters<LoadAgentDefinitions>[0]): Promise<void> {
      if (!load) return;
      const next = await load(input);
      input.signal.throwIfAborted();
      snapshot = structuredClone(next);
    },
  };
}

export function createAgentDefinitionsReader(
  profiles: readonly AgentProfile[],
  options: Parameters<typeof normalizeAgentProfiles>[1] = {},
  thinkrail: { enabled: boolean } = { enabled: false },
): GetAgentDefinitions {
  const snapshot: AgentDefinitionsSnapshot = {
    activeAgents: normalizeAgentProfiles(
      // Bugfix：normalize 按后者覆盖前者，内置先放才能保留同名自定义 profile 的工具限制。
      [...(thinkrail.enabled ? createThinkrailAgentProfiles() : []), ...profiles],
      options,
    ).filter(applyThinkrailAgentProfiles(thinkrail)),
  };
  return () => snapshot;
}
