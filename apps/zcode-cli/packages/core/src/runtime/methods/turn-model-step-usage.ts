import type { MessageId, Model, TraceContext } from "../deps.js";
import type { RuntimeModelTextResult } from "../types.js";
import type { AgentRuntimeInternal } from "../internal.js";
import type { RegularTurnLoopState } from "./turn-loop-state.js";
import type { RuntimeMessageEntry } from "../../agent/message-history.js";
import {
  persistedTokenUsageBaseline,
  type PersistedTokenUsageBaseline,
} from "../../agent/message-history-usage.js";
import { recordModelUsageFact } from "./usage-observability.js";
import { querySourceForTask } from "./turn-cache-usage.js";
export {
  querySourceForTask,
  recordMainTurnCacheHitUsage,
  mainTurnCacheHitAggregateFromMessages,
} from "./turn-cache-usage.js";

interface RecordMainTurnModelUsageInput {
  assistantMessageId: MessageId;
  error?: unknown;
  model: Model;
  modelTraceContext: TraceContext;
  networkEventStartIndex: number;
  result?: RuntimeModelTextResult;
  startedAt: number;
  status: "completed" | "error" | "cancelled";
  toolCallCount?: number;
}

export async function recordMainTurnModelUsage(
  runtime: AgentRuntimeInternal,
  state: RegularTurnLoopState,
  input: RecordMainTurnModelUsageInput,
): Promise<void> {
  await recordModelUsageFact(runtime, {
    assistantMessageId: input.assistantMessageId,
    error: input.error,
    events: state.events,
    // 运行中切模会立即更新 Session Selection；usage 若在 await 后重新读取它，
    // 就会把旧请求的 token 归到新模型。这里只消费 model step 开始时的不可变快照。
    model: input.model,
    networkEventStartIndex: input.networkEventStartIndex,
    parentUserMessageId: state.currentUserMessageId,
    querySource: querySourceForTask(runtime.config.taskType),
    result: input.result,
    startedAt: input.startedAt,
    status: input.status,
    toolCallCount: input.toolCallCount,
    traceContext: input.modelTraceContext,
  });
}

export function findLatestCommittedAssistantUsage(
  sourceEntries: readonly (RuntimeMessageEntry | undefined)[],
): { messageIndex: number; baseline: PersistedTokenUsageBaseline } | undefined {
  for (let messageIndex = sourceEntries.length - 1; messageIndex >= 0; messageIndex--) {
    const entry = sourceEntries[messageIndex];
    if (!entry || entry.kind === "attachment" || entry.message.role !== "assistant") continue;
    const baseline = persistedTokenUsageBaseline(entry.tokens);
    if (baseline) return { messageIndex, baseline };
  }
  return undefined;
}
