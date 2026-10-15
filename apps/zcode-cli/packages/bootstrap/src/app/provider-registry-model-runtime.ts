import type { AiSdkModelAdapter } from "@zcode/adapters/model";
import type { ClaudeSdkConnection } from "@zcode/adapters/agent-kernel";
import type { Model } from "@zcode/contracts";
import type { AgentRuntimeDeps } from "@zcode/core";
import {
  type ModelSelection,
  type ModelSelectionValidation,
  type Provider,
  type ProviderModel,
  type ProviderRegistryView,
} from "@zcode/provider";
import { createRegistrySelectionProtocolError } from "./provider-registry-selection.js";

export type RuntimeModelFactory = NonNullable<AgentRuntimeDeps["modelFactory"]>;

export interface ProviderRegistryModelSource {
  getView(): ProviderRegistryView;
  getProvider(providerId: string): Provider | undefined;
  getModel(providerId: string, modelId: string): ProviderModel | undefined;
  validateSelection(selection: ModelSelection): ModelSelectionValidation;
  onDidChange(listener: () => void): () => void;
}

type ApiProviderModelAdapter = Pick<AiSdkModelAdapter, "createModel">;

interface ApiProviderModelRuntimeOptions {
  readonly registry: ProviderRegistryModelSource;
  readonly modelAdapter: ApiProviderModelAdapter;
}

/**
 * 从业务 Registry 精确查找一次完整事实，并直接创建冻结静态配置的 Model。
 */
export class ApiProviderModelRuntime {
  readonly #registry: ProviderRegistryModelSource;
  readonly #modelAdapter: ApiProviderModelAdapter;
  #started = false;

  constructor(options: ApiProviderModelRuntimeOptions) {
    this.#registry = options.registry;
    this.#modelAdapter = options.modelAdapter;
  }

  readonly modelFactory: RuntimeModelFactory = (target): Model => {
    if (!this.#started) throw new Error("ApiProviderModelRuntime 必须先 start() 再创建 Model");
    const validation = this.#registry.validateSelection(target.selection);
    if (!validation.ok) throw createRegistrySelectionProtocolError(validation);
    const providerId = target.selection.providerId;
    const modelId = target.selection.modelId;
    const provider = this.#registry.getProvider(providerId);
    if (!provider) throw new Error("Registry Selection 校验与 Provider 索引结果不一致");
    const registryModel = this.#registry.getModel(providerId, modelId);
    if (!registryModel) throw new Error("Registry Selection 校验与 Model 索引结果不一致");
    return this.#createRegistryModel(provider, registryModel, target);
  };

  readonly requiresClaudeModelGateway = (selection: ModelSelection | undefined): boolean => {
    if (!this.#started || !selection)
      throw new Error("Select a model connection before using the Claude engine");
    const validation = this.#registry.validateSelection(selection);
    if (!validation.ok) throw createRegistrySelectionProtocolError(validation);
    const provider = this.#registry.getProvider(selection.providerId);
    return (
      provider?.config.api?.type !== "anthropic-messages" ||
      provider.config.access.type === "zhipu-account"
    );
  };

  readonly claudeSdkConnection = (selection: ModelSelection | undefined): ClaudeSdkConnection => {
    if (!this.#started || !selection)
      throw new Error("Select a model connection before using the Claude SDK engine");
    const validation = this.#registry.validateSelection(selection);
    if (!validation.ok) throw createRegistrySelectionProtocolError(validation);
    const provider = this.#registry.getProvider(selection.providerId);
    const model = this.#registry.getModel(selection.providerId, selection.modelId);
    if (!provider || !model) throw new Error("Native SDK model registry selection is unavailable");
    const api = provider.config.api;
    const access = provider.config.access;
    if (
      api?.type !== "anthropic-messages" ||
      !access ||
      access.type === "zhipu-account" ||
      !access.apiKey
    ) {
      throw new Error(
        "Claude Agent SDK requires an Anthropic-compatible API key connection configured in ZCode",
      );
    }
    // SDK 使用 API 根路径；Vercel Anthropic adapter 的配置入口包含 /v1。
    const baseUrl = api.baseUrl?.replace(/\/v1\/?$/u, "");
    return {
      model: model.modelId,
      apiKey: access.apiKey,
      baseUrl,
      headers: api.headers ? { ...api.headers } : undefined,
    };
  };

  start(): void {
    if (this.#started) return;
    this.#started = true;
  }

  dispose(): void {
    this.#started = false;
  }

  #createRegistryModel(
    provider: Provider,
    registryModel: ProviderModel,
    target: Parameters<RuntimeModelFactory>[0],
  ): Model {
    const config = registryModel.config;
    // 输出预算属于单次请求，由 Agent 执行链显式决定，不能在 ModelFactory 中静默绑定。
    // Selection 已在上面的 Registry 边界完成校验，Factory 不再承担任何缺省修复。
    const normalReasoningLevel = target.selection.options!.reasoningLevel!;
    return this.#modelAdapter.createModel({
      providerId: provider.providerId,
      modelId: registryModel.modelId,
      providerConfig: provider.config,
      modelConfig: config,
      // Off-Peak 与 Highspeed 都靠执行作用域的动态 requestAuth（JWT / 计划 Key / 卡 ID header）
      // 发送，必须把承载它的 source 透传给 adapter。此门禁与 runner.ts 的 requestAuthRequired
      // 门禁一一对应：漏掉 highspeed 会在这里丢掉 source，导致 runner 端 requestAuth 缺失、
      // 本轮在发送前抛 model_request_auth_missing。
      ...(provider.config.access.type === "zhipu-account" &&
      (provider.config.access.mode === "off-peak" || provider.config.access.mode === "highspeed")
        ? {
            requestDependencies: {
              requestAuth: {
                source: target.requestDependencies?.requestAuth?.source,
              },
            },
          }
        : {}),
      options: {
        reasoningLevel: normalReasoningLevel,
      },
    });
  }
}
