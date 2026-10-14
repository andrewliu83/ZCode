// ThinkRail 总开关的传递链（docs/thinkrail/design.md D2 / D3）：
//   * 权威在 Host：它每次 client work 前读设置文件，把结论经 workspace/updateThinkrailToolPolicy 推给 CLI；
//   * 关闭时不发请求 —— CLI 缺省即关闭，对旧 CLI 零打扰；
//   * 旧 CLI method-not-found / 超时只降级，不阻断客户端就绪；
//   * 变更入口 syncThinkrailEnabled 双向：开了要推，关了也要推（这里没有「服务端提供」闩住）。
//
// 结构照 zcodeAgentService.offPeakToolPolicy.test.ts（同形的 workspace 级策略）。

import { describe, expect, it, vi } from "vitest";
import { zcodeProtocolMethods } from "@zcode/shared";
import { offPeakSelectionView } from "./fixtures/offPeakSelection.js";

class MockProcessManagerBase {
  onRuntimeLifecycle() {
    return { dispose() {} };
  }
  onRuntimeRestarted() {
    return { dispose() {} };
  }
  markReady() {}
}

async function setup(params: {
  enabled?: boolean;
  policyResponse?: (requestParams: unknown) => unknown;
  forwarding?: (enabled: boolean | undefined) => void;
  readSettings?: (enabled: boolean | undefined) => Promise<boolean | undefined>;
}) {
  // 设置文件的可变替身：resolve 读它，sync 写入它 —— 真实路径下 UI 先写设置、再发变更信号。
  let current = params.enabled;
  const resolveThinkrailEnabled = vi.fn(async () => {
    const snapshot = current;
    return params.readSettings ? params.readSettings(snapshot) : snapshot;
  });
  const forwarded: (boolean | undefined)[] = [];
  const request = vi.fn(async (method: string, requestParams?: unknown) => {
    if (method === zcodeProtocolMethods.workspaceUpdateThinkrailToolPolicy) {
      if (params.policyResponse) return params.policyResponse(requestParams);
      return requestParams;
    }
    throw new Error(`Unexpected method ${method}`);
  });
  const getClient = vi.fn(async () => ({
    request,
    transportKind: "stdio" as const,
    onNotification: () => ({ dispose() {} }),
    onRequest: () => ({ dispose() {} }),
    onClose: () => ({ dispose() {} }),
  }));
  vi.resetModules();
  vi.doMock("../src/zcode-agent/zcodeAgentProcessManager.js", () => ({
    ZCodeAgentProcessManager: class extends MockProcessManagerBase {
      getClient = getClient;
      disposeAll() {}
    },
  }));
  const { createZCodeAgentService } = await import("../src/zcode-agent/zcodeAgentService.js");
  const service = createZCodeAgentService({
    modelSelectionReadinessSource: { getView: async () => offPeakSelectionView() },
    resolveThinkrailEnabled,
    forwardThinkrailEnabled: (enabled) => {
      forwarded.push(enabled);
      params.forwarding?.(enabled);
    },
  });
  return {
    service,
    request,
    resolveThinkrailEnabled,
    forwarded,
    /** 设置文件替身：写它模拟 UI 落盘，再调 sync 才是真实顺序。 */
    writeSettings: (next: boolean | undefined) => {
      current = next;
    },
  };
}

function policyCalls(request: ReturnType<typeof vi.fn>) {
  return request.mock.calls.filter(
    ([method]) => method === zcodeProtocolMethods.workspaceUpdateThinkrailToolPolicy,
  );
}

