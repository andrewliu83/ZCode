import type { IPlatformService } from "@zcode/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ChatErrorBanner } from "@/ChatErrorBanner.js";
import { PlatformProvider } from "@/hooks/usePlatform.js";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";

vi.mock("@/components/ui/toast.js", () => ({ toast: vi.fn() }));

it("keeps the error visible without a feedback uploader or automatic screenshot capture", () => {
  const captureWindowScreenshot = vi.fn(async () => null);
  const html = renderToStaticMarkup(
    createElement(
      ZCodeIntlProvider,
      { initialLocale: "zh-CN" },
      createElement(
        PlatformProvider,
        { platform: { captureWindowScreenshot } as unknown as IPlatformService },
        createElement(ChatErrorBanner, {
          error: {
            code: "PROVIDER_AUTH_FAILED",
            message: "Provider authentication failed.",
            traceId: "trace-auth-failed",
          },
          onDismiss: vi.fn(),
        }),
      ),
    ),
  );
  expect(html).toContain("Provider authentication failed.");
  expect(html).not.toContain("反馈问题");
  expect(captureWindowScreenshot).not.toHaveBeenCalled();
});
