import { open, readdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve, join, sep } from "node:path";
import { runReleaseCommand as run } from "./apple-signing.mjs";

const MACHO_MAGICS = new Set([
  "feedface",
  "feedfacf",
  "cefaedfe",
  "cffaedfe",
  "cafebabe",
  "bebafeca",
  "cafebabf",
  "bfbafeca",
]);

async function collectMachO(root) {
  const binaries = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) binaries.push(...(await collectMachO(path)));
    else if (entry.isFile()) {
      const file = await open(path, "r");
      try {
        const { buffer, bytesRead } = await file.read(Buffer.alloc(4), 0, 4, 0);
        if (bytesRead === 4 && MACHO_MAGICS.has(buffer.toString("hex"))) binaries.push(path);
      } finally {
        await file.close();
      }
    }
  }
  return binaries;
}

export async function collectCommunityMacPresignPaths(appPath) {
  const resources = join(appPath, "Contents/Resources");
  const paths = await collectMachO(join(resources, "glm"));
  const tools = join(resources, "tools");
  try {
    await stat(tools);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return paths;
  }
  paths.push(...(await collectMachO(tools)));
  const driverApp = join(tools, "cua-driver/CuaDriver.app");
  try {
    await stat(driverApp);
    // tools 被默认签名遍历忽略；内部 Mach-O 全部签完后再封 Driver app，最后才封外层应用。
    paths.push(driverApp);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return paths;
}

export async function presignCommunityMacResources({ appPath, desktopRoot, config, signing }) {
  const childEntitlements = resolve(desktopRoot, config.mac.entitlementsInherit);
  const driverApp = join(appPath, "Contents/Resources/tools/cua-driver/CuaDriver.app");
  for (const binary of await collectCommunityMacPresignPaths(appPath)) {
    // Driver 的屏幕捕获与 Apple Events 权限不能被 Electron 通用子进程 entitlement 覆盖。
    const entitlements =
      binary === driverApp || binary.startsWith(`${driverApp}${sep}`)
        ? resolve(desktopRoot, "build/entitlements.cua-driver.plist")
        : childEntitlements;
    await run("/usr/bin/codesign", [
      "--force",
      "--sign",
      signing.identity,
      ...(signing.keychain ? ["--keychain", signing.keychain] : []),
      ...(signing.mode === "native"
        ? ["--options", "runtime", "--timestamp"]
        : ["--timestamp=none"]),
      "--entitlements",
      entitlements,
      binary,
    ]);
  }
}

export async function signCommunityMacApp({ appPath, desktopRoot, config, signing }) {
  await presignCommunityMacResources({ appPath, desktopRoot, config, signing });
  const require = createRequire(resolve(desktopRoot, "package.json"));
  const { signAsync } = require("@electron/osx-sign");
  const ignored = config.mac.signIgnore.map((pattern) => new RegExp(pattern));
  await signAsync({
    app: appPath,
    identity: signing.identity,
    keychain: signing.keychain,
    identityValidation: signing.mode === "native",
    platform: "darwin",
    type: "distribution",
    version: require("electron/package.json").version,
    strictVerify: true,
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
    ignore: (file) => ignored.some((pattern) => pattern.test(file)),
    optionsForFile: (file) => ({
      entitlements: resolve(
        desktopRoot,
        file === appPath ? config.mac.entitlements : config.mac.entitlementsInherit,
      ),
      hardenedRuntime: signing.mode === "native",
      timestamp: signing.mode === "native" ? undefined : "none",
    }),
  });
  await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath]);
}
