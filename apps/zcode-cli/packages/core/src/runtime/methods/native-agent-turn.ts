import { refreshContextPolicy } from "./context-policy.js";
import { createTurnModel } from "./turn-model.js";
import {
  resolveTurnAttachments,
  summarizeTurnAttachmentsForEvent,
} from "../helpers/attachments.js";
import { THINKRAIL_SKILL_NAMES } from "@zcode/thinkrail";
import { nativeThinkrailRules } from "./native-agent-prompt.js";
import { nativeAgentProfiles } from "./native-agent-profiles.js";
import { createNativeTurnProjection } from "./native-agent-events.js";
import {
  resolveSkillListingPolicy,
  CoreErrorType,
  SessionEventType,
  createChildTraceContext,
  createMessageId,
  createToolCallId,
  createTurnId,
  createModelUsageSummary,
  createModelUsageSummaryFromEvents,
} from "@zcode/contracts";
import type { SessionEvent, TraceContext } from "@zcode/contracts";
import type { TurnState } from "../deps.js";
import type { AgentRuntimeInternal } from "../internal.js";
import type { ActiveTurnStartReservation, ExecuteTurnOptions, TurnResult } from "../types.js";
import {
  appendTurnOutcomeEvent,
  createTurnAbortScope,
  createTurnFailureError,
  throwIfTurnAborted,
} from "../helpers/turn-errors.js";

