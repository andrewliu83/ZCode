import { estimateTokens } from "../../context/utils.js";
import { buildIdentitySection } from "../../context/sections/identity.js";
import { inspectSystemPrompt, type SystemPromptInspection } from "../../context/system-prompt.js";
import type { AgentRuntimeInternal } from "../internal.js";
import type { TraceContext } from "@zcode/contracts";
import { SYSTEM_REMINDER_SOURCES } from "../../system-reminder/source.js";
import { refreshContextPolicy } from "./context-policy.js";
import { modelMessageContentToText } from "@zcode/contracts";
import { rebuildContextPrefix } from "./context-refresh.js";
import { nativeThinkrailRules } from "./native-agent-prompt.js";

export async function getSystemPromptInspection(
  this: AgentRuntimeInternal,
  trace: TraceContext,
): Promise<SystemPromptInspection> {
  let busy = Boolean(this.activeTurn || this.activeTurnStartReservation);
  if (!busy) {
    await refreshContextPolicy(this, trace);
    busy = Boolean(this.activeTurn || this.activeTurnStartReservation);
    if (!busy) {
      await this.ensureContextInitialized(trace);
      // 异步初始化期间可能接纳了新轮次，查询不能重写正在使用的上下文。
      busy = Boolean(this.activeTurn || this.activeTurnStartReservation);
      if (!busy) rebuildContextPrefix(this);
    }
  }
  if (this.thinkrailPolicyRefresh) await this.thinkrailPolicyRefresh;
  if (this.nativeAgentKernel || (this.config.agentKernel && this.config.agentKernel !== "zcode")) {
    const content = nativeThinkrailRules(this, this.config.runtimeFeatures?.thinkrail === true);
    return {
      nativeKernel: this.config.agentKernel ?? "zcode",
      basePrompt: this.config.mainSystemPrompt ?? "",
      defaultPrompt: "",
      busy,
      sections: content
        ? [
            {
              name: "ThinkRail",
              source: "thinkrail",
              content,
              injectionTarget: "system",
              cacheHint: "dynamic",
              chars: content.length,
              tokens: estimateTokens(content),
              preview: content.slice(0, 100),
              readOnly: true,
            },
          ]
        : [],
    };
  }
  const result =
    this.latestContextBuildResult ??
    this.createContextBuilderFromSnapshot(
      this.createConfigOnlyContextSnapshot(this.workingDirectory),
      this.memoryRoot,
      { memoryIndexContent: this.memoryIndexContent, persistEnvInfo: false },
    ).build();
  const additionalSections: NonNullable<
    Parameters<typeof inspectSystemPrompt>[1]
  >["additionalSections"] = [];
  const reminderSources = new Set<string>(SYSTEM_REMINDER_SOURCES);
  for (const [index, entry] of this.messageHistory.borrowReadOnlyRuntimeEntries().entries()) {
    const source = entry.metadata?.source;
    if (
      !source ||
      source === "context_prefix" ||
      source === "skills_listing" ||
      !reminderSources.has(source)
    )
      continue;
    const content =
      entry.kind === "attachment"
        ? entry.content
        : modelMessageContentToText(entry.message.content);
    additionalSections.push({
      name: `${source} ${index + 1}`,
      source,
      content,
      injectionTarget: "meta_user",
      cacheHint: "dynamic",
      chars: content.length,
      tokens: estimateTokens(content),
      preview: content.slice(0, 100),
    });
  }
  return inspectSystemPrompt(result, {
    defaultPrompt:
      this.config.systemPrompt?.trim() || buildIdentitySection(this.config.outputStyle).content,
    busy,
    additionalSections,
    lastRequest: this.lastSystemPromptRequest,
  });
}
