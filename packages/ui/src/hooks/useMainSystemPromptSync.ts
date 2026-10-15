import { useEffect, useRef } from "react";
import type { IZCodeAgentService } from "@zcode/services";
import { logger } from "@/logger.js";
import { useSystemPromptInspectionStore } from "@/store/systemPromptInspectionStore.js";

/** 初次由 Host 读取设置；后续跨窗口广播只发送信号，正文持久化仍由 SettingService 负责。 */
export function useMainSystemPromptSync(params: {
  settingsLoaded: boolean;
  kernelSystemPrompts?: Record<string, string>;
  mainSystemPrompt?: string;
  zcodeAgentService: Pick<IZCodeAgentService, "syncMainSystemPrompt">;
}): void {
  const { settingsLoaded, mainSystemPrompt, kernelSystemPrompts, zcodeAgentService } = params;
  const fingerprint = JSON.stringify([mainSystemPrompt, kernelSystemPrompts ?? {}]);
  const observed = useRef<{ value?: string } | null>(null);
  const chain = useRef(Promise.resolve());
  useEffect(() => {
    if (!settingsLoaded) return;
    const previous = observed.current;
    observed.current = { value: fingerprint };
    if (!previous || previous.value === fingerprint) return;
    chain.current = chain.current.then(async () => {
      try {
        await zcodeAgentService.syncMainSystemPrompt({
          mainSystemPrompt,
          ...(kernelSystemPrompts ? { kernelSystemPrompts } : {}),
        });
        useSystemPromptInspectionStore.getState().invalidate();
      } catch (error) {
        logger.warn("[system-prompt] 正文策略同步失败", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }, [fingerprint, kernelSystemPrompts, mainSystemPrompt, settingsLoaded, zcodeAgentService]);
}
