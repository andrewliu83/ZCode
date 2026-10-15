import { expect, it } from "vitest";
import {
  createRootTraceContext,
  createSessionId,
  type SkillMetadata,
  type SkillPort,
} from "@zcode/contracts";
import { createTestAgentRuntime } from "./test-agent-runtime.js";
import { createTestSessionEventStore } from "./test-event-store.js";
import { createTestModelFactory } from "./test-runtime-model.js";

it("目录查询等待已接纳 turn 的技能快照更新，不返回工具门已切换但技能尚未就绪的中间状态", async () => {
  const sessionId = createSessionId("thinkrail-catalog-admission");
  const trace = createRootTraceContext({ sessionId });
  let enabled = false;
  let enterDiscovery!: () => void;
  const entered = new Promise<void>((resolve) => {
    enterDiscovery = resolve;
  });
  let finishDiscovery!: () => void;
  const gate = new Promise<void>((resolve) => {
    finishDiscovery = resolve;
  });
  const skill: SkillMetadata = {
    name: "choosing-a-workflow",
    description: "Router",
    path: "/builtin/choosing-a-workflow/SKILL.md",
    directory: "/builtin/choosing-a-workflow",
    rootPath: "/builtin",
    scope: "system",
    source: "bundled",
    safeToAutoLoad: true,
    frontmatterKeys: [],
  };
  const graphSkill: SkillMetadata = {
    ...skill,
    name: "spec-graph",
    path: "/builtin/spec-graph/SKILL.md",
    directory: "/builtin/spec-graph",
  };
  let enterLoad!: () => void;
  const loading = new Promise<void>((resolve) => {
    enterLoad = resolve;
  });
  let finishLoad!: () => void;
  const loadGate = new Promise<void>((resolve) => {
    finishLoad = resolve;
  });
  const skillPort: SkillPort = {
    async discoverSkills() {
      if (enabled) {
        enterDiscovery();
        await gate;
      }
      return {
        skills: enabled ? [skill, graphSkill] : [],
        diagnostics: [],
        totalDiscovered: enabled ? 2 : 0,
      };
    },
    async loadSkill(request) {
      enterLoad();
      await loadGate;
      const metadata = request.name === "spec-graph" ? graphSkill : skill;
      return {
        metadata,
        content: `LOADED_${metadata.name}`,
        baseDirectory: metadata.directory,
        bytesRead: 20,
        sizeBytes: 20,
        truncated: false,
      };
    },
  };
  const runtime = createTestAgentRuntime(
    sessionId,
    { workingDirectory: "/workspace", runtimeFeatures: { thinkrail: false } },
    {
      eventStore: createTestSessionEventStore(),
      skillPort,
      traceContext: trace,
      readThinkrailEnabled: () => enabled,
      modelFactory: createTestModelFactory({
        generateText: async () => ({ finishReason: "stop", text: "done", usage: {} }),
      }),
    },
  );
  expect((await runtime.getSkillCatalog(trace)).skills).toEqual([]);
  enabled = true;
  const turn = runtime.executeTurn("熟悉当前项目");
  await entered;
  let catalogResolved = false;
  const catalog = runtime.getSkillCatalog(trace).then((value) => {
    catalogResolved = true;
    return value;
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(catalogResolved).toBe(false);
  finishDiscovery();
  await loading;
  expect(catalogResolved).toBe(false);
  finishLoad();
  await turn;
  const loadedCatalog = await catalog;
  expect(loadedCatalog.skills.map((entry) => entry.name)).toEqual([
    "choosing-a-workflow",
    "spec-graph",
  ]);
  expect(loadedCatalog).not.toHaveProperty("preloadedSkills");
});
