import { expect, it, vi } from "vitest";
import { createSessionId } from "@zcode/contracts";
import { createTestAgentRuntime } from "./test-agent-runtime.js";
import { createTestSessionEventStore } from "./test-event-store.js";
import { createTestModelFactory } from "./test-runtime-model.js";

it("无遥测端口时自动压缩仍按实际用量决策，并保留本地诊断", async () => {
  const info = vi.fn();
  const logger = { child: () => logger, debug: vi.fn(), error: vi.fn(), info, warn: vi.fn() };
  let mainRequests = 0;
  let compactionRequests = 0;
  const runtime = createTestAgentRuntime(
    createSessionId("local-auto-compact"),
    {
      maxOutputTokens: 64_000,
      modelContextBudgetStrategy: "preflight-v1",
      modelStreaming: "off",
    },
    {
      eventStore: createTestSessionEventStore(),
      logger,
      modelFactory: createTestModelFactory({
        properties: { contextWindow: 128_000 },
        async generateText(_request, observation) {
          // 本地调用上下文仍用于鉴权和诊断，不依赖已删除的 OTLP span。
          if (observation.invocationContext?.modelCall?.operation === "context_compaction") {
            compactionRequests += 1;
            return {
              finishReason: "stop",
              text: "<summary>Local compact summary.</summary>",
              toolCalls: [],
              usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
            };
          }
          mainRequests += 1;
          return {
            finishReason: "stop",
            text: `response-${mainRequests}`,
            toolCalls: [],
            usage:
              mainRequests === 8
                ? { inputTokens: 94_001, outputTokens: 1, totalTokens: 94_002 }
                : { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
          };
        },
      } as never),
    },
  );
  try {
    // 需要可压缩的旧轮次；只有一轮历史会被正常的 recent-tail 保护跳过。
    for (let index = 0; index < 8; index++) await runtime.executeTurn(`seed-${index}`);
    await runtime.executeTurn("trigger auto compact");
    expect(compactionRequests).toBe(1);
    expect(mainRequests).toBe(9);
    const decision = info.mock.calls
      .map((call) => call[1])
      .find((context) => context?.event === "compact.auto.started");
    expect(decision).toMatchObject({
      contextWindow: 128_000,
      threshold: 94_000,
      tokenSource: "provider_usage",
    });
  } finally {
    await runtime.closeBrowserSession();
  }
});
