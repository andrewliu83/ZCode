import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  COMMUNITY_DISTRIBUTION,
  communityPublishOptions,
  validateCommunityRelease,
} from "../community-distribution.mjs";
import { resolveAppleSigningMode } from "../apple-signing.mjs";
import { verifyCommunityRelease } from "../verify-community-release.mjs";

const repository = "andrewliu83/ZCode";
test("Community release tags, version and repository are independently validated", () => {
  assert.equal(COMMUNITY_DISTRIBUTION.appId, "io.github.andrewliu83.zcode");
  assert.deepEqual(communityPublishOptions(), {
    provider: "github",
    owner: "andrewliu83",
    repo: "ZCode",
    tagNamePrefix: "community-v",
    channel: "latest",
    releaseType: "release",
  });
  assert.deepEqual(
    validateCommunityRelease({
      version: "0.1.0",
      tag: "community-v0.1.0",
      repository,
      publish: true,
    }),
    { version: "0.1.0", tag: "community-v0.1.0", prerelease: false },
  );
  for (const tag of ["v3.15.1", "v0.1.0", "community-v0.1.1"])
    assert.throws(() =>
      validateCommunityRelease({ version: "0.1.0", tag, repository, publish: true }),
    );
  assert.throws(() =>
    validateCommunityRelease({
      version: "0.1.0",
      tag: "community-v0.1.0",
      repository: "upstream/ZCode",
      publish: true,
    }),
  );
  assert.equal(
    validateCommunityRelease({ version: "0.2.0-beta.1", tag: "community-v0.2.0-beta.1" })
      .prerelease,
    true,
  );
});

test("release can prepare an app directory without creating unsigned installers", () => {
  const result = spawnSync(
    process.execPath,
    [
      "packages/desktop/scripts/bundle.mjs",
      "--os",
      "mac",
      "--arch",
      "arm64",
      "--app-only",
      "--dry-run",
    ],
    { cwd: new URL("../..", import.meta.url), encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--dir/);
});

test("Apple credentials are optional as a complete set, never silently downgraded", () => {
  assert.equal(resolveAppleSigningMode({}), "ad-hoc");
  assert.throws(() => resolveAppleSigningMode({ APPLE_ID: "fixture" }), /Incomplete/);
  assert.equal(
    resolveAppleSigningMode({
      MACOS_CERTIFICATE_P12_BASE64: "fixture",
      APPLE_SIGNING_IDENTITY: "Developer ID Application: Fixture (TEAM)",
      APPLE_ID: "fixture",
      APPLE_APP_SPECIFIC_PASSWORD: "fixture",
      APPLE_TEAM_ID: "TEAM",
    }),
    "native",
  );
});

test("final metadata must describe the signed artifact, not a previous ZIP", async () => {
  const directory = await mkdtemp(join(tmpdir(), "community-release-test-"));
  const zip = "zcode-community-0.1.0-mac-arm64.zip";
  const bytes = Buffer.from("fixture signed zip");
  const digest = createHash("sha512").update(bytes).digest("base64");
  try {
    await writeFile(join(directory, zip), bytes);
    await writeFile(join(directory, "zcode-community-0.1.0-mac-arm64.dmg"), "fixture");
    await writeFile(
      join(directory, "latest-mac.yml"),
      `version: 0.1.0\nfiles:\n  - url: ${zip}\n    sha512: ${digest}\n    size: ${bytes.length}\npath: ${zip}\nsha512: ${digest}\n`,
    );
    await verifyCommunityRelease({ directory, version: "0.1.0" });
    const appPath = join(directory, "fixture.app");
    await assert.rejects(
      verifyCommunityRelease({ directory, version: "0.1.0", appPath }),
      /app-update|ENOENT/,
    );
    await mkdir(join(appPath, "Contents/Resources"), { recursive: true });
    const runtime = join(appPath, "Contents/Resources/app-update.yml");
    await writeFile(
      runtime,
      JSON.stringify({ ...communityPublishOptions(), updaterCacheDirName: "upstream-updater" }),
    );
    await assert.rejects(
      verifyCommunityRelease({ directory, version: "0.1.0", appPath }),
      /configuration/,
    );
    await writeFile(
      runtime,
      JSON.stringify({
        ...communityPublishOptions(),
        updaterCacheDirName: "zcode-community-updater",
      }),
    );
    await verifyCommunityRelease({ directory, version: "0.1.0", appPath });
    assert.match(await readFile(join(directory, "SHA512SUMS.txt"), "utf8"), /zcode-community/);
    await assert.rejects(verifyCommunityRelease({ directory, version: "0.2.0" }), /version/);
    await writeFile(join(directory, zip), "changed after checksum");
    await assert.rejects(verifyCommunityRelease({ directory, version: "0.1.0" }), /checksum/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
