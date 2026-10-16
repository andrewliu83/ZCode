import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { NativeAgentRequest, NativeAgentEvent } from "@zcode/contracts";
import type { query } from "@anthropic-ai/claude-agent-sdk/core";
import { ClaudeStreamProjection } from "../src/agent-kernel/claude-stream-projection.js";
import { ClaudeAgentKernel } from "../src/agent-kernel/claude.js";
import { nativeSdkPrompt } from "../src/agent-kernel/prompt.js";

function request(overrides: Partial<NativeAgentRequest> = {}): NativeAgentRequest {
  return {
    prompt: "inspect",
    cwd: "/tmp",
    mode: "default",
    planEnabled: false,
    appendSystemPrompt: "Keep ThinkRail",
    pluginRoots: [],
    tools: [],
    signal: new AbortController().signal,
    onEvent: async () => {},
    requestPermission: async () => ({ allowed: false }),
    ...overrides,
  };
}

function stream() {
  const nativeId = randomUUID();
  const generator = (async function* () {
    yield { type: "system", subtype: "init", session_id: nativeId, model: "configured-model" };
    yield {
      type: "stream_event",
      parent_tool_use_id: null,
      event: {
        type: "message_start",
        message: { id: "message-1", usage: { input_tokens: 0, output_tokens: 0 } },
      },
    };
    yield {
      type: "stream_event",
      parent_tool_use_id: null,
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "hello" } },
    };
    yield {
      type: "assistant",
      parent_tool_use_id: null,
      message: {
        id: "message-1",
        content: [
          { type: "text", text: "hello" },
          { type: "tool_use", id: "tool-1", name: "Read", input: { file_path: "README.md" } },
        ],
      },
    };
    yield {
      type: "user",
      parent_tool_use_id: null,
      message: {
        content: [{ type: "tool_result", tool_use_id: "tool-1", content: "read result" }],
      },
    };
    yield {
      type: "result",
      subtype: "success",
      is_error: false,
      result: "hello",
      session_id: nativeId,
      total_cost_usd: 0,
    };
  })();
  return Object.assign(generator, { close: vi.fn() });
}

