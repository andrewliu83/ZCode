import { createHash } from "node:crypto";
import {
  createNativeModelGateway,
  type ClaudeModelConnectionLease,
} from "@zcode/adapters/agent-kernel";
import type { NativeAgentRequest, Model, ModelSelection } from "@zcode/contracts";
import type { RuntimeModelFactory } from "./provider-registry-model-runtime.js";

/** SDK 原生请求 → Model 端口；注册模型别名只在本轮 lease 内有效。 */
export async function openClaudeModelGateway(
  request: NativeAgentRequest,
  createModel: RuntimeModelFactory,
): Promise<ClaudeModelConnectionLease> {
  if (!request.modelSelection) throw new Error("Select a model before using the Claude engine");
  const keys = new Map<string, string>();
  const models = new Map<string, Model>();
  const key = (selection: ModelSelection) =>
    JSON.stringify([selection.providerId, selection.modelId, selection.options ?? {}]);
  const register = (selection: ModelSelection) => {
    const identity = key(selection);
    if (keys.has(identity)) return;
    const alias = models.has(selection.modelId)
      ? `zcode-${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`
      : selection.modelId;
    const model = request.modelFactory
      ? request.modelFactory(selection)
      : createModel({ selection });
    keys.set(identity, alias);
    models.set(alias, model);
  };
  register(request.modelSelection);
  for (const [name, profile] of Object.entries(request.agents ?? {})) {
    if (!profile.modelSelection) continue;
    try {
      register(profile.modelSelection);
    } catch (error) {
      throw new Error(
        `Claude SDK subagent ${name} has an invalid model connection: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }
  const lease = await createNativeModelGateway({
    models,
    signal: request.signal,
    invocationContext: request.modelInvocationContext,
  });
  return {
    close: lease.close,
    resolveConnection: (selection) => {
      if (!selection || !keys.has(key(selection)))
        throw new Error("Model selection is outside this native execution lease");
      return {
        model: keys.get(key(selection))!,
        baseUrl: lease.baseUrl,
        apiKey: lease.apiKey,
        gateway: true,
      };
    },
  };
}
