// 常驻规则原文与工具名字面（docs/thinkrail/design.md D3 / D4）。
//
// 为什么需要这些断言：工具名在领域包（tool-names.ts）与 @zcode/contracts 各有一份**同字面**的
// 常量。领域包刻意不 import contracts（它是无运行时依赖的底层），代价是两处可能漂移 ——
// 这一份测试与 core 的 thinkrail-spec-tools.test.ts 各断言一边，漂移会立刻红。

import { describe, expect, it } from "vitest";
import {
  SPEC_CREATE_TOOL_NAME,
  SPEC_DELETE_TOOL_NAME,
  SPEC_GET_TOOL_NAME,
  SPEC_GRAPH_TOOL_NAME,
  SPEC_GREP_TOOL_NAME,
  SPEC_RULE,
  SPEC_UPDATE_TOOL_NAME,
  SPEC_VALIDATE_TOOL_NAME,
  THINKRAIL_SPEC_TOOL_NAMES,
  WORKFLOW_RULE,
} from "../src/index.js";

describe("常驻规则", () => {
  it("spec 规则是四条，且引用的是内核裸名（不带 MCP 前缀）", () => {
    const lines = SPEC_RULE.split("\n");
    expect(lines[0]).toBe("Specs are this project's ground truth.");
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain("spec_grep / spec_get / spec_graph");
    expect(SPEC_RULE).not.toContain("mcp__");
  });

  it("workflow 规则是指针而不是复述：只让读技能，不复述路由表", () => {
    expect(WORKFLOW_RULE).toContain("read the choosing-a-workflow skill FIRST");
    // 落成技能之前（P4），正文不得点名任何 workflow 技能 —— 点名了就是指向一个还不存在的技能。
    expect(WORKFLOW_RULE).not.toMatch(/shipping-a-pr|writing-specs|brainstorming/);
  });

  it("两段正文都短（常驻段每轮都在，字节稳定才不搅动 prompt 缓存）", () => {
    expect(SPEC_RULE.length).toBeLessThan(700);
    expect(WORKFLOW_RULE.length).toBeLessThan(300);
  });
});

describe("工具名字面", () => {
  it("七个名字与 core / contracts 侧一致（这是跨包同字面的唯一守卫）", () => {
    expect([...THINKRAIL_SPEC_TOOL_NAMES]).toEqual([
      "spec_grep",
      "spec_get",
      "spec_graph",
      "spec_create",
      "spec_update",
      "spec_delete",
      "spec_validate",
    ]);
    expect(SPEC_GREP_TOOL_NAME).toBe("spec_grep");
    expect(SPEC_GET_TOOL_NAME).toBe("spec_get");
    expect(SPEC_GRAPH_TOOL_NAME).toBe("spec_graph");
    expect(SPEC_CREATE_TOOL_NAME).toBe("spec_create");
    expect(SPEC_UPDATE_TOOL_NAME).toBe("spec_update");
    expect(SPEC_DELETE_TOOL_NAME).toBe("spec_delete");
    expect(SPEC_VALIDATE_TOOL_NAME).toBe("spec_validate");
  });
});
