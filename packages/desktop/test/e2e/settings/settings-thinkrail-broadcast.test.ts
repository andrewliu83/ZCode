import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  PlatformChannels,
  TID_SETTINGS_PAGE,
  TID_SETTINGS_SECTION_NAV,
  TID_SETTINGS_THINKRAIL_ENABLED_SWITCH,
  TID_TASK_SETTINGS_BUTTON,
  testId,
  createThinkrailAgentProfiles,
  TID_SUBAGENT_ROW,
} from "@zcode/shared";
import {
  DEFAULT_WORKSPACE,
  clearAppData,
  clickTestIdByDom,
  getE2EAppDataPaths,
  waitForDefaultWorkspaceReady,
  waitForWorkspaceApp,
} from "../helpers/desktop-app.js";
import { sel } from "../helpers/selectors.js";

const SETTINGS_TIMEOUT_MS = 15_000;

describe("ThinkRail 设置广播 E2E", () => {
  after(async () => {
    await clearAppData();
  });

  it("TR-01：本窗口操作成功后，外部关闭通知继续更新控件", async function () {
    this.timeout(90_000);
    // 通用工作区 helper 用 Escape 关闭职业引导，不在设置回归里另行推进初始化页面。
    await waitForDefaultWorkspaceReady(30_000);
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 30_000);
    await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON);
    await $(sel(TID_SETTINGS_PAGE)).waitForDisplayed({ timeout: SETTINGS_TIMEOUT_MS });
    await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "general"));
    const control = $(sel(TID_SETTINGS_THINKRAIL_ENABLED_SWITCH));
    await control.waitForDisplayed({ timeout: SETTINGS_TIMEOUT_MS });
    expect(await control.getAttribute("aria-checked")).toBe("false");
    await clickTestIdByDom(TID_SETTINGS_THINKRAIL_ENABLED_SWITCH);
    const settingsPath = join(getE2EAppDataPaths().appDataDir, "setting.json");
    await browser.waitUntil(
      async () => (await readSettings(settingsPath)).thinkrailEnabled === true,
      { timeout: SETTINGS_TIMEOUT_MS, timeoutMsg: "ThinkRail 开关未落盘" },
    );
    expect(await control.getAttribute("aria-checked")).toBe("true");
    // 复现其他窗口落盘后的真实输入：同一设置文件 + Main 的 SettingsChanged 通知。
    // 不重挂载设置页，否则会清掉 pending 并掩盖广播更新失效的根因。
    const current = await readSettings(settingsPath);
    await writeFile(settingsPath, JSON.stringify({ ...current, thinkrailEnabled: false }));
    await browser.electron.execute((electron, channel) => {
      for (const window of electron.BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(channel);
      }
    }, PlatformChannels.SettingsChanged);
    await browser.waitUntil(async () => (await control.getAttribute("aria-checked")) === "false", {
      timeout: SETTINGS_TIMEOUT_MS,
      timeoutMsg: "已落盘的乐观值遮住了关闭广播",
    });
  });
  it("TR-CAT-01/02：开启后显示只读预设和技能，外部关闭后已挂载目录继续更新", async function () {
    this.timeout(120_000);
    await waitForDefaultWorkspaceReady(30_000);
    await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON);
    await $(sel(TID_SETTINGS_PAGE)).waitForDisplayed({ timeout: SETTINGS_TIMEOUT_MS });
    await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "general"));
    const control = $(sel(TID_SETTINGS_THINKRAIL_ENABLED_SWITCH));
    await control.waitForDisplayed({ timeout: SETTINGS_TIMEOUT_MS });
    if ((await control.getAttribute("aria-checked")) !== "true") {
      await clickTestIdByDom(TID_SETTINGS_THINKRAIL_ENABLED_SWITCH);
    }
    const settingsPath = join(getE2EAppDataPaths().appDataDir, "setting.json");
    await browser.waitUntil(
      async () => (await readSettings(settingsPath)).thinkrailEnabled === true,
      { timeout: SETTINGS_TIMEOUT_MS },
    );
    await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "subagents"));
    for (const preset of createThinkrailAgentProfiles()) {
      await $(sel(testId(TID_SUBAGENT_ROW, preset.name))).waitForDisplayed({
        timeout: SETTINGS_TIMEOUT_MS,
      });
    }
    await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "skill"));
    const builtIns = $('[data-skills-built-in="true"]');
    await builtIns.waitForDisplayed({ timeout: SETTINGS_TIMEOUT_MS });
    expect(await builtIns.getText()).toContain("choosing-a-workflow");
    expect(await builtIns.$$('button[role="switch"]')).toHaveLength(0);
    // 关闭来自另一个窗口，不重挂载技能页，以便覆盖实际的目录失效顺序。
    const current = await readSettings(settingsPath);
    await writeFile(settingsPath, JSON.stringify({ ...current, thinkrailEnabled: false }));
    await browser.electron.execute((electron, channel) => {
      for (const window of electron.BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(channel);
      }
    }, PlatformChannels.SettingsChanged);
    await browser.waitUntil(async () => !(await builtIns.isExisting()), {
      timeout: SETTINGS_TIMEOUT_MS,
      timeoutMsg: "关闭后旧的内置技能目录仍然可见",
    });
    await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "subagents"));
    await browser.waitUntil(
      async () => !(await $(sel(testId(TID_SUBAGENT_ROW, "fixer"))).isExisting()),
      { timeout: SETTINGS_TIMEOUT_MS },
    );
  });
});

async function readSettings(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}
