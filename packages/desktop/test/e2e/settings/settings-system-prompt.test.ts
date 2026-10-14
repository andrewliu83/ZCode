import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  PlatformChannels,
  TID_SETTINGS_PAGE,
  TID_SETTINGS_SECTION_NAV,
  TID_SETTINGS_THINKRAIL_ENABLED_SWITCH,
  TID_TASK_SETTINGS_BUTTON,
  testId,
} from "@zcode/shared";
import {
  clearAppData,
  clickTestIdByDom,
  getE2EAppDataPaths,
  setInputValueByTestIdDom,
} from "../helpers/desktop-app.js";
import { prepareV4ConversationE2E } from "../helpers/v4-conversation.js";
import { sel } from "../helpers/selectors.js";

const timeout = 20_000;
const readSettings = async (path: string) =>
  JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;

describe("系统提示词设置 E2E", () => {
  after(async () => {
    await clearAppData();
  });
  it("保存/恢复默认、外部更新和 ThinkRail 只读来源使用真实设置与 CLI 投影", async function () {
    this.timeout(150_000);
    await prepareV4ConversationE2E({ skipProvider: true });
    await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON);
    await $(sel(TID_SETTINGS_PAGE)).waitForDisplayed({ timeout });
    await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "general"));
    const thinkrail = $(sel(TID_SETTINGS_THINKRAIL_ENABLED_SWITCH));
    await thinkrail.waitForDisplayed({ timeout });
    if ((await thinkrail.getAttribute("aria-checked")) !== "true")
      await clickTestIdByDom(TID_SETTINGS_THINKRAIL_ENABLED_SWITCH);
    await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "systemPrompt"));
    const editor = $('[data-testid="settings-system-prompt-editor"]');
    await editor.waitForDisplayed({ timeout });
    await browser.waitUntil(
      async () => {
        const page = $('[data-testid="settings-system-prompt"]');
        const alert = page.$('[role="alert"]');
        if (await alert.isExisting()) throw new Error(await alert.getText());
        if ((await page.getText()).includes("选择工作区后"))
          throw new Error("设置页没有 workspace 目标");
        return (await editor.getValue()).length > 20;
      },
      { timeout, timeoutMsg: "系统提示词正文未加载" },
    );
    const defaultBody = await editor.getValue();
    const rule = $('[data-prompt-source="thinkrail"] textarea');
    await rule.waitForDisplayed({ timeout });
    expect(await rule.getAttribute("readonly")).not.toBeNull();
    expect(await rule.getValue()).toContain("choosing-a-workflow");
    const sourceBefore = await rule.getValue();
    await editor.waitForEnabled({ timeout });
    await setInputValueByTestIdDom("settings-system-prompt-editor", "CUSTOM E2E BASE PROMPT", {
      timeout,
    });
    await clickTestIdByDom("settings-system-prompt-save");
    const path = join(getE2EAppDataPaths().appDataDir, "setting.json");
    await browser.waitUntil(
      async () => (await readSettings(path)).mainSystemPrompt === "CUSTOM E2E BASE PROMPT",
      { timeout },
    );
    expect(await rule.getValue()).toBe(sourceBefore);
    const effectiveBase = $('[data-prompt-source="base_prompt"] textarea');
    const dialogs = await browser.execute(() =>
      [...document.querySelectorAll('[role="alertdialog"]')].map((element) => element.textContent),
    );
    if (dialogs.length) throw new Error(`设置保存后的阻挡弹窗: ${dialogs.join(" | ")}`);
    await $('[data-prompt-source="base_prompt"] summary').click();
    await browser.waitUntil(
      async () => (await effectiveBase.getValue()) === "CUSTOM E2E BASE PROMPT",
      { timeout },
    );
    expect(await effectiveBase.getAttribute("readonly")).not.toBeNull();
    await clickTestIdByDom("settings-system-prompt-restore");
    await browser.waitUntil(async () => !(await readSettings(path)).mainSystemPrompt, { timeout });
    await browser.waitUntil(async () => (await editor.getValue()) === defaultBody, { timeout });
    const current = await readSettings(path);
    await writeFile(
      path,
      JSON.stringify({
        ...current,
        mainSystemPrompt: "OTHER WINDOW BASE",
        thinkrailEnabled: false,
      }),
    );
    await browser.electron.execute((electron, channel) => {
      for (const window of electron.BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(channel);
      }
    }, PlatformChannels.SettingsChanged);
    await browser.waitUntil(async () => (await editor.getValue()) === "OTHER WINDOW BASE", {
      timeout,
    });
    await browser.waitUntil(
      async () => !(await $('[data-prompt-source="thinkrail"]').isExisting()),
      { timeout },
    );
  });
});
