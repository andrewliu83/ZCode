import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, mkdir, copyFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { COMMUNITY_DISTRIBUTION } from "./community-distribution.mjs";
import { COMMUNITY_RELEASE_TARGETS, communityArtifactName } from "./community-release-targets.mjs";

async function digest(path) {
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

/** 发布 owner 必须先收齐并验证所有平台，再产生可上传目录；不依赖构建 job 间的文件覆盖顺序。 */
export async function collectCommunityRelease({
  inputDirectory,
  outputDirectory,
  version,
  commit,
}) {
  const directories = await readdir(inputDirectory);
  const expected = COMMUNITY_RELEASE_TARGETS.map((target) => `community-${target.id}`);
  if (
    directories.length !== expected.length ||
    expected.some((name) => !directories.includes(name))
  )
    throw new Error("Missing or unexpected Community release platform");
  const builds = [];
  const files = new Map();
  for (const target of COMMUNITY_RELEASE_TARGETS) {
    const directory = resolve(inputDirectory, `community-${target.id}`);
    const build = JSON.parse(await readFile(resolve(directory, "release-build.json"), "utf8"));
    if (
      build.version !== version ||
      build.tag !== `${COMMUNITY_DISTRIBUTION.tagPrefix}${version}` ||
      build.product !== COMMUNITY_DISTRIBUTION.name ||
      build.target !== target.id ||
      build.os !== target.os ||
      build.arch !== target.arch
    )
      throw new Error(`Release build identity/version mismatch: ${target.id}`);
    if (
      typeof build.agentVersion !== "string" ||
      !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(build.agentVersion)
    )
      throw new Error(`Packaged Agent startup was not verified: ${target.id}`);
    commit ??= build.commit;
    if (!commit || build.commit !== commit) throw new Error("Release builds use different commits");
    if (!(target.os === "mac" ? ["native", "ad-hoc"] : ["unsigned"]).includes(build.signing))
      throw new Error("Unsupported release signing mode");
    const required = [
      target.manifest,
      ...target.extensions.map((ext) => communityArtifactName(target, version, ext)),
    ];
    const allowed = new Set([
      ...required,
      ...required.filter((name) => name !== target.manifest).map((name) => `${name}.blockmap`),
    ]);
    const sums = (await readFile(resolve(directory, "SHA512SUMS.txt"), "utf8")).trim().split("\n");
    const recorded = new Set();
    for (const line of sums) {
      const match = /^([a-f0-9]{128})  ([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(line);
      if (!match || !allowed.has(match[2])) throw new Error("Invalid release checksum entry");
      const [, sha512, name] = match;
      if (recorded.has(name) || files.has(name))
        throw new Error(`Duplicate release asset: ${name}`);
      const path = resolve(directory, name);
      if ((await digest(path)) !== sha512) throw new Error(`Release checksum mismatch: ${name}`);
      recorded.add(name);
      files.set(name, { path, sha512 });
    }
    if (required.some((name) => !recorded.has(name)))
      throw new Error(`Missing release asset: ${target.id}`);
    const actual = await readdir(directory);
    if (
      actual.some(
        (name) => !recorded.has(name) && !["release-build.json", "SHA512SUMS.txt"].includes(name),
      )
    )
      throw new Error("Unexpected release artifact");
    builds.push(build);
  }
  // 目录必须新建；重跑不能把残留旧版本或只完成一半的资产混入发布。
  await mkdir(outputDirectory);
  for (const [name, file] of files) await copyFile(file.path, resolve(outputDirectory, name));
  await writeFile(
    resolve(outputDirectory, "SHA512SUMS.txt"),
    [...files]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, file]) => `${file.sha512}  ${name}`)
      .join("\n") + "\n",
  );
  await writeFile(
    resolve(outputDirectory, "community-builds.json"),
    JSON.stringify({ version, commit, builds }, null, 2) + "\n",
  );
  const mac = builds.find((build) => build.os === "mac");
  const notes = `${COMMUNITY_DISTRIBUTION.name} ${version}\n\nIndependent Community distribution; does not replace upstream ZCode.\n\n- macOS arm64: DMG and ZIP. ${mac.signing === "native" ? "Developer ID signed and Apple notarized." : "Ad hoc signed, not Apple notarized; first installation may require Open Anyway in Privacy & Security."}\n- Windows x64: NSIS installer (unsigned).\n- Linux x64: AppImage, DEB and RPM.\n\nThe first Community version must be installed manually. Later releases use the Community update source. DEB/RPM installation may require system authorization.\n`;
  await writeFile(resolve(outputDirectory, "release-notes.md"), notes);
  return builds;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({
    options: {
      input: { type: "string", default: "release-input" },
      output: { type: "string", default: "release-assets" },
    },
  });
  const { version } = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  await collectCommunityRelease({
    inputDirectory: resolve(values.input),
    outputDirectory: resolve(values.output),
    version,
    commit: process.env.GITHUB_SHA,
  });
  console.log("All Community platform assets and checksums verified");
}
