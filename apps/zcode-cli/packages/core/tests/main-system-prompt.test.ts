import { describe, expect, it } from "vitest";
import { createContextBuilder, type ContextBuilderConfig } from "../src/context/index.js";
import { SPEC_RULE, WORKFLOW_RULE } from "@zcode/thinkrail";

const base: ContextBuilderConfig = {
  workingDirectory: "/workspace",
  envInfo: {
    cwd: "/workspace",
    platform: "darwin",
    shell: "zsh",
    osVersion: "test",
    nodeVersion: "24",
  },
  presentationSurface: "zcode_desktop",
  guidanceToolNames: ["Read", "Skill", "spec_grep", "spec_get", "spec_graph"],
  thinkrail: { enabled: true, specRule: SPEC_RULE, workflowRule: WORKFLOW_RULE },
};

describe("主代理基础提示词设置", () => {
  it("替换稳定正文时保留 ThinkRail、Desktop 和其他动态注入段", () => {
    const result = createContextBuilder({ ...base, mainSystemPrompt: "USER BASE PROMPT" }).build();
    expect(result.sections.find((s) => s.source === "main_system_prompt")?.content.trim()).toBe(
      "USER BASE PROMPT",
    );
    expect(result.sections.some((s) => s.source === "identity")).toBe(false);
    expect(result.sections.find((s) => s.source === "thinkrail")?.content).toBe(
      `${SPEC_RULE}\n\n${WORKFLOW_RULE}`,
    );
    expect(result.sections.some((s) => s.source === "desktop_context")).toBe(true);
    expect(result.sections.some((s) => s.source === "dynamic_behavior")).toBe(true);
    expect(
      result.systemMessages.some((m) => JSON.stringify(m.content).includes("USER BASE PROMPT")),
    ).toBe(true);
  });

  it("清空设置恢复默认正文，保留相同注入段", () => {
    const result = createContextBuilder({ ...base, mainSystemPrompt: " \n " }).build();
    expect(result.sections.some((s) => s.source === "identity")).toBe(true);
    expect(result.sections.find((s) => s.source === "thinkrail")?.content).toBe(
      `${SPEC_RULE}\n\n${WORKFLOW_RULE}`,
    );
  });

  it("不会覆盖工作流 actor 的 persona", () => {
    const result = createContextBuilder({
      ...base,
      mainSystemPrompt: "USER BASE PROMPT",
      workflowActor: { name: "worker", persona: "ACTOR PERSONA" },
    }).build();
    expect(result.sections.some((s) => s.source === "main_system_prompt")).toBe(false);
    expect(result.sections.some((s) => s.source === "workflow_actor_identity")).toBe(true);
  });

  it("传统 customSystemPrompt 仍保持完整替换语义", () => {
    const result = createContextBuilder({ ...base, customSystemPrompt: "LEGACY BODY" }).build();
    expect(result.sections.some((s) => s.source === "custom_system_prompt")).toBe(true);
    expect(result.sections.some((s) => s.source === "desktop_context")).toBe(false);
  });
});
