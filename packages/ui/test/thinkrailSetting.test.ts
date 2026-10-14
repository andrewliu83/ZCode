// @vitest-environment jsdom
// 常规设置里的 ThinkRail 总开关（docs/thinkrail/design.md D2）。
//
// 与动态工作流那一行的差异就是这份测试的重点：没有灰度层，所以**行总是渲染**；值只有设置文件
// 一个来源；落盘失败要回滚乐观值并提示。
// 测试项目只收 .test.ts（vitest.config.ts 的 unit include），所以这里用 createElement 而非 JSX。
import { createElement, type ReactNode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TID_SETTINGS_THINKRAIL_ENABLED_SWITCH } from "@zcode/shared";
import { buildThinkrailEnabledPatch, ThinkrailSetting } from "@/settings/ThinkrailSetting.js";

const mocks = vi.hoisted(() => ({
  update: vi.fn(async (_patch: unknown) => undefined),
  toast: vi.fn(),
  settings: {} as Record<string, unknown>,
}));

vi.mock("@/hooks/useSettingService.js", () => ({
  useSettings: () => ({ settings: mocks.settings, update: mocks.update }),
}));
vi.mock("@/components/ui/toast.js", () => ({ toast: mocks.toast }));
vi.mock("@/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({ intl: { formatMessage: ({ id }: { id: string }) => id } }),
}));
// SettingsRow 只关心 label/description/control 的渲染，样式层不参与这份断言。
vi.mock("@/settings/SettingsPageParts.js", () => ({
  SettingsRow: ({
    label,
    description,
    control,
  }: {
    label: string;
    description: string;
    control: ReactNode;
  }) =>
    createElement(
      "div",
      null,
      createElement("span", { "data-testid": "label" }, label),
      createElement("span", { "data-testid": "description" }, description),
      control,
    ),
}));

beforeEach(() => {
  mocks.update.mockClear();
  mocks.toast.mockClear();
  mocks.settings = {};
});

afterEach(cleanup);

// Radix 的 Switch 根是 button（role="switch"），开合体现在 aria-checked 上，不是 input.checked
// —— 既有设置行测试同样按 aria-checked 断言（browserSettingsSection.test.ts）。
function switchControl(): HTMLElement {
  return screen.getByTestId(TID_SETTINGS_THINKRAIL_ENABLED_SWITCH);
}

function isChecked(): boolean {
  return switchControl().getAttribute("aria-checked") === "true";
}

describe("ThinkrailSetting", () => {
  it("行总是渲染（开关没有灰度层，不需要等就绪）", () => {
    render(createElement(ThinkrailSetting));
    expect(screen.getByTestId("label").textContent).toBe("settings.thinkrail");
    expect(screen.getByTestId("description").textContent).toBe("settings.thinkrailDescription");
  });

  it("缺省（未落盘）显示关闭：缺省即关是开关的语义", () => {
    render(createElement(ThinkrailSetting));
    expect(isChecked()).toBe(false);
    mocks.settings = { thinkrailEnabled: false };
    cleanup();
    render(createElement(ThinkrailSetting));
    expect(isChecked()).toBe(false);
  });

  it("落盘为 true 时显示打开", () => {
    mocks.settings = { thinkrailEnabled: true };
    render(createElement(ThinkrailSetting));
    expect(isChecked()).toBe(true);
  });

  it("打开时写入的 patch 只有这一个字段", async () => {
    render(createElement(ThinkrailSetting));
    switchControl().click();
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(mocks.update).toHaveBeenCalledWith({ thinkrailEnabled: true });
  });

  it("保存成功后仍跟随其他窗口的设置广播", async () => {
    const view = render(createElement(ThinkrailSetting));
    await act(async () => switchControl().click());
    mocks.settings = { thinkrailEnabled: true };
    view.rerender(createElement(ThinkrailSetting));
    expect(isChecked()).toBe(true);
    mocks.settings = { thinkrailEnabled: false };
    view.rerender(createElement(ThinkrailSetting));
    expect(isChecked()).toBe(false);
  });

  it("落盘失败：回滚乐观值并提示", async () => {
    mocks.update.mockRejectedValueOnce(new Error("nope"));
    render(createElement(ThinkrailSetting));
    switchControl().click();
    // 乐观值先动（开关立刻反馈），失败后回到设置文件的事实。
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1));
    expect(mocks.toast).toHaveBeenCalledWith("settings.thinkrail.saveError");
    await waitFor(() => expect(isChecked()).toBe(false));
  });

  it("buildThinkrailEnabledPatch 只带 thinkrailEnabled（不顺手写别的字段）", () => {
    expect(buildThinkrailEnabledPatch(true)).toEqual({ thinkrailEnabled: true });
    expect(buildThinkrailEnabledPatch(false)).toEqual({ thinkrailEnabled: false });
  });
});
