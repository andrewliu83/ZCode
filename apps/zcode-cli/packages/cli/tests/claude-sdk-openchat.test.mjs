import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  "真实 SDK 经 Built-in Chat 兜底完成工具回合，不混入导致严格网关 500 的 reasoning 对象",
  {
    skip: !runtimePath || !existsSync(runtimePath) ? "需要已准备的随包 SDK 运行时" : false,
    timeout: 60_000,
  },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "sdk-openchat-regression-"));
    const requests = [];
    let lease;
    const upstream = createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      requests.push(body);
      // 复现真实上游的类型限制；不能让宽松夹具吞掉错误字段而再次漏测。
      if (body.reasoning && typeof body.reasoning === "object") {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            error: { message: "Chat reasoning cannot deserialize Object into byte[]" },
          }),
        );
        return;
      }
      const first = requests.length === 1;
      response.writeHead(200, { "content-type": "text/event-stream" });
      const chunk = (delta, finishReason) => ({
        id: `chat_fixture_${requests.length}`,
        object: "chat.completion.chunk",
        created: 1,
        model: body.model,
        choices: [{ index: 0, delta, finish_reason: finishReason }],
      });
      const delta = first
        ? {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: "call_read",
                type: "function",
                function: {
                  name: "Read",
                  arguments: JSON.stringify({ file_path: join(root, "README.md") }),
                },
              },
            ],
          }
        : { role: "assistant", content: "OPENCHAT_OK" };
      response.write(`data: ${JSON.stringify(chunk(delta, null))}\n\n`);
      response.write(`data: ${JSON.stringify(chunk({}, first ? "tool_calls" : "stop"))}\n\n`);
      response.write(
        `data: ${JSON.stringify({ ...chunk({}, null), choices: [], usage: { prompt_tokens: 32, completion_tokens: 8, total_tokens: 40 } })}\n\n`,
      );
      response.end("data: [DONE]\n\n");
    });
    const bundle = join(root, "adapter.cjs");
    try {
      await writeFile(join(root, "README.md"), "OPENCHAT_READ_BODY\n");
      await build({
        ...resolveCjsModuleMetadata(),
        stdin: {
          contents:
            'export { ClaudeAgentKernel, createNativeModelGateway } from "@zcode/adapters/agent-kernel"; export { AiSdkModelAdapter } from "@zcode/adapters/model"; export { parseZCodeBuiltinModelConfigRules, createRegistryModelConfig, createRegistryProviderConfig, parseProviderConfig } from "@zcode/provider";',
          resolveDir: dirname(
            fileURLToPath(new URL("../../adapters/package.json", import.meta.url)),
          ),
          sourcefile: "openchat-fixture.mjs",
        },
        bundle: true,
        platform: "node",
        target: "node24",
        format: "cjs",
        outfile: bundle,
        logLevel: "silent",
      });
      const {
        ClaudeAgentKernel,
        createNativeModelGateway,
        AiSdkModelAdapter,
        parseZCodeBuiltinModelConfigRules,
        createRegistryModelConfig,
        createRegistryProviderConfig,
        parseProviderConfig,
      } = require(bundle);
      const release = JSON.parse(
        await readFile(
          new URL("../../../../../config/provider/zcode-builtin.json", import.meta.url),
          "utf8",
        ),
      );
      const modelId = "gongsi/glm-5.3-flash";
      await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
      const baseUrl = `http://127.0.0.1:${upstream.address().port}/v1`;
      const modelConfig = createRegistryModelConfig(
        parseZCodeBuiltinModelConfigRules(release.config.modelConfigRules).resolve({
          providerId: "fixture",
          modelId,
          apiType: "openai-chat-completions",
          baseUrl,
        }),
      );
      const providerConfig = createRegistryProviderConfig(
        parseProviderConfig({
          group: "standard-personal",
          access: { type: "api-key", apiKey: "fixture" },
          api: { type: "openai-chat-completions", baseUrl },
        }),
      );
      assert.ok(
        modelConfig.ok && providerConfig.ok,
        "完整配置必须从实际 Built-in 规则解析，不能手写一份正确 Map 掩盖缺陷",
      );
      const model = new AiSdkModelAdapter({ env: {}, retry: { maxAttempts: 1 } }).createModel({
        providerId: "fixture",
        modelId,
        providerConfig: providerConfig.config,
        modelConfig: modelConfig.config,
        options: { reasoningLevel: "max", maxOutputTokens: 4096 },
      });
      const events = [];
      let closed = false;
      const kernel = new ClaudeAgentKernel({
        sdkRuntimePath: runtimePath,
        stateDirectory: join(root, "state"),
        env: {
          HOME: root,
          PATH: "/no-external-cli",
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        },
        resolveConnection: () => {
          throw new Error("Only the controlled model gateway is allowed");
        },
        openConnection: async (request) => {
          lease = await createNativeModelGateway({
            models: new Map([[modelId, model]]),
            signal: request.signal,
          });
          return {
            resolveConnection: () => ({
              model: modelId,
              apiKey: lease.apiKey,
              baseUrl: lease.baseUrl,
              gateway: true,
            }),
            close: async () => {
              closed = true;
              await lease.close();
            },
          };
        },
      });
      const result = await kernel.run({
        prompt: "Read README.md and report.",
        cwd: root,
        mode: "yolo",
        planEnabled: false,
        baseSystemPrompt: "Local protocol fixture. Use the provided tools.",
        appendSystemPrompt: "",
        pluginRoots: [],
        tools: [],
        toolAllowlist: ["Read"],
        signal: AbortSignal.timeout(40_000),
        onEvent: async (event) => events.push(event),
        requestPermission: async () => ({ allowed: true }),
      });
      assert.equal(result.response, "OPENCHAT_OK");
      assert.equal(requests.length, 2);
      assert.equal(
        events.filter((event) => event.type === "tool-start" && event.name === "Read").length,
        1,
      );
      assert.ok(JSON.stringify(requests[1].messages).includes("OPENCHAT_READ_BODY"));
      for (const body of requests) {
        assert.equal(body.model, modelId);
        assert.equal(body.reasoning_effort, "max");
        assert.equal(body.thinking.type, "enabled");
        assert.equal(body.enable_thinking, true);
        assert.equal(Object.hasOwn(body, "reasoning"), false);
      }
      assert.equal(closed, true);
      assert.equal(result.costUsd, undefined);
    } finally {
      await lease?.close();
      upstream.closeAllConnections();
      await new Promise((resolve) => upstream.close(resolve));
      delete require.cache[bundle];
      await rm(root, { recursive: true, force: true });
    }
  },
);
