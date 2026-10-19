import type { UpdateStatePayload } from "@zcode/shared";

/**
 * 更新状态窗在“下载中 / 已下载”阶段承担安装状态反馈，用户不能误关闭。
 * 但允许真正退出时必须放行：forceQuit 打开后若仍按状态锁窗，
 * `app.quit()` 会被这个不可关闭窗口挡住，Main 永不退出，
 * 安装助手等待父进程超时后放弃安装（用户看到重启但版本未变）。
 */
export function resolveUpdateStatusWindowClosable(
  state: UpdateStatePayload,
  forceQuit: boolean,
): boolean {
  if (forceQuit) return true;
  return state.kind !== "download-progress" && state.kind !== "update-downloaded";
}
