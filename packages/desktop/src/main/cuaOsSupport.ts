import { release } from "node:os";
import type { CuaOsSupport } from "@zcode/shared";

// 固定 Driver 0.36.0 的 app 与原生 SDK 都要求 macOS 13，低版本须在授权前明确提示。
export const CUA_MINIMUM_MACOS_VERSION = "13.0";
const CUA_MINIMUM_DARWIN_MAJOR = 22;

export function darwinMajorToMacosMajor(major: number): number {
  return major - 9;
}

export function resolveCuaOsSupport(
  platform = process.platform,
  darwinRelease = release(),
): CuaOsSupport {
  if (platform !== "darwin") return { kind: "not-applicable" };
  const major = Number.parseInt(darwinRelease.split(".")[0] ?? "0", 10);
  if (Number.isNaN(major)) return { kind: "supported" };
  if (major < CUA_MINIMUM_DARWIN_MAJOR) {
    return {
      kind: "macos-below-minimum",
      minimumMacOs: CUA_MINIMUM_MACOS_VERSION,
      currentMacOs: String(darwinMajorToMacosMajor(major)),
    };
  }
  return { kind: "supported" };
}
