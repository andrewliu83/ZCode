import { describe, expect, it, vi } from "vitest";
import { createMainSystemPromptPolicySync } from "../src/zcode-agent/mainSystemPromptPolicy.js";
import type { ZCodeProtocolClient } from "../src/zcode-agent/zcodeProtocolClient.js";

const makeClient = () => ({
  isDisposed: false,
  request: vi.fn(
    async (
      _method: string,
      params: { mainSystemPrompt: string; workspace: { workspaceKey: string } },
    ) => params,
  ),
});
function createPolicy(
  resolve?: () => Promise<string | undefined>,
  forward?: (value: string | undefined, kernels?: Record<string, string>) => Promise<void>,
  resolveKernels?: () => Promise<Record<string, string> | undefined>,
) {
  const fake = makeClient();
  const entry = {
    client: fake as unknown as ZCodeProtocolClient,
    workspace: { workspacePath: "/workspace", workspaceIdentity: "identity:A" },
  };
  const sync = createMainSystemPromptPolicySync({
    resolve,
    resolveKernels,
    forward,
    entries: () => [entry],
    workspaceKey: (workspace) => workspace.workspaceIdentity || workspace.workspacePath,
    workspaceRef: (workspace) => ({
      ...workspace,
      workspaceKey: workspace.workspaceIdentity || workspace.workspacePath,
    }),
    methodNotFound: (error) => (error as { code?: number }).code === -32601,
  });
  return { fake, entry, sync };
}

describe("主智能体正文的 Host 策略同步", () => {
  it("按内核同步完整策略，转发保留各正文并能只清空对应内核", async () => {
    let kernels = { claude: "CLAUDE", "fixture-agent": "THIRD" };
    const forward = vi.fn(async () => {});
    const { fake, entry, sync } = createPolicy(
      async () => "ZCODE",
      forward,
      async () => kernels,
    );
    await sync.update(entry);
    expect(fake.request.mock.calls.at(-1)?.[1]).toMatchObject({
      mainSystemPrompt: "ZCODE",
      kernelSystemPrompts: kernels,
    });
    kernels = { ...kernels, claude: "" };
    await sync.sync("STALE", { claude: "MUST NOT APPLY" });
    expect(fake.request.mock.calls.at(-1)?.[1]).toMatchObject({
      mainSystemPrompt: "ZCODE",
      kernelSystemPrompts: { claude: "", "fixture-agent": "THIRD" },
    });
    expect(forward).toHaveBeenCalledWith("ZCODE", kernels);
    await sync.update(entry);
    expect(fake.request).toHaveBeenCalledTimes(2);
  });

  it("初始化与设置保存共享串行队列，迟到的旧读取不会覆盖新正文，恢复会发送空值", async () => {
    let authoritative: string | undefined = "OLD";
    let resolveOld!: (value: string) => void;
    let entered!: () => void;
    const firstRead = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let count = 0;
    const { fake, entry, sync } = createPolicy(async () => {
      if (++count === 1) {
        entered();
        return await new Promise<string>((resolve) => {
          resolveOld = resolve;
        });
      }
      return authoritative;
    });
    const initial = sync.update(entry);
    await firstRead;
    authoritative = "NEW";
    const changed = sync.sync("untrusted stale signal");
    resolveOld("OLD");
    await Promise.all([initial, changed]);
    expect(fake.request.mock.calls.map((call) => call[1].mainSystemPrompt)).toEqual(["OLD", "NEW"]);
    authoritative = undefined;
    await sync.sync(undefined);
    expect(fake.request.mock.calls.at(-1)?.[1].mainSystemPrompt).toBe("");
    await sync.update(entry);
    expect(fake.request).toHaveBeenCalledTimes(3);
  });

  it("本机有设置权威时不采用传入正文；附属 remote 沿用推送缓存", async () => {
    const local = createPolicy(async () => "CANONICAL");
    await local.sync.sync("SHOULD NOT APPLY");
    expect(local.fake.request.mock.calls[0]?.[1].mainSystemPrompt).toBe("CANONICAL");
    const remote = createPolicy();
    await remote.sync.sync("INHERITED");
    expect(remote.fake.request.mock.calls[0]?.[1].mainSystemPrompt).toBe("INHERITED");
    expect(remote.fake.request.mock.calls[0]?.[1].workspace.workspaceKey).toBe("identity:A");
  });

  it("远程转发等待前次确认，慢的旧推送不会落在新正文之后", async () => {
    let current = "FIRST";
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const forwarded: Array<string | undefined> = [];
    const { sync } = createPolicy(
      async () => current,
      async (value) => {
        forwarded.push(value);
        if (value === "FIRST") {
          entered();
          await gate;
        }
      },
    );
    const first = sync.sync("FIRST");
    await waiting;
    current = "SECOND";
    const second = sync.sync("SECOND");
    expect(forwarded).toEqual(["FIRST"]);
    release();
    await Promise.all([first, second]);
    expect(forwarded).toEqual(["FIRST", "SECOND"]);
  });

  it("仅 method-not-found 降级，其余 RPC 故障会被报告并允许下次重试", async () => {
    const { fake, entry, sync } = createPolicy(async () => "PROMPT");
    fake.request.mockRejectedValueOnce(new Error("transient"));
    await expect(sync.update(entry)).rejects.toThrow("transient");
    await sync.update(entry);
    expect(fake.request).toHaveBeenCalledTimes(2);
    const old = createPolicy(async () => "PROMPT");
    old.fake.request.mockRejectedValueOnce({ code: -32601 });
    await old.sync.update(old.entry);
    await old.sync.update(old.entry);
    expect(old.fake.request).toHaveBeenCalledTimes(1);
  });
});
