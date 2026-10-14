// P1 的开关协议方法（docs/thinkrail/design.md D2）。
// 与 off-peak-tool-policy.test.ts 同构：判定权在 Host，CLI 只缓存结论。
import { describe, expect, it } from "vitest";
import { updateThinkrailToolPolicy } from "../src/zcode-protocol/thinkrail-policy.js";
import type { ZCodeProtocolAgentServerContext } from "../src/zcode-protocol/server-types.js";

function makeContext() {
  return {
    appRuntimePreferences: {
      askUserQuestionAutoResolutionEnabled: true,
      modelIoFullRetentionEnabled: false,
      offPeakToolEnabled: false,
      thinkrailEnabled: false,
    },
  } as unknown as ZCodeProtocolAgentServerContext;
}

describe("workspace/updateThinkrailToolPolicy", () => {
  it("缓存 Host 判定的开关，供后续 create/resume/v4 冷恢复读取，并回显结果", async () => {
    const context = makeContext();
    const workspace = { workspaceKey: "/w", workspacePath: "/w" };
    const result = await updateThinkrailToolPolicy(context, { workspace, enabled: true });
    expect(context.appRuntimePreferences.thinkrailEnabled).toBe(true);
    expect(result).toEqual({ workspace, enabled: true });

    await updateThinkrailToolPolicy(context, { workspace, enabled: false });
    expect(context.appRuntimePreferences.thinkrailEnabled).toBe(false);
  });

  it("strict schema 拒绝未知键（不让 host 误传 per-session 字段）", async () => {
    await expect(
      updateThinkrailToolPolicy(makeContext(), {
        workspace: { workspaceKey: "/w", workspacePath: "/w" },
        enabled: true,
        sessionId: "s1",
      }),
    ).rejects.toThrow();
  });

  it("缺少 enabled 时拒绝：开关没有「保持不变」的第三态", async () => {
    await expect(
      updateThinkrailToolPolicy(makeContext(), {
        workspace: { workspaceKey: "/w", workspacePath: "/w" },
      }),
    ).rejects.toThrow();
  });
});
