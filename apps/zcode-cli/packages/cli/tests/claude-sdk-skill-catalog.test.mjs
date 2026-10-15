import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { resolveCjsModuleMetadata } from "../scripts/build.mjs";

const runtimePath = process.env.ZCODE_CLAUDE_SDK_EXECUTABLE;
const require = createRequire(import.meta.url);
const bundledRoot = fileURLToPath(new URL("../../bundled-skills/skills", import.meta.url));

async function transcriptFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await transcriptFiles(path)));
    else if (entry.name.endsWith(".jsonl")) files.push(path);
  }
  return files;
}

function modelFixture(requests) {
  return createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    response.setHeader("content-type", "application/json");
    if (request.url?.includes("count_tokens")) {
      response.end(JSON.stringify({ input_tokens: 1000 }));
      return;
    }
    requests.push(body);
    const message = {
      id: "msg_catalog",
      type: "message",
      role: "assistant",
      model: body.model,
      content: [{ type: "text", text: "CATALOG_OK" }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1000, output_tokens: 20 },
    };
    if (!body.stream) {
      response.end(JSON.stringify(message));
      return;
    }
    response.setHeader("content-type", "text/event-stream");
    const send = (event, data) =>
      response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    send("message_start", {
      type: "message_start",
      message: { ...message, content: [], stop_reason: null },
    });
    send("content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    });
    send("content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "CATALOG_OK" },
    });
    send("content_block_stop", { type: "content_block_stop", index: 0 });
    send("message_delta", {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 20 },
    });
    send("message_stop", { type: "message_stop" });
    response.end();
  });
}

