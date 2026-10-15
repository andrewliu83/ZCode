// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { ZCodeSystemPromptReadResult } from "@zcode/shared";
import { useSystemPromptInspection } from "../src/hooks/useSystemPromptInspection.js";

const services = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../src/hooks/useZCodeAgentService.js", () => ({
  useZCodeAgentService: (_path: string, _remoteId: string, identity: string) =>
    services.get(identity),
}));
vi.mock("../src/store/zcodeSessionStore.js", () => ({
  useZCodeSessionStore: vi.fn(),
  selectWorkspaceZCodeState: vi.fn(),
}));

function Probe({ identity, kernel }: { identity: string; kernel?: string }) {
  const { snapshot } = useSystemPromptInspection({
    workspacePath: "/same/path",
    workspaceIdentity: identity,
    remoteSessionId: identity,
    agentKernel: kernel,
  });
  return createElement("p", null, snapshot?.basePrompt ?? "loading");
}
const snapshot = (body: string): ZCodeSystemPromptReadResult => ({
  authority: "workspace",
  basePrompt: body,
  defaultPrompt: "default",
  sections: [],
  busy: false,
});

it("快速切换预览内核，迟到的 ZCode 结果不能覆盖 Claude 正文", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let finishOld!: (value: ZCodeSystemPromptReadResult) => void;
  const read = vi.fn(({ agentKernel }: { agentKernel?: string }) =>
    agentKernel === "zcode"
      ? new Promise<ZCodeSystemPromptReadResult>((resolve) => {
          finishOld = resolve;
        })
      : Promise.resolve(snapshot("CLAUDE ONLY")),
  );
  services.set("one", { getSystemPromptSnapshot: read });
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(Probe, { identity: "one", kernel: "zcode" })));
    await act(async () => root.render(createElement(Probe, { identity: "one", kernel: "claude" })));
    expect(container.textContent).toBe("CLAUDE ONLY");
    await act(async () => finishOld(snapshot("STALE ZCODE")));
    expect(container.textContent).toBe("CLAUDE ONLY");
    expect(read.mock.calls.map(([target]) => target.agentKernel)).toEqual(["zcode", "claude"]);
  } finally {
    await act(async () => root.unmount());
    services.clear();
  }
});

it("相同路径切换远程 identity/attachment 后，迟到的旧提示词不会覆盖新来源", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let resolveA!: (value: ZCodeSystemPromptReadResult) => void;
  let resolveB!: (value: ZCodeSystemPromptReadResult) => void;
  services.set("identity:A", {
    getSystemPromptSnapshot: vi.fn(
      () =>
        new Promise((resolve) => {
          resolveA = resolve;
        }),
    ),
  });
  services.set("identity:B", {
    getSystemPromptSnapshot: vi.fn(
      () =>
        new Promise((resolve) => {
          resolveB = resolve;
        }),
    ),
  });
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(createElement(Probe, { identity: "identity:A" }));
    });
    await act(async () => {
      root.render(createElement(Probe, { identity: "identity:B" }));
    });
    await act(async () => {
      resolveB(snapshot("NEW AUTHORITY"));
    });
    expect(container.textContent).toBe("NEW AUTHORITY");
    await act(async () => {
      resolveA(snapshot("STALE AUTHORITY"));
    });
    expect(container.textContent).toBe("NEW AUTHORITY");
  } finally {
    await act(async () => {
      root.unmount();
    });
    services.clear();
  }
});
