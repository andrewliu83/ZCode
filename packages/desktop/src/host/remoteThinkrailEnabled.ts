import type { RemoteTarget } from "@zcode/shared";
import type { IZCodeAgentService } from "@zcode/services";

/**
 * 把 ThinkRail 总开关推给远程 Host（docs/thinkrail/design.md D2）。
 *
 * 与 remoteDynamicWorkflowUserMode.ts 同形：desktop-attached remote Host（SSH / WSL / Docker）
 * 读不到桌面的设置文件，开关只能由 desktop 推送 —— 建远程 workspace services 时推一次，
 * 本机 Host 收到变化信号后再推给本窗口所有在线连接。standalone server 有自己的设置权威，不推。
 * 单个连接失败（旧版本不认识该方法、连接已断）只上报，不影响其它连接。
 */
export async function pushThinkrailEnabledToRemoteHosts(
  connections: ReadonlyArray<{
    target: RemoteTarget;
    zcodeAgentService: Pick<IZCodeAgentService, "syncThinkrailEnabled">;
  }>,
  enabled: boolean | undefined,
  onError: (error: unknown) => void,
): Promise<void> {
  await Promise.all(
    connections
      .filter((connection) => connection.target.kind !== "server")
      .map(async (connection) => {
        try {
          await connection.zcodeAgentService.syncThinkrailEnabled(
            enabled === undefined ? {} : { enabled },
          );
        } catch (error) {
          onError(error);
        }
      }),
  );
}
