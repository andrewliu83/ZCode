import { BUILT_IN_AGENT_KERNELS, agentKernelIdSchema } from "@zcode/shared";
import type { AgentKernelKind, SessionStorePort, SessionId } from "@zcode/contracts";

export interface PersistedAgentKernel {
  kernel: AgentKernelKind;
  nativeSessionId?: string;
}

/** 恢复只看会话绑定；没有绑定的历史数据一律属于 ZCode。 */
export async function resolveAgentKernelBinding(
  store: SessionStorePort,
  sessionId: SessionId | undefined,
  resume: boolean,
  requested: AgentKernelKind | undefined,
  supports: (id: string) => boolean = (id) =>
    BUILT_IN_AGENT_KERNELS.some((kernel) => kernel.id === id),
): Promise<PersistedAgentKernel> {
  if (!resume) {
    const kernel = agentKernelIdSchema.parse(requested ?? "zcode");
    if (!supports(kernel)) throw new Error(`Unsupported agent kernel: ${kernel}`);
    return { kernel };
  }
  if (!sessionId) throw new Error("Resuming an agent kernel requires a session ID");
  const entries = await store.sessionEntries?.({ sessionID: sessionId, type: "agent_kernel" });
  if (!entries?.length) return { kernel: "zcode" };
  const entry = entries.find((value) => value.id === `agent-kernel:${sessionId}`);
  const data = entry?.data;
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("Invalid persisted agent kernel binding");
  const value = data as Record<string, unknown>;
  const kernel = agentKernelIdSchema.parse(value.kernel);
  if (!supports(kernel)) throw new Error(`Unsupported persisted agent kernel: ${kernel}`);
  if (
    value.nativeSessionId !== undefined &&
    (typeof value.nativeSessionId !== "string" || !value.nativeSessionId.trim())
  ) {
    throw new Error("Invalid persisted native agent session ID");
  }
  return { kernel, nativeSessionId: value.nativeSessionId as string | undefined };
}
