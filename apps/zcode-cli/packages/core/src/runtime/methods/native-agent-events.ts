import {
  SessionEventType,
  createMessageId,
  createPartId,
  createToolCallId,
  createModelId,
  createModelProviderId,
} from "@zcode/contracts";
import type {
  NativeAgentEvent,
  NativeAgentResult,
  SessionEvent,
  MessageId,
  TraceContext,
  ToolPart,
  TurnId,
  ModelSelection,
  ModelUsage,
} from "@zcode/contracts";
import type { AgentRuntimeInternal } from "../internal.js";
import { throwIfTurnAborted } from "../helpers/turn-errors.js";

/** SDK 事实只写入 CLI 的同一展示序列，不执行工具或维护另一份会话状态。 */
export function createNativeTurnProjection(
  runtime: AgentRuntimeInternal,
  options: {
    trace: TraceContext;
    turnId: TurnId;
    userMessageId: MessageId;
    startedAt: number;
    signal: AbortSignal;
    modelSelection?: ModelSelection;
  },
  emit: (type: SessionEvent["type"], payload: unknown) => Promise<void>,
) {
  const { trace, turnId, userMessageId, startedAt, signal, modelSelection } = options;
  const messages = new Map<
    string,
    { id: MessageId; text: string; reasoning: string; started: number; model?: string }
  >();
  const tools = new Map<string, { part: ToolPart; started: number }>();
  let model: string | undefined;
  const saveMessage = async (
    message: { id: MessageId; started: number; model?: string },
    completed: boolean,
    usage?: ModelUsage,
    cost = 0,
  ) => {
    await runtime.persistMessage(
      {
        id: message.id,
        sessionID: runtime.sessionId,
        parentID: userMessageId,
        role: "assistant",
        time: { created: message.started, ...(completed ? { completed: Date.now() } : {}) },
        mode: runtime.getMode(),
        planEnabled: runtime.getPlanEnabled(),
        agent: "claude-code",
        modelId: modelSelection?.modelId
          ? createModelId(modelSelection.modelId)
          : message.model
            ? createModelId(message.model)
            : undefined,
        providerId: createModelProviderId(modelSelection?.providerId ?? "claude-code"),
        path: { cwd: runtime.workingDirectory, root: runtime.workspaceRoot },
        cost,
        tokens: {
          input: usage?.inputTokens ?? 0,
          output: usage?.outputTokens ?? 0,
          reasoning: usage?.reasoningTokens ?? 0,
          cache: { read: usage?.cacheReadTokens ?? 0, write: usage?.cacheWriteTokens ?? 0 },
        },
        anchor: { turnId },
        semantics: {
          origin: "agent_runtime",
          kind: "assistant_response",
          uiVisibility: "visible",
          providerVisibility: "visible",
          transcriptVisibility: "visible",
        },
      },
      trace,
    );
  };
  const ensureMessage = async (nativeId: string) => {
    const previous = messages.get(nativeId);
    if (previous) return previous;
    const message = {
      id: createMessageId(`msg_claude_${turnId}_${nativeId}`),
      text: "",
      reasoning: "",
      started: Date.now(),
      model,
    };
    messages.set(nativeId, message);
    await saveMessage(message, false);
    return message;
  };
  const onEvent = async (event: NativeAgentEvent) => {
    throwIfTurnAborted(signal);
    if (event.type === "session") {
      if (
        runtime.config.nativeAgentSessionId &&
        runtime.config.nativeAgentSessionId !== event.sessionId
      ) {
        throw new Error(
          "Claude returned a different session while resuming; refusing silent replacement",
        );
      }
      runtime.config.nativeAgentSessionId = event.sessionId;
      model = event.model;
      await runtime.sessionStore?.saveSessionEntry?.({
        id: `agent-kernel:${runtime.sessionId}`,
        sessionID: runtime.sessionId,
        type: "agent_kernel",
        time: { created: startedAt, updated: Date.now() },
        data: { kernel: "claude", nativeSessionId: event.sessionId },
      });
      return;
    }
    if (event.type === "text" || event.type === "reasoning") {
      const message = await ensureMessage(event.messageId);
      if (event.type === "text") message.text += event.delta;
      else message.reasoning += event.delta;
      await emit(SessionEventType.ModelStreaming, {
        assistantMessageId: message.id,
        kind: `${event.type}_${event.done ? "end" : "delta"}`,
        delta: event.delta,
        done: event.done === true,
      });
      const partID = createPartId(`part_claude_${turnId}_${event.type}_${event.messageId}`);
      await runtime.persistPart(
        {
          id: partID,
          sessionID: runtime.sessionId,
          messageID: message.id,
          type: event.type,
          text: event.type === "text" ? message.text : message.reasoning,
          time: { start: message.started, end: Date.now() },
        },
        trace,
      );
      return;
    }
    if (event.type === "tool-start") {
      const message = await ensureMessage(event.messageId);
      const id = createToolCallId(event.toolCallId);
      const now = Date.now();
      const part: ToolPart = {
        id: createPartId(`part_claude_${turnId}_tool_${event.toolCallId}`),
        sessionID: runtime.sessionId,
        messageID: message.id,
        callID: id,
        type: "tool",
        tool: event.name,
        state: { status: "running", input: event.input, time: { start: now } },
        metadata: { agentKernel: "claude" },
      };
      tools.set(event.toolCallId, { part, started: now });
      await runtime.persistPart(part, trace);
      await emit(SessionEventType.ToolCallScheduled, {
        assistantMessageId: message.id,
        toolCallId: id,
        toolName: event.name,
        input: event.input,
        schedule: { parallelGroups: [[id]], executionOrder: [id] },
      });
      await emit(SessionEventType.ToolCallStarted, {
        toolCallId: id,
        toolName: event.name,
        startedAt: new Date(now),
      });
      return;
    }
    if (event.type === "model-complete") {
      const message = await ensureMessage(event.messageId);
      await emit(SessionEventType.ModelComplete, {
        assistantMessageId: message.id,
        content: event.content,
        stopReason: "end_turn",
        usage: event.usage,
      });
      return;
    }
    const tool = tools.get(event.toolCallId);
    if (!tool) return;
    const end = Date.now();
    const input = tool.part.state.input;
    const loaded =
      tool.part.tool === "Skill"
        ? runtime.skillLoadOutcome?.skills.find(
            (skill) =>
              input.skill ===
                `${skill.source === "bundled" ? "thinkrail" : (skill.pluginName ?? "zcode")}:${skill.name}` ||
              input.skill === (skill.qualifiedName ?? skill.name),
          )
        : undefined;
    tool.part = {
      ...tool.part,
      state: event.isError
        ? { status: "error", input, error: event.output, time: { start: tool.started, end } }
        : {
            status: "completed",
            input,
            output: event.output,
            title: tool.part.tool,
            metadata: loaded
              ? { skill: { name: loaded.name, qualifiedName: loaded.qualifiedName } }
              : {},
            time: { start: tool.started, end },
          },
    };
    await runtime.persistPart(tool.part, trace);
    await emit(SessionEventType.ToolCallResult, {
      toolCallId: tool.part.callID,
      result: { success: !event.isError, content: event.output },
      duration: end - tool.started,
    });
  };

  return {
    onEvent,
    get toolCallCount() {
      return tools.size;
    },
    finish: async (result: NativeAgentResult) => {
      if (!messages.size && result.response)
        await onEvent({
          type: "text",
          messageId: `result_${turnId}`,
          delta: result.response,
          done: true,
        });
      const completed = [...messages.values()];
      for (const [index, message] of completed.entries()) {
        // 冷恢复必须看到回复终态；SDK 整轮用量只在终态消息保存一次，避免重复累计内部请求。
        const last = index === completed.length - 1;
        await saveMessage(
          message,
          true,
          last ? result.usage : undefined,
          last ? result.costUsd : undefined,
        );
        await emit(SessionEventType.ModelStreaming, {
          assistantMessageId: message.id,
          kind: "finish",
          delta: "",
          done: true,
        });
      }
    },
  };
}
