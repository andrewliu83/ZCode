import { describe, expect, it } from "vitest";
import { AgentRuntime } from "../src/runtime/agent-runtime.js";
import { InMemorySessionEventStore, SessionEventType, createSessionId } from "@zcode/contracts";
import type { NativeAgentKernelPort } from "@zcode/contracts";

function runtime(kernel: NativeAgentKernelPort, kind = "claude") {
  return new AgentRuntime(
    createSessionId(),
    { agentKernel: kind, workingDirectory: "/tmp", mode: "build" },
    {
      eventStore: new InMemorySessionEventStore(),
      nativeAgentKernel: kernel,
      modelFactory: () => {
        throw new Error("ZCode model loop must not run for Claude");
      },
    },
  );
}

describe("native Claude kernel admission", () => {
  it("runs the native loop and publishes text and already-executed tool events", async () => {
    const agent = runtime({
      run: async (request) => {
        await request.onEvent({
          type: "session",
          sessionId: "native-session",
          model: "claude-sonnet",
        });
        await request.onEvent({ type: "text", messageId: "native-message", delta: "Inspecting" });
        await request.onEvent({
          type: "model-complete",
          messageId: "native-message",
          content: "Inspecting",
          usage: { inputTokens: 20, outputTokens: 5, cacheReadTokens: 10 },
        });
        await request.onEvent({
          type: "tool-start",
          messageId: "native-message",
          toolCallId: "native-call",
          name: "Skill",
          input: { skill: "choosing-a-workflow" },
        });
        await request.onEvent({
          type: "tool-result",
          toolCallId: "native-call",
          output: "router loaded",
          isError: false,
        });
        return {
          sessionId: "native-session",
          response: "done",
          model: "claude-sonnet",
          usage: { inputTokens: 20, outputTokens: 8, cacheReadTokens: 10 },
        };
      },
    });
    const result = await agent.executeTurn("请熟悉当前项目");
    expect(result.response).toBe("done");
    expect(result.usage).toMatchObject({ inputTokens: 20, outputTokens: 8, cacheReadTokens: 10 });
    expect(result.events.some((event) => event.type === SessionEventType.ToolCallStarted)).toBe(
      true,
    );
    expect(result.events.some((event) => event.type === SessionEventType.ToolCallResult)).toBe(
      true,
    );
    expect(
      result.events.filter((event) => event.type === SessionEventType.TurnComplete),
    ).toHaveLength(1);
  });
  it("a third registered kernel enters the native port instead of the ZCode model loop", async () => {
    const agent = runtime(
      { run: async (request) => ({ sessionId: "third-native", response: request.prompt }) },
      "fixture-agent",
    );
    expect(agent.getAgentKernel()).toBe("fixture-agent");
    expect((await agent.executeTurn("third engine input")).response).toBe("third engine input");
  });

  it("serializes future inputs through the existing runtime inbox", async () => {
    const calls: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const agent = runtime({
      run: async (request) => {
        calls.push(request.prompt);
        if (calls.length === 1) await gate;
        return { sessionId: "native-session", response: request.prompt };
      },
    });
    const first = agent.executeTurn("one");
    const second = agent.executeTurn("two");
    await Promise.resolve();
    release();
    await Promise.all([first, second]);
    expect(calls).toEqual(["one", "two"]);
  });
  it("records failure without falling back to the ZCode engine", async () => {
    const agent = runtime({
      run: async () => {
        throw new Error("native resume rejected");
      },
    });
    await expect(agent.executeTurn("continue")).rejects.toMatchObject({
      cause: { message: "native resume rejected" },
    });
    const events = await agent.getSessionEventStore().getEvents(agent.getSessionId());
    expect(events.some((event) => event.type === SessionEventType.TurnError)).toBe(true);
  });
});
