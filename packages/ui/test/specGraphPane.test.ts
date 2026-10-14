// spec 图面板的 tab 与入口规则（docs/thinkrail/design.md D7 / 验收 F1）。
//
// 面板只读这件事在契约层已经断言（services 的 contract.test.ts 检查接口上没有写方法）；
// 这里断言的是「谁在什么时候能看到它」——一个工作区一个 tab、切对话不藏、入口随开关。
import { describe, expect, it } from "vitest";
import { resolveOpenTabLauncherItemIds } from "@/app-shell/animatedSidePanePanelModel.js";
import {
  activateSpecGraphSidePane,
  closeSpecGraphSidePane,
  isWorkspaceGlobalSidePaneTab,
  toggleSpecGraphSidePane,
  type WorkspaceSidePaneState,
} from "@/lib/workspaceSidePane.js";

describe("spec 图面板 tab", () => {
  it("打开是恒等 tab：重复打开只有一个（与 git 面板同一条规则）", () => {
    const first = activateSpecGraphSidePane(null);
    const second = activateSpecGraphSidePane(first);
    expect(second.tabs).toHaveLength(1);
    expect(second.tabs[0]?.type).toBe("spec-graph");
    expect(second.activeTabId).toBe("spec-graph");
  });

  it("是 workspace 级 tab：切对话不会把它藏掉", () => {
    const state = activateSpecGraphSidePane(null);
    const tab = state.tabs[0]!;
    expect(isWorkspaceGlobalSidePaneTab(tab)).toBe(true);
  });

  it("toggle 在已激活时关闭；close 只关它自己", () => {
    const opened = activateSpecGraphSidePane(null);
    expect(toggleSpecGraphSidePane(opened)).toBeNull();

    const withGit: WorkspaceSidePaneState = {
      tabs: [
        { id: "git", type: "git", openedAt: 1 },
        { id: "spec-graph", type: "spec-graph", openedAt: 2 },
      ],
      activeTabId: "spec-graph",
    };
    const closed = closeSpecGraphSidePane(withGit);
    expect(closed?.tabs.map((tab) => tab.type)).toEqual(["git"]);
    // 活动 tab 被关掉后落到剩下的那个，而不是留一个指向不存在 tab 的 activeTabId。
    expect(closed?.activeTabId).toBe("git");
  });

  it("入口随开关出现：关闭时加号菜单里没有 spec-graph", () => {
    const base = { developerToolsEnabled: false, hasReviewTab: false };
    expect(resolveOpenTabLauncherItemIds(base)).not.toContain("spec-graph");
    expect(resolveOpenTabLauncherItemIds({ ...base, thinkrailEnabled: true })).toContain(
      "spec-graph",
    );
  });
});
