import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformChannels, type WebRemoteControlContext } from "@zcode/shared";
import type { WebRemoteControlStartAuthorization } from "../src/main/webRemoteControlManager.js";

type IpcHandler = (...args: unknown[]) => unknown;

const h = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>(),
  fromWebContents: vi.fn(),
  showMessageBox: vi.fn(async () => ({ response: 1 })),
}));

function withStartAuthorization(manager: {
  start(windowId: number, context: WebRemoteControlContext): Promise<unknown>;
  resetPairing(windowId: number, context: WebRemoteControlContext): Promise<unknown>;
  stop(windowId: number): Promise<void>;
  getStatus(windowId: number): unknown;
}) {
  return {
    ...manager,
    authorizeStart: vi.fn(
      (windowId: number, context: WebRemoteControlContext): WebRemoteControlStartAuthorization => ({
        token: `ticket-${windowId}`,
        expiresAt: Date.now() + 30_000,
        windowId,
        workspaceKey: context.workspaceIdentity?.trim() || context.workspacePath,
        ...(context.remoteSessionId ? { remoteSessionId: context.remoteSessionId } : {}),
      }),
    ),
    startAuthorized: vi.fn(
      (
        windowId: number,
        context: WebRemoteControlContext,
        _authorization: WebRemoteControlStartAuthorization,
      ) => manager.start(windowId, context),
    ),
    resetPairingAuthorized: vi.fn(
      (
        windowId: number,
        context: WebRemoteControlContext,
        _authorization: WebRemoteControlStartAuthorization,
      ) => manager.resetPairing(windowId, context),
    ),
  };
}

vi.mock("electron", () => ({
  app: {
    getLocale: vi.fn(() => "zh-CN"),
    getPreferredSystemLanguages: vi.fn(() => ["zh-CN"]),
  },
  BrowserWindow: {
    fromWebContents: h.fromWebContents,
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => h.handlers.set(channel, handler)),
  },
  dialog: {
    showMessageBox: h.showMessageBox,
  },
}));

describe("Web Remote Control IPC", () => {
  beforeEach(() => {
    h.handlers.clear();
    h.fromWebContents.mockReset();
    h.fromWebContents.mockReturnValue({ id: 17 });
    h.showMessageBox.mockReset();
    h.showMessageBox.mockResolvedValue({ response: 1 });
  });

  it("显式启动保留本地 workspace 目标与返回结果", async () => {
    const start = vi.fn(async () => ({ status: "running" }));
    const { registerWebRemoteControlIpcHandlers } =
      await import("../src/main/desktopWebRemoteControlIpc.js");
    registerWebRemoteControlIpcHandlers({
      webRemoteControlManager: withStartAuthorization({
        start,
        resetPairing: vi.fn(),
        stop: vi.fn(),
        getStatus: vi.fn(),
      }),
    });

    const context = { workspacePath: "/workspace/local" };
    const result = await h.handlers.get(PlatformChannels.StartWebRemoteControl)?.(
      { sender: { id: 73 } },
      context,
    );

    expect(result).toEqual({ status: "running" });
    expect(start).toHaveBeenCalledWith(17, context);

    expect(h.showMessageBox).not.toHaveBeenCalled();
  });

  it("重新配对保留远程 workspace identity", async () => {
    const resetPairing = vi.fn(async () => ({ status: "running" }));
    const { registerWebRemoteControlIpcHandlers } =
      await import("../src/main/desktopWebRemoteControlIpc.js");
    registerWebRemoteControlIpcHandlers({
      webRemoteControlManager: withStartAuthorization({
        start: vi.fn(),
        resetPairing,
        stop: vi.fn(),
        getStatus: vi.fn(),
      }),
    });

    const context = {
      workspacePath: "/workspace/remote",
      workspaceIdentity: "remote:wsl:Ubuntu:/workspace/remote",
      remoteSessionId: "remote-session-1",
    };
    const result = await h.handlers.get(PlatformChannels.ResetWebRemoteControlPairing)?.(
      { sender: { id: 74 } },
      context,
    );

    expect(result).toEqual({ status: "running" });
    expect(resetPairing).toHaveBeenCalledWith(17, context);

    expect(h.showMessageBox).not.toHaveBeenCalled();
  });

  it("启动失败时保留原始异常", async () => {
    const error = Object.assign(new Error("relay websocket closed"), {
      code: "RELAY_CLOSED",
    });

    const { registerWebRemoteControlIpcHandlers } =
      await import("../src/main/desktopWebRemoteControlIpc.js");
    registerWebRemoteControlIpcHandlers({
      webRemoteControlManager: withStartAuthorization({
        start: vi.fn(async () => {
          throw error;
        }),
        resetPairing: vi.fn(),
        stop: vi.fn(),
        getStatus: vi.fn(),
      }),
    });

    const operation = h.handlers.get(PlatformChannels.StartWebRemoteControl)?.(
      { sender: { id: 75 } },
      { workspacePath: "/workspace/local" },
    );

    await expect(operation).rejects.toBe(error);
  });

  it("内部票据只在 manager 提供的目标绑定接口中使用一次", async () => {
    const authorization: WebRemoteControlStartAuthorization = {
      token: "ticket-1",
      expiresAt: Date.now() + 30_000,
      windowId: 17,
      workspaceKey: "/workspace/local",
    };
    const authorizeStart = vi.fn(() => authorization);
    const startAuthorized = vi.fn(async () => ({ status: "running" }));
    const { registerWebRemoteControlIpcHandlers } =
      await import("../src/main/desktopWebRemoteControlIpc.js");
    registerWebRemoteControlIpcHandlers({
      webRemoteControlManager: {
        startAuthorized,
        authorizeStart,
        resetPairingAuthorized: vi.fn(),
        stop: vi.fn(),
        getStatus: vi.fn(),
      },
    });

    const context = { workspacePath: "/workspace/local" };
    await expect(
      h.handlers.get(PlatformChannels.StartWebRemoteControl)?.({ sender: { id: 78 } }, context),
    ).resolves.toEqual({ status: "running" });
    expect(authorizeStart).toHaveBeenCalledWith(17, context);
    expect(startAuthorized).toHaveBeenCalledWith(17, context, authorization);
  });
});