/** CLI 保持 admission/生命周期所有权；SDK 的工具事件仅投影，不能再次执行。 */
export async function executeNativeAgentTurn(
  runtime: AgentRuntimeInternal,
  input: string,
  attachments: TurnState["attachments"] | undefined,
  options: ExecuteTurnOptions | undefined,
  reservation?: ActiveTurnStartReservation,
): Promise<TurnResult> {
  const turnId = reservation?.turnId ?? createTurnId();
  const trace =
    reservation?.traceContext ??
    createChildTraceContext(options?.traceContext ?? runtime.rootTraceContext, {
      sessionId: runtime.sessionId,
      turnId,
    });
  const scope = createTurnAbortScope(options?.abortSignal);
  const events: SessionEvent[] = [];
  const startedAt = Date.now();
  const userMessageId = options?.recordedInputMessageId ?? createMessageId();
  const displayInput = options?.displayInput ?? input;
  const enabled =
    runtime.readThinkrailEnabled?.() ?? runtime.config.runtimeFeatures?.thinkrail === true;
  const userPrompt = runtime.readMainSystemPrompt
    ? runtime.readMainSystemPrompt(runtime.config.agentKernel ?? "zcode")
    : runtime.config.mainSystemPrompt;
  const modelSelection = options?.intent?.modelSelection ?? runtime.getSessionModelSelection();
  let active: ReturnType<AgentRuntimeInternal["beginActiveTurn"]> | undefined;
  const emit = async (type: SessionEvent["type"], payload: unknown) => {
    const event = runtime.createEvent(type, payload, trace);
    await runtime.appendEvent(event, trace);
    events.push(event);
  };
  try {
    throwIfTurnAborted(scope.signal);
    if (!reservation) runtime.reserveTurnStart(turnId, trace, "regular");
    await runtime.ensureSessionPersisted(displayInput, trace);
    // 原生内核可能自行管理模型；只读 Catalog 能力，不能为目录预算强制创建 ZCode Model。
    const contextWindow = modelSelection
      ? runtime.modelCatalogPort
          ?.listModels()
          .find(
            (entry) =>
              entry.providerId === modelSelection.providerId &&
              entry.modelId === modelSelection.modelId,
          )?.contextWindow
      : undefined;
    const projection = createNativeTurnProjection(
      runtime,
      {
        trace,
        turnId,
        userMessageId,
        startedAt,
        signal: scope.signal,
        modelSelection,
        contextWindow,
      },
      emit,
    );
    await runtime.ensureContextInitialized(trace);
    await refreshContextPolicy(runtime, trace, {
      thinkrailEnabled: enabled,
      mainSystemPrompt: userPrompt,
    });
    await runtime.prepareAgentDefinitions({
      signal: scope.signal,
      traceContext: trace,
      thinkrailEnabled: enabled,
    });
    active = runtime.beginActiveTurn(turnId, trace, "regular", false, {
      ...(options?.inputId ? { inputId: options.inputId } : {}),
    });
    await emit(SessionEventType.TurnStarted, {
      turnNumber: runtime.turnNumber,
      input: displayInput,
      messageId: userMessageId,
      inputId: options?.inputId,
      intent: options?.intent,
      attachments: summarizeTurnAttachmentsForEvent(attachments),
      executionStartedAt: performance.timeOrigin + performance.now(),
    });
    const resolvedAttachments = await resolveTurnAttachments(attachments, {
      abortSignal: scope.signal,
      artifactStore: runtime.artifactStore,
      fileSystemPort: runtime.fileSystemPort,
      imageProcessorPort: runtime.imageProcessorPort,
      sessionId: runtime.sessionId,
      traceContext: trace,
      turnId,
      workingDirectory: runtime.workingDirectory,
    });
    if (options?.skipInputRecord !== true) {
      await runtime.persistUserPrompt(userMessageId, displayInput, resolvedAttachments, trace, {
        intent: options?.intent,
        sessionInputId: options?.intent?.queueItemId,
        sourceCommandId: options?.inputId,
      });
    }
    if (!runtime.nativeAgentKernel)
      throw new Error(`Agent kernel ${runtime.config.agentKernel} is unavailable`);
    const result = await runtime.nativeAgentKernel.run({
      prompt: input,
      inputContent: resolvedAttachments.map((attachment) => attachment.contentBlock),
      modelSelection,
      skillListingPolicy: resolveSkillListingPolicy({
        contextWindow,
        metadataBudget: runtime.config.skillMetadataBudget,
        listingBudgetFraction: runtime.config.skillListingBudgetFraction,
        maxDescriptionChars: runtime.config.skillListingMaxDescChars,
      }),
      modelFactory: (selection) =>
        createTurnModel(runtime, {
          selection,
          requestDependencies: options?.modelExecution?.requestDependencies,
        }),
      modelInvocationContext: {
        traceContext: trace,
        modelCall: {
          actorKind: runtime.agentTelemetry.actorKind,
          operation: "agent_step",
          operationId: trace.spanId,
        },
        metadata: { sessionId: runtime.sessionId, turnId, workspacePath: runtime.workingDirectory },
      },
      cwd: runtime.workingDirectory,
      resumeSessionId: runtime.config.nativeAgentSessionId,
      mode: runtime.getMode(),
      planEnabled: runtime.getPlanEnabled(),
      baseSystemPrompt: userPrompt?.trim() || undefined,
      appendSystemPrompt: nativeThinkrailRules(runtime, enabled),
      pluginRoots: runtime.config.nativeAgentPluginRoots ?? [],
      signal: scope.signal,
      onEvent: projection.onEvent,
      skills: runtime.skillLoadOutcome?.skills.filter(
        (skill) => skill.source !== "bundled" || THINKRAIL_SKILL_NAMES.includes(skill.name),
      ),
      toolAllowlist: runtime.config.toolAllowlist,
      toolDenylist: runtime.config.toolDisallowlist,
      agents: nativeAgentProfiles(
        runtime.getAgentDefinitions().activeAgents,
        runtime.nativeAgentKernel.builtInAgents,
      ),
      tools: enabled ? nativeSpecTools(runtime, scope.signal, trace) : [],
      requestPermission: async (request) => {
        if (request.name === "AskUserQuestion") {
          const entry = runtime.registry.get(request.name);
          const executor = runtime.getToolExecutor();
          if (!entry || !executor.authorizeAppTool)
            throw new Error("Native user interaction is unavailable");
          const approved = await executor.authorizeAppTool(
            { id: createToolCallId(request.toolCallId), name: request.name, input: request.input },
            entry,
            { signal: scope.signal, traceContext: trace },
          );
          return { allowed: true, input: approved as Record<string, unknown> };
        }
        const response = await runtime.permissionBroker.requestPermission(
          {
            requestId: `native-permission:${request.toolCallId}`,
            sessionId: runtime.sessionId,
            turnId,
            traceId: trace.traceId,
            toolCallId: createToolCallId(request.toolCallId),
            toolName: request.name,
            input: request.input,
            mode: runtime.getMode(),
            ruleId: `native-${runtime.config.agentKernel}`,
            reason: `${runtime.config.agentKernel} requests permission`,
            riskLevel: "high",
            requestedAt: new Date(),
          },
          { signal: scope.signal },
        );
        return {
          allowed: response.decision === "allow",
          reason: response.reason,
          input: response.modifiedInput as Record<string, unknown> | undefined,
        };
      },
    });
    throwIfTurnAborted(scope.signal);
    await projection.finish(result);
    const observedUsage = createModelUsageSummaryFromEvents(events);
    // SDK 的终态 usage 包含原生子代理等内部请求；不能只用主线程流式快照的零值覆盖它。
    const usage = result.usage
      ? {
          ...createModelUsageSummary([result.usage])!,
          modelRequestCount: observedUsage?.modelRequestCount ?? 1,
        }
      : observedUsage;
    await emit(SessionEventType.TurnComplete, {
      response: result.response,
      usage,
      tokenCount: 0,
      toolCallCount: projection.toolCallCount,
      duration: Date.now() - startedAt,
      resultType: "success",
      inputId: options?.inputId,
    });
    runtime.turnNumber++;
    return {
      response: result.response,
      turnId,
      traceId: trace.traceId,
      usage,
      events,
      projection: await runtime.rebuildProjection(),
    };
  } catch (error) {
    const coreError = createTurnFailureError(error, scope.signal, "Claude Code execution failed");
    await appendTurnOutcomeEvent(runtime, {
      coreError,
      events,
      durationMs: Date.now() - startedAt,
      turnPhase: "native_agent",
      inputId: options?.inputId,
      traceContext: trace,
      fallbackMessage: "Claude Code execution failed",
      logEvent: "turn.failed",
      logLabel: "Claude Code",
    });
    if (coreError.type !== CoreErrorType.TurnCancelled) {
      runtime.queueAutoDrain = false;
      runtime.queueExternalDrainActive = false;
    }
    throw coreError;
  } finally {
    scope.dispose();
    if (active) runtime.finishActiveTurn(active);
    runtime.releaseTurnStart(turnId);
  }
}

