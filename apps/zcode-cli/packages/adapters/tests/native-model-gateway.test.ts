import { describe, expect, it, vi } from "vitest";
import { createNativeModelGateway } from "../src/agent-kernel/model-gateway.js";
import {
  nativeMessagesSchema,
  toGatewayModelRequest,
} from "../src/agent-kernel/model-gateway-request.js";
import { getCurrentModelInvocationContext } from "@zcode/contracts";
import type { Model, ModelRequest } from "@zcode/contracts";

function fixtureModel() {
  const requests: ModelRequest[] = [];
  const generateText = vi.fn(async (request: ModelRequest) => {
    requests.push(request);
    return { text: "DONE", finishReason: "stop", usage: { inputTokens: 31, outputTokens: 4 } };
  });
  const streamText = vi.fn(async function* (request: ModelRequest) {
    requests.push(request);
    yield { type: "text_start", id: "text" };
    yield { type: "text_delta", id: "text", text: "Inspecting" };
    yield { type: "text_end", id: "text" };
    yield {
      type: "tool_call",
      toolCall: { id: "call-1", name: "Read", input: { file_path: "README.md" } },
    };
    yield {
      type: "finish",
      finishReason: "tool-calls",
      usage: { inputTokens: 31, outputTokens: 8 },
    };
  });
  const model = {
    optionSpecs: { maxOutputTokens: { min: 1, max: 4096 } },
    generateText,
    streamText,
  } as unknown as Model;
  return { model, requests, generateText, streamText };
}
const body = {
  model: "registered-model",
  messages: [{ role: "user", content: "inspect" }],
  max_tokens: 8192,
};
const controller = () => new AbortController();

