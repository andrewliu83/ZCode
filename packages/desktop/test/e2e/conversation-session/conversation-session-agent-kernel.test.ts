// AK01 / AK03 / AK04：真实 Composer → v4 → Runtime 快照，SDK 执行由 v4-agent-kernel focused tests 补证。
import {
  TID_SETTINGS_BACK_BUTTON,
  TID_SETTINGS_PAGE,
  TID_SETTINGS_SECTION_NAV,
  TID_TASK_SETTINGS_BUTTON,
  TID_V4_ATTACHMENT,
  TID_V4_COMPOSER_AGENT_KERNEL,
  TID_V4_COMPOSER_AGENT_KERNEL_OPTION,
  TID_V4_COMPOSER_INPUT,
  TID_V4_SESSION_PANE,
  testId,
} from "@zcode/shared";
import {
  clearAppData,
  clickTestIdByDom,
  setInputValueByTestIdDom,
} from "../helpers/desktop-app.js";
import {
  getV4ComposerText,
  getV4PaneSnapshot,
  pasteV4ComposerFileAttachment,
  prepareV4ConversationE2E,
  selectV4TaskById,
  sendV4Prompt,
  waitForV4Pane,
  waitForV4TimelineContaining,
} from "../helpers/v4-conversation.js";

const timeout = 30_000;
const pane = () => $(`[data-testid="${testId(TID_V4_SESSION_PANE, "workspace-main")}"]`);
const picker = () => $(`[data-testid="${TID_V4_COMPOSER_AGENT_KERNEL}"]`);
async function choose(kernel: "zcode" | "claude") {
  await picker().waitForClickable({ timeout });
  await picker().click();
  const option = $(`[data-testid="${testId(TID_V4_COMPOSER_AGENT_KERNEL_OPTION, kernel)}"]`);
  await option.waitForDisplayed({ timeout });
  await option.click();
  await browser.waitUntil(
    async () => (await picker().getAttribute("data-agent-kernel")) === kernel,
    { timeout },
  );
}
async function waitForBinding(kernel: "zcode" | "claude") {
  try {
    await browser.waitUntil(
      async () => (await pane().getAttribute("data-bound-agent-kernel")) === kernel,
      { timeout },
    );
  } catch (error) {
    const dataset = await pane().getAttribute("data-bound-agent-kernel");
    const boundId = await pane().getAttribute("data-bound-session-id");
    throw new Error(
      `Expected ${kernel} binding; actual=${dataset}, id=${boundId}, pane=${JSON.stringify(await getV4PaneSnapshot())}`,
      { cause: error },
    );
  }
  const id = await pane().getAttribute("data-bound-session-id");
  if (!id) throw new Error("Runtime binding missing session ID");
  return id;
}

