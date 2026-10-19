import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, realpath } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { CuaHelperError } from "./broker.js";
import { DRIVER_ENV } from "./driver-sdk.js";

const run = promisify(execFile);
export const DRIVER_BUNDLE_ID = "com.trycua.driver";
const isWindows = () => process.platform === "win32";

/** macOS 用独立 .app（TCC 主体）；Windows/Linux 直接运行随包二进制。 */
export async function driverAppIdentity(appPath) {
  const canonical = await realpath(appPath);
  if (process.platform === "darwin") {
    const { stdout } = await run("/usr/bin/plutil", [
      "-convert",
      "json",
      "-o",
      "-",
      join(canonical, "Contents", "Info.plist"),
    ]);
    const info = JSON.parse(stdout);
    if (info.CFBundleIdentifier !== DRIVER_BUNDLE_ID || info.CFBundleExecutable !== "cua-driver") {
      throw new CuaHelperError("Bundled Cua Driver app identity does not match.");
    }
    return {
      appPath: canonical,
      executablePath: join(canonical, "Contents", "MacOS", info.CFBundleExecutable),
      bundleId: info.CFBundleIdentifier,
      displayName: info.CFBundleDisplayName || info.CFBundleName || "CuaDriver",
    };
  }
  const executablePath =
    canonical.endsWith(".exe") || canonical.includes("cua-driver")
      ? canonical
      : join(canonical, isWindows() ? "cua-driver.exe" : "cua-driver");
  await chmod(executablePath, 0o755).catch(() => {});
  return {
    appPath: canonical,
    executablePath,
    bundleId: DRIVER_BUNDLE_ID,
    displayName: "Cua Driver",
  };
}

export function nativeSocketPath(directory) {
  return isWindows()
    ? `\\\\.\\pipe\\zcode-cua-${randomUUID()}`
    : join(directory, `${randomUUID().slice(0, 8)}.sock`);
}

export function buildDriverLaunchSpec(spec) {
  const args = [
    "serve",
    "--socket",
    spec.socketPath,
    "--permission-mode",
    "standard",
    "--no-permissions-gate",
  ];
  if (spec.pidFile) args.push("--pid-file", spec.pidFile);
  return args;
}

export function buildHelperOpenArgs(spec) {
  if (typeof spec.appPath !== "string" || typeof spec.socketPath !== "string") {
    throw new CuaHelperError("Cua Driver app and socket paths are required.");
  }
  const openArgs = ["-n", "-g"];
  for (const [key, value] of Object.entries(DRIVER_ENV)) openArgs.push("--env", `${key}=${value}`);
  openArgs.push(spec.appPath, "--args", ...buildDriverLaunchSpec(spec));
  return openArgs;
}

/** macOS 经 LaunchServices 启动独立 app；Windows/Linux 直接执行随包二进制。 */
export function buildDriverLaunch(spec) {
  if (process.platform === "darwin") {
    // LaunchServices 需要 .app 包路径；可执行文件路径只用于进程归属校验。
    return { command: "/usr/bin/open", args: buildHelperOpenArgs(spec) };
  }
  return {
    command: spec.executablePath ?? spec.appPath,
    args: buildDriverLaunchSpec(spec),
  };
}

export async function commandLineFor(pid, exec) {
  if (isWindows()) {
    const { stdout } = await exec(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}").CommandLine`,
      ],
      { timeout: 5000, windowsHide: true },
    ).catch(() => ({ stdout: "" }));
    return stdout.trim();
  }
  const { stdout } = await exec("/bin/ps", ["-ww", "-p", String(pid), "-o", "command="], {
    timeout: 5000,
  }).catch(() => ({ stdout: "" }));
  return stdout.trim();
}
