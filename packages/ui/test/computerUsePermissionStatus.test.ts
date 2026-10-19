// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CuaPermissionStatusResult } from "@zcode/services";
import { ZCODE_CUA_OFFICIAL_PLUGIN_ID } from "@zcode/shared";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import { ComputerUseSection } from "@/settings/ComputerUseSection.js";
import { usePluginManagementStore } from "@/store/pluginManagementStore.js";

const h = vi.hoisted(() => ({
  status: null as CuaPermissionStatusResult | null,
  refresh: vi.fn(),
  services: {},
  platform: { openCuaPermissionOnboarding: vi.fn() },
  settings: { settings: {}, update: vi.fn() },
}));
vi.mock("@/hooks/useServices.js", () => ({ useServices: () => h.services }));
vi.mock("@/hooks/usePlatform.js", () => ({ usePlatform: () => h.platform }));
vi.mock("@/hooks/useSettingService.js", () => ({ useSettings: () => h.settings }));
vi.mock("@/hooks/useCuaPermissionStatus.js", () => ({
  useCuaPermissionStatus: () => ({ status: h.status, settled: true, refresh: h.refresh }),
}));

beforeEach(() => {
  h.status = null;
  usePluginManagementStore.setState({
    plugins: [
      {
        id: ZCODE_CUA_OFFICIAL_PLUGIN_ID,
        name: "zcode-cua",
        enabled: true,
        source: "official",
        marketplace: "zcode-plugins-official",
        skillCount: 1,
        skillRootCount: 1,
        commandRootCount: 0,
        mcpServerNames: [],
        rootPath: "/test/zcode-cua",
      },
    ],
  });
});
afterEach(() => {
  cleanup();
  usePluginManagementStore.setState({ plugins: [] });
});

function renderSection(locale: "en-US" | "zh-CN" = "en-US") {
  return render(
    createElement(
      ZCodeIntlProvider,
      { initialLocale: locale },
      createElement(ComputerUseSection, {
        isDesktop: true,
        isMacDesktop: true,
        workspacePath: "/test/workspace",
      }),
    ),
  );
}

describe("Computer Use permission status", () => {
  it.each([
    ["en-US", "Driver unavailable", "Unknown"],
    ["zh-CN", "驱动不可用", "未知"],
  ] as const)("shows driver unavailability and its reason in %s", (locale, label, unknown) => {
    h.status = { available: false, reason: "Driver executable missing" };
    renderSection(locale);
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByText("Driver executable missing")).toBeTruthy();
    expect(screen.queryByText(unknown)).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(h.platform.openCuaPermissionOnboarding).not.toHaveBeenCalled();
  });

  it("renders service-shaped permissions without an availability flag", () => {
    h.status = {
      grantOwner: "ai.cua.driver",
      accessibility: "granted",
      screenRecording: "denied",
    };
    renderSection();
    expect(screen.getByText("Granted")).toBeTruthy();
    expect(screen.getByText("Missing")).toBeTruthy();
    expect(screen.queryByText("Unknown")).toBeNull();
    expect(screen.queryByText("Driver unavailable")).toBeNull();
  });

  it("keeps an unknown permission distinct from an unavailable driver", () => {
    h.status = { grantOwner: null, accessibility: "unknown", screenRecording: "unknown" };
    renderSection();
    expect(screen.getAllByText("Unknown")).toHaveLength(2);
    expect(screen.queryByText("Driver unavailable")).toBeNull();
  });
});