describe("聊天输入框 Agent 内核", () => {
  after(async () => {
    await clearAppData();
  });
  it("AK01/AK03 右下角显式选择、预热换代，历史换内核保留草稿和附件且不自动发送", async function () {
    this.timeout(180_000);
    await prepareV4ConversationE2E();
    await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON);
    await $(`[data-testid="${TID_SETTINGS_PAGE}"]`).waitForDisplayed({ timeout });
    await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "general"));
    expect(await $('[data-testid="settings-agent-kernel-select"]').isExisting()).toBe(false);
    await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON);
    await picker().waitForDisplayed({ timeout });
    expect(await picker().getAttribute("data-agent-kernel")).toBe("zcode");
    const oldWarm = await waitForBinding("zcode");
    await setInputValueByTestIdDom(TID_V4_COMPOSER_INPUT, "UNSENT_ENGINE_DRAFT");
    await choose("claude");
    expect(await waitForBinding("claude")).not.toBe(oldWarm);
    expect(await getV4ComposerText()).toBe("UNSENT_ENGINE_DRAFT");
    expect((await getV4PaneSnapshot()).rowCount).toBe(0);
    await choose("zcode");
    await waitForBinding("zcode");
    await setInputValueByTestIdDom(TID_V4_COMPOSER_INPUT, "");
    await sendV4Prompt("E2E_AK_SEED 建立原 ZCode 会话");
    await browser.waitUntil(async () => (await getV4ComposerText()) === "", {
      timeout,
      timeoutMsg: "ZCode accepted 后已提交正文未清空",
    });
    await waitForV4TimelineContaining("AK_SEED_OK", timeout);
    await waitForV4Pane(
      (s) => !s.canStop && Boolean(s.sessionId && s.sessionId !== "draft"),
      "Seed not completed",
      timeout,
    );
    const originalId = (await getV4PaneSnapshot()).sessionId!;
    await setInputValueByTestIdDom(TID_V4_COMPOSER_INPUT, "PRESERVE_ENGINE_DRAFT");
    await pasteV4ComposerFileAttachment("kernel-draft.png");
    const attachment = $(`[data-testid^="${TID_V4_ATTACHMENT}"]`);
    await attachment.waitForDisplayed({ timeout });
    await choose("claude");
    const claudeId = await waitForBinding("claude");
    expect(claudeId).not.toBe(originalId);
    await browser.waitUntil(async () => (await getV4ComposerText()) === "PRESERVE_ENGINE_DRAFT", {
      timeout,
    });
    expect(await attachment.isDisplayed()).toBe(true);
    expect((await getV4PaneSnapshot()).rowCount).toBe(0);
    await choose("zcode");
    const newZcodeId = await waitForBinding("zcode");
    expect(newZcodeId).not.toBe(originalId);
    expect(newZcodeId).not.toBe(claudeId);
    await browser.waitUntil(async () => (await getV4ComposerText()) === "PRESERVE_ENGINE_DRAFT", {
      timeout,
    });
    expect(await attachment.isDisplayed()).toBe(true);
    expect((await getV4PaneSnapshot()).rowCount).toBe(0);
    await selectV4TaskById(originalId);
    await waitForV4TimelineContaining("AK_SEED_OK", timeout);
    expect(await getV4ComposerText()).toBe("");
    expect(await picker().getAttribute("data-agent-kernel")).toBe("zcode");
    await selectV4TaskById(newZcodeId);
    await browser.waitUntil(async () => (await getV4ComposerText()) === "PRESERVE_ENGINE_DRAFT", {
      timeout,
    });
    expect(await attachment.isDisplayed()).toBe(true);
  });

  it("AK01 从右下角选择 Claude 后首发由随包 SDK 执行并正常收口", async function () {
    this.timeout(120_000);
    await prepareV4ConversationE2E();
    await choose("claude");
    await waitForBinding("claude");
    await sendV4Prompt("E2E_AK_NATIVE 验证应用内 Claude SDK");
    await browser.waitUntil(async () => (await getV4ComposerText()) === "", {
      timeout,
      timeoutMsg: "Claude accepted 后已提交正文未清空",
    });
    expect(
      await browser.execute((id) => {
        const input = document.querySelector(`[data-testid="${id}"]`) as
          | (HTMLElement & {
              __zcodeLexicalInputE2E?: { getEditorState: () => { toJSON: () => unknown } };
            })
          | null;
        return JSON.stringify(input?.__zcodeLexicalInputE2E?.getEditorState().toJSON());
      }, TID_V4_COMPOSER_INPUT),
    ).not.toContain("E2E_AK_NATIVE");
    await setInputValueByTestIdDom(TID_V4_COMPOSER_INPUT, "NEXT_UNSENT_DRAFT");
    await waitForV4TimelineContaining("AK_NATIVE_OK", 60_000);
    await waitForV4Pane(
      (s) => !s.canStop && s.sessionId !== "draft",
      "Native turn did not complete",
      timeout,
    );
    expect(await getV4ComposerText()).toBe("NEXT_UNSENT_DRAFT");
    const completedRows = (await getV4PaneSnapshot()).rowCount;
    await sendV4Prompt("E2E_AK_NATIVE 同一会话再次发送，验证 accepted 后没有旧草稿回填");
    await waitForV4Pane(
      (s) =>
        !s.canStop &&
        s.rowCount > completedRows &&
        s.timelineText.split("AK_NATIVE_OK").length >= 3,
      "Native follow-up did not complete",
      60_000,
    );
    expect(await getV4ComposerText()).toBe("");
    expect(await picker().getAttribute("data-agent-kernel")).toBe("claude");
    expect(await pane().getAttribute("data-bound-agent-kernel")).toBe("claude");
  });

  it("AK04 执行中不能切换内核", async function () {
    this.timeout(120_000);
    await prepareV4ConversationE2E();
    if ((await picker().getAttribute("data-agent-kernel")) !== "zcode") await choose("zcode");
    await sendV4Prompt("E2E_AK_BUSY 验证运行门禁");
    await waitForV4Pane((s) => s.canStop, "No active turn observed", timeout);
    expect(await picker().isEnabled()).toBe(false);
    expect(await picker().getAttribute("data-agent-kernel")).toBe("zcode");
    await waitForV4TimelineContaining("AK_BUSY_OK", timeout);
    await waitForV4Pane((s) => !s.canStop, "Busy turn did not complete", timeout);
    await picker().waitForEnabled({ timeout });
  });
});
