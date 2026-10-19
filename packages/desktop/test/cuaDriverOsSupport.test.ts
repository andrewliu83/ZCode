import { describe, expect, it } from "vitest";
import { CUA_MINIMUM_MACOS_VERSION, resolveCuaOsSupport } from "../src/main/cuaOsSupport.js";

describe("Cua Driver OS floor", () => {
  it("matches the pinned app and native SDK minimum macOS 13", () => {
    expect(CUA_MINIMUM_MACOS_VERSION).toBe("13.0");
    expect(resolveCuaOsSupport("darwin", "21.6.0")).toEqual({
      kind: "macos-below-minimum", minimumMacOs: "13.0", currentMacOs: "12",
    });
    expect(resolveCuaOsSupport("darwin", "22.0.0")).toEqual({ kind: "supported" });
    expect(resolveCuaOsSupport("linux", "6.0")).toEqual({ kind: "not-applicable" });
  });
});
