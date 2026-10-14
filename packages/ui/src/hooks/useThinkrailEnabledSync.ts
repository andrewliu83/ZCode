import { useEffect, useRef } from "react";
import type { IZCodeAgentService } from "@zcode/services";
import { logger } from "@/logger.js";
import { useThinkrailCatalogStore } from "@/store/thinkrailCatalogStore.js";
import { useSystemPromptInspectionStore } from "@/store/systemPromptInspectionStore.js";

/**
 * ThinkRail 总开关变化后的同步（docs/thinkrail/design.md D2），与 useDynamicWorkflowAvailability
 * 里那个用户选择同步同形：设置文件是开关的唯一来源；任何窗口写入后，共享设置广播让每个窗口的
 * Root 都读到新值，各自通知本窗口的 Host（重发 CLI 策略、转发给远程 Host）。
 *
 * 与动态工作流的差异只有一处：这里**没有**「重读快照」这一步 —— 开关不是随服务端翻转的灰度，
 * 它只有设置文件一个来源，UI 直接用 `appSettings.thinkrailEnabled` 渲染即可。所以只需要
 * 「信号 → Host」这一段，不需要第二份快照状态。
 *
 *   - 首次读到的值只是基线：启动时 Host 自己会读设置文件，不需要信号；
 *   - 多次变化串行：上一轮信号落地后才发下一轮，慢的请求不会盖掉新结果。
 */
export function useThinkrailEnabledSync(params: {
  settingsLoaded: boolean;
  enabled: boolean | undefined;
  zcodeAgentService: Pick<IZCodeAgentService, "syncThinkrailEnabled">;
}): void {
  const { settingsLoaded, enabled, zcodeAgentService } = params;
  const observedRef = useRef<{ enabled: boolean | undefined } | null>(null);
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    if (!settingsLoaded) return;
    const observed = observedRef.current;
    observedRef.current = { enabled };
    if (observed === null || observed.enabled === enabled) return;
    chainRef.current = chainRef.current.then(async () => {
      try {
        await zcodeAgentService.syncThinkrailEnabled(enabled === undefined ? {} : { enabled });
        // 必须等 Host 确认策略后再失效目录，避免刷新先读到旧开关且再无后续通知。
        useThinkrailCatalogStore.getState().invalidate();
        useSystemPromptInspectionStore.getState().invalidate();
      } catch (error) {
        // 同步失败不阻断 UI：Host 端的设置文件仍是权威，下一次窗口变化或重启会重新对齐。
        logger.warn("[thinkrail] 总开关同步到 Host 失败", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }, [enabled, settingsLoaded, zcodeAgentService]);
}
