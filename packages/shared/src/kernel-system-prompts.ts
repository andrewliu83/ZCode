import type { AgentKernelId } from "./agent-kernels.js";

/** 一个内核只有一个正文来源；历史字段只属于 ZCode，不能漏到其它内核。 */
export function resolveKernelSystemPrompt(
  settings: {
    mainSystemPrompt?: string;
    kernelSystemPrompts?: Readonly<Record<string, string>>;
  },
  kernel: AgentKernelId = "zcode",
): string | undefined {
  const value =
    kernel === "zcode" ? settings.mainSystemPrompt : settings.kernelSystemPrompts?.[kernel];
  return value?.trim() || undefined;
}
