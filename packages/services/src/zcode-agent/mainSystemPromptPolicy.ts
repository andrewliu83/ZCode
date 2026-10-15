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
type KernelPrompts = Record<string, string>;

/** Settings 唯一持久化；remote 缓存按 workspace 串行追平整个内核正文策略。 */
export function createMainSystemPromptPolicySync(options: {
  resolvePolicy?: () => Promise<{ mainSystemPrompt?: string; kernelSystemPrompts?: KernelPrompts }>;
  resolve?: () => Promise<string | undefined>;
  resolveKernels?: () => Promise<KernelPrompts | undefined>;
  forward?: (value: string | undefined, kernels?: KernelPrompts) => void | Promise<void>;
  entries: () => Iterable<ClientEntry>;
  workspaceKey: (workspace: ZCodeAgentWorkspaceTarget) => string;
  workspaceRef: (workspace: ZCodeAgentWorkspaceTarget) => ZCodeWorkspaceRef;
  methodNotFound: (error: unknown) => boolean;
}) {
  let pushed: string | undefined;
  let pushedKernels: KernelPrompts | undefined;
  let signals = Promise.resolve();
  const pending = new Map<string, Promise<void>>();
  const applied = new WeakMap<ZCodeProtocolClient, string>();
  const unsupported = new WeakSet<ZCodeProtocolClient>();
  const resolve = async () => {
    // 一次读取同一设置快照，防止并发保存时把旧 ZCode 正文与新内核正文拼成混合策略。
    const policy = options.resolvePolicy
      ? await options.resolvePolicy()
      : {
          mainSystemPrompt: options.resolve ? await options.resolve() : pushed,
          kernelSystemPrompts: options.resolveKernels
            ? await options.resolveKernels()
            : pushedKernels,
        };
    return { ...policy, mainSystemPrompt: policy.mainSystemPrompt?.trim() || "" };
  };
  function update(entry: ClientEntry): Promise<void> {
    const key = options.workspaceKey(entry.workspace);
    const next = (pending.get(key) ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        if (entry.client.isDisposed || unsupported.has(entry.client)) return;
        const policy = await resolve();
        const kernels = policy.kernelSystemPrompts;
        const fingerprint = JSON.stringify([policy.mainSystemPrompt, kernels ?? {}]);
        if (fingerprint === (applied.get(entry.client) ?? JSON.stringify(["", {}]))) return;
        try {
          await entry.client.request(
            zcodeProtocolMethods.workspaceUpdateSystemPromptPolicy,
            {
              workspace: options.workspaceRef(entry.workspace),
              mainSystemPrompt: policy.mainSystemPrompt,
              ...(kernels && Object.keys(kernels).length ? { kernelSystemPrompts: kernels } : {}),
            },
            zcodeWorkspaceUpdateSystemPromptPolicyResultSchema,
          );
          applied.set(entry.client, fingerprint);
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
    async sync(value: string | undefined, kernels?: KernelPrompts) {
      pushed = value;
      pushedKernels = kernels;
      const next = signals
        .catch(() => undefined)
        .then(async () => {
          const authoritative = await resolve();
          await options.forward?.(
            authoritative.mainSystemPrompt || undefined,
            authoritative.kernelSystemPrompts,
          );
          await Promise.all([...options.entries()].map(update));
        });
      signals = next;
      await next;
    },
  };
}
