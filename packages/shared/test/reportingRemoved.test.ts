import { describe, expect, it } from "vitest";
import { PlatformChannels, ServiceChannels, HostResponseTypes } from "../src/channels.js";
import { hostResponseMessageSchema, webRemoteControlAppPayloadSchema } from "../src/validation.js";
import { DesktopCommandIds } from "../src/platform.js";

describe("removed reporting and upload contracts", () => {
  it("does not expose a feedback upload service or reporting IPC", () => {
    expect(ServiceChannels).not.toHaveProperty("Feedback");
    for (const name of [
      "ReportTelemetryEvent",
      "ReportArmsCustomEvent",
      "SyncTelemetryContext",
      "OpenFeedbackDialog",
      "ReadFinalArmsCustomEventsE2E",
      "ReportLocalTtftBatch",
    ]) {
      expect(PlatformChannels).not.toHaveProperty(name);
    }
    expect(DesktopCommandIds).not.toHaveProperty("OpenFeedback");
  });
  it("远控与 Host 协议拒绝旧埋点消息，不再转发或接纳上传任务", () => {
    expect(HostResponseTypes).not.toHaveProperty("SessionCreateTelemetry");
    expect(HostResponseTypes).not.toHaveProperty("FeedbackLogArchiveRequest");
    expect(
      hostResponseMessageSchema.safeParse({ type: "session-create-telemetry", event: {} }).success,
    ).toBe(false);
    expect(
      webRemoteControlAppPayloadSchema.safeParse({ zcode_type: "telemetry-report", event: {} })
        .success,
    ).toBe(false);
  });
  it("keeps local diagnostics and model task access independent from reporting", () => {
    expect(ServiceChannels).toHaveProperty("ZCodeAgent");
    expect(PlatformChannels).toHaveProperty("ExportLogs");
    expect(DesktopCommandIds).toHaveProperty("OpenResourceManager");
  });
});