function nativeSpecTools(runtime: AgentRuntimeInternal, signal: AbortSignal, trace: TraceContext) {
  return runtime
    .getTools()
    .filter((tool) => tool.name.startsWith("spec_"))
    .map((tool) => ({
      name: tool.name,
      description: tool.description ?? tool.name,
      inputSchema: tool.inputSchema,
      execute: async (input: Record<string, unknown>) => {
        const entry = runtime.registry.get(tool.name);
        if (!entry) throw new Error(`Native tool is unavailable: ${tool.name}`);
        // 修复依据：先复用既有 MCP 校验/审批入口；SDK 拥有工具结果投影，不能重复发出执行事件。
        const executor = runtime.getToolExecutor();
        if (!executor.authorizeAppTool)
          throw new Error("Native MCP tool authorization is unavailable");
        const id = createToolCallId();
        const approved = await executor.authorizeAppTool({ id, name: tool.name, input }, entry, {
          signal,
          traceContext: trace,
        });
        const result = await entry.handler(approved, {
          toolCallId: id,
          abortSignal: signal,
          traceId: trace.traceId,
          traceContext: trace,
          workingDirectory: runtime.workingDirectory,
          workspaceRoot: runtime.workspaceRoot,
          sessionId: runtime.sessionId,
          turnId: trace.turnId,
          fileSystemPort: runtime.fileSystemPort,
          sessionStore: runtime.sessionStore,
          workspaceIdentity: runtime.config.workspaceIdentity,
        });
        return typeof result === "string" ? result : JSON.stringify(result);
      },
    }));
}
