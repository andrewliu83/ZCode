import { SPEC_RULE, WORKFLOW_RULE } from "@zcode/thinkrail";
import type { AgentRuntimeInternal } from "../internal.js";
import { buildThinkrailSection } from "../../context/sections/thinkrail.js";

/** SDK 追加段与设置投影共用；不把 ZCode 的基础正文冒充为 SDK preset。 */
export function nativeThinkrailRules(runtime: AgentRuntimeInternal, enabled: boolean): string {
  if (
    !enabled ||
    runtime.config.toolDisallowlist?.includes("Skill") ||
    (runtime.config.toolAllowlist && !runtime.config.toolAllowlist.includes("Skill"))
  )
    return "";
  // 原生内核与 ZCode/设置预览共用规则组装，避免再次引入 hasSpec 条件差异。
  const prompt =
    buildThinkrailSection({
      enabled,
      toolNames: runtime.getTools().map((tool) => tool.name),
      specRule: SPEC_RULE,
      workflowRule: WORKFLOW_RULE,
    })?.content ?? "";
  return runtime.nativeAgentKernel?.formatSystemPromptExtension?.(prompt) ?? prompt;
}
