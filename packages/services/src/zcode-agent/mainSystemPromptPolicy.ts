import {
  zcodeProtocolMethods,
  zcodeWorkspaceUpdateSystemPromptPolicyResultSchema,
  type ZCodeWorkspaceRef,
} from "@zcode/shared";
import type { ZCodeProtocolClient } from "./zcodeProtocolClient.js";
import type { ZCodeAgentWorkspaceTarget } from "./zcodeAgent.js";

interface ClientEntry {
  client: ZCodeProtocolClient;
  workspace: ZCodeAgentWorkspaceTarget;
}

/** Settings 唯一持久化，附属 remote 仅持有 desktop 推送缓存；每 workspace 串行追平。 */
export function createMainSystemPromptPolicySync(options: {
  resolve?: () => Promise<string | undefined>;
  forward?: (value: string | undefined) => void | Promise<void>;
  entries: () => Iterable<ClientEntry>;
  workspaceKey: (workspace: ZCodeAgentWorkspaceTarget) => string;
  workspaceRef: (workspace: ZCodeAgentWorkspaceTarget) => ZCodeWorkspaceRef;
  methodNotFound: (error: unknown) => boolean;
}) {
  let pushed: string | undefined;
  let signals = Promise.resolve();
  const pending = new Map<string, Promise<void>>();
  const applied = new WeakMap<ZCodeProtocolClient, string>();
  const unsupported = new WeakSet<ZCodeProtocolClient>();
  const resolve = async () => (options.resolve ? await options.resolve() : pushed)?.trim() || "";
  function update(entry: ClientEntry): Promise<void> {
    const key = options.workspaceKey(entry.workspace);
    const next = (pending.get(key) ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        if (entry.client.isDisposed || unsupported.has(entry.client)) return;
        const value = await resolve();
        if (value === (applied.get(entry.client) ?? "")) return;
        try {
          await entry.client.request(
            zcodeProtocolMethods.workspaceUpdateSystemPromptPolicy,
            {
              workspace: options.workspaceRef(entry.workspace),
              mainSystemPrompt: value,
            },
            zcodeWorkspaceUpdateSystemPromptPolicyResultSchema,
          );
          applied.set(entry.client, value);
        } catch (error) {
          if (!options.methodNotFound(error)) throw error;
          unsupported.add(entry.client);
        }
      });
    pending.set(key, next);
    void next
      .finally(() => {
        if (pending.get(key) === next) pending.delete(key);
      })
      .catch(() => undefined);
    return next;
  }
  return {
    update,
    async sync(value: string | undefined) {
      pushed = value;
      const next = signals
        .catch(() => undefined)
        .then(async () => {
          const authoritative = await resolve();
          await options.forward?.(authoritative || undefined);
          await Promise.all([...options.entries()].map(update));
        });
      signals = next;
      await next;
    },
  };
}
