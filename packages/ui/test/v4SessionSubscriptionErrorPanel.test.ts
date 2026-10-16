// @vitest-environment jsdom
import type { IPlatformService } from "@zcode/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { PlatformProvider } from "@/hooks/usePlatform.js";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import { SessionSubscriptionErrorPanel } from "@/v4/SessionSubscriptionErrorPanel.js";

afterEach(cleanup);
it("shows the error and reconnect action without uploading diagnostics", () => {
  const onReconnect = vi.fn();
  const captureWindowScreenshot = vi.fn();
  render(
    createElement(
      ZCodeIntlProvider,
      { initialLocale: "zh-CN" },
      createElement(
        PlatformProvider,
        { platform: { captureWindowScreenshot } as unknown as IPlatformService },
        createElement(SessionSubscriptionErrorPanel, {
          error: "EPERM: operation not permitted",
          sessionId: "session-1",
          workspacePath: "/workspace",
          onReconnect,
        }),
      ),
    ),
  );
  expect(screen.getByText("EPERM: operation not permitted")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "反馈问题" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "重新连接" }));
  expect(onReconnect).toHaveBeenCalledOnce();
  expect(captureWindowScreenshot).not.toHaveBeenCalled();
});
