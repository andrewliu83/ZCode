import { expect, it, vi } from "vitest";
import type { Model, ModelSelection, NativeAgentRequest } from "@zcode/contracts";
import { openClaudeModelGateway } from "../src/app/claude-model-gateway.js";

const selection = (providerId: string): ModelSelection => ({
  providerId,
  modelId: "same-id",
  options: { reasoningLevel: "high" },
});
const nativeRequest = (root: ModelSelection, child: ModelSelection): NativeAgentRequest => ({
  prompt: "fixture",
  cwd: "/tmp",
  mode: "yolo",
  planEnabled: false,
  modelSelection: root,
  appendSystemPrompt: "",
  pluginRoots: [],
  tools: [],
  signal: new AbortController().signal,
  onEvent: async () => {},
  requestPermission: async () => ({ allowed: true }),
  agents: { reviewer: { description: "review", prompt: "review", modelSelection: child } },
});

it("routes same-named models from different providers through one SDK connection without changing explicit selections", async () => {
  const root = selection("parent-provider");
  const child = selection("child-provider");
  const models = new Map<string, Model>();
  const createModel = vi.fn(({ selection: chosen }: { selection: ModelSelection }) => {
    const model = {
      optionSpecs: { maxOutputTokens: { max: 1024 } },
      generateText: async () => ({
        text: chosen.providerId,
        finishReason: "stop",
        usage: { inputTokens: 3, outputTokens: 1 },
      }),
    } as unknown as Model;
    models.set(chosen.providerId, model);
    return model;
  });
  const lease = await openClaudeModelGateway(nativeRequest(root, child), createModel);
  try {
    const main = await lease.resolveConnection(root);
    const agent = await lease.resolveConnection(child);
    expect(main.baseUrl).toBe(agent.baseUrl);
    expect(main.apiKey).toBe(agent.apiKey);
    expect(main.model).not.toBe(agent.model);
    expect(createModel.mock.calls.map(([input]) => input.selection)).toEqual([root, child]);
    for (const [connection, provider] of [
      [main, root.providerId],
      [agent, child.providerId],
    ] as const) {
      const response = await fetch(`${connection.baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "x-api-key": connection.apiKey, "content-type": "application/json" },
        body: JSON.stringify({
          model: connection.model,
          messages: [{ role: "user", content: "fixture" }],
          max_tokens: 8,
        }),
      });
      expect(await response.json()).toMatchObject({ content: [{ type: "text", text: provider }] });
    }
    expect(() => lease.resolveConnection(selection("not-in-lease"))).toThrow();
  } finally {
    await lease.close();
  }
});

it("preserves the child name and original failure when an explicit connection does not exist", async () => {
  const root = selection("parent-provider");
  const child = selection("missing-provider");
  await expect(
    openClaudeModelGateway(nativeRequest(root, child), ({ selection: chosen }) => {
      if (chosen.providerId === child.providerId) throw new Error("Provider does not exist");
      return {} as Model;
    }),
  ).rejects.toThrow(
    "Claude SDK subagent reviewer has an invalid model connection: Provider does not exist",
  );
});
