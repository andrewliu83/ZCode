import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { c as createTar, Header } from "tar";
import {
  prepareCuaDriverAssets,
  readCuaDriverSources,
  replaceCuaDriverAssets,
  validateCuaDriverArchive,
} from "../scripts/prepare-cua-driver.mjs";
import { resolveDevDesktopCuaDriverEnv } from "../../../scripts/dev-desktop-cua-env.mjs";
import { collectCommunityMacPresignPaths } from "../../../scripts/sign-community-macos.mjs";

const roots: string[] = [];
const desktopRoot = resolve(import.meta.dirname, "..");
const targetPlatform = { os: "darwin", arch: "arm64", key: "darwin-arm64" };
const macho = Buffer.from("cffaedfe0c000001", "hex");

async function put(path: string, content: string | Buffer, mode = 0o644) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, { mode });
}

async function fixture() {
  const root = await mkdtemp(join(desktopRoot, ".cua-driver-test-"));
  roots.push(root);
  const source = await readCuaDriverSources();
  const asset = source.archives["darwin-arm64"];
  const archiveRoot = join(root, "archive", asset.root);
  const app = join(archiveRoot, asset.app);
  const plist = Object.entries({
    CFBundleIdentifier: asset.bundleId,
    CFBundleExecutable: "cua-driver",
    CFBundleShortVersionString: source.version,
    CFBundleVersion: source.version,
    LSMinimumSystemVersion: asset.minimumSystemVersion,
  })
    .map(([key, value]) => `<key>${key}</key><string>${value}</string>`)
    .join("\n");
  await put(join(app, "Contents/Info.plist"), `<plist><dict>${plist}</dict></plist>`);
  await put(join(app, asset.executable), macho, 0o755);
  await put(join(app, "Contents/MacOS/cua-cursor-theme"), macho, 0o755);
  for (const notice of source.notices) {
    await put(join(archiveRoot, notice.member), notice.member);
    notice.sha256 = createHash("sha256").update(notice.member).digest("hex");
  }
  const archivePath = join(root, "fixture.tar.gz");
  await createTar({ gzip: true, file: archivePath, cwd: join(root, "archive") }, [asset.root]);
  asset.bytes = (await stat(archivePath)).size;
  asset.sha256 = createHash("sha256")
    .update(await readFile(archivePath))
    .digest("hex");
  const packages = { ...source.sdkPackages, ...source.sdkNativePackages["darwin-arm64"] };
  for (const [name, version] of Object.entries(packages)) {
    await put(join(root, "node_modules", name, "package.json"), JSON.stringify({ name, version }));
  }
  for (const file of [
    "@trycua/cua-driver/dist/index.js",
    "@trycua/cua-driver/dist/native/node-runtime.js",
    "@ubjs/node/typescript/dist/resolve-lib.js",
  ])
    await put(join(root, "node_modules", file), "export {};");
  for (const file of ["libcua_driver_sdk.dylib", "cua_driver_node_runtime.node"]) {
    await put(join(root, "node_modules/@trycua/cua-driver-darwin-arm64", file), macho, 0o755);
  }
  return { root, source, asset, archivePath };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Cua Driver release staging", () => {
  it("stages the app, notices, and copied target SDK closure", async () => {
    const { root, source, archivePath } = await fixture();
    const result = await prepareCuaDriverAssets({
      desktopPackageRoot: root,
      targetPlatform,
      source,
      archivePath,
    });
    expect(result.outputDir).toBe(join(root, "bundled-tools/cua-driver/darwin-arm64"));
    expect((await stat(result.appPath)).isDirectory()).toBe(true);
    expect((await stat(result.sdkPath)).isSymbolicLink()).toBe(false);
    expect(await readFile(join(result.outputDir, "THIRD_PARTY_NOTICES.md"), "utf8")).toBe(
      "THIRD_PARTY_NOTICES.md",
    );
    expect((await stat(join(result.appPath, "Contents/MacOS/cua-driver"))).mode & 0o111).not.toBe(
      0,
    );
    expect(
      await readFile(
        join(
          result.outputDir,
          "node_modules/@trycua/cua-driver-darwin-arm64/libcua_driver_sdk.dylib",
        ),
      ),
    ).toEqual(macho);
    await rm(join(root, "node_modules"), { recursive: true });
    expect(await readFile(join(result.sdkPath, "dist/index.js"), "utf8")).toBe("export {};");
  });

  it("rejects same-size corruption before replacing a prepared app", async () => {
    const { root, source, archivePath, asset } = await fixture();
    const result = await prepareCuaDriverAssets({
      desktopPackageRoot: root,
      targetPlatform,
      source,
      archivePath,
    });
    await writeFile(archivePath, Buffer.alloc(asset.bytes));
    await expect(
      prepareCuaDriverAssets({ desktopPackageRoot: root, targetPlatform, source, archivePath }),
    ).rejects.toThrow("SHA-256 mismatch");
    expect((await stat(result.appPath)).isDirectory()).toBe(true);
    await writeFile(archivePath, "partial");
    await expect(
      prepareCuaDriverAssets({ desktopPackageRoot: root, targetPlatform, source, archivePath }),
    ).rejects.toThrow("size mismatch");
  });

  it("verifies cached reuse without download and rejects corrupt cache", async () => {
    const { root, source, asset, archivePath } = await fixture();
    const cacheDir = join(root, "cache");
    await put(join(cacheDir, asset.file), await readFile(archivePath));
    const fetchImpl = () => {
      throw new Error("unexpected download");
    };
    const options = {
      desktopPackageRoot: root,
      targetPlatform,
      source,
      env: { ZCODE_CUA_DRIVER_CACHE_DIR: cacheDir },
      fetchImpl,
    };
    expect((await prepareCuaDriverAssets(options)).skipped).toBe(false);
    await writeFile(join(cacheDir, asset.file), Buffer.alloc(asset.bytes));
    await expect(prepareCuaDriverAssets(options)).rejects.toThrow("SHA-256 mismatch");
  });

  it("verifies fresh downloads and removes partial downloads on failure", async () => {
    const { root, source, archivePath } = await fixture();
    const bytes = await readFile(archivePath);
    const options = {
      desktopPackageRoot: root,
      targetPlatform,
      source,
      cacheDir: join(root, "cache"),
      fetchImpl: async () => new Response(bytes),
    };
    expect((await prepareCuaDriverAssets(options)).skipped).toBe(false);
    await rm(options.cacheDir, { recursive: true });
    await expect(
      prepareCuaDriverAssets({ ...options, fetchImpl: async () => new Response("partial") }),
    ).rejects.toThrow("size mismatch");
    await expect(
      stat(join(options.cacheDir, source.archives["darwin-arm64"].file)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    ["../escape", "File", undefined],
    ["/absolute", "File", undefined],
    ["cua-driver-rs-0.36.0-darwin-arm64/escape", "SymbolicLink", "../../escape"],
    ["cua-driver-rs-0.36.0-darwin-arm64/escape", "Link", "/escape"],
  ])("rejects unsafe tar entry %s (%s)", async (path, type, linkpath) => {
    const { root, asset } = await fixture();
    const header = new Header({ path, type, linkpath, size: 0, mode: 0o644 });
    header.encode();
    const archive = join(root, "unsafe.tar.gz");
    await writeFile(archive, gzipSync(Buffer.concat([header.block!, Buffer.alloc(1024)])));
    await expect(validateCuaDriverArchive(archive, asset)).rejects.toThrow(
      "Unsafe Cua Driver archive entry",
    );
  });

  it("fails when the pinned target SDK closure is missing or wrong-version", async () => {
    const { root, source, archivePath } = await fixture();
    const manifest = join(root, "node_modules/@ubjs/core/package.json");
    await writeFile(manifest, JSON.stringify({ name: "@ubjs/core", version: "0.0.0" }));
    await expect(
      prepareCuaDriverAssets({ desktopPackageRoot: root, targetPlatform, source, archivePath }),
    ).rejects.toThrow("SDK package mismatch");
    await rm(
      join(root, "node_modules/@trycua/cua-driver-darwin-arm64/cua_driver_node_runtime.node"),
    );
    await writeFile(manifest, JSON.stringify({ name: "@ubjs/core", version: "0.31.0-3" }));
    await expect(
      prepareCuaDriverAssets({ desktopPackageRoot: root, targetPlatform, source, archivePath }),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["app", "dylib", "addon"])(
    "rejects x64 Mach-O in the arm64 %s resource",
    async (resource) => {
      const { root, source, asset, archivePath } = await fixture();
      const wrongArch = Buffer.from("cffaedfe07000001", "hex");
      if (resource === "app") {
        await writeFile(join(root, "archive", asset.root, asset.app, asset.executable), wrongArch);
        await createTar({ gzip: true, file: archivePath, cwd: join(root, "archive") }, [
          asset.root,
        ]);
        asset.bytes = (await stat(archivePath)).size;
        asset.sha256 = createHash("sha256")
          .update(await readFile(archivePath))
          .digest("hex");
      } else {
        await writeFile(
          join(
            root,
            "node_modules/@trycua/cua-driver-darwin-arm64",
            resource === "dylib" ? "libcua_driver_sdk.dylib" : "cua_driver_node_runtime.node",
          ),
          wrongArch,
        );
      }
      await expect(
        prepareCuaDriverAssets({ desktopPackageRoot: root, targetPlatform, source, archivePath }),
      ).rejects.toThrow("arm64 Mach-O");
    },
  );

  it("restores the previous verified output when the replacement rename fails", async () => {
    const { root } = await fixture();
    const prepared = join(root, "prepared");
    const output = join(root, "output");
    await put(join(prepared, "marker"), "new");
    await put(join(output, "marker"), "old");
    await expect(
      replaceCuaDriverAssets(prepared, output, async (from: string, to: string) => {
        if (from === prepared) throw new Error("rename failed");
        await rename(from, to);
      }),
    ).rejects.toThrow("rename failed");
    expect(await readFile(join(output, "marker"), "utf8")).toBe("old");
    await replaceCuaDriverAssets(prepared, output);
    expect(await readFile(join(output, "marker"), "utf8")).toBe("new");
  });

  it("skips unsupported target platforms without inspecting or downloading resources", async () => {
    expect(await prepareCuaDriverAssets({ targetPlatform: { os: "darwin", arch: "x64" } })).toEqual(
      {
        skipped: true,
      },
    );
    expect(
      await prepareCuaDriverAssets({ targetPlatform: { os: "win32", arch: "arm64" } }),
    ).toEqual({ skipped: true });
    expect(
      resolveDevDesktopCuaDriverEnv({ platform: "darwin", arch: "x64", repoRoot: "/repo" }),
    ).toEqual({});
    expect(
      resolveDevDesktopCuaDriverEnv({ platform: "darwin", arch: "arm64", repoRoot: "/repo" }),
    ).toEqual({
      ZCODE_CUA_BUNDLED_HELPER_APP_PATH:
        "/repo/packages/desktop/bundled-tools/cua-driver/darwin-arm64/CuaDriver.app",
      ZCODE_CUA_DRIVER_SDK_PATH:
        "/repo/packages/desktop/bundled-tools/cua-driver/darwin-arm64/node_modules/@trycua/cua-driver",
    });
    expect(
      resolveDevDesktopCuaDriverEnv({ platform: "win32", arch: "x64", repoRoot: "/repo" }),
    ).toEqual({
      ZCODE_CUA_BUNDLED_HELPER_APP_PATH:
        "/repo/packages/desktop/bundled-tools/cua-driver/win32-x64/cua-driver.exe",
      ZCODE_CUA_DRIVER_SDK_PATH:
        "/repo/packages/desktop/bundled-tools/cua-driver/win32-x64/node_modules/@trycua/cua-driver",
    });
    expect(
      resolveDevDesktopCuaDriverEnv({ platform: "linux", arch: "x64", repoRoot: "/repo" }),
    ).toEqual({
      ZCODE_CUA_BUNDLED_HELPER_APP_PATH:
        "/repo/packages/desktop/bundled-tools/cua-driver/linux-x64/cua-driver",
      ZCODE_CUA_DRIVER_SDK_PATH:
        "/repo/packages/desktop/bundled-tools/cua-driver/linux-x64/node_modules/@trycua/cua-driver",
    });
  });

  // 回归依据：Windows checkout 的 CRLF 转换会改写随包许可，导致摘要校验在打包前失败。
  it("keeps checked-in Driver notices byte-pinned across checkout", async () => {
    const attributes = await readFile(resolve(desktopRoot, "../../.gitattributes"), "utf8");
    expect(attributes).toMatch(/^third-party\/cua-driver\/\*\* -text -whitespace$/mu);
    const source = await readCuaDriverSources();
    for (const notice of source.notices) {
      const local = await readFile(
        resolve(desktopRoot, "../../third-party/cua-driver", notice.member),
      );
      expect(createHash("sha256").update(local).digest("hex")).toBe(notice.sha256);
    }
  });

  it("presigns SDK/app Mach-O before sealing the nested Driver app", async () => {
    const { root } = await fixture();
    const app = join(root, "ZCode.app");
    const resources = join(app, "Contents/Resources");
    const driver = join(resources, "tools/cua-driver/CuaDriver.app");
    const native = join(resources, "tools/cua-driver/node_modules/sdk.dylib");
    const executable = join(driver, "Contents/MacOS/cua-driver");
    await mkdir(join(resources, "glm"), { recursive: true });
    await put(native, macho);
    await put(executable, macho);
    await put(join(driver, "Contents/Info.plist"), "plist");
    const paths = await collectCommunityMacPresignPaths(app);
    expect(paths).toContain(native);
    expect(paths).toContain(executable);
    expect(paths.at(-1)).toBe(driver);
    expect(paths).not.toContain(join(driver, "Contents/Info.plist"));
  });
});
