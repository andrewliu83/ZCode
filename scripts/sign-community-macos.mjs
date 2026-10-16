import { open, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve, join } from "node:path";
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

export async function signCommunityMacApp({ appPath, desktopRoot, config, signing }) {
  const childEntitlements = resolve(desktopRoot, config.mac.entitlementsInherit);
  // glm 在原有 signIgnore 中：必须先给 SDK、Node 和其它 Mach-O 独立签名，再封整个 app。
  for (const binary of await collectMachO(join(appPath, "Contents/Resources/glm"))) {
    await run("/usr/bin/codesign", [
      "--force",
      "--sign",
      signing.identity,
      ...(signing.keychain ? ["--keychain", signing.keychain] : []),
      ...(signing.mode === "native"
        ? ["--options", "runtime", "--timestamp"]
        : ["--timestamp=none"]),
      "--entitlements",
      childEntitlements,
      binary,
    ]);
  }
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
