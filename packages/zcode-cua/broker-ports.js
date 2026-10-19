const permissionStates = new Set(["granted", "stale", "denied", "unknown"]);

export function isCuaPermissionStatusAvailable(result) {
  // Service 的有效权限结果可省略 available；必须同时校验主体与权限，避免残缺结果被视为可用。
  return (
    result !== null &&
    typeof result === "object" &&
    !Array.isArray(result) &&
    (result.available === undefined || result.available === true) &&
    (result.grantOwner === null || typeof result.grantOwner === "string") &&
    permissionStates.has(result.accessibility) &&
    permissionStates.has(result.screenRecording)
  );
}

export function shouldRunCuaScreenCaptureProbe(state, options) {
  // 普通权限查询保持只读；仅已授权且调用方显式请求时才执行真实截图探针。
  return state === "granted" && options?.includeFunctionalProbes === true;
}
