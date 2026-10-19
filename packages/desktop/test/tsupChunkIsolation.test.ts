import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { build } from "tsup";
import { describe, expect, it } from "vitest";
import tsupConfig, {
  resolveBuildRemoteCdnReleaseRoots,
  resolveDesktopTsupBundleSecurityOptions,
} from "../tsup.config";

type EsbuildLikeOptions = {
  chunkNames?: string;
  legalComments?: string;
};

function getChunkNames(configName: string): string | undefined {
  const configs = Array.isArray(tsupConfig) ? tsupConfig : [tsupConfig];
  const target = configs.find((config) => config.name === configName);
  expect(target).toBeDefined();

  const esbuildOptions: EsbuildLikeOptions = {};
  target?.esbuildOptions?.(esbuildOptions);
  return esbuildOptions.chunkNames;
}

function getExternal(configName: string): string[] {
  const configs = Array.isArray(tsupConfig) ? tsupConfig : [tsupConfig];
  const target = configs.find((config) => config.name === configName);
  expect(target).toBeDefined();
  expect(Array.isArray(target?.external)).toBe(true);
  return target?.external as string[];
}

function getNoExternal(configName: string): string[] {
  const configs = Array.isArray(tsupConfig) ? tsupConfig : [tsupConfig];
  const target = configs.find((config) => config.name === configName);
  expect(target).toBeDefined();
  expect(Array.isArray(target?.noExternal)).toBe(true);
  return target?.noExternal as string[];
}

function getDefines(configName: string): Record<string, string> {
  const configs = Array.isArray(tsupConfig) ? tsupConfig : [tsupConfig];
  const target = configs.find((config) => config.name === configName);
  expect(target).toBeDefined();
  return target?.define ?? {};
}

