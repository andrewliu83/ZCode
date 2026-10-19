import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

export const DRIVER_ENV = Object.freeze({
  CUA_DRIVER_RS_TELEMETRY_ENABLED: "false",
  CUA_TELEMETRY_ENABLED: "false",
  CUA_DRIVER_RS_UPDATE_CHECK: "false",
  DO_NOT_TRACK: "1",
  CUA_TELEMETRY: "0",
});

export async function loadDriverSdk(env = process.env) {
  // 原生库在加载时读取配置，须在动态导入前关闭独立遥测与更新。
  Object.assign(process.env, DRIVER_ENV);
  const sdkPath =
    env.ZCODE_CUA_DRIVER_SDK_PATH?.trim() ||
    (process.resourcesPath
      ? join(process.resourcesPath, "tools", "cua-driver", "node_modules", "@trycua", "cua-driver")
      : undefined);
  if (sdkPath && !isAbsolute(sdkPath)) throw new Error("Cua Driver SDK path must be absolute.");
  return sdkPath
    ? await import(pathToFileURL(join(sdkPath, "dist", "index.js")).href)
    : await import("@trycua/cua-driver");
}

export function parseDriverResult(result) {
  if (!result || typeof result !== "object")
    throw new Error("Cua Driver returned an invalid result.");
  let parsed;
  for (const source of [result.rawJson, result.text, result.structuredJson]) {
    if (typeof source !== "string" || !source.trim()) continue;
    try {
      const value = JSON.parse(source);
      if (!value || typeof value !== "object") continue;
      const body =
        value.structuredContent && typeof value.structuredContent === "object"
          ? value.structuredContent
          : value;
      parsed =
        !Array.isArray(body) && parsed && !Array.isArray(parsed) ? { ...parsed, ...body } : body;
    } catch {
      // 文本树不是 JSON；保留后续原始结构候选。
    }
  }
  return parsed;
}
