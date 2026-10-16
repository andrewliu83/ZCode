import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ configDir: "", start: vi.fn(), setPath: vi.fn() }));
vi.mock("electron", () => ({
  app: { name: "ZCode Test", getName: () => "ZCode Test", setPath: h.setPath },
  crashReporter: { start: h.start },
}));
vi.mock("@zcode/services/node", () => ({ getAppConfigDir: () => h.configDir }));

afterEach(async () => {
  if (h.configDir) await rm(h.configDir, { recursive: true, force: true });
});

it("崩溃捕获只写本地目录，不启用上传或读取上报地址", async () => {
  h.configDir = await mkdtemp(join(tmpdir(), "zcode-local-crash-"));
  const { initializeCrashCapture } = await import("../src/main/desktopCrashCapture.js");
  const paths = initializeCrashCapture({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });
  expect(paths.rootDir).toBe(join(h.configDir, "crash"));
  expect(h.setPath).toHaveBeenCalledWith("crashDumps", paths.stagingDir);
  expect(h.start).toHaveBeenCalledTimes(1);
  const options = h.start.mock.calls[0]![0];
  expect(options.uploadToServer).toBe(false);
  expect(new URL(options.submitURL).hostname).toMatch(/\.invalid$/u);
  initializeCrashCapture({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });
  expect(h.start).toHaveBeenCalledTimes(1);
});
