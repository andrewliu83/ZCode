import { parseArgs } from "node:util";
import { COMMUNITY_DISTRIBUTION } from "./community-distribution.mjs";

/** 每个 OS 首期一个架构，避免多个 runner 同时发布同名更新清单。 */
export const COMMUNITY_RELEASE_TARGETS = Object.freeze(
  [
    {
      id: "macos-arm64",
      os: "mac",
      platform: "darwin",
      arch: "arm64",
      runner: "macos-15",
      unpacked: "mac-arm64",
      resources: "Contents/Resources",
      manifest: "latest-mac.yml",
      extensions: [".dmg", ".zip"],
      targets: ["dmg", "zip"],
    },
    {
      id: "windows-x64",
      os: "win",
      platform: "win32",
      arch: "x64",
      runner: "windows-2022",
      unpacked: "win-unpacked",
      resources: "resources",
      manifest: "latest.yml",
      extensions: [".exe"],
      targets: ["nsis"],
    },
    {
      id: "linux-x64",
      os: "linux",
      platform: "linux",
      arch: "x64",
      runner: "ubuntu-22.04",
      unpacked: "linux-unpacked",
      resources: "resources",
      manifest: "latest-linux.yml",
      extensions: [".AppImage", ".deb", ".rpm"],
      targets: ["AppImage", "deb", "rpm"],
    },
  ].map((target) =>
    Object.freeze({
      ...target,
      extensions: Object.freeze(target.extensions),
      targets: Object.freeze(target.targets),
    }),
  ),
);

export function resolveCommunityReleaseTarget(os = process.platform, arch) {
  const normalized = { darwin: "mac", win32: "win", windows: "win" }[os] ?? os;
  const target = COMMUNITY_RELEASE_TARGETS.find(
    (t) => t.os === normalized && (!arch || t.arch === arch),
  );
  if (!target) throw new Error(`Unsupported Community release target: ${os}/${arch ?? "default"}`);
  return target;
}

export function assertCommunityReleaseHost(
  target,
  platform = process.platform,
  arch = process.arch,
) {
  if (platform !== target.platform || arch !== target.arch)
    throw new Error(
      `Community release requires native ${target.platform}/${target.arch}; current ${platform}/${arch}`,
    );
}

export function communityReleaseArguments(args = process.argv.slice(2)) {
  // pnpm run 的显式 -- 分隔符不是发行脚本的位置参数。
  return parseArgs({
    args: args.filter((arg) => arg !== "--"),
    options: {
      os: { type: "string" },
      arch: { type: "string" },
      plan: { type: "boolean" },
      "skip-build": { type: "boolean" },
      directory: { type: "string" },
    },
  }).values;
}

export function communityArtifactName(target, version, extension) {
  return `${COMMUNITY_DISTRIBUTION.executableName}-${version}-${target.os}-${target.arch}${extension}`;
}
