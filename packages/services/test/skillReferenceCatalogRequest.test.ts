import { expect, it, vi } from "vitest";
import { requestSkillReferenceCatalog } from "../src/zcode-agent/skillReferenceCatalogRequest.js";

const params = {
  workspace: { workspacePath: "/workspace", workspaceKey: "test-identity" },
  sessionId: "session",
};
const result = { authority: "session", skills: [] };

it("内置技能入口仅在旧 Agent 返回 method-not-found 时回退，保持身份与会话", async () => {
  const request = vi.fn().mockRejectedValueOnce({ code: -32601 }).mockResolvedValue(result);
  expect(await requestSkillReferenceCatalog({ request }, params)).toBe(result);
  expect(request.mock.calls.map((call) => call.slice(0, 2))).toEqual([
    ["skills/referenceCatalogWithBuiltIns", params],
    ["skills/referenceCatalog", params],
  ]);
});

it.each([-32602, -32000, undefined])("其他错误 %s 不切换 authority", async (code) => {
  const error = Object.assign(new Error("failed"), { code });
  const request = vi.fn().mockRejectedValue(error);
  await expect(requestSkillReferenceCatalog({ request }, params)).rejects.toBe(error);
  expect(request).toHaveBeenCalledTimes(1);
});
