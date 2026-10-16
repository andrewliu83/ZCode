import { describe, expect, it, vi } from "vitest";
import { createHelpAppConfigReader, resolveHelpAppConfig } from "../src/helpAppConfig.js";

// 服务端分组名沿用历史协议，但客户端只读取社区入口。
const envelope = (help: unknown) => ({ code: 0, data: { configs: { feedbackUrl: help } } });
const community = (url: string) => ({ community_urls: { "zh-CN": url } });

describe("help app config", () => {
  it("按语言回退社区入口，忽略远端及本地残留的反馈设置", () => {
    expect(
      resolveHelpAppConfig(
        {
          ...community("https://remote.example.com"),
          feedback_url: "https://removed.example.com",
          feedback_use_external_form: true,
        },
        {
          community_urls: {
            "zh-CN": "https://local.example.com/cn",
            "en-US": "https://local.example.com/en",
          },
          feedback_url: "https://removed-local.example.com",
        },
      ),
    ).toEqual({
      community_urls: {
        "zh-CN": "https://remote.example.com",
        "en-US": "https://local.example.com/en",
      },
    });
  });

  it("只返回社区配置，并保持 no-store、并发合并、TTL 和 endpoint 隔离", async () => {
    let now = 0;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () =>
      Response.json(
        envelope({
          ...community("https://remote.example.com"),
          feedback_url: "https://removed.example.com",
          feedback_use_external_form: true,
        }),
      ),
    );
    const read = createHelpAppConfigReader({ fetchImpl, now: () => now });
    const [a, b] = await Promise.all([
      read("https://a.example.com/configs"),
      read("https://a.example.com/configs"),
    ]);
    expect(a).toEqual(b);
    expect(a).toEqual(community("https://remote.example.com"));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ cache: "no-store", credentials: "omit" });
    await read("https://a.example.com/configs");
    await read("https://b.example.com/configs");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    now = 3_600_001;
    await read("https://a.example.com/configs");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it.each([{}, { code: 1, data: { configs: { feedbackUrl: {} } } }, envelope(null)])(
    "无效响应不进入缓存 %j",
    async (body) => {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json(body));
      const read = createHelpAppConfigReader({ fetchImpl });
      await expect(read("https://a.example.com/configs")).rejects.toThrow();
      await expect(read("https://a.example.com/configs")).rejects.toThrow();
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    },
  );

  it.each([new Response("bad", { status: 503 }), new Response("not json")])(
    "HTTP 和 JSON 错误不缓存",
    async (response) => {
      const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => response.clone());
      const read = createHelpAppConfigReader({ fetchImpl });
      await expect(read("https://a.example.com/configs")).rejects.toThrow();
      await expect(read("https://a.example.com/configs")).rejects.toThrow();
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    },
  );

  it("超时信号传递到网络层，失败后可重试", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException("timeout", "TimeoutError"));
    const read = createHelpAppConfigReader({ fetchImpl });
    await expect(read("https://a.example.com/configs")).rejects.toThrow("timeout");
    expect(fetchImpl.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    fetchImpl.mockImplementation(async () =>
      Response.json(envelope(community("https://recovered.example.com"))),
    );
    expect((await read("https://a.example.com/configs")).community_urls?.["zh-CN"]).toBe(
      "https://recovered.example.com",
    );
  });

  it("旧 endpoint 的迟到响应不覆盖新 endpoint", async () => {
    let finishOld!: (response: Response) => void;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (String(url).includes("old"))
        return new Promise<Response>((resolve) => {
          finishOld = resolve;
        });
      return Response.json(envelope(community("https://new.example.com")));
    });
    const read = createHelpAppConfigReader({ fetchImpl });
    const old = read("https://old.example.com/configs");
    expect((await read("https://new.example.com/configs")).community_urls?.["zh-CN"]).toBe(
      "https://new.example.com",
    );
    finishOld(Response.json(envelope(community("https://old.example.com"))));
    await old;
    expect((await read("https://new.example.com/configs")).community_urls?.["zh-CN"]).toBe(
      "https://new.example.com",
    );
  });
});
