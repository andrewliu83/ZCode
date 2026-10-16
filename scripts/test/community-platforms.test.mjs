import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  COMMUNITY_RELEASE_TARGETS,
  resolveCommunityReleaseTarget,
  assertCommunityReleaseHost,
} from "../community-release-targets.mjs";
import {
  verifyCommunityRelease,
  mergeCommunityUpdateManifests,
} from "../verify-community-release.mjs";
import { collectCommunityRelease } from "../collect-community-release.mjs";

const version = "0.1.0";
const commit = "fixture-commit";
const artifactName = (target, extension) =>
  `zcode-community-${version}-${target.os}-${target.arch}${extension}`;

async function fixture(directory, target) {
  await mkdir(directory, { recursive: true });
  const files = [];
  for (const extension of target.extensions) {
    const name = artifactName(target, extension);
    const bytes = Buffer.from(`${target.id}: ${extension}`);
    await writeFile(join(directory, name), bytes);
    files.push({
      url: name,
      sha512: createHash("sha512").update(bytes).digest("base64"),
      size: bytes.length,
    });
  }
  await writeFile(
    join(directory, target.manifest),
    JSON.stringify({ version, files, path: files[0].url, sha512: files[0].sha512 }),
  );
  await verifyCommunityRelease({ directory, version, os: target.os, arch: target.arch });
  await writeFile(
    join(directory, "release-build.json"),
    JSON.stringify({
      version,
      agentVersion: version,
      tag: `community-v${version}`,
      product: "ZCode Community",
      commit,
      target: target.id,
      os: target.os,
      arch: target.arch,
      signing: target.os === "mac" ? "ad-hoc" : "unsigned",
    }),
  );
}

