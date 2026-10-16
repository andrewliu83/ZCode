import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { COMMUNITY_DISTRIBUTION, communityUpdateConfiguration } from "./community-distribution.mjs";
import {
  communityArtifactName,
  communityReleaseArguments,
  resolveCommunityReleaseTarget,
} from "./community-release-targets.mjs";

const require = createRequire(new URL("../packages/desktop/package.json", import.meta.url));
const { parse, stringify } = require("yaml");

async function sha512(path) {
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("base64");
}

/** 多次 Linux 封装会分别生成清单；先校验同版本，再汇总到唯一平台清单。 */
export function mergeCommunityUpdateManifests(documents, version) {
  if (!documents.length) throw new Error("No platform update manifests");
  const parts = documents.map((document) => parse(document));
  const files = [];
  const names = new Set();
  for (const part of parts) {
    if (part.version !== version || !Array.isArray(part.files) || !part.files.length)
      throw new Error("Platform update manifest version/files mismatch");
    for (const file of part.files) {
      if (names.has(file.url)) throw new Error("Duplicate platform update asset");
      names.add(file.url);
      files.push(file);
    }
  }
  return stringify({ ...parts[0], files, path: files[0].url, sha512: files[0].sha512 });
}

export async function verifyCommunityRelease({ directory, version, appPath, os = "mac", arch }) {
  const target = resolveCommunityReleaseTarget(os, arch);
  if (appPath) {
    const runtime = parse(
      await readFile(resolve(appPath, target.resources, "app-update.yml"), "utf8"),
    );
    const expected = communityUpdateConfiguration();
    if (
      Object.keys(runtime).length !== Object.keys(expected).length ||
      Object.entries(expected).some(([key, value]) => runtime[key] !== value)
    )
      throw new Error("Packaged update configuration mismatch");
  }
  const entries = await readdir(directory);
  const metadata = parse(await readFile(resolve(directory, target.manifest), "utf8"));
  if (metadata.version !== version || !Array.isArray(metadata.files) || !metadata.files.length)
    throw new Error("Release metadata version/files mismatch");
  const assets = new Set();
  for (const file of metadata.files) {
    const name = decodeURIComponent(file.url);
    if (
      name !== basename(name) ||
      name.includes("\\") ||
      /\s/.test(name) ||
      !target.extensions.some((ext) => name === communityArtifactName(target, version, ext))
    )
      throw new Error("Release asset name/platform mismatch");
    const path = resolve(directory, name);
    if (assets.has(name)) throw new Error("Duplicate release asset");
    if (
      (await sha512(path)) !== file.sha512 ||
      (file.size !== undefined && (await stat(path)).size !== file.size)
    )
      throw new Error(`Release checksum/size mismatch: ${name}`);
    assets.add(name);
  }
  for (const extension of target.extensions) {
    const name = communityArtifactName(target, version, extension);
    if (!(await stat(resolve(directory, name))).isFile())
      throw new Error(`Missing release asset: ${name}`);
    // DMG 供手动安装；其余格式必须也出现在客户端使用的清单中。
    if (extension !== ".dmg" && !assets.has(name))
      throw new Error(`Missing update format: ${extension}`);
    assets.add(name);
  }
  if (
    metadata.path &&
    (!metadata.files.some((file) => file.url === metadata.path) ||
      (await sha512(resolve(directory, metadata.path))) !== metadata.sha512)
  )
    throw new Error("Legacy release checksum mismatch");
  assets.add(target.manifest);
  for (const name of entries) {
    if (
      name.endsWith(".blockmap") &&
      target.extensions.some(
        (ext) => name === `${communityArtifactName(target, version, ext)}.blockmap`,
      )
    )
      assets.add(name);
  }
  const checksums = [];
  for (const name of [...assets].sort())
    checksums.push(
      `${Buffer.from(await sha512(resolve(directory, name)), "base64").toString("hex")}  ${name}`,
    );
  await writeFile(resolve(directory, "SHA512SUMS.txt"), checksums.join("\n") + "\n");
  return metadata;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const options = communityReleaseArguments();
  const target = resolveCommunityReleaseTarget(
    options.os ?? process.env.ZCODE_TARGET_OS,
    options.arch ?? process.env.ZCODE_TARGET_ARCH,
  );
  const version = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ).version;
  const directory = resolve(options.directory ?? `packages/desktop/dist/community/${target.id}`);
  const unpacked = resolve(directory, target.unpacked);
  await verifyCommunityRelease({
    directory,
    version,
    os: target.os,
    arch: target.arch,
    appPath:
      target.os === "mac" ? resolve(unpacked, `${COMMUNITY_DISTRIBUTION.name}.app`) : unpacked,
  });
  console.log("Community Release metadata and final artifact checksums verified");
}