test(
  "真实 SDK 的目录遵守冻结预算，必需 ThinkRail 正文首轮可见且无伪造 Skill 调用",
  {
    skip:
      !runtimePath || !existsSync(runtimePath)
        ? "需要已准备的 ZCODE_CLAUDE_SDK_EXECUTABLE；不下载或调用外部 CLI"
        : false,
    timeout: 120_000,
  },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "sdk-catalog-regression-"));
    const requests = [];
    const fixture = modelFixture(requests);
    const bundle = join(root, "adapter.cjs");
    try {
      await build({
        ...resolveCjsModuleMetadata(),
        stdin: {
          contents:
            'export { ClaudeAgentKernel } from "@zcode/adapters/agent-kernel"; export { NodeSkillAdapter } from "@zcode/adapters/skills"; export { createContextBuilder, preloadThinkrailSkills } from "@zcode/core";' +
            ` export { query } from ${JSON.stringify(createRequire(new URL("../../adapters/package.json", import.meta.url)).resolve("@anthropic-ai/claude-agent-sdk/core"))};`,
          resolveDir: dirname(fileURLToPath(new URL("../package.json", import.meta.url))),
          sourcefile: "catalog-fixture.mjs",
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
        NodeSkillAdapter,
        createContextBuilder,
        preloadThinkrailSkills,
        query,
      } = require(bundle);
      const port = new NodeSkillAdapter();
      const bundled = { path: bundledRoot, scope: "system", source: "bundled", priority: 0 };
      const existing = await port.discoverSkills({ workingDirectory: root, roots: [bundled] });
      const fakeRoot = join(root, "skills");
      for (let i = 0; i < 96 - existing.skills.length; i++) {
        const name = `fixture-${String(i).padStart(3, "0")}`;
        const path = join(fakeRoot, name);
        await mkdir(path, { recursive: true });
        await writeFile(
          join(path, "SKILL.md"),
          `---\nname: ${name}\ndescription: ${"Controlled catalog trigger description. ".repeat(7)}\n---\nFixture.\n`,
        );
      }
      const catalog = await port.discoverSkills({
        workingDirectory: root,
        roots: [bundled, { path: fakeRoot, source: "agents", scope: "user", priority: 1 }],
      });
      assert.equal(catalog.skills.length, 96);
      const toolNames = ["Skill", "spec_grep", "spec_get", "spec_graph"];
      const loaded = await preloadThinkrailSkills({
        enabled: true,
        toolNames,
        outcome: catalog,
        port,
        workingDirectory: root,
      });
      const section = createContextBuilder({
        workingDirectory: root,
        envInfo: {
          cwd: root,
          platform: "fixture",
          shell: "fixture",
          osVersion: "fixture",
          nodeVersion: "24",
        },
        skills: loaded,
        guidanceToolNames: toolNames,
        thinkrail: {
          enabled: true,
          specRule: "Specs before code.",
          workflowRule: "Follow the loaded workflow entry.",
        },
      })
        .build()
        .sections.find((section) => section.source === "thinkrail");
      assert.ok(section);
      await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
      const summaries = [];
      for (const [characterBudget, maxDescriptionChars] of [
        [8000, 1536],
        [40000, 1536],
        [40000, 80],
        [0, 1536],
      ]) {
        const state = join(root, `state-${characterBudget}-${maxDescriptionChars}`);
        const events = [];
        requests.length = 0;
        // 先模拟旧版整会话快照，再验证新适配器恢复时能更新正文，而不只测试新会话。
        let legacySnapshot = characterBudget === 8000;
        const kernel = new ClaudeAgentKernel({
          query: (args) => {
            if (!legacySnapshot) return query(args);
            legacySnapshot = false;
            return query({
              ...args,
              options: {
                ...args.options,
                systemPrompt: { ...args.options.systemPrompt, snapshot: true },
              },
            });
          },
          sdkRuntimePath: runtimePath,
          stateDirectory: state,
          skillPluginCacheRoot: join(state, "plugins"),
          env: {
            HOME: root,
            PATH: "/no-external-cli",
            SLASH_COMMAND_TOOL_CHAR_BUDGET: "999999",
            CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
          },
          resolveConnection: () => ({
            model: "glm-fixture",
            apiKey: "local-fixture",
            baseUrl: `http://127.0.0.1:${fixture.address().port}`,
          }),
        });
        const admittedRequest = {
          prompt: "请熟悉当前项目",
          cwd: root,
          mode: "yolo",
          planEnabled: false,
          baseSystemPrompt:
            characterBudget === 40_000 && maxDescriptionChars === 1536
              ? undefined
              : "Isolated catalog fixture.",
          appendSystemPrompt: section.content,
          skills: catalog.skills,
          skillListingPolicy: { characterBudget, maxDescriptionChars },
          pluginRoots: [],
          tools: [],
          signal: AbortSignal.timeout(45_000),
          onEvent: async (event) => events.push(event),
          requestPermission: async () => ({ allowed: true }),
        };
        const result = await kernel.run(admittedRequest);
        assert.equal(result.response, "CATALOG_OK");
        assert.equal(
          events.filter((event) => event.type === "tool-start" && event.name === "Skill").length,
          0,
        );
        const system = JSON.stringify(requests[0].system);
        assert.ok(system.includes("Existing code without a spec graph takes priority"));
        assert.ok(system.includes('<preloaded_skill name=\\"spec-graph\\">'));
        const lines = [];
        for (const path of await transcriptFiles(state)) {
          for (const line of (await readFile(path, "utf8")).split("\n").filter(Boolean)) {
            const attachment = JSON.parse(line).attachment;
            if (attachment?.type === "skill_listing")
              lines.push(
                ...attachment.content
                  .split("\n")
                  .filter((line) => /^- (?:thinkrail|zcode):/u.test(line)),
              );
          }
        }
        assert.equal(lines.length, 96);
        const described = lines.filter((line) => line.includes(": "));
        assert.ok(
          described.every(
            (line) => line.split(": ").slice(1).join(": ").length <= maxDescriptionChars,
          ),
        );
        summaries.push(described.length);
        if (characterBudget === 8000) {
          requests.length = 0;
          const resumed = await kernel.run({
            ...admittedRequest,
            resumeSessionId: result.sessionId,
            appendSystemPrompt: section.content + "\nRESUMED_ENTRY_CONTEXT",
            skillListingPolicy: { characterBudget: 40_000, maxDescriptionChars: 80 },
            signal: AbortSignal.timeout(45_000),
          });
          assert.equal(resumed.sessionId, result.sessionId);
          assert.ok(
            JSON.stringify(requests[0].system).includes("RESUMED_ENTRY_CONTEXT"),
            JSON.stringify({
              requests: requests.length,
              markers: requests.map((request) => ({
                system: JSON.stringify(request.system).includes("RESUMED_ENTRY_CONTEXT"),
                anywhere: JSON.stringify(request).includes("RESUMED_ENTRY_CONTEXT"),
                messages: request.messages?.length,
                systemTail: JSON.stringify(request.system).slice(-220),
              })),
            }),
          );
          requests.length = 0;
          const off = await kernel.run({
            ...admittedRequest,
            resumeSessionId: resumed.sessionId,
            appendSystemPrompt: "",
            skills: catalog.skills.filter((skill) => skill.source !== "bundled"),
            signal: AbortSignal.timeout(45_000),
          });
          assert.equal(off.sessionId, result.sessionId);
          assert.ok(
            !JSON.stringify(requests[0].system).includes(
              "Existing code without a spec graph takes priority",
            ),
          );
        }
      }
      assert.ok(summaries[1] > summaries[0], "larger explicit budget preserves more descriptions");
      assert.equal(summaries[1], 96);
      assert.equal(summaries[2], 96);
      assert.equal(summaries[3], 0);
    } finally {
      delete require.cache[bundle];
      fixture.closeAllConnections();
      if (fixture.listening) await new Promise((resolve) => fixture.close(resolve));
      await rm(root, { recursive: true, force: true });
    }
  },
);
