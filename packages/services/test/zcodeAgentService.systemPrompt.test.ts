import { expect, it, vi } from "vitest";
import { zcodeProtocolMethods, zcodeSystemPromptReadParamsSchema } from "@zcode/shared";
import { offPeakSelectionView } from "./fixtures/offPeakSelection.js";

it.each([
  ["desktop", "zcode"],
  ["terminal", "zcode"],
  ["desktop", "claude"],
  ["terminal", "claude"],
] as const)(
  "%s 的 %s 内核预览使用显式目标并转换表面协议",
  async (presentationSurface, agentKernel) => {
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
        service.getSystemPromptSnapshot({ workspacePath: "/workspace/app", agentKernel }),
      ).resolves.toEqual(result);
      expect(requests).toEqual([
        {
          workspace: { workspacePath: "/workspace/app", workspaceKey: "/workspace/app" },
          presentationSurface: presentationSurface === "desktop" ? "zcode_desktop" : "terminal",
          ...(agentKernel === "claude" ? { agentKernel: "claude" } : {}),
        },
      ]);
    } finally {
      service.disposeAll();
    }
  },
);
