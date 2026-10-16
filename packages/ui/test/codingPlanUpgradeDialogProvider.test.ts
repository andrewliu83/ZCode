// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  status: "ready" as "ready" | "loading" | "error",
  retry: vi.fn(),
  targets: [] as Array<{ providerId: string; initialAudience?: "personal" | "team" } | undefined>,
  onOpenResult: undefined as undefined | ((opened: boolean) => void),
}));
vi.mock("@/hooks/useCodingPlanEntryPlanList.js", () => ({
  useCodingPlanEntryPlanList: () => ({
    entryPlanList: "coding_plan__personal_lite",
    status: h.status,
    retry: h.retry,
  }),
}));
vi.mock("@/hooks/usePlatform.js", () => ({ usePlatform: () => ({}) }));
vi.mock("@/settings/CodingPlanUpgradeDialog.js", () => ({
  CodingPlanUpgradeDialog: ({
    target,
    onOpenResult,
  }: {
    target?: { providerId: string; initialAudience?: "personal" | "team" };
    onOpenResult?: (opened: boolean) => void;
  }) => {
    h.targets.push(target);
    h.onOpenResult = onOpenResult;
    return null;
  },
}));
import {
  CodingPlanUpgradeDialogProvider,
  useCodingPlanUpgradeDialog,
} from "@/settings/CodingPlanUpgradeDialogProvider.js";

afterEach(() => {
  cleanup();
  h.status = "ready";
  h.targets.length = 0;
  h.onOpenResult = undefined;
  vi.clearAllMocks();
});
function Launcher({
  version = 0,
  observation,
}: {
  version?: number;
  observation?: { signal: AbortSignal; onResult: (opened: boolean) => void };
}) {
  const { openCodingPlanUpgrade } = useCodingPlanUpgradeDialog();
  return createElement(
    "button",
    {
      "data-version": version,
      onClick: () =>
        openCodingPlanUpgrade(
          { providerId: "zai-coding-plan", initialAudience: "personal" },
          observation,
        ),
    },
    "Upgrade",
  );
}
function app(props: Parameters<typeof Launcher>[0] = {}) {
  return createElement(CodingPlanUpgradeDialogProvider, null, createElement(Launcher, props));
}

describe("CodingPlanUpgradeDialogProvider without reporting", () => {
  it.each([true, false])("settles an observed opening %s only once", (opened) => {
    const result = vi.fn();
    render(app({ observation: { signal: new AbortController().signal, onResult: result } }));
    fireEvent.click(screen.getByRole("button", { name: "Upgrade" }));
    const finish = h.onOpenResult!;
    act(() => {
      finish(opened);
      finish(!opened);
    });
    expect(result).toHaveBeenCalledExactlyOnceWith(opened);
  });
  it("aborts an observed opening and ignores a late ready event", () => {
    const controller = new AbortController();
    const result = vi.fn();
    render(app({ observation: { signal: controller.signal, onResult: result } }));
    fireEvent.click(screen.getByRole("button", { name: "Upgrade" }));
    const late = h.onOpenResult!;
    act(() => controller.abort());
    act(() => late(true));
    expect(result).toHaveBeenCalledExactlyOnceWith(false);
    expect(h.targets.at(-1)).toBeUndefined();
  });
  it.each(["loading", "error"] as const)(
    "blocks %s inventory without replaying the click after readiness",
    (status) => {
      h.status = status;
      const view = render(app());
      fireEvent.click(screen.getByRole("button", { name: "Upgrade" }));
      expect(h.targets.at(-1)).toBeUndefined();
      h.status = "ready";
      view.rerender(app({ version: 1 }));
      expect(h.targets.at(-1)).toBeUndefined();
      fireEvent.click(screen.getByRole("button", { name: "Upgrade" }));
      expect(h.targets.at(-1)).toEqual({
        providerId: "zai-coding-plan",
        initialAudience: "personal",
      });
    },
  );
  it("preserves the selected purchase target across OAuth-driven rerenders without a tracking context", () => {
    const view = render(app());
    fireEvent.click(screen.getByRole("button", { name: "Upgrade" }));
    const target = h.targets.at(-1);
    expect(target).toEqual({ providerId: "zai-coding-plan", initialAudience: "personal" });
    view.rerender(app({ version: 1 }));
    expect(h.targets.at(-1)).toBe(target);
    expect(h.targets.at(-1)).not.toHaveProperty("funnelContext");
  });
});