describe("bundled Claude Agent SDK bridge", () => {
  it("clears inherited exporters and disables SDK reporting even without a skill budget", async () => {
    const runQuery = vi.fn((_params: Parameters<typeof query>[0]) => stream());
    const kernel = new ClaudeAgentKernel({
      query: runQuery as unknown as typeof query,
      resolveConnection: () => ({ model: "test", apiKey: "test-key" }),
      env: {
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example.invalid",
        CLAUDE_CODE_ENABLE_TELEMETRY: "1",
        DISABLE_TELEMETRY: "0",
        DISABLE_ERROR_REPORTING: "0",
      },
    });
    await kernel.run(request());
    const options = runQuery.mock.calls[0]![0].options!;
    expect(options.env).not.toHaveProperty("OTEL_EXPORTER_OTLP_ENDPOINT");
    expect(options.env).not.toHaveProperty("CLAUDE_CODE_ENABLE_TELEMETRY");
    expect(options.env).toMatchObject({
      DISABLE_TELEMETRY: "1",
      DISABLE_ERROR_REPORTING: "1",
      OTEL_SDK_DISABLED: "true",
    });
    expect(JSON.parse(String(options.settings)).env).toEqual({
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      CLAUDE_CODE_ENABLE_TELEMETRY: "0",
      DISABLE_TELEMETRY: "1",
      DISABLE_ERROR_REPORTING: "1",
      OTEL_SDK_DISABLED: "true",
    });
  });

  it("does not close streaming usage when early tool results interleave before final message_delta", async () => {
    const events: NativeAgentEvent[] = [];
    const state = new ClaudeStreamProjection(
      request({
        onEvent: async (event) => {
          events.push(event);
        },
      }),
    );
    const accept = (message: unknown) =>
      state.accept(message as Parameters<ClaudeStreamProjection["accept"]>[0]);
    await accept({
      type: "stream_event",
      parent_tool_use_id: null,
      event: {
        type: "message_start",
        message: {
          id: "interleaved",
          usage: {
            input_tokens: 20,
            output_tokens: 0,
            cache_read_input_tokens: 70,
            cache_creation_input_tokens: 10,
          },
        },
      },
    });
    await accept({
      type: "assistant",
      parent_tool_use_id: null,
      message: {
        id: "interleaved",
        content: [],
        usage: {
          input_tokens: 20,
          output_tokens: 0,
          cache_read_input_tokens: 70,
          cache_creation_input_tokens: 10,
        },
      },
    });
    await accept({ type: "user", parent_tool_use_id: null, message: { content: [] } });
    expect(events.filter((event) => event.type === "model-complete")).toHaveLength(0);
    await accept({
      type: "stream_event",
      parent_tool_use_id: null,
      event: { type: "message_delta", usage: { output_tokens: 9 } },
    });
    await accept({
      type: "stream_event",
      parent_tool_use_id: null,
      event: { type: "message_stop" },
    });
    expect(events.filter((event) => event.type === "model-complete")).toEqual([
      expect.objectContaining({
        usage: { inputTokens: 100, outputTokens: 9, cacheReadTokens: 70, cacheWriteTokens: 10 },
      }),
    ]);
  });
  it("counts final usage once per native message across text/tool fragments and excludes children", async () => {
    const completions: NativeAgentEvent[] = [];
    const rawUsage = {
      input_tokens: 20,
      output_tokens: 1,
      cache_read_input_tokens: 70,
      cache_creation_input_tokens: 10,
    };
    const native = Object.assign(
      (async function* () {
        yield { type: "system", subtype: "init", session_id: "native-fixture", model: "test" };
        for (const output of [1, 4, 9])
          yield {
            type: "assistant",
            parent_tool_use_id: null,
            message: {
              id: "request-1",
              content: [{ type: "text", text: "first" }],
              usage: { ...rawUsage, output_tokens: output },
            },
          };
        yield { type: "user", parent_tool_use_id: null, message: { content: [] } };
        yield {
          type: "assistant",
          parent_tool_use_id: "child-tool",
          message: { id: "child", content: [], usage: rawUsage },
        };
        yield {
          type: "assistant",
          parent_tool_use_id: null,
          message: {
            id: "request-2",
            content: [{ type: "text", text: "second" }],
            usage: { ...rawUsage, output_tokens: 11 },
          },
        };
        yield {
          type: "result",
          subtype: "success",
          is_error: false,
          session_id: "native-fixture",
          result: "second",
          total_cost_usd: 0,
          usage: {
            input_tokens: 40,
            output_tokens: 20,
            cache_read_input_tokens: 140,
            cache_creation_input_tokens: 20,
          },
        };
      })(),
      { close: vi.fn() },
    );
    const kernel = new ClaudeAgentKernel({
      query: vi.fn(() => native) as unknown as typeof query,
      resolveConnection: () => ({ model: "test", apiKey: "fixture" }),
      env: {},
    });
    const result = await kernel.run(
      request({
        onEvent: async (event) => {
          if (event.type === "model-complete") completions.push(event);
        },
      }),
    );
    expect(completions).toEqual([
      expect.objectContaining({
        messageId: "request-1",
        content: "first",
        usage: { inputTokens: 100, outputTokens: 9, cacheReadTokens: 70, cacheWriteTokens: 10 },
      }),
      expect.objectContaining({
        messageId: "request-2",
        content: "second",
        usage: { inputTokens: 100, outputTokens: 11, cacheReadTokens: 70, cacheWriteTokens: 10 },
      }),
    ]);
    expect(result.usage).toEqual({
      inputTokens: 200,
      outputTokens: 20,
      cacheReadTokens: 140,
      cacheWriteTokens: 20,
    });
  });
  it.each([false, true])(
    "releases the per-turn model connection on completion or failure: invalid=%s",
    async (invalid) => {
      const close = vi.fn(async () => {});
      const native = stream();
      const kernel = new ClaudeAgentKernel({
        resolveConnection: () => {
          throw new Error("Must use leased model connection");
        },
        openConnection: async () => ({
          close,
          resolveConnection: () => ({
            model: "leased-model",
            apiKey: invalid ? "" : "lease-token",
            gateway: true,
          }),
        }),
        query: vi.fn(() => native) as unknown as typeof query,
        env: {},
      });
      if (invalid) await expect(kernel.run(request())).rejects.toThrow("Configure an API key");
      else
        await expect(kernel.run(request())).resolves.toMatchObject({
          response: "hello",
          costUsd: undefined,
        });
      expect(close).toHaveBeenCalledOnce();
    },
  );

  it("keeps each routed subagent model and clears the external global override", async () => {
    const runQuery = vi.fn(() => stream());
    const kernel = new ClaudeAgentKernel({
      query: runQuery as unknown as typeof query,
      resolveConnection: (selected) => ({
        model: selected?.modelId ?? "parent",
        apiKey: "lease",
        baseUrl: "http://127.0.0.1:1",
        gateway: true,
      }),
      env: { CLAUDE_CODE_SUBAGENT_MODEL: "outside-model" },
    });
    await kernel.run(
      request({
        agents: {
          reviewer: {
            description: "review",
            prompt: "review",
            modelSelection: { providerId: "child-provider", modelId: "child-model" },
          },
        },
      }),
    );
    const options = (
      runQuery.mock.calls as unknown as [{ options: Parameters<typeof query>[0]["options"] }][]
    )[0]![0].options!;
    expect(options.env?.CLAUDE_CODE_SUBAGENT_MODEL).toBeUndefined();
    expect(options.env?.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("parent");
    expect(options.agents?.reviewer?.model).toBe("child-model");
  });

  it("passes resolved image and PDF bytes as native SDK user message content", async () => {
    const prompt = nativeSdkPrompt(
      request({
        inputContent: [
          { type: "image", mediaType: "image/png", dataUrl: "data:image/png;base64,aGVsbG8=" },
          {
            type: "file",
            mediaType: "application/pdf",
            name: "fixture.pdf",
            dataUrl: "data:application/pdf;base64,cGRm",
          },
        ],
      }),
    );
    if (typeof prompt === "string") throw new Error("Expected multimodal input");
    const messages = [];
    for await (const message of prompt) messages.push(message);
    expect(messages[0]?.message.content).toEqual([
      { type: "text", text: "inspect" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" } },
      {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: "cGRm" },
        title: "fixture.pdf",
      },
    ]);
  });

  it("keeps AskUserQuestion connected to host UI even in yolo mode", async () => {
    const sdkStream = stream();
    const runQuery = vi.fn(() => sdkStream);
    const requestPermission = vi.fn(async () => ({
      allowed: true,
      input: { questions: [], answers: { choice: "A" } },
    }));
    const kernel = new ClaudeAgentKernel({
      query: runQuery as unknown as typeof query,
      resolveConnection: () => ({ model: "test", apiKey: "test-key" }),
      env: {},
    });
    await kernel.run(request({ mode: "yolo", requestPermission }));
    const options = (
      runQuery.mock.calls as unknown as [{ options: Parameters<typeof query>[0]["options"] }][]
    )[0]![0].options!;
    await expect(
      options.canUseTool!(
        "AskUserQuestion",
        { questions: [] },
        { signal: new AbortController().signal, toolUseID: "question-1" },
      ),
    ).resolves.toMatchObject({ behavior: "allow", updatedInput: { answers: { choice: "A" } } });
    expect(requestPermission).toHaveBeenCalledOnce();
    await options.canUseTool!(
      "Read",
      { file_path: "README.md" },
      { signal: new AbortController().signal, toolUseID: "read-1" },
    );
    expect(requestPermission).toHaveBeenCalledOnce();
  });

  it("overrides the selected kernel's base while retaining read-only extension and native skill discovery", async () => {
    const runQuery = vi.fn(() => stream());
    const kernel = new ClaudeAgentKernel({
      query: runQuery as unknown as typeof query,
      resolveConnection: () => ({ model: "test", apiKey: "test-key" }),
      env: {},
    });
    await kernel.run(request({ baseSystemPrompt: "CLAUDE OVERRIDE" }));
    const options = (
      runQuery.mock.calls as unknown as [{ options: Parameters<typeof query>[0]["options"] }][]
    )[0]![0].options!;
    expect(options.systemPrompt).toEqual({
      type: "custom",
      prompt: "CLAUDE OVERRIDE\n\nKeep ThinkRail",
      snapshot: false,
    });
    expect(options.verbatimPrompts).toBe(false);
    await kernel.run(request({ baseSystemPrompt: " " }));
    expect(
      (
        runQuery.mock.calls as unknown as [{ options: Parameters<typeof query>[0]["options"] }][]
      )[1]![0].options!.systemPrompt,
    ).toMatchObject({ type: "preset", preset: "claude_code", append: "Keep ThinkRail" });
  });

  it("uses configured API auth without external CLI login and preserves native skill injection", async () => {
    const sdkStream = stream();
    const runQuery = vi.fn(() => sdkStream);
    const events: NativeAgentEvent[] = [];
    const kernel = new ClaudeAgentKernel({
      query: runQuery as unknown as typeof query,
      resolveConnection: () => ({
        model: "configured-model",
        apiKey: "test-api-key",
        baseUrl: "http://127.0.0.1:1234",
        headers: { "x-fixture": "1" },
      }),
      env: {
        PATH: "/no-external-cli",
        CLAUDE_CODE_OAUTH_TOKEN: "external-login",
        ANTHROPIC_AUTH_TOKEN: "external-auth",
      },
      stateDirectory: "/tmp/zcode-sdk-state",
    });
    await expect(
      kernel.run(
        request({
          onEvent: async (event) => {
            events.push(event);
          },
          toolAllowlist: ["Read", "Skill"],
          toolDenylist: ["Bash"],
        }),
      ),
    ).resolves.toMatchObject({ response: "hello" });
    const options = (
      runQuery.mock.calls as unknown as [{ options: Record<string, unknown> }][]
    )[0]![0].options;
    expect(options.env).toMatchObject({
      ANTHROPIC_API_KEY: "test-api-key",
      ANTHROPIC_MODEL: "configured-model",
      CLAUDE_CONFIG_DIR: "/tmp/zcode-sdk-state",
    });
    expect(options.env).not.toHaveProperty("CLAUDE_CODE_OAUTH_TOKEN");
    expect(options.env).not.toHaveProperty("ANTHROPIC_AUTH_TOKEN");
    expect(options).not.toHaveProperty("pathToClaudeCodeExecutable");
    expect(options).toMatchObject({
      verbatimPrompts: false,
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: "Keep ThinkRail",
        snapshot: false,
      },
      tools: ["Read", "Skill"],
      disallowedTools: ["Bash"],
    });
    expect(
      events
        .filter((event) => event.type === "text")
        .map((event) => event.delta)
        .join(""),
    ).toBe("hello");
    expect(events.filter((event) => event.type === "tool-start")).toHaveLength(1);
    expect(events.filter((event) => event.type === "tool-result")).toHaveLength(1);
    expect(sdkStream.close).toHaveBeenCalledOnce();
  });

  it("identifies an invalid subagent model without changing its explicit selection", async () => {
    const runQuery = vi.fn(() => stream());
    const kernel = new ClaudeAgentKernel({
      query: runQuery as unknown as typeof query,
      resolveConnection: (selection) => {
        if (selection?.providerId === "removed") throw new Error("Provider not found");
        return { model: "main", apiKey: "test-key" };
      },
      env: {},
    });
    await expect(
      kernel.run(
        request({
          agents: {
            fixer: {
              description: "Review",
              prompt: "Read only",
              tools: ["Read"],
              modelSelection: { providerId: "removed", modelId: "pinned" },
            },
          },
        }),
      ),
    ).rejects.toThrow(
      "Claude SDK subagent fixer has an invalid model connection: Provider not found",
    );
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("preserves user subagent prompts, tool restrictions and same-connection model selection", async () => {
    const runQuery = vi.fn(() => stream());
    const kernel = new ClaudeAgentKernel({
      query: runQuery as unknown as typeof query,
      resolveConnection: (selection) => ({
        model: selection?.modelId ?? "main",
        apiKey: "test-key",
      }),
      env: {},
    });
    await kernel.run(
      request({
        agents: {
          fixer: {
            description: "Review only",
            prompt: "USER FIXER PROMPT",
            tools: ["Read"],
            modelSelection: { providerId: "fixture", modelId: "subagent-model" },
            maxTurns: 3,
          },
        },
      }),
    );
    const options = (
      runQuery.mock.calls as unknown as [{ options: Record<string, unknown> }][]
    )[0]![0].options;
    expect(options.agents).toMatchObject({
      fixer: { prompt: "USER FIXER PROMPT", tools: ["Read"], model: "subagent-model", maxTurns: 3 },
    });
  });

  it("translates subagent spec permissions to SDK MCP tool names", async () => {
    const runQuery = vi.fn(() => stream());
    const kernel = new ClaudeAgentKernel({
      query: runQuery as unknown as typeof query,
      resolveConnection: () => ({ model: "main", apiKey: "test-key" }),
      env: {},
    });
    await kernel.run(
      request({
        agents: {
          explorer: {
            description: "Read spec",
            prompt: "Explore",
            tools: ["Read", "spec_get"],
            disallowedTools: ["spec_write"],
          },
        },
      }),
    );
    const options = (
      runQuery.mock.calls as unknown as [{ options: Record<string, unknown> }][]
    )[0]![0].options;
    expect(options.agents).toMatchObject({
      explorer: {
        tools: ["Read", "mcp__zcode_thinkrail__spec_get"],
        disallowedTools: ["mcp__zcode_thinkrail__spec_write"],
      },
    });
  });

  it("passes cancellation into SDK and closes the stream on a projection failure", async () => {
    const sdkStream = stream();
    const runQuery = vi.fn(() => sdkStream);
    const controller = new AbortController();
    const kernel = new ClaudeAgentKernel({
      query: runQuery as unknown as typeof query,
      resolveConnection: () => ({ model: "test", apiKey: "test-key" }),
      env: {},
    });
    await expect(
      kernel.run(
        request({
          signal: controller.signal,
          onEvent: async () => {
            controller.abort();
            throw new Error("projection failed");
          },
        }),
      ),
    ).rejects.toThrow("projection failed");
    const options = (
      runQuery.mock.calls as unknown as [{ options: Record<string, unknown> }][]
    )[0]![0].options;
    expect((options.abortController as AbortController).signal.aborted).toBe(true);
    expect(sdkStream.close).toHaveBeenCalledOnce();
  });
});
