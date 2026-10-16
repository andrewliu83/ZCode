import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it, vi } from "vitest";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const desktopDir = resolve(import.meta.dirname, "..");
const builderDir = dirname(require.resolve("app-builder-lib/package.json"));

it("compiles real UAC calls and prepackaged NSIS stages with warnings as errors", async (context) => {
  // NSIS 自带的 mac 编译器是 x86_64；Apple Silicon 缺少 Rosetta 时只跳过此环境不支持的编译测试。
  if (process.platform === "darwin" && process.arch === "arm64") {
    try {
      await execFileAsync("/usr/bin/arch", ["-x86_64", "/usr/bin/true"]);
    } catch (error) {
      const stderr = (error as { stderr?: string }).stderr ?? "";
      if (stderr.includes("Bad CPU type in executable")) {
        context.skip("NSIS x86_64 compiler requires Rosetta on Apple Silicon");
        return;
      }
      throw error;
    }
  }
  const { NSIS_PATH, NSIS_RESOURCES_PATH, NsisTargetOptions } = require(
    resolve(builderDir, "out/targets/nsis/nsisUtil.js"),
  );
  NsisTargetOptions.resolve({});
  const [nsisDir, resourcesDir] = await Promise.all([NSIS_PATH(), NSIS_RESOURCES_PATH()]);
  const compiler = join(
    nsisDir,
    process.platform === "win32"
      ? "Bin/makensis.exe"
      : process.platform === "darwin"
        ? "mac/makensis"
        : "linux/makensis",
  );
  const temp = await mkdtemp(join(tmpdir(), "zcode-nsis-compile-"));
  try {
    for (const uninstaller of [false, true]) {
      const output = join(temp, uninstaller ? "uninstaller.exe" : "installer.exe");
      // 只编译不执行：载荷复用当前文件，所有平台都能验证真实 NSIS 插件解析。
      const args = [
        "-V2",
        "-WX",
        ...(uninstaller ? ["-DBUILD_UNINSTALLER"] : []),
        `-DNSIS_INCLUDE_DIR=${join(nsisDir, "Include")}`,
        `-DELECTRON_BUILDER_NSIS_INCLUDE_DIR=${join(builderDir, "templates/nsis/include")}`,
        `-DNSIS_PLUGIN_DIR=${join(resourcesDir, "plugins/x86-unicode")}`,
        `-DZCODE_INSTALLER_NSH=${join(desktopDir, "build/installer.nsh")}`,
        `-DFIXTURE_EXE=${import.meta.filename}`,
        `-DOUTPUT_FILE=${output}`,
        `-DDEFAULT_LOG_PATH=${join(temp, "default.log")}`,
        `-DELEVATED_LOG_PATH=${join(temp, "elevated.log")}`,
        join(desktopDir, "test/fixtures/installer-nsh-smoke.nsi"),
      ];
      await execFileAsync(compiler, args, { env: { ...process.env, NSISDIR: nsisDir } }).catch(
        (error) => {
          throw new Error(`${error.stdout}\n${error.stderr}`, { cause: error });
        },
      );
      expect((await stat(output)).size).toBeGreaterThan(0);
    }
    const upstream = join(builderDir, "templates/nsis/installSection.nsh");
    const template = join(temp, "installSection.nsh");
    const original = await readFile(upstream, "utf8");
    const isolated = original.replace(/^!include installer\.nsh\r?\n/, "");
    expect(isolated).not.toBe(original);
    const compileTemplate = () =>
      execFileAsync(
        compiler,
        [
          "-V2",
          "-WX",
          `-DNSIS_INCLUDE_DIR=${join(nsisDir, "Include")}`,
          `-DELECTRON_BUILDER_NSIS_INCLUDE_DIR=${join(builderDir, "templates/nsis/include")}`,
          `-DNSIS_PLUGIN_DIR=${join(resourcesDir, "plugins/x86-unicode")}`,
          `-DZCODE_INSTALLER_NSH=${join(desktopDir, "build/installer.nsh")}`,
          `-DZCODE_INSTALL_SECTION=${template}`,
          `-DFIXTURE_EXE=${import.meta.filename}`,
          `-DOUTPUT_FILE=${join(temp, "prepackaged.exe")}`,
          `-DDEFAULT_LOG_PATH=${join(temp, "default.log")}`,
          `-DELEVATED_LOG_PATH=${join(temp, "elevated.log")}`,
          join(desktopDir, "test/fixtures/installer-nsh-smoke.nsi"),
        ],
        { env: { ...process.env, NSISDIR: nsisDir } },
      );
    await writeFile(template, isolated);
    await expect(compileTemplate()).rejects.toMatchObject({
      stdout: expect.stringContaining(
        'warning 6010: install function "ZCodeResetUninstallerLog" not referenced',
      ),
    });
    for (const targetPresentableName of ["nsis", "nsis-web"]) {
      vi.resetModules();
      const patch = await import("../scripts/patch-nsis-install-section.mjs");
      const patchFile = patch.patchNsisInstallSectionFile;
      const restore = patch.restoreNsisInstallSectionFileSync;
      const patchSpy = vi
        .spyOn(patch, "patchNsisInstallSectionFile")
        .mockImplementation(async (path) => {
          expect(path).toBe(upstream);
          return patchFile(template);
        });
      vi.spyOn(patch, "restoreNsisInstallSectionFileSync").mockImplementation((args) => {
        expect(args.filePath).toBe(upstream);
        restore({ filePath: template, originalSource: args.originalSource });
      });
      const before = new Set(process.listeners("exit"));
      try {
        const { default: config } = await import("../electron-builder.config.js");
        expect(typeof config.artifactBuildStarted).toBe("function");
        await config.artifactBuildStarted({ targetPresentableName: "zip" });
        expect(patchSpy).not.toHaveBeenCalled();
        await config.artifactBuildStarted({ targetPresentableName });
        await config.artifactBuildStarted({ targetPresentableName });
        expect(patchSpy).toHaveBeenCalledTimes(1);
        const patched = await readFile(template, "utf8");
        expect(patched).toContain("!insertmacro customInstallCleanupStarted");
        await compileTemplate().catch((error) => {
          throw new Error(`${error.stdout}\n${error.stderr}`, { cause: error });
        });
        expect((await stat(join(temp, "prepackaged.exe"))).size).toBeGreaterThan(0);
      } finally {
        for (const listener of process.listeners("exit")) {
          if (before.has(listener)) continue;
          process.removeListener("exit", listener);
          listener(0);
        }
        vi.restoreAllMocks();
      }
      expect(await readFile(template, "utf8")).toBe(isolated);
    }
    expect(await readFile(upstream, "utf8")).toBe(original);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}, 120_000);
