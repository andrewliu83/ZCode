export const CUA_REQUEST_ACCESS_STATUS_META_KEY = "zcode.cua/request-access-status-v1";

export const cuaRequestAccessStatusSchema = {
  safeParse(input) {
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      input.schemaVersion !== 1 ||
      input.platform !== "darwin" ||
      typeof input.grantOwner !== "string" ||
      !input.grantOwner.trim() ||
      !["granted", "stale", "denied"].includes(input.accessibility) ||
      !["unknown", "granted", "denied"].includes(input.screenRecording)
    ) {
      return { success: false, error: new Error("Invalid Computer Use permission status.") };
    }
    return {
      success: true,
      data: {
        schemaVersion: 1,
        platform: "darwin",
        grantOwner: input.grantOwner,
        accessibility: input.accessibility,
        screenRecording: input.screenRecording,
      },
    };
  },
};