describe("workspace/updateThinkrailToolPolicy 同步（D2）", () => {
  it("开关为真时在客户端就绪阶段下发 enabled:true", async () => {
    const { service, request, resolveThinkrailEnabled } = await setup({ enabled: true });
    await service.initialize({ workspacePath: "/workspace/app" });
    const calls = policyCalls(request);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]).toEqual({
      workspace: expect.objectContaining({ workspacePath: "/workspace/app" }),
      enabled: true,
    });
    expect(resolveThinkrailEnabled).toHaveBeenCalled();
    service.disposeAll();
  });

  it("开关关（或缺省）时不发请求：CLI 缺省即关，对旧 CLI 零打扰", async () => {
    const off = await setup({ enabled: false });
    await off.service.initialize({ workspacePath: "/workspace/app" });
    expect(policyCalls(off.request)).toHaveLength(0);
    off.service.disposeAll();

    const absent = await setup({});
    await absent.service.initialize({ workspacePath: "/workspace/app" });
    expect(policyCalls(absent.request)).toHaveLength(0);
    absent.service.disposeAll();
  });

  it("旧 CLI method-not-found（-32601）与非 -32601 错误都只降级，不阻断客户端就绪", async () => {
    const missing = await setup({
      enabled: true,
      policyResponse: () => {
        throw Object.assign(new Error("Method not found"), { code: -32601 });
      },
    });
    await expect(missing.service.initialize({ workspacePath: "/workspace/app" })).resolves.toEqual(
      expect.objectContaining({ available: true }),
    );
    missing.service.disposeAll();

    const timedOut = await setup({
      enabled: true,
      policyResponse: () => {
        throw new Error("request timed out");
      },
    });
    await expect(timedOut.service.initialize({ workspacePath: "/workspace/app" })).resolves.toEqual(
      expect.objectContaining({ available: true }),
    );
    timedOut.service.disposeAll();
  });

  it("初始化读取迟到时，关闭信号必须等待同一条策略队列且最终保持关闭", async () => {
    const initialRead = Promise.withResolvers<void>();
    const releaseRead = Promise.withResolvers<void>();
    const forwarded = Promise.withResolvers<void>();
    const applied: boolean[] = [];
    const { service, writeSettings } = await setup({
      enabled: true,
      readSettings: async (snapshot) => {
        if (snapshot === true) {
          initialRead.resolve();
          await releaseRead.promise;
        }
        return snapshot;
      },
      forwarding: (enabled) => {
        if (enabled === false) forwarded.resolve();
      },
      policyResponse: (raw) => {
        applied.push((raw as { enabled: boolean }).enabled);
        return raw;
      },
    });
    const initialization = service.initialize({ workspacePath: "/workspace/app" });
    await initialRead.promise;
    writeSettings(false);
    const sync = service.syncThinkrailEnabled({ enabled: false });
    // 转发信号说明变更已被 Host 接收；初始化读取仍被显式挂起，不用计时器猜事件顺序。
    await forwarded.promise;
    await Promise.resolve();
    releaseRead.resolve();
    await Promise.all([initialization, sync]);
    service.disposeAll();
    expect(applied).toEqual([true, false]);
  });

  it("变更入口是双向的：开了推 true，关了推 false（与动态工作流「关不掉」不同）", async () => {
    const { service, request, forwarded, writeSettings } = await setup({ enabled: false });
    await service.initialize({ workspacePath: "/workspace/app" });
    expect(policyCalls(request)).toHaveLength(0);

    // 打开：设置文件先被写，再发信号 → 推一次 true。
    writeSettings(true);
    await service.syncThinkrailEnabled({ enabled: true });
    const opened = policyCalls(request);
    expect(opened).toHaveLength(1);
    expect(opened[0]?.[1]).toEqual({
      workspace: expect.objectContaining({ workspacePath: "/workspace/app" }),
      enabled: true,
    });

    // 关闭：必须真的把 false 推下去，否则 CLI 进程会一直开着工具面。
    writeSettings(false);
    await service.syncThinkrailEnabled({ enabled: false });
    const closed = policyCalls(request);
    expect(closed).toHaveLength(2);
    expect(closed[1]?.[1]).toEqual({
      workspace: expect.objectContaining({ workspacePath: "/workspace/app" }),
      enabled: false,
    });

    // 转发的值取自设置权威（每次现读设置文件），不是传入值本身。
    expect(forwarded).toEqual([true, false]);
    service.disposeAll();
  });
});
