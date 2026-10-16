import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { copyGenUiRuntimeAssets } from "./gen-ui-runtime-assets.mjs";

const execFile = promisify(execFileCallback);

it("preserves pinned resource bytes when Git checks out with Windows line endings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gen-ui-checkout-"));
  const assets = "apps/zcode-cli/packages/visualize-plugin/skills/visualize/assets";
  const tweak = "packages/desktop/src/renderer/src/plugin-sandbox/genUiTweakRuntime.js";
  const root = new URL("../../../", import.meta.url);
  const manifest = JSON.parse(
    await readFile(new URL(`${assets}/vendor/manifest.json`, root), "utf8"),
  );
  const runtime = JSON.parse(
    await readFile(new URL(`${assets}/runtime-manifest.json`, root), "utf8"),
  );
  const expected = new Map<string, string>();
  for (const resource of manifest.resources) {
    expected.set(`${assets}/vendor/${resource.file}`, resource.sha256);
    expected.set(`${assets}/vendor/${resource.licenseFile}`, resource.licenseSha256);
  }
  for (const [file, entry] of Object.entries(runtime.files)) {
    expected.set(
      file === "tweak.js" ? tweak : `${assets}/${file}`,
      (entry as { sha256: string }).sha256,
    );
  }
  const git = (...args: string[]) =>
    execFile("git", ["-C", directory, ...args], {
      encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_COUNT: "0" },
    });
  try {
    await cp(new URL(".gitattributes", root), join(directory, ".gitattributes"));
    for (const path of expected.keys()) {
      await mkdir(join(directory, path, ".."), { recursive: true });
      await cp(new URL(path, root), join(directory, path));
    }
    await writeFile(join(directory, "ordinary.txt"), "line one\nline two\n");
    await git("init", "--quiet");
    await git("config", "core.autocrlf", "false");
    await git("add", "--", ".");
    await git("config", "core.autocrlf", "true");
    await Promise.all(
      [...expected.keys(), "ordinary.txt"].map((path) => rm(join(directory, path))),
    );
    await git("checkout-index", "--all", "--force");
    expect(await readFile(join(directory, "ordinary.txt"), "utf8")).toBe(
      "line one\r\nline two\r\n",
    );
    for (const [path, hash] of expected) {
      expect(
        createHash("sha256")
          .update(await readFile(join(directory, path)))
          .digest("hex"),
        path,
      ).toBe(hash);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("packages the same pinned runtime assets used by standalone export", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gen-ui-assets-"));
  const source = new URL(
    "../../../apps/zcode-cli/packages/visualize-plugin/skills/visualize/assets/",
    import.meta.url,
  );
  const manifest = JSON.parse(await readFile(new URL("runtime-manifest.json", source), "utf8"));
  try {
    // 清单只承载当前资源的完整性数据，避免把无关的构建元数据带入分发包。
    expect(Object.keys(manifest)).toEqual(["files"]);
    expect(Object.keys(manifest.files).sort()).toEqual([
      "calendar.js",
      "tweak.js",
      "visualize.css",
      "visualize.html",
    ]);
    for (const entry of Object.values(manifest.files)) {
      expect(Object.keys(entry as object)).toEqual(["sha256"]);
    }
    await copyGenUiRuntimeAssets(directory);
    const vendors = JSON.parse(await readFile(join(directory, "vendor/manifest.json"), "utf8"));
    for (const resource of vendors.resources) {
      for (const [file, hash] of [
        [resource.file, resource.sha256],
        [resource.licenseFile, resource.licenseSha256],
      ]) {
        const bytes = await readFile(join(directory, "vendor", file));
        expect(bytes).toEqual(await readFile(new URL(`vendor/${file}`, source)));
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(hash);
      }
    }
    for (const file of ["visualize.css", "visualize.html", "calendar.js"]) {
      const bytes = await readFile(join(directory, file));
      expect(bytes).toEqual(await readFile(new URL(file, source)));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(manifest.files[file].sha256);
    }
    const tweak = await readFile(
      new URL("../src/renderer/src/plugin-sandbox/genUiTweakRuntime.js", import.meta.url),
    );
    expect(createHash("sha256").update(tweak).digest("hex")).toBe(
      manifest.files["tweak.js"].sha256,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
