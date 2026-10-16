// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/ControlHintTooltip.js", () => ({
  ControlHintTooltip: ({ children }: { children: unknown }) => children,
}));
vi.mock("@/components/ui/button.js", () => ({
  Button: ({ children, ...props }: { children: unknown; [key: string]: unknown }) =>
    createElement("button", props, children),
}));
vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({ intl: { formatMessage: ({ id }: { id: string }) => id } }),
}));
vi.mock("@/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useResolvedRemoteWorkspaceSessionId.js", () => ({
  useResolvedRemoteWorkspaceSessionId: (_: string, id?: string) => id ?? null,
}));
vi.mock("@/hooks/useWebRemoteControlStatus.js", () => ({
  useWebRemoteControlStatus: () => ({ status: "idle" }),
}));
vi.mock("@/WebRemoteControlDialog.js", () => ({
  WebRemoteControlDialog: (props: {
    open: boolean;
    workspacePath: string;
    workspaceIdentity?: string;
    remoteSessionId?: string;
  }) =>
    props.open
      ? createElement("div", {
          role: "dialog",
          "data-workspace": props.workspacePath,
          "data-identity": props.workspaceIdentity,
          "data-remote-session": props.remoteSessionId,
        })
      : null,
}));
afterEach(cleanup);

describe("WorkspaceWebRemoteControlTrigger", () => {
  it.each([
    { workspacePath: "/workspace/local" },
    {
      workspacePath: "/workspace/remote",
      workspaceIdentity: "remote:ssh:fixture:22:user:/workspace/remote",
      remoteSessionId: "remote-session-1",
    },
  ])("无埋点依赖时仍能打开远控并保持目标身份 $workspacePath", async (input) => {
    const { WorkspaceWebRemoteControlTrigger } =
      await import("../src/WorkspaceWebRemoteControlTrigger.js");
    const { WebRemoteControlFeatureProvider } =
      await import("../src/WebRemoteControlFeatureProvider.js");
    const { PlatformProvider } = await import("../src/hooks/usePlatform.js");
    render(
      createElement(
        PlatformProvider,
        { platform: {} as never },
        createElement(
          WebRemoteControlFeatureProvider,
          { enabled: true },
          createElement(WorkspaceWebRemoteControlTrigger, input),
        ),
      ),
    );
    fireEvent.click(screen.getByRole("button"));
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("data-workspace")).toBe(input.workspacePath);
    if ("workspaceIdentity" in input)
      expect(dialog.getAttribute("data-identity")).toBe(input.workspaceIdentity);
    if ("remoteSessionId" in input)
      expect(dialog.getAttribute("data-remote-session")).toBe(input.remoteSessionId);
  });
});
