import { useEffect, useState } from "react";
import { TID_SETTINGS_THINKRAIL_ENABLED_SWITCH, type AppSettings } from "@zcode/shared";
import { Switch } from "@/components/ui/switch.js";
import { toast } from "@/components/ui/toast.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { SettingsRow } from "@/settings/SettingsPageParts.js";

/**
 * ThinkRail 总开关（docs/thinkrail/design.md D2）。
 *
 * 与动态工作流那一行（`DynamicWorkflowModeSetting`）的差异，根因只有一个：**开关不是灰度**。
 * 它没有「服务端是否提供」这一层，值也只有一个来源（设置文件），所以：
 *
 *   - 行**总是渲染**（动态工作流那边服务端未提供时整行不渲染）；
 *   - 不需要快照 + 就绪态，直接用 `appSettings.thinkrailEnabled`；
 *   - 但乐观值与错误回滚和那边一样要，因为落盘 → Host 重发策略 → 下一轮工具面生效同样是异步的。
 *
 * 开关打开后不追溯已活跃的会话（工具表在创建/恢复时装配），所以说明文案写的是「每轮注入」「加入工具」，
 * 而不是让用户以为当前对话会立刻变。
 */
export function buildThinkrailEnabledPatch(
  enabled: boolean,
): Pick<AppSettings, "thinkrailEnabled"> {
  return { thinkrailEnabled: enabled };
}

export function ThinkrailSetting() {
  const { intl } = useZCodeIntl();
  const { settings, update } = useSettings();
  // 未落盘时按关闭显示：缺省即关是开关的语义，UI 不自己发明第三种状态。
  const settled = settings?.thinkrailEnabled === true;
  const [pending, setPending] = useState<boolean | null>(null);
  useEffect(() => {
    // Bugfix：已落盘的乐观值若一直保留，会遮住其他窗口广播来的新设置。
    if (pending !== null && settled === pending) setPending(null);
  }, [pending, settled]);

  const value = pending ?? settled;
  const label = intl.formatMessage({ id: "settings.thinkrail" });

  const handleCheckedChange = async (next: boolean) => {
    if (next === value) return;
    setPending(next);
    try {
      await update(buildThinkrailEnabledPatch(next));
      // 等共享快照追上后由 effect 清空乐观值，避免服务写入与快照刷新之间的闪回。
    } catch (error) {
      setPending(null);
      logger.warn("[settings] 保存 ThinkRail 开关失败", { error: String(error) });
      toast(intl.formatMessage({ id: "settings.thinkrail.saveError" }));
    }
  };

  return (
    <SettingsRow
      label={label}
      description={intl.formatMessage({ id: "settings.thinkrailDescription" })}
      control={
        <Switch
          aria-label={label}
          checked={value}
          data-testid={TID_SETTINGS_THINKRAIL_ENABLED_SWITCH}
          onCheckedChange={(checked) => {
            void handleCheckedChange(checked);
          }}
        />
      }
    />
  );
}
