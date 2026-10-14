// ThinkRail 常驻段的渲染条件（docs/thinkrail/design.md D3 / 验收表 D3、E1、E3）。
//
// Spec 规则与工作流路由各自按能力判断；首次导入无 spec 的项目仍需要路由。

import { describe, expect, it } from "vitest";
import { SPEC_RULE, WORKFLOW_RULE } from "@zcode/thinkrail";
import { buildThinkrailSection } from "../src/context/sections/thinkrail.js";

const ALL_TOOLS = ["Read", "Bash", "Skill", "spec_grep", "spec_get", "spec_graph", "spec_create"];

function build(overrides: Partial<Parameters<typeof buildThinkrailSection>[0]> = {}) {
  return buildThinkrailSection({
    enabled: true,
    hasSpec: true,
    specRule: SPEC_RULE,
    workflowRule: WORKFLOW_RULE,
    toolNames: ALL_TOOLS,
    ...overrides,
  });
}

describe("ThinkRail 常驻段", () => {
  it("三条条件都满足时渲染，两条规则都在，且是 dynamic system 段", () => {
    const section = build();
    expect(section).not.toBeNull();
    expect(section?.source).toBe("thinkrail");
    expect(section?.injectionTarget).toBe("system");
    expect(section?.cacheHint).toBe("dynamic");
    expect(section?.content).toContain("Specs are this project's ground truth.");
    expect(section?.content).toContain("spec_grep / spec_get / spec_graph");
    expect(section?.content).toContain("read the choosing-a-workflow skill FIRST");
    expect(section?.tokens).toBeGreaterThan(0);
  });

  it("开关关：不渲染（工具不在，规则会指向不存在的工具）", () => {
    expect(build({ enabled: false })).toBeNull();
  });

  it("无 spec 的项目保留工作流路由，省略 spec 规则", () => {
    const section = build({ hasSpec: false });
    expect(section?.content).toContain("read the choosing-a-workflow skill FIRST");
    expect(section?.content).not.toContain("Specs are this project's ground truth.");
  });

  it("只有 Skill 能力时仍可路由；没有 Skill 时不能注入要求先加载技能的规则", () => {
    expect(build({ toolNames: ["Read", "Skill"], hasSpec: false })?.content).toBe(WORKFLOW_RULE);
    expect(build({ toolNames: ALL_TOOLS.filter((name) => name !== "Skill") })).toBeNull();
  });

  it("锚点判断：只读子代理的工具表里没有 spec 读侧三件时不渲染", () => {
    // code-reviewer 那类：只有 read / glob / grep。
    expect(build({ toolNames: ["Read", "Glob", "Grep"] })).toBeNull();
    // 缺一件也算不满足（锚点是主体内容所需，不做「有就行」的宽松判断）。
    expect(build({ toolNames: ["Read", "spec_grep", "spec_get"] })).toBeNull();
    expect(build({ toolNames: ALL_TOOLS })).not.toBeNull();
  });

  it("工具表缺席（测试 / 旧调用方）：等于没有锚点，不渲染", () => {
    expect(build({ toolNames: [] })).toBeNull();
  });
});