describe("native model protocol gateway", () => {
  it("keeps tool IDs, structured outputs, image/PDF bytes and requested tool choice in the standard Model contract", () => {
    const request = toGatewayModelRequest(
      nativeMessagesSchema.parse({
        ...body,
        system: [{ type: "text", text: "BASE", cache_control: { type: "ephemeral" } }],
        messages: [
          {
            role: "assistant",
            content: [
              { type: "tool_use", id: "call-1", name: "Read", input: { file_path: "README.md" } },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "call-1",
                is_error: true,
                content: [{ type: "text", text: "missing" }],
              },
              {
                type: "image",
                source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" },
              },
              {
                type: "document",
                title: "fixture.pdf",
                source: { type: "base64", media_type: "application/pdf", data: "cGRm" },
              },
            ],
          },
          { role: "system", content: "SDK non-Claude model guidance" },
        ],
        tools: [{ name: "Read", input_schema: { type: "object" } }],
        tool_choice: { type: "tool", name: "Read" },
        output_config: { format: { type: "json_schema", schema: { type: "object" } } },
      }),
      controller().signal,
    );
    expect(request.messages[0]).toEqual({
      role: "system",
      content: [{ type: "text", text: "BASE" }],
    });
    expect(request.messages[1]?.toolCalls?.[0]).toEqual({
      id: "call-1",
      name: "Read",
      input: { file_path: "README.md" },
    });
    expect(request.messages[2]).toMatchObject({
      role: "tool",
      toolCallId: "call-1",
      toolName: "Read",
      isError: true,
    });
    expect(request.messages[3]?.content).toEqual([
      { type: "image", mediaType: "image/png", dataUrl: "data:image/png;base64,aGVsbG8=" },
      {
        type: "file",
        name: "fixture.pdf",
        mediaType: "application/pdf",
        dataUrl: "data:application/pdf;base64,cGRm",
      },
    ]);
    expect(request.messages.at(-1)).toEqual({
      role: "system",
      content: "SDK non-Claude model guidance",
    });
    expect(request.toolChoice).toEqual({ type: "tool", toolName: "Read" });
    expect(request.responseJsonSchema).toEqual({ type: "object" });
  });
  it("projects real text/tools/usage and never executes the listed tools itself", async () => {
    const fake = fixtureModel();
    const lease = await createNativeModelGateway({
      models: new Map([[body.model, fake.model]]),
      signal: controller().signal,
    });
    const post = (data: unknown) =>
      fetch(`${lease.baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "x-api-key": lease.apiKey, "content-type": "application/json" },
        body: JSON.stringify(data),
      });
    try {
      const plain = await post(body);
      expect(plain.status).toBe(200);
      expect(await plain.json()).toMatchObject({
        content: [{ type: "text", text: "DONE" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 31, output_tokens: 4 },
      });
      const response = await post({ ...body, stream: true });
      expect(response.headers.get("content-type")).toBe("text/event-stream");
      const events = await response.text();
      expect(events).toContain('"type":"tool_use","id":"call-1","name":"Read"');
      expect(events).toContain('"stop_reason":"tool_use"');
      expect(events).toContain('"input_tokens":31,"output_tokens":8');
      expect(events).toContain("event: message_stop");
      expect(fake.requests.every((request) => request.options?.maxOutputTokens === 4096)).toBe(
        true,
      );
      expect(fake.streamText).toHaveBeenCalledOnce();
    } finally {
      await lease.close();
    }
    await expect(fetch(`${lease.baseUrl}/v1/messages`)).rejects.toThrow();
  });
  it("keeps invocation context during iteration and propagates cancellation without a success terminator", async () => {
    const fake = fixtureModel();
    let observed: unknown;
    let cancelled = false;
    const stop = controller();
    const model = {
      ...fake.model,
      streamText: async function* (request: ModelRequest) {
        observed = getCurrentModelInvocationContext()?.metadata;
        yield { type: "text_start", id: "blocked" };
        await new Promise<void>((resolve) =>
          request.abortSignal!.addEventListener(
            "abort",
            () => {
              cancelled = true;
              resolve();
            },
            { once: true },
          ),
        );
        throw new Error("fixture upstream cancelled: must-not-leak");
      },
    } as unknown as Model;
    const lease = await createNativeModelGateway({
      models: new Map([[body.model, model]]),
      signal: stop.signal,
      invocationContext: { metadata: { nativeGatewayTest: "context-preserved" } },
    });
    try {
      const response = await fetch(`${lease.baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "x-api-key": lease.apiKey, "content-type": "application/json" },
        body: JSON.stringify({ ...body, stream: true }),
      });
      expect(observed).toEqual({ nativeGatewayTest: "context-preserved" });
      stop.abort();
      const events = await response.text();
      expect(cancelled).toBe(true);
      expect(events).toContain("event: error");
      expect(events).not.toContain("must-not-leak");
      expect(events).not.toContain("event: message_stop");
    } finally {
      await lease.close();
    }
  });
  it("rejects unauthorized requests, unknown model aliases and unsupported body instead of forwarding them", async () => {
    const fake = fixtureModel();
    const lease = await createNativeModelGateway({
      models: new Map([[body.model, fake.model]]),
      signal: controller().signal,
    });
    try {
      expect(
        (
          await fetch(`${lease.baseUrl}/v1/messages`, {
            method: "POST",
            body: JSON.stringify(body),
          })
        ).status,
      ).toBe(401);
      const headers = { "x-api-key": lease.apiKey, "content-type": "application/json" };
      expect(
        (
          await fetch(`${lease.baseUrl}/v1/messages`, {
            method: "POST",
            headers,
            body: JSON.stringify({ ...body, model: "outside-lease" }),
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await fetch(`${lease.baseUrl}/v1/messages`, {
            method: "POST",
            headers,
            body: JSON.stringify({ ...body, unsupported: true }),
          })
        ).status,
      ).toBe(400);
      expect(fake.generateText).not.toHaveBeenCalled();
      expect(fake.streamText).not.toHaveBeenCalled();
    } finally {
      await lease.close();
    }
  });
});
