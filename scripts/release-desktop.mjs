#!/usr/bin/env node
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { COMMUNITY_DISTRIBUTION, communityUpdateConfiguration } from "./community-distribution.mjs";
import {
  communityReleaseArguments,
  resolveCommunityReleaseTarget,
  assertCommunityReleaseHost,
} from "./community-release-targets.mjs";
import {
  createAppleSigningContext,
  resolveAppleSigningMode,
  runReleaseCommand as run,
} from "./apple-signing.mjs";
import { signCommunityMacApp } from "./sign-community-macos.mjs";
import { smokeCommunityAgent } from "./smoke-community-agent.mjs";
import {
  createElectronBuilderBinariesMirrorEnv,
  createElectronRuntimeMirrorEnv,
  OFFICIAL_ELECTRON_BUILDER_BINARIES_MIRROR,
} from "../packages/desktop/scripts/bundle.mjs";
import {
  mergeCommunityUpdateManifests,
  verifyCommunityRelease,
} from "./verify-community-release.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const desktopRoot = resolve(repoRoot, "packages/desktop");
const options = communityReleaseArguments();
const target = resolveCommunityReleaseTarget(
  options.os ?? process.env.ZCODE_TARGET_OS,
  options.arch ?? process.env.ZCODE_TARGET_ARCH,
);
const signingMode = target.os === "mac" ? resolveAppleSigningMode(process.env) : "unsigned";
// Electron 的全局镜像变量会覆盖 DMG 工具下载源，两次封装必须共用隔离后的环境。
const downloads = {
  ...createElectronRuntimeMirrorEnv("https://github.com/electron/electron/releases/download/"),
  ...createElectronBuilderBinariesMirrorEnv(OFFICIAL_ELECTRON_BUILDER_BINARIES_MIRROR),
};
const env = {
  ...process.env,
  NODE_ENV: "production",
  ZCODE_ENV: "production",
  ZCODE_PREVIEW_IDENTITY: "0",
  ZCODE_SKIP_REMOTE_ASSETS: "1",
  ZCODE_TARGET_OS: target.os,
  ZCODE_TARGET_ARCH: target.arch,
  ZCODE_DESKTOP_DIST_DIR: process.env.ZCODE_DESKTOP_DIST_DIR ?? `dist/community/${target.id}`,
  ZCODE_AUTO_UPDATE: process.env.ZCODE_AUTO_UPDATE ?? "1",
  ZCODE_MAC_UPDATE_MODE: signingMode === "native" ? "native" : "ad-hoc",
  ZCODE_ENABLE_MAC_SIGN: "0",
  ZCODE_ENABLE_WINDOWS_SIGN: "0",
  CSC_IDENTITY_AUTO_DISCOVERY: "false",
  // Windows Community 暂交付无 Authenticode 包，不继承企业签名服务或发行机证书。
  ...(target.os === "win" ? { CSC_LINK: "", WIN_CSC_LINK: "" } : {}),
  VITE_ZCODE_E2E_STORE_BRIDGE: "0",
  ZCODE_E2E_KEEP_BUILD_CACHE: "0",
  npm_config_registry: "https://registry.npmjs.org",
  ...downloads,
};
const directory = resolve(desktopRoot, env.ZCODE_DESKTOP_DIST_DIR);
const withinDist = relative(resolve(desktopRoot, "dist"), directory);
// Windows 路径分隔符不是 /；统一按 relative 判断，不能误拒正常盘符或误删 dist 本身。
if (
  !withinDist ||
  withinDist === ".." ||
  withinDist.startsWith(`..${sep}`) ||
  isAbsolute(withinDist)
)
  throw new Error("Release output must be inside desktop/dist");
