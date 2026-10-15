import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { expect, it } from "vitest";
import { toAiSdkMessages, toAiSdkTools } from "../src/model/index.js";
import {
  nativeMessagesSchema,
  toGatewayModelRequest,
} from "../src/agent-kernel/model-gateway-request.js";

it.each(["anthropic", "openai"] as const)(
  "native cache boundaries reach %s wire without unsupported fields",
  async (protocol) => {
    const cache = { type: "ephemeral" as const, ttl: "1h" as const };
    const request = toGatewayModelRequest(
      nativeMessagesSchema.parse({
        model: "fixture",
        max_tokens: 100,
        system: [
          { type: "text", text: "stable", cache_control: cache },
          { type: "text", text: "dynamic" },
        ],
        tools: [
          { name: "Read", input_schema: { type: "object", properties: {} }, cache_control: cache },
        ],
        messages: [
          { role: "user", content: "read" },
          {
            role: "assistant",
            content: [{ type: "tool_use", id: "call-1", name: "Read", input: {} }],
          },
          {
            role: "user",
            content: [
              { type: "tool_result", tool_use_id: "call-1", content: "done", cache_control: cache },
            ],
          },
        ],
      }),
      new AbortController().signal,
    );
    let wire: any;
    const fetcher: typeof fetch = async (_input, init) => {
      wire = JSON.parse(String(init?.body));
      return Response.json(
        protocol === "anthropic"
          ? {
              id: "fixture",
              type: "message",
              role: "assistant",
              model: "fixture",
              content: [{ type: "text", text: "done" }],
              stop_reason: "end_turn",
              stop_sequence: null,
              usage: {
                input_tokens: 20,
                output_tokens: 4,
                cache_read_input_tokens: 70,
                cache_creation_input_tokens: 10,
              },
            }
          : {
              id: "fixture",
              object: "chat.completion",
              created: 1,
              model: "fixture",
              choices: [
                {
                  index: 0,
                  finish_reason: "stop",
                  message: { role: "assistant", content: "done" },
                },
              ],
              usage: {
                prompt_tokens: 100,
                completion_tokens: 4,
                total_tokens: 104,
                prompt_tokens_details: { cached_tokens: 70 },
              },
            },
      );
    };
    const model =
      protocol === "anthropic"
        ? createAnthropic({
            apiKey: "fixture",
            baseURL: "https://provider.test/v1",
            fetch: fetcher,
          })("fixture")
        : createOpenAI({
            apiKey: "fixture",
            baseURL: "https://provider.test/v1",
            fetch: fetcher,
          }).chat("fixture");
    const result = await generateText({
      model,
      messages: toAiSdkMessages(request.messages, { providerKind: protocol }),
      tools: toAiSdkTools(request.tools, { providerKind: protocol }),
      maxRetries: 0,
    });
    expect(result.usage.inputTokens).toBe(100);
    expect(result.usage.inputTokenDetails?.cacheReadTokens).toBe(70);
    if (protocol === "anthropic") {
      expect(wire.system).toEqual([
        { type: "text", text: "stable", cache_control: cache },
        { type: "text", text: "dynamic" },
      ]);
      expect(wire.tools[0].cache_control).toEqual(cache);
      expect(wire.messages.at(-1).content[0].cache_control).toEqual(cache);
    } else {
      expect(JSON.stringify(wire)).not.toContain("cache_control");
      expect(JSON.stringify(wire)).not.toContain("cacheControl");
    }
  },
);
