import { afterEach, describe, expect, it, vi } from "vitest";

async function importFreshEnvModule() {
  vi.resetModules();
  return import("../src/env.js");
}
describe("shared runtime env", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("keeps optional updates disabled and does not expose reporting endpoints", async () => {
    vi.stubGlobal("__ZCODE_ARMS_RUM_ENDPOINT__", "https://collector.example.invalid");
    vi.stubGlobal("__ZCODE_TELEMETRY_REPORT_ENDPOINT__", "https://collector.example.invalid/event");
    const env = await importFreshEnvModule();
    expect(env.ZCODE_AUTO_UPDATE_ENABLED).toBe(false);
    expect(env).not.toHaveProperty("ZCODE_ARMS_RUM_ENDPOINT");
    expect(env).not.toHaveProperty("ZCODE_TELEMETRY_REPORT_ENDPOINT");
    expect(env).not.toHaveProperty("mapZCodeEnvToArmsRumEnv");
  });
  it("未注入 ZCODE_ENV 时默认 test", async () => {
    vi.stubGlobal("__ZCODE_ENV__", undefined);
    const env = await importFreshEnvModule();
    expect(env.ZCODE_ENV).toBe("test");
    expect(env.normalizeZCodeEnv("development")).toBe("test");
  });
  it("未注入身份 define 时 flavor 跟随 ZCODE_ENV", async () => {
    vi.stubGlobal("__ZCODE_ENV__", "production");
    vi.stubGlobal("__ZCODE_PRODUCT_FLAVOR__", undefined);
    const env = await importFreshEnvModule();
    expect(env.ZCODE_PRODUCT_FLAVOR).toBe("production");
    expect(env.normalizeZCodeProductFlavor(undefined, "test")).toBe("preview");
    expect(env.normalizeZCodeProductFlavor("bogus", "production")).toBe("production");
  });
  it("显式注入 preview 身份时生产后端构建仍是 Preview", async () => {
    vi.stubGlobal("__ZCODE_ENV__", "production");
    vi.stubGlobal("__ZCODE_PRODUCT_FLAVOR__", "preview");
    const env = await importFreshEnvModule();
    expect(env.ZCODE_ENV).toBe("production");
    expect(env.ZCODE_PRODUCT_FLAVOR).toBe("preview");
  });
});
