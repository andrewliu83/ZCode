import { THINKRAIL_SKILL_NAMES } from "@zcode/thinkrail";
import type { TraceContext, SkillMetadata } from "@zcode/contracts";
import type { AgentRuntimeInternal } from "../internal.js";
import { refreshBranchAwareBuiltInTools } from "./embedded-search-branch.js";

async function refreshInvocationCounts(runtime: AgentRuntimeInternal): Promise<void> {
  if (!runtime.skillLoadOutcome || !runtime.sessionStore?.getSkillInvocationCounts) return;
  const counts = await runtime.sessionStore.getSkillInvocationCounts();
  runtime.skillLoadOutcome = {
    ...runtime.skillLoadOutcome,
    skills: runtime.skillLoadOutcome.skills.map((skill) => ({
      ...skill,
      invocationCount: counts[skill.qualifiedName ?? skill.name] ?? 0,
    })),
  };
}

export interface ContextPolicySnapshot {
  thinkrailEnabled?: boolean;
  mainSystemPrompt?: string;
}

/** CommandInbox/空闲查询共用更新门；运行中的 turn 只采用接纳时的快照。 */
export async function refreshContextPolicy(
  runtime: AgentRuntimeInternal,
  traceContext: TraceContext,
  admitted?: ContextPolicySnapshot,
): Promise<boolean> {
  if (runtime.contextInitialization) await runtime.contextInitialization;
  if (runtime.thinkrailPolicyRefresh) await runtime.thinkrailPolicyRefresh;
  // 空闲查询等待期间可能接纳了输入；只有 admission 自己可以在 reservation 内更新策略。
  if (admitted === undefined && (runtime.activeTurn || runtime.activeTurnStartReservation))
    return false;
  const enabled = runtime.readThinkrailEnabled
    ? (admitted?.thinkrailEnabled ?? runtime.readThinkrailEnabled())
    : runtime.config.runtimeFeatures?.thinkrail === true;
  const mainPromptAllowed = !runtime.config.subagentContext && !runtime.config.workflowActor;
  const mainSystemPrompt =
    mainPromptAllowed && runtime.readMainSystemPrompt
      ? (admitted === undefined
          ? runtime.readMainSystemPrompt(runtime.config.agentKernel ?? "zcode")
          : admitted.mainSystemPrompt
        )?.trim() || undefined
      : runtime.config.mainSystemPrompt;
  const thinkrailChanged = enabled !== (runtime.config.runtimeFeatures?.thinkrail === true);
  if (!thinkrailChanged && mainSystemPrompt === runtime.config.mainSystemPrompt) {
    await refreshInvocationCounts(runtime);
    return false;
  }

  const previousFeatures = runtime.config.runtimeFeatures;
  const previousSkills = runtime.skillLoadOutcome;
  const previousMainPrompt = runtime.config.mainSystemPrompt;
  const refresh = (async () => {
    // 修复依据：基础正文、工具/技能 gate 与注入提示词共享同一个执行快照。
    runtime.config.runtimeFeatures = { ...previousFeatures, thinkrail: enabled };
    runtime.config.mainSystemPrompt = mainSystemPrompt;
    if (thinkrailChanged) refreshBranchAwareBuiltInTools(runtime);
    try {
      if (thinkrailChanged && runtime.contextInitialized) {
        const discovered = await runtime.discoverSkillsForContext(traceContext);
        if (!previousSkills || !discovered) {
          runtime.skillLoadOutcome = discovered;
          await refreshInvocationCounts(runtime);
          return;
        }
        const belongsToThinkrail = (skill: SkillMetadata) =>
          skill.source === "bundled" && THINKRAIL_SKILL_NAMES.includes(skill.name);
        // 原因：整份重新发现会把会话外新增的用户/插件技能带进冻结目录。
        const previousThinkrail = previousSkills.skills.filter(belongsToThinkrail);
        const nextThinkrail = discovered.skills.filter(belongsToThinkrail);
        runtime.skillLoadOutcome = {
          ...previousSkills,
          preloadedSkills: discovered.preloadedSkills,
          skills: [
            ...previousSkills.skills.filter((skill) => !belongsToThinkrail(skill)),
            ...nextThinkrail,
          ].sort((left, right) => left.name.localeCompare(right.name)),
          totalDiscovered:
            previousSkills.totalDiscovered - previousThinkrail.length + nextThinkrail.length,
        };
      }
      await refreshInvocationCounts(runtime);
    } catch (error) {
      runtime.config.runtimeFeatures = previousFeatures;
      runtime.config.mainSystemPrompt = previousMainPrompt;
      runtime.skillLoadOutcome = previousSkills;
      if (thinkrailChanged) refreshBranchAwareBuiltInTools(runtime);
      throw error;
    }
  })();
  runtime.thinkrailPolicyRefresh = refresh;
  try {
    await refresh;
    return true;
  } finally {
    if (runtime.thinkrailPolicyRefresh === refresh) runtime.thinkrailPolicyRefresh = undefined;
  }
}
