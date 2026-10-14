// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useThinkrailEnabledSync } from "@/hooks/useThinkrailEnabledSync.js";
import { useThinkrailCatalogStore } from "@/store/thinkrailCatalogStore.js";

vi.mock("@/logger.js", () => ({ logger: { warn: vi.fn() } }));
beforeEach(() => {
  useThinkrailCatalogStore.setState({ revision: 0 });
});

it("只有 Host 确认开关后才失效目录，失败信号不发布新目录代次", async () => {
  let acknowledge!: () => void;
  const pending = new Promise<void>((resolve) => {
    acknowledge = resolve;
  });
  const syncThinkrailEnabled = vi
    .fn()
    .mockReturnValueOnce(pending)
    .mockRejectedValueOnce(new Error("offline"));
  const zcodeAgentService = { syncThinkrailEnabled };
  const hook = renderHook(
    ({ enabled }) => useThinkrailEnabledSync({ settingsLoaded: true, enabled, zcodeAgentService }),
    {
      initialProps: { enabled: false },
    },
  );
  expect(syncThinkrailEnabled).not.toHaveBeenCalled();
  hook.rerender({ enabled: true });
  await waitFor(() => expect(syncThinkrailEnabled).toHaveBeenCalledTimes(1));
  expect(useThinkrailCatalogStore.getState().revision).toBe(0);
  await act(async () => {
    acknowledge();
    await pending;
  });
  await waitFor(() => expect(useThinkrailCatalogStore.getState().revision).toBe(1));
  hook.rerender({ enabled: false });
  await waitFor(() => expect(syncThinkrailEnabled).toHaveBeenCalledTimes(2));
  expect(useThinkrailCatalogStore.getState().revision).toBe(1);
  hook.unmount();
});
