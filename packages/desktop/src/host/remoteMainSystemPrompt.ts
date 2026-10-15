import type { RemoteTarget } from "@zcode/shared";
import type { IZCodeAgentService } from "@zcode/services";

/** 附属 SSH/WSL/Docker Host 由桌面设置驱动；独立 server 保留自己的设置权威。 */
export async function pushMainSystemPromptToRemoteHosts(
  connections: ReadonlyArray<{
    target: RemoteTarget;
    zcodeAgentService: Pick<IZCodeAgentService, "syncMainSystemPrompt">;
  }>,
  mainSystemPrompt: string | undefined,
  onError: (error: unknown) => void,
  kernelSystemPrompts?: Record<string, string>,
): Promise<void> {
  await Promise.all(
    connections
      .filter((connection) => connection.target.kind !== "server")
      .map(async (connection) => {
        try {
          await connection.zcodeAgentService.syncMainSystemPrompt({
            mainSystemPrompt,
            ...(kernelSystemPrompts ? { kernelSystemPrompts } : {}),
          });
        } catch (error) {
          onError(error);
        }
      }),
  );
}
