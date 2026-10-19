import { describe, expect, it } from "vitest";
import { DRIVER_ENV, loadDriverSdk, parseDriverResult } from "../driver-sdk.js";

describe("Driver SDK boundary", () => {
  it("merges real capture extras with structured state without losing either", () => {
    expect(
      parseDriverResult({
        rawJson: JSON.stringify({
          structuredContent: { capture_id: "capture", snapshot_id: "old" },
        }),
        text: "AX tree",
        structuredJson: JSON.stringify({ snapshot_id: "current", elements: [] }),
      }),
    ).toEqual({ capture_id: "capture", snapshot_id: "current", elements: [] });
  });
  it("preserves inventories and treats non-JSON text as text", () => {
    expect(parseDriverResult({ text: '[{"pid":1}]' })).toEqual([{ pid: 1 }]);
    expect(parseDriverResult({ text: "Window tree" })).toBeUndefined();
    expect(() => parseDriverResult(null)).toThrow("invalid result");
  });
  it("rejects relative SDK overrides before loading native code", async () => {
    await expect(loadDriverSdk({ ZCODE_CUA_DRIVER_SDK_PATH: "relative" })).rejects.toThrow(
      "absolute",
    );
  });
  it("pins telemetry and independent updates off", () => {
    expect(DRIVER_ENV).toEqual({
      CUA_DRIVER_RS_TELEMETRY_ENABLED: "false",
      CUA_TELEMETRY_ENABLED: "false",
      CUA_DRIVER_RS_UPDATE_CHECK: "false",
      DO_NOT_TRACK: "1",
      CUA_TELEMETRY: "0",
    });
  });
});
