import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { readSystemPrompt, updateSystemPromptPolicy } from "../src/zcode-protocol/system-prompt.js";
import type { ZCodeProtocolAgentServerContext } from "../src/zcode-protocol/server-types.js";

it("工作区提示词预览不创建 Session，不调用模型；ThinkRail 根据进程策略独立注入", async () => {
  const root = await mkdtemp(join(tmpdir(), "prompt-protocol-preview-"));
  const createZCodeApp = vi.fn();
  const context = {
    deps: { env: { HOME: root, ZCODE_STORAGE_DIR: root }, createZCodeApp },
    sessions: new Map(),
    appRuntimePreferences: {
      thinkrailEnabled: true,
      dynamicWorkflowEnabled: false,
      mainSystemPrompt: "PREVIEW BASE",
    },
  } as unknown as ZCodeProtocolAgentServerContext;
  const params = {
    workspace: { workspacePath: root, workspaceKey: root },
    presentationSurface: "zcode_desktop",
  };
  try {
    const snapshot = await readSystemPrompt(context, params);
    expect(snapshot.authority).toBe("workspace");
    expect(snapshot.basePrompt).toBe("PREVIEW BASE");
    expect(snapshot.sections.find((section) => section.source === "thinkrail")?.content).toContain(
      "choosing-a-workflow",
    );
    expect(
      snapshot.sections.find((section) => section.source === "desktop_context")?.readOnly,
    ).toBe(true);
    expect(createZCodeApp).not.toHaveBeenCalled();
    updateSystemPromptPolicy(context, { workspace: params.workspace, mainSystemPrompt: "" });
    context.appRuntimePreferences.thinkrailEnabled = false;
    const off = await readSystemPrompt(context, params);
    expect(off.basePrompt).toBe(off.defaultPrompt);
    expect(off.sections.some((section) => section.source === "thinkrail")).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("查询会话时必须匹配 workspace identity，未知会话不退回工作区预览", async () => {
  const inspect = vi.fn(async () => ({
    basePrompt: "SESSION BASE",
    defaultPrompt: "DEFAULT",
    sections: [],
    busy: false,
    lastRequest: { at: "2026-01-01T00:00:00.000Z", systemMessages: ["ACTUAL SYSTEM"] },
  }));
  const context = {
    sessions: new Map([
      [
        "session",
        { workspace: { workspaceKey: "identity:A" }, app: { getSystemPromptInspection: inspect } },
      ],
    ]),
  } as unknown as ZCodeProtocolAgentServerContext;
  const workspace = {
    workspacePath: "/same/path",
    workspaceKey: "identity:A",
    workspaceIdentity: "identity:A",
  };
  const result = await readSystemPrompt(context, { workspace, sessionId: "session" });
  expect(result.authority).toBe("session");
  expect(result.lastRequest?.systemMessages).toEqual(["ACTUAL SYSTEM"]);
  inspect.mockClear();
  await expect(
    readSystemPrompt(context, {
      workspace: { ...workspace, workspaceKey: "identity:B", workspaceIdentity: "identity:B" },
      sessionId: "session",
    }),
  ).rejects.toMatchObject({ code: -32004 });
  await expect(
    readSystemPrompt(context, { workspace, sessionId: "missing" }),
  ).rejects.toMatchObject({ code: -32004 });
  expect(inspect).not.toHaveBeenCalled();
});
