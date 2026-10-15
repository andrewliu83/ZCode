import { expect, it, vi } from "vitest";
import { SessionEventType } from "@zcode/contracts";
import { mainTurnCacheHitAggregateFromMessages } from "../src/runtime/methods/turn-model-step-usage.js";
import { createNativeTurnProjection } from "../src/runtime/methods/native-agent-events.js";
import type { AgentRuntimeInternal } from "../src/runtime/internal.js";

it("native main request usage stays identical in live cache aggregation and persisted messages", async () => {
  const saved = new Map<string, any>();
  const events: { type: string; payload: any }[] = [];
  const runtime = {
    config: { agentKernel: "claude" },
    sessionId: "session-fixture",
    workingDirectory: "/fixture",
    workspaceRoot: "/fixture",
    getMode: () => "build",
    getPlanEnabled: () => false,
    persistMessage: vi.fn(async (message: any) => {
      saved.set(message.id, message);
    }),
    mainTurnCacheHitAggregate: {
      requestCount: 0,
      totalInputTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
    },
  } as unknown as AgentRuntimeInternal;
  const projection = createNativeTurnProjection(
    runtime,
    {
      trace: {} as never,
      turnId: "turn-fixture" as never,
      userMessageId: "user-fixture" as never,
      startedAt: Date.now(),
      signal: new AbortController().signal,
      contextWindow: 200000,
    },
    async (type, payload) => {
      events.push({ type, payload });
    },
  );
  await projection.onEvent({
    type: "model-complete",
    messageId: "request-1",
    content: "first",
    usage: { inputTokens: 100, outputTokens: 9, cacheReadTokens: 70 },
  });
  await projection.onEvent({
    type: "model-complete",
    messageId: "request-2",
    content: "second",
    usage: { inputTokens: 50, outputTokens: 3, cacheReadTokens: 20 },
  });
  // SDK result can include native child/internal calls; it must not replace main-thread facts.
  await projection.finish({
    sessionId: "native-fixture",
    response: "second",
    usage: { inputTokens: 999, outputTokens: 33, cacheReadTokens: 888 },
  });
  const complete = events.filter((event) => event.type === SessionEventType.ModelComplete);
  expect(complete).toHaveLength(2);
  expect(complete[1]!.payload).toMatchObject({
    contextWindow: 200000,
    querySource: "main_turn",
    cacheHit: {
      hitRate: 0.6,
      latestHitRate: 0.4,
      hitRateRequestCount: 2,
      totalInputTokens: 150,
      totalCacheReadTokens: 90,
    },
  });
  const persisted = [...saved.values()].map((info) => ({ info, parts: [] }));
  expect(
    mainTurnCacheHitAggregateFromMessages({
      activeMessages: persisted,
      persistedMessages: persisted,
    }),
  ).toEqual({
    requestCount: 2,
    totalInputTokens: 150,
    totalCacheReadTokens: 90,
    totalCacheWriteTokens: 0,
  });
  expect([...saved.values()].map((message) => message.tokens.input)).toEqual([100, 50]);
  expect([...saved.values()].map((message) => message.tokens.cache.read)).toEqual([70, 20]);
});
