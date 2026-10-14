import { expect, it, vi } from "vitest";
import { zcodeProtocolMethods, zcodeSystemPromptReadParamsSchema } from "@zcode/shared";
import { offPeakSelectionView } from "./fixtures/offPeakSelection.js";

it.each(["desktop", "terminal"] as const)(
  "%s 的 Host 表面值在查询边界转换为 CLI 协议值",
  async (presentationSurface) => {
    const requests: unknown[] = [];
    const result = {
      authority: "workspace",
      basePrompt: "BASE",
      defaultPrompt: "DEFAULT",
      sections: [],
      busy: false,
    };
    const client = {
      transportKind: "stdio",
      request: vi.fn(async (method: string, params: unknown) => {
        if (method !== zcodeProtocolMethods.systemPromptRead)
          throw new Error(`Unexpected ${method}`);
        requests.push(zcodeSystemPromptReadParamsSchema.parse(params));
        return result;
      }),
      onNotification: () => ({ dispose() {} }),
      onRequest: () => ({ dispose() {} }),
      onClose: () => ({ dispose() {} }),
    };
    vi.resetModules();
    vi.doMock("../src/zcode-agent/zcodeAgentProcessManager.js", () => ({
      ZCodeAgentProcessManager: class {
        getClient = vi.fn(async () => client);
        markReady() {}
        onRuntimeLifecycle() {
          return { dispose() {} };
        }
        onRuntimeRestarted() {
          return { dispose() {} };
        }
        disposeAll() {}
      },
    }));
    const { createZCodeAgentService } = await import("../src/zcode-agent/zcodeAgentService.js");
    const service = createZCodeAgentService({
      presentationSurface,
      modelSelectionReadinessSource: { getView: async () => offPeakSelectionView() },
    });
    try {
      await expect(
        service.getSystemPromptSnapshot({ workspacePath: "/workspace/app" }),
      ).resolves.toEqual(result);
      expect(requests).toEqual([
        {
          workspace: { workspacePath: "/workspace/app", workspaceKey: "/workspace/app" },
          presentationSurface: presentationSurface === "desktop" ? "zcode_desktop" : "terminal",
        },
      ]);
    } finally {
      service.disposeAll();
    }
  },
);
