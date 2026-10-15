// ThinkRail 的五个具名 subagent 预设（docs/thinkrail/design.md D6）。
//
// 断言的是「开关决定名单」这件事的两个方向，以及一条不能妥协的语义：**关掉时未命中要自解释**，
// 不能静默降级成 general-purpose（用户以为在用一个受限的审查 agent，实际拿到全权限）。

import { describe, expect, it } from "vitest";
import {
  applyThinkrailAgentProfiles,
  createAgentDefinitionsReader,
  createThinkrailAgentProfiles,
  THINKRAIL_AGENT_TYPES,
} from "../src/subagent/index.js";

const presetNames = Object.values(THINKRAIL_AGENT_TYPES);

describe("ThinkRail subagent 预设", () => {
  it("五个预设：名字、内置来源、工具白名单都不为空", () => {
    const profiles = createThinkrailAgentProfiles();
    expect(profiles.map((profile) => profile.name).sort()).toEqual([...presetNames].sort());
    for (const profile of profiles) {
      expect(profile.source).toBe("built-in");
      expect(profile.description.length, profile.name).toBeGreaterThan(0);
      expect(profile.systemPrompt.length, profile.name).toBeGreaterThan(0);
      expect(profile.tools?.length ?? 0, profile.name).toBeGreaterThan(0);
    }
  });

  it("只读预设不拿写工具；能写的预设才拿 Edit/Write", () => {
    const byName = new Map(createThinkrailAgentProfiles().map((p) => [p.name, p]));
    for (const name of ["Explore", "code-reviewer", "test-runner"]) {
      const profile = byName.get(name);
      expect(profile, name).toBeDefined();
      const tools = profile!.tools ?? [];
      expect(tools, name).not.toContain("Edit");
      expect(tools, name).not.toContain("Write");
    }
    for (const name of ["fixer", "ui-designer"]) {
      const tools = byName.get(name)?.tools ?? [];
      expect(tools, name).toContain("Edit");
      expect(tools, name).toContain("Write");
    }
  });

  it("白名单里不含 ZCode 没有的工具（BrowserPreview 那种宿主专名）", () => {
    // PI-Desktop 的 `present` / `BrowserPreview` 在 ZCode 不存在：写进白名单只会得到一个
    // 永不出现的工具名。ui-designer 的正文相应改成用项目自己的浏览器/E2E 工具验证。
    for (const profile of createThinkrailAgentProfiles()) {
      for (const tool of profile.tools ?? []) {
        expect(tool, profile.name).not.toMatch(/BrowserPreview|^present$|thinkrail_delegate/);
      }
      expect(profile.systemPrompt, profile.name).not.toMatch(/BrowserPreview|thinkrail_delegate/);
    }
  });

  it("开关打开：五个预设都在可选名单里", () => {
    const reader = createAgentDefinitionsReader([], {}, { enabled: true });
    const names = reader().activeAgents.map((profile) => profile.name);
    for (const name of presetNames) expect(names, name).toContain(name);
    // 既有内置仍在（预设是加法，不是替换）。
    expect(names).toContain("general-purpose");
    expect(names).toContain("Explore");
  });

  it("开关关闭：四个专用预设移除，基础 Explore 保留且不重复", () => {
    const reader = createAgentDefinitionsReader([]);
    const names = reader().activeAgents.map((profile) => profile.name);
    for (const name of presetNames.filter((value) => value !== "Explore"))
      expect(names, name).not.toContain(name);
    expect(names.filter((name) => name === "Explore")).toHaveLength(1);
    expect(names).not.toContain("explorer");
    expect(names).toContain("general-purpose");
  });

  it.each(["user", "project", "plugin"] as const)(
    "开启时保留 %s 同名 profile 的提示词、模型与工具限制",
    (source) => {
      const customProfile = {
        name: "fixer",
        description: "自定义 fixer",
        source,
        systemPrompt: "只读检查，不允许改文件",
        tools: ["Read"],
        modelSelection: { providerId: "custom-provider", modelId: "custom-model" },
      };
      const reader = createAgentDefinitionsReader([customProfile], {}, { enabled: true });
      expect(reader().activeAgents.find((profile) => profile.name === "fixer")).toEqual(
        customProfile,
      );
    },
  );

  it("关掉开关不会连坐用户自己的同名 profile（它盖在内置之上）", () => {
    const userProfile = {
      name: "fixer",
      description: "用户自己写的 fixer",
      source: "user" as const,
      systemPrompt: "mine",
    };
    const reader = createAgentDefinitionsReader([userProfile]);
    const active = reader().activeAgents;
    expect(active.map((profile) => profile.name)).toContain("fixer");
    expect(active.find((profile) => profile.name === "fixer")?.systemPrompt).toBe("mine");
    // 专用预设移除，基础 Explore 仍保留。
    const builtIn = active.filter(
      (profile) =>
        profile.source === "built-in" &&
        profile.name !== "Explore" &&
        presetNames.includes(profile.name),
    );
    expect(builtIn).toHaveLength(0);
  });

  it("predicate 只吃掉内置的预设名，不动别的内置 profile", () => {
    const predicate = applyThinkrailAgentProfiles({ enabled: false });
    expect(predicate({ name: "fixer", source: "built-in" })).toBe(false);
    expect(predicate({ name: "fixer", source: "user" })).toBe(true);
    expect(predicate({ name: "Explore", source: "built-in" })).toBe(true);
    expect(
      applyThinkrailAgentProfiles({ enabled: true })({ name: "fixer", source: "built-in" }),
    ).toBe(true);
  });
});