if (options.plan) {
  console.log(
    JSON.stringify(
      {
        product: COMMUNITY_DISTRIBUTION,
        target,
        signing: signingMode,
        directory,
        autoUpdate: env.ZCODE_AUTO_UPDATE,
        downloads,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
assertCommunityReleaseHost(target);
const { version } = JSON.parse(await readFile(resolve(repoRoot, "package.json"), "utf8"));
Object.assign(process.env, env);
const signing = target.os === "mac" ? await createAppleSigningContext(env) : undefined;
try {
  await rm(directory, { recursive: true, force: true });
  await run("pnpm", ["--filter", "@zcode/desktop", "prepare:build-meta"], { cwd: repoRoot, env });
  if (!options["skip-build"]) {
    await run("pnpm", ["--filter", "@zcode/desktop", "prepare:runtime-assets"], {
      cwd: repoRoot,
      env,
    });
    await run("pnpm", ["--filter", "@zcode/desktop", "build:no-runtime-assets"], {
      cwd: repoRoot,
      env,
    });
  }
  await run(
    "pnpm",
    [
      "bundle:desktop",
      "--",
      "--os",
      target.os,
      "--arch",
      target.arch,
      "--skip-prepare",
      "--skip-build",
      "--app-only",
    ],
    { cwd: repoRoot, env },
  );
  const { default: config } = await import(
    pathToFileURL(resolve(desktopRoot, "electron-builder.config.js")).href
  );
  const unpacked = resolve(directory, target.unpacked);
  const appPath = target.os === "mac" ? resolve(unpacked, `${config.productName}.app`) : unpacked;
  const runtimeConfig = resolve(appPath, target.resources, "app-update.yml");
  // --dir 不生成 app-update.yml；必须在签名或封装前写入正确的独立更新源与缓存名。
  await writeFile(runtimeConfig, JSON.stringify(communityUpdateConfiguration(), null, 2) + "\n");
  if (signing) {
    console.log(`[release] Signing ${config.productName} ${version} (${signing.mode})`);
    await signCommunityMacApp({ appPath, desktopRoot, config, signing });
    if (signing.mode === "native") {
      const notaryZip = resolve(directory, "notary-submission.zip");
      await run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", appPath, notaryZip]);
      await run("xcrun", [
        "notarytool",
        "submit",
        notaryZip,
        "--apple-id",
        env.APPLE_ID,
        "--password",
        env.APPLE_APP_SPECIFIC_PASSWORD,
        "--team-id",
        env.APPLE_TEAM_ID,
        "--wait",
        "--timeout",
        "20m",
      ]);
      await run("xcrun", ["stapler", "staple", appPath]);
      await run("spctl", ["--assess", "--type", "execute", "--verbose", appPath]);
      await rm(notaryZip);
    }
  }
  const agentVersion = await smokeCommunityAgent({
    appPath,
    productName: config.productName,
    os: target.os,
    env,
  });
  console.log(`[release] Packaged Agent startup verified (${agentVersion})`);
  for (const name of await readdir(directory)) {
    if (/\.(?:dmg|zip|exe|AppImage|deb|rpm|blockmap|yml)$/.test(name))
      await rm(resolve(directory, name));
  }
  const manifests = [];
  // FPM 会改写共享 resources/package-type；串行且 AppImage 优先，避免格式污染或清单覆盖。
  const groups =
    target.os === "linux" ? target.targets.map((format) => [format]) : [target.targets];
  for (const formats of groups) {
    if (target.os === "linux")
      await rm(resolve(appPath, target.resources, "package-type"), { force: true });
    await run(
      "pnpm",
      [
        "--filter",
        "@zcode/desktop",
        "exec",
        "electron-builder",
        "--config",
        "electron-builder.config.js",
        `--${target.os}`,
        ...formats,
        `--${target.arch}`,
        "--prepackaged",
        appPath,
        "--publish",
        "never",
      ],
      { cwd: repoRoot, env },
    );
    manifests.push(await readFile(resolve(directory, target.manifest), "utf8"));
  }
  if (manifests.length > 1)
    await writeFile(
      resolve(directory, target.manifest),
      mergeCommunityUpdateManifests(manifests, version),
    );
  await verifyCommunityRelease({ directory, version, appPath, os: target.os, arch: target.arch });
  if (signing) await run("codesign", ["--verify", "--deep", "--strict", appPath]);
  await writeFile(
    resolve(directory, "release-build.json"),
    JSON.stringify(
      {
        version,
        agentVersion,
        product: config.productName,
        signing: signingMode,
        target: target.id,
        os: target.os,
        arch: target.arch,
        commit: process.env.GITHUB_SHA ?? "local",
        tag: `${COMMUNITY_DISTRIBUTION.tagPrefix}${version}`,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`[release] Ready: ${directory}`);
} finally {
  await signing?.close();
}
