import type { AppSettings } from "@zcode/shared";

/** 设置日志仅保留正文是否配置，避免泄露任一内核的系统提示词。 */
export function formatSettingsLog(settings: AppSettings): string {
  return JSON.stringify({
    ...settings,
    mainSystemPrompt: settings.mainSystemPrompt === undefined ? undefined : "[redacted]",
    kernelSystemPrompts:
      settings.kernelSystemPrompts === undefined
        ? undefined
        : Object.fromEntries(
            Object.keys(settings.kernelSystemPrompts).map((id) => [id, "[redacted]"]),
          ),
  });
}