describe("desktop tsup chunk isolation", () => {
  it("ZIP 解包器应外置，避免 Electron ESM 启动时动态 require fs 崩溃", () => {
    for (const name of ["main", "host", "scheduler"]) expect(getExternal(name)).toContain("yauzl");
  });
  it("更新器的 CommonJS 运行时应外置，macOS 动态 chunk 不能内联 require events", () => {
    expect(getExternal("main")).toContain("builder-util-runtime");
  });

  it.skipIf(process.platform !== "darwin")(
    "生产 ESM 更新器在真实 Electron 中完成无更新、有更新和失败检查",
    async () => {
      const configs = Array.isArray(tsupConfig) ? tsupConfig : [tsupConfig];
      const main = configs.find((config) => config.name === "main")!;
      const cache = resolve("packages/desktop/.e2e-cache");
      await mkdir(cache, { recursive: true });
      const root = await mkdtemp(join(cache, "updater-runtime-"));
      try {
        await build({
          ...main,
          config: false,
          entry: { updater: resolve("packages/desktop/src/main/communityUpdaterFactory.ts") },
          outDir: root,
          define: { ...main.define, __ZCODE_MAC_UPDATE_MODE__: '"ad-hoc"' },
          splitting: true,
          minify: true,
          keepNames: true,
          sourcemap: false,
          onSuccess: undefined,
          silent: true,
        });
        const probe = join(root, "probe.cjs");
        await writeFile(
          probe,
          String.raw`
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const { app } = require("electron");
app.setPath("userData", join(__dirname, "user-data"));
app.setPath("sessionData", join(__dirname, "session-data"));
app.disableHardwareAcceleration();
Object.defineProperty(app, "isPackaged", { value: true });
app.getVersion = () => "0.1.2";
const deadline = setTimeout(() => {
  process.stderr.write("updater runtime probe timed out\n");
  app.exit(2);
}, 20000);
app.whenReady().then(async () => {
  const server = createServer();
  try {
    const pkg = require("electron-updater");
    const { resolveCommunityUpdater } = await import(pathToFileURL(join(__dirname, "updater.js")).href);
    const fallback = pkg.autoUpdater;
    const updater = await resolveCommunityUpdater(fallback);
    assert.notEqual(updater, fallback);
    assert.equal(updater.constructor.name, "CommunityMacUpdater");
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.logger = null;
    let version = "0.1.2";
    let invalid = false;
    let requests = 0;
    server.on("request", (request, response) => {
      requests++;
      assert.match(request.url, /^\/latest-mac\.yml(?:\?|$)/);
      response.end(invalid ? "version: invalid" :
        "version: " + version + "\nfiles:\n  - url: update.zip\n    sha512: " +
        Buffer.alloc(64).toString("base64") + "\n    size: 1\n");
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const feed = "http://127.0.0.1:" + server.address().port;
    const events = [];
    updater.on("checking-for-update", () => events.push("checking"));
    updater.on("update-not-available", () => events.push("up-to-date"));
    updater.on("update-available", () => events.push("available"));
    updater.on("error", () => events.push("error"));
    updater.setFeedURL({ provider: "generic", url: feed });
    assert.equal((await updater.checkForUpdates()).isUpdateAvailable, false);
    version = "0.1.3";
    assert.equal((await updater.checkForUpdates()).isUpdateAvailable, true);
    invalid = true;
    await assert.rejects(updater.checkForUpdates(), /valid semver/);
    assert.deepEqual(events, ["checking", "up-to-date", "checking", "available", "checking", "error"]);
    assert.equal(requests, 3);
    process.stdout.write("COMMUNITY_UPDATER_RUNTIME_OK\n");
    app.exit(0);
  } catch (error) {
    process.stderr.write(String(error.stack || error) + "\n");
    app.exit(1);
  } finally {
    clearTimeout(deadline);
    server.close();
  }
});
`,
        );
        const { default: electron } = await import("electron");
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const { stdout } = await promisify(execFile)(electron as unknown as string, [probe], {
          env,
          timeout: 30_000,
        });
        expect(stdout).toContain("COMMUNITY_UPDATER_RUNTIME_OK");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it("main 构建应将 chunk 输出到 main 子目录，避免覆盖 host 构建产物", () => {
    expect(getChunkNames("main")).toBe("main/chunk-[hash]");
  });

  it("host 构建应将 chunk 输出到 host 子目录，避免覆盖 main 构建产物", () => {
    expect(getChunkNames("host")).toBe("host/chunk-[hash]");
  });

  it("main/host 构建应外置飞书 SDK，避免 Electron ESM 动态 require 崩溃", () => {
    expect(getExternal("main")).toContain("@larksuiteoapi/node-sdk");
    expect(getExternal("host")).toContain("@larksuiteoapi/node-sdk");
  });

  it("main/host 构建应外置 yaml，避免 Electron ESM 动态 require 崩溃", () => {
    expect(getExternal("main")).toContain("yaml");
    expect(getExternal("host")).toContain("yaml");
  });

  it("main/host/scheduler 应内联 CUA producer，安装包不能依赖被排除的 @zcode node_modules", () => {
    for (const configName of ["main", "host", "scheduler"]) {
      expect(getNoExternal(configName)).toContain("@zcode/zcode-cua");
      expect(getExternal(configName)).toContain("@trycua/cua-driver");
    }
  });

  it("main/host/scheduler 应内联 Provider workspace 包，Electron 不能直接加载 TypeScript 源码", () => {
    for (const configName of ["main", "host", "scheduler"]) {
      expect(getNoExternal(configName)).toContain("@zcode/provider");
      expect(getNoExternal(configName)).toContain("@zcode/provider-node");
    }
  });

  it("生产构建应压缩 main/host/preload 且不生成 sourcemap", () => {
    expect(resolveDesktopTsupBundleSecurityOptions({ NODE_ENV: "production" })).toEqual({
      keepNames: true,
      minify: true,
      sourcemap: false,
    });
  });

  it("开发构建应保留 sourcemap 方便本地调试", () => {
    expect(resolveDesktopTsupBundleSecurityOptions({ NODE_ENV: "development" })).toEqual({
      keepNames: false,
      minify: false,
      sourcemap: true,
    });
  });

  it("E2E coverage 构建应关闭压缩并保留 sourcemap", () => {
    expect(
      resolveDesktopTsupBundleSecurityOptions({
        NODE_ENV: "production",
        ZCODE_E2E_COVERAGE: "1",
      }),
    ).toEqual({
      keepNames: false,
      minify: false,
      sourcemap: true,
    });
  });

  it("remote runtime CDN 根应可由 CI 的 CDN_DOMAIN/OSS_PATH_PREFIX 多值注入", () => {
    expect(
      resolveBuildRemoteCdnReleaseRoots({
        CDN_DOMAIN: "cdn-zcode.z.ai,cdn.zcode-ai.com",
        OSS_PATH_PREFIX: "zcode/electron/releases",
      }),
    ).toEqual([
      "https://cdn-zcode.z.ai/zcode/electron/releases",
      "https://cdn.zcode-ai.com/zcode/electron/releases",
    ]);
  });

  it("remote runtime CDN 根的路径前缀数量不匹配时应失败", () => {
    expect(() =>
      resolveBuildRemoteCdnReleaseRoots({
        CDN_DOMAIN: "cdn-zcode.z.ai,cdn.zcode-ai.com",
        OSS_PATH_PREFIX: "new-prefix,old-prefix,extra-prefix",
      }),
    ).toThrow("OSS_PATH_PREFIX must contain one value or match CDN_DOMAIN count");
  });

  it("安装包身份与后端环境作为两个编译期常量注入每个 bundle", () => {
    // 打包后的应用不能依赖机器环境变量：ZCODE_PREVIEW_IDENTITY 在构建时折叠成 __ZCODE_PRODUCT_FLAVOR__。
    for (const entry of ["main", "host", "preload"] as const) {
      const defines = getDefines(entry);
      expect(defines).toHaveProperty("__ZCODE_ENV__");
      expect(defines).toHaveProperty("__ZCODE_PRODUCT_FLAVOR__");
      expect(['"production"', '"preview"']).toContain(defines.__ZCODE_PRODUCT_FLAVOR__);
    }
  });

  it("所有 tsup 子构建都应关闭 esbuild legal comments 输出", () => {
    for (const configName of ["main", "host", "preload"]) {
      const configs = Array.isArray(tsupConfig) ? tsupConfig : [tsupConfig];
      const target = configs.find((config) => config.name === configName);
      expect(target).toBeDefined();

      const esbuildOptions: EsbuildLikeOptions = {};
      target?.esbuildOptions?.(esbuildOptions);
      expect(esbuildOptions.legalComments).toBe("none");
    }
  });
});
