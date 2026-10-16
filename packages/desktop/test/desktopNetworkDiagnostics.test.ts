import { afterEach, expect, it, vi } from "vitest";
vi.mock("../src/main/desktopRuntimeEnv.js", () => ({ desktopRuntimeEnv: "development" }));

afterEach(async () => {
  const module = await import("../src/main/desktopNetworkDiagnostics.js");
  module.stopDesktopNetworkDiagnostics();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("网络诊断仅在本地聚合记录，不发送请求，停止后不再写入", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn(() => {
    throw new Error("diagnostics must stay local");
  });
  vi.stubGlobal("fetch", fetch);
  const {
    registerDesktopNetworkDiagnostics,
    ingestHostNetworkObservations,
    stopDesktopNetworkDiagnostics,
    NETWORK_DIAGNOSTIC_INTERVAL_MS,
  } = await import("../src/main/desktopNetworkDiagnostics.js");
  const logger = { info: vi.fn(), warn: vi.fn() };
  registerDesktopNetworkDiagnostics(logger);
  ingestHostNetworkObservations([
    { transport: "rpc", interface: "terminal.write", durationMs: 5, ok: true },
    {
      transport: "rpc",
      interface: "terminal.write",
      durationMs: 8,
      ok: false,
      errorKind: "timeout",
    },
  ]);
  await vi.advanceTimersByTimeAsync(NETWORK_DIAGNOSTIC_INTERVAL_MS);
  expect(logger.info).toHaveBeenCalledExactlyOnceWith(
    "[network] local aggregate",
    expect.objectContaining({
      interface: "terminal.write",
      requestTotal: 2,
      successCount: 1,
      failCount: 1,
    }),
  );
  expect(fetch).not.toHaveBeenCalled();
  stopDesktopNetworkDiagnostics();
  await vi.advanceTimersByTimeAsync(NETWORK_DIAGNOSTIC_INTERVAL_MS * 2);
  expect(logger.info).toHaveBeenCalledTimes(1);
});