async function withFixtures(run) {
  const root = await mkdtemp(join(tmpdir(), "community-platforms-"));
  try {
    const inputDirectory = join(root, "input");
    const outputDirectory = join(root, "output");
    for (const target of COMMUNITY_RELEASE_TARGETS)
      await fixture(join(inputDirectory, `community-${target.id}`), target);
    await run({ root, inputDirectory, outputDirectory });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("each release target has one native runner, platform feed and supported architecture", () => {
  assert.deepEqual(
    COMMUNITY_RELEASE_TARGETS.map((t) => [t.os, t.arch, t.manifest]),
    [
      ["mac", "arm64", "latest-mac.yml"],
      ["win", "x64", "latest.yml"],
      ["linux", "x64", "latest-linux.yml"],
    ],
  );
  assert.equal(resolveCommunityReleaseTarget("win").runner, "windows-2022");
  assert.equal(resolveCommunityReleaseTarget("linux").runner, "ubuntu-22.04");
  assert.throws(() => resolveCommunityReleaseTarget("win", "arm64"), /Unsupported/);
  assert.throws(
    () => assertCommunityReleaseHost(resolveCommunityReleaseTarget("win"), "darwin", "arm64"),
    /native/,
  );
  for (const target of COMMUNITY_RELEASE_TARGETS)
    assertCommunityReleaseHost(target, target.platform, target.arch);
});

test("Windows and Linux release plans can be inspected without spawning native tools", () => {
  for (const os of ["win", "linux"]) {
    const result = spawnSync(
      process.execPath,
      ["scripts/release-desktop.mjs", "--os", os, "--arch", "x64", "--plan"],
      { encoding: "utf8", cwd: new URL("../..", import.meta.url) },
    );
    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.target.os, os);
    assert.equal(plan.target.arch, "x64");
    assert.equal(plan.signing, "unsigned");
    assert.equal(plan.autoUpdate, "1");
  }
});

test("serialized Linux formats merge without losing AppImage, DEB or RPM entries", () => {
  const parts = ["AppImage", "deb", "rpm"].map((extension) =>
    JSON.stringify({ version, files: [{ url: `fixture.${extension}`, sha512: extension }] }),
  );
  const merged = mergeCommunityUpdateManifests(parts, version);
  for (const extension of ["AppImage", "deb", "rpm"])
    assert.match(merged, new RegExp(`fixture\\.${extension}`));
  assert.throws(() => mergeCommunityUpdateManifests([...parts, parts[0]], version), /Duplicate/);
  assert.throws(() => mergeCommunityUpdateManifests(parts, "0.2.0"), /version/);
});

test("platform verification requires every installer format and catches damaged packages", async () => {
  await withFixtures(async ({ inputDirectory }) => {
    const target = resolveCommunityReleaseTarget("linux");
    const directory = join(inputDirectory, `community-${target.id}`);
    await rm(join(directory, artifactName(target, ".rpm")));
    await assert.rejects(verifyCommunityRelease({ directory, version, os: "linux", arch: "x64" }));
    await fixture(directory, target);
    await writeFile(join(directory, artifactName(target, ".AppImage")), "tampered");
    await assert.rejects(
      verifyCommunityRelease({ directory, version, os: "linux", arch: "x64" }),
      /checksum/,
    );
  });
});

test("release collection keeps all OS feeds and aggregates checksums without filename collisions", async () => {
  await withFixtures(async ({ inputDirectory, outputDirectory }) => {
    const builds = await collectCommunityRelease({
      inputDirectory,
      outputDirectory,
      version,
      commit,
    });
    assert.equal(builds.length, 3);
    const names = await readdir(outputDirectory);
    for (const target of COMMUNITY_RELEASE_TARGETS) {
      assert(names.includes(target.manifest));
      for (const extension of target.extensions)
        assert(names.includes(artifactName(target, extension)));
    }
    const checksums = await readFile(join(outputDirectory, "SHA512SUMS.txt"), "utf8");
    for (const line of checksums.trim().split("\n")) {
      const [digest, name] = line.split("  ");
      assert.equal(
        createHash("sha512")
          .update(await readFile(join(outputDirectory, name)))
          .digest("hex"),
        digest,
      );
    }
    assert.match(await readFile(join(outputDirectory, "release-notes.md"), "utf8"), /Windows/);
  });
});

for (const failure of [
  "missing-platform",
  "wrong-commit",
  "wrong-version",
  "unverified-agent",
  "tampered",
  "duplicate-name",
]) {
  test(`release collection fails before publication: ${failure}`, async () => {
    await withFixtures(async ({ inputDirectory, outputDirectory }) => {
      const win = join(inputDirectory, "community-windows-x64");
      if (failure === "missing-platform") await rm(win, { recursive: true });
      if (failure === "wrong-commit") {
        const path = join(win, "release-build.json");
        await writeFile(
          path,
          JSON.stringify({ ...JSON.parse(await readFile(path, "utf8")), commit: "other" }),
        );
      }
      if (failure === "wrong-version" || failure === "unverified-agent") {
        const path = join(win, "release-build.json");
        const build = JSON.parse(await readFile(path, "utf8"));
        await writeFile(
          path,
          JSON.stringify({
            ...build,
            ...(failure === "wrong-version" ? { version: "0.2.0" } : { agentVersion: "" }),
          }),
        );
      }
      if (failure === "tampered") await writeFile(join(win, "latest.yml"), "modified manifest");
      if (failure === "duplicate-name") {
        const directory = join(inputDirectory, "community-linux-x64");
        const name = "latest.yml";
        const bytes = Buffer.from("duplicate");
        await writeFile(join(directory, name), bytes);
        const sums = await readFile(join(directory, "SHA512SUMS.txt"), "utf8");
        await writeFile(
          join(directory, "SHA512SUMS.txt"),
          sums + `${createHash("sha512").update(bytes).digest("hex")}  ${name}\n`,
        );
      }
      await assert.rejects(
        collectCommunityRelease({ inputDirectory, outputDirectory, version, commit }),
      );
    });
  });
}
