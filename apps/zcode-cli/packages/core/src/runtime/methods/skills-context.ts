import { traceContextToLogContext, type SkillLoadOutcome, type TraceContext } from "../deps.js";
import type { AgentRuntimeInternal } from "../internal.js";
import { preloadThinkrailSkills } from "../../context/thinkrail-skills.js";

export async function discoverSkillsForContext(
  this: AgentRuntimeInternal,
  traceContext: TraceContext,
): Promise<SkillLoadOutcome | undefined> {
  if (!this.skillPort) return undefined;
  let outcome: SkillLoadOutcome;
  try {
    outcome = await this.skillPort.discoverSkills({
      workingDirectory: this.workingDirectory,
      trace: traceContext,
    });
    this.logger?.debug("Skills discovered", {
      ...traceContextToLogContext(traceContext),
      diagnosticCount: outcome.diagnostics.length,
      module: "core.runtime",
      skillCount: outcome.skills.length,
      totalDiscovered: outcome.totalDiscovered,
    });
  } catch (error) {
    this.logger?.warn("Skill discovery failed", {
      ...traceContextToLogContext(traceContext),
      error: error instanceof Error ? error.message : String(error),
      module: "core.runtime",
    });
    outcome = {
      skills: [],
      diagnostics: [
        {
          code: "skill_scan_failed",
          severity: "warning",
          message: error instanceof Error ? error.message : String(error),
        },
      ],
      totalDiscovered: 0,
    };
  }
  // 可信入口加载失败必须终止，不能被发现阶段的可恢复 warning 吞掉后继续请求模型。
  return preloadThinkrailSkills({
    enabled:
      this.config.runtimeFeatures?.thinkrail === true &&
      !this.config.subagentContext &&
      !this.config.workflowActor,
    toolNames: this.getTools().map((tool) => tool.name),
    outcome,
    port: this.skillPort,
    workingDirectory: this.workingDirectory,
    trace: traceContext,
  });
}
