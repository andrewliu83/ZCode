import { describe, expect, it } from "vitest";
import {
  PROCESS_RESOURCE_CLI_LANES,
  PROCESS_RESOURCE_ROLES,
  resolveCliProcessResourceRole,
} from "@zcode/shared";

describe("本地资源诊断角色", () => {
  it("保留桌面、Host、CLI 与 MCP 的角色分类", () => {
    expect([...PROCESS_RESOURCE_ROLES]).toEqual([
      "main",
      "renderer_main",
      "renderer_guest",
      "gpu",
      "chromium_other",
      "host",
      "scheduler",
      "cli_chat",
      "cli_aux",
      "mcp",
    ]);
  });
  it("保留 CLI lane 分类以及旧远端缺少 lane 时的兼容", () => {
    expect([...PROCESS_RESOURCE_CLI_LANES]).toEqual(["chat", "plugin", "mcp-status"]);
    expect(resolveCliProcessResourceRole("chat")).toBe("cli_chat");
    expect(resolveCliProcessResourceRole("plugin")).toBe("cli_aux");
    expect(resolveCliProcessResourceRole("mcp-status")).toBe("cli_aux");
    expect(resolveCliProcessResourceRole(undefined)).toBe("cli_chat");
  });
});
