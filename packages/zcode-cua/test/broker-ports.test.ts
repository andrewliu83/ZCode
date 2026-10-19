import { describe, expect, it } from "vitest";
import type { CuaPermissionStatus } from "../broker.js";
import { isCuaPermissionStatusAvailable, shouldRunCuaScreenCaptureProbe } from "../broker-ports.js";

const status: CuaPermissionStatus = {
  grantOwner: "ai.cua.driver",
  accessibility: "granted",
  screenRecording: "denied",
};

describe("CUA permission ports", () => {
  it("accepts service-shaped status with omitted availability and every permission state", () => {
    for (const state of ["granted", "stale", "denied", "unknown"] as const) {
      expect(
        isCuaPermissionStatusAvailable({ ...status, accessibility: state, screenRecording: state }),
      ).toBe(true);
    }
    expect(isCuaPermissionStatusAvailable({ ...status, available: true })).toBe(true);
    expect(isCuaPermissionStatusAvailable({ ...status, grantOwner: null })).toBe(true);
  });

  it.each([
    undefined,
    null,
    false,
    "granted",
    [],
    {},
    { available: true },
    { available: false, reason: "Driver executable missing" },
    { ...status, available: false },
    { ...status, available: null },
    { ...status, available: "true" },
    { ...status, grantOwner: undefined },
    { ...status, grantOwner: 123 },
    { ...status, accessibility: null },
    { ...status, accessibility: "authorized" },
    { ...status, screenRecording: undefined },
    { ...status, screenRecording: true },
  ])("rejects unavailable or malformed permission result %j", (result) => {
    expect(isCuaPermissionStatusAvailable(result)).toBe(false);
  });

  it("runs a functional screen capture probe only for granted permission and explicit opt-in", () => {
    expect(shouldRunCuaScreenCaptureProbe("granted", { includeFunctionalProbes: true })).toBe(true);
    for (const options of [
      undefined,
      {},
      { includeFunctionalProbes: false },
      { includeFunctionalProbes: 1 },
      { probeScreenCapture: true },
    ]) {
      expect(shouldRunCuaScreenCaptureProbe("granted", options)).toBe(false);
    }
    for (const state of [undefined, "unknown", "denied", "stale"] as const) {
      expect(shouldRunCuaScreenCaptureProbe(state, { includeFunctionalProbes: true })).toBe(false);
    }
  });
});
