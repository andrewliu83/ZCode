import { zcodeWorkspaceUpdateThinkrailToolPolicyParamsSchema } from "@zcode/shared";
import { parseParams, type ZCodeProtocolAgentServerContext } from "./server-types.js";

/**
 * ThinkRail 总开关（docs/thinkrail/design.md D2）。与 off-peak-tool-policy.ts 同构：
 * 判定权在 Host（它读用户设置 `AppSettings.thinkrailEnabled`），CLI 只缓存结论，从不读设置文件本身。
 *
 * 为什么必须是 workspace 级推送而不是 per-request flag：v4 冷恢复
 * （subscribe → resumePersistedSession）没有 host 参数通道，只有进程缓存能覆盖到它。
 *
 * 新建/恢复及已有 record 的下一轮命令边界读取缓存；正在执行的 turn 保持原工具面。
 */
export async function updateThinkrailToolPolicy(
  context: ZCodeProtocolAgentServerContext,
  rawParams: unknown,
) {
  const params = parseParams(zcodeWorkspaceUpdateThinkrailToolPolicyParamsSchema, rawParams);
  context.appRuntimePreferences.thinkrailEnabled = params.enabled;
  return { workspace: params.workspace, enabled: params.enabled };
}
