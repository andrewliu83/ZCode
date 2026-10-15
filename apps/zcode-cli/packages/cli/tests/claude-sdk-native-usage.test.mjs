import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { resolveCjsModuleMetadata } from "../scripts/build.mjs";

const runtimePath = process.env.ZCODE_CLAUDE_SDK_EXECUTABLE;
const require = createRequire(import.meta.url);
test(
  "real bundled SDK counts text and two tool blocks as one model request with canonical cache usage",
  {
    skip:
      !runtimePath || !existsSync(runtimePath) ? "requires prepared bundled SDK runtime" : false,
    timeout: 90000,
  },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "sdk-usage-regression-"));
    const bundle = join(root, "adapter.cjs");
    const requests = [];
    const fixture = createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      if (request.url?.includes("count_tokens")) {
        response.end(JSON.stringify({ input_tokens: 100 }));
        return;
      }
      requests.push(body);
      const first = requests.length === 1;
      const content = first
        ? [
            { type: "text", text: "Inspect both nodes." },
            {
              type: "tool_use",
              id: "tool_a",
              name: "mcp__zcode_thinkrail__spec_get",
              input: { id: "A" },
            },
            {
              type: "tool_use",
              id: "tool_b",
              name: "mcp__zcode_thinkrail__spec_get",
              input: { id: "B" },
            },
            { type: "text", text: " Await both results." },
          ]
        : [{ type: "text", text: "USAGE_OK" }];
      const usage = first
        ? {
            input_tokens: 20,
            output_tokens: 9,
            cache_read_input_tokens: 70,
            cache_creation_input_tokens: 10,
          }
        : {
            input_tokens: 30,
            output_tokens: 3,
            cache_read_input_tokens: 50,
            cache_creation_input_tokens: 0,
          };
      const message = {
        id: `msg_${requests.length}`,
        type: "message",
        role: "assistant",
        model: body.model,
        content,
        stop_reason: first ? "tool_use" : "end_turn",
        stop_sequence: null,
        usage,
      };
      if (!body.stream) {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(message));
        return;
      }
      response.setHeader("content-type", "text/event-stream");
      const send = (event, data) =>
        response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      send("message_start", {
        type: "message_start",
        message: {
          ...message,
          content: [],
          stop_reason: null,
          usage: { ...usage, output_tokens: 0 },
        },
      });
      for (const [index, block] of content.entries()) {
        send("content_block_start", {
          type: "content_block_start",
          index,
          content_block:
            block.type === "text" ? { type: "text", text: "" } : { ...block, input: {} },
        });
        send("content_block_delta", {
          type: "content_block_delta",
          index,
          delta:
            block.type === "text"
              ? { type: "text_delta", text: block.text }
              : { type: "input_json_delta", partial_json: JSON.stringify(block.input) },
        });
        send("content_block_stop", { type: "content_block_stop", index });
      }
      send("message_delta", {
        type: "message_delta",
        delta: { stop_reason: message.stop_reason, stop_sequence: null },
        usage,
      });
      send("message_stop", { type: "message_stop" });
      response.end();
    });
    try {
      await build({
        ...resolveCjsModuleMetadata(),
        stdin: {
          contents: 'export { ClaudeAgentKernel } from "@zcode/adapters/agent-kernel";',
          resolveDir: dirname(fileURLToPath(new URL("../package.json", import.meta.url))),
          sourcefile: "usage-fixture.mjs",
        },
        bundle: true,
        platform: "node",
        target: "node24",
        format: "cjs",
        outfile: bundle,
        logLevel: "silent",
      });
      const { ClaudeAgentKernel } = require(bundle);
      await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
      const events = [];
      let executed = 0;
      const kernel = new ClaudeAgentKernel({
        sdkRuntimePath: runtimePath,
        stateDirectory: join(root, "state"),
        env: {
          HOME: root,
          PATH: "/no-external-cli",
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        },
        resolveConnection: () => ({
          model: "glm-fixture",
          apiKey: "fixture",
          baseUrl: `http://127.0.0.1:${fixture.address().port}`,
        }),
      });
      const result = await kernel.run({
        prompt: "Inspect the two fixture nodes.",
        cwd: root,
        mode: "yolo",
        planEnabled: false,
        baseSystemPrompt: "Isolated usage fixture.",
        appendSystemPrompt: "",
        skills: [],
        pluginRoots: [],
        tools: [
          {
            name: "spec_get",
            description: "Read a fixture node",
            inputSchema: {
              type: "object",
              properties: { id: { type: "string" } },
              required: ["id"],
            },
            execute: async () => {
              executed++;
              return "fixture node";
            },
          },
        ],
        signal: AbortSignal.timeout(45000),
        requestPermission: async () => ({ allowed: true }),
        onEvent: async (event) => events.push(event),
      });
      assert.equal(requests.length, 2);
      assert.equal(executed, 2);
      assert.equal(events.filter((event) => event.type === "tool-start").length, 2);
      assert.equal(events.filter((event) => event.type === "tool-result").length, 2);
      const complete = events.filter((event) => event.type === "model-complete");
      assert.equal(complete.length, 2, JSON.stringify(complete));
      assert.deepEqual(
        complete.map((event) => event.usage),
        [
          { inputTokens: 100, outputTokens: 9, cacheReadTokens: 70, cacheWriteTokens: 10 },
          { inputTokens: 80, outputTokens: 3, cacheReadTokens: 50, cacheWriteTokens: 0 },
        ],
      );
      assert.equal(complete[0].content, "Inspect both nodes. Await both results.");
      assert.equal(result.response, "USAGE_OK");
      assert.deepEqual(result.usage, {
        inputTokens: 180,
        outputTokens: 12,
        cacheReadTokens: 120,
        cacheWriteTokens: 10,
      });
    } finally {
      delete require.cache[bundle];
      fixture.closeAllConnections();
      if (fixture.listening) await new Promise((resolve) => fixture.close(resolve));
      await rm(root, { recursive: true, force: true });
    }
  },
);
