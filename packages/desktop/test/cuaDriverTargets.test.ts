import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  isSupportedCuaDriverTarget,
  prepareCuaDriverAssets,
  readCuaDriverSources,
} from "../scripts/prepare-cua-driver.mjs";

const roots: string[] = [];
const desktopRoot = resolve(import.meta.dirname, "..");

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Cua Driver target selection", () => {
  it("pins every Community target with its own executable and native package", async () => {
    const source = await readCuaDriverSources();
    for (const [key, executable] of [
      ["darwin-arm64", "Contents/MacOS/cua-driver"],
      ["win32-x64", "cua-driver.exe"],
      ["linux-x64", "cua-driver"],
    ]) {
      expect(source.archives[key].executable).toBe(executable);
      expect(Object.keys(source.sdkNativePackages[key])).toHaveLength(1);
    }
  });

  it("accepts only pinned targets and skips unsupported ones without writing output", async () => {
    expect(isSupportedCuaDriverTarget({ os: "win32", arch: "x64" })).toBe(true);
    expect(isSupportedCuaDriverTarget({ os: "linux", arch: "x64" })).toBe(true);
    expect(isSupportedCuaDriverTarget({ os: "linux", arch: "arm64" })).toBe(false);
    const root = await mkdtemp(join(tmpdir(), "cua-targets-"));
    roots.push(root);
    expect(
      await prepareCuaDriverAssets({
        desktopPackageRoot: root,
        targetPlatform: { os: "linux", arch: "arm64", key: "linux-arm64" },
      }),
    ).toEqual({ skipped: true });
  });

  // 回归依据：0.1.4 首次发行只在 macOS 准备 Driver，Windows/Linux 打包时资源缺失直接失败。
  it("prepares Driver assets on every desktop platform before packaging", async () => {
    const source = await readFile(
      resolve(desktopRoot, "scripts/prepare-runtime-assets.mjs"),
      "utf8",
    );
    const gate = source.match(
      /\.\.\.\(isCuaDriverInstalled\(\{ desktopPackageRoot: desktopRoot \}\)[\s\S]*?\["prepare:cua-driver"\]/u,
    );
    expect(gate, "Driver preparation must not be gated on the host platform").not.toBeNull();
  });
});
