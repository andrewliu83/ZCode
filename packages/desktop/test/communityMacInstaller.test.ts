import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  appendFile,
  rm,
  stat,
  utimes,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import {
  validateMacUpdateArchive,
  validateMacUpdateTarget,
  prepareCommunityMacUpdate,
} from "../src/main/communityMacInstaller.js";

const run = promisify(execFile);
const appName = "ZCode Community";
const appId = "io.github.andrewliu83.zcode";

it("rejects unsafe ZIP entries and non-installable application locations", () => {
  validateMacUpdateArchive([`${appName}.app/Contents/Info.plist`], appName);
  for (const bad of [
    "../outside",
    "/absolute",
    "Other.app/Contents/file",
    `${appName}.app/Contents/../../outside`,
  ]) {
    expect(() =>
      validateMacUpdateArchive([`${appName}.app/Contents/Info.plist`, bad], appName),
    ).toThrow();
  }
  for (const bad of [
    "/Volumes/Installer/ZCode Community.app",
    "/private/var/AppTranslocation/random/d/ZCode Community.app",
    "/Applications/ZCode.app/Contents",
  ])
    expect(() => validateMacUpdateTarget(bad)).toThrow();
});

async function makeApp(root: string, version: string, identifier = appId) {
  const app = join(root, `${appName}.app`);
  await mkdir(join(app, "Contents/MacOS"), { recursive: true });
  const source = join(root, "fixture.c");
  await writeFile(source, "int main(void) { return 0; }\n");
  await run("/usr/bin/clang", [source, "-o", join(app, "Contents/MacOS/fixture")]);
  await writeFile(
    join(app, "Contents/Info.plist"),
    `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${identifier}</string><key>CFBundleExecutable</key><string>fixture</string><key>CFBundleShortVersionString</key><string>${version}</string><key>CFBundleVersion</key><string>${version}</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`,
  );
  await run("/usr/bin/codesign", ["--force", "--sign", "-", app]);
  return app;
}

describe.skipIf(process.platform !== "darwin")("real macOS Community update transaction", () => {
  // 回归依据：父进程未退出时安装助手会放弃并留下 staging；准备下一次更新时必须清掉过期残留。
  it("removes stale update staging without touching a fresh one", async () => {
    const root = await mkdtemp(join(tmpdir(), "community-update-stale-"));
    try {
      const installed = join(root, "installed");
      const incoming = join(root, "incoming");
      const target = await makeApp(installed, "0.1.0");
      const next = await makeApp(incoming, "0.1.1");
      const archive = join(root, "update.zip");
      await run("/usr/bin/ditto", ["-c", "-k", "--keepParent", next, archive]);
      const stale = join(installed, ".zcode-community-update-stale");
      const fresh = join(installed, ".zcode-community-update-fresh");
      await mkdir(stale, { recursive: true });
      await mkdir(fresh, { recursive: true });
      const old = new Date(Date.now() - 60 * 60 * 1000);
      await utimes(stale, old, old);
      await prepareCommunityMacUpdate({
        archive,
        target,
        version: "0.1.1",
        appName,
        appId,
        arch: process.arch,
      });
      expect(await stat(stale).catch(() => undefined)).toBeUndefined();
      expect((await stat(fresh)).isDirectory()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30000);

  it.each([false, true])(
    "waits for Main exit and installs, or rolls back corrupted staging (corrupt=%s)",
    async (corrupt) => {
      const root = await mkdtemp(join(tmpdir(), "community-update $ fixture-"));
      let parent: ReturnType<typeof spawn> | undefined;
      try {
        const installed = join(root, "installed");
        const incoming = join(root, "incoming");
        const target = await makeApp(installed, "0.1.0");
        const next = await makeApp(incoming, "0.1.1");
        const archive = join(root, "update.zip");
        await run("/usr/bin/ditto", ["-c", "-k", "--keepParent", next, archive]);
        await expect(
          prepareCommunityMacUpdate({
            archive,
            target,
            version: "9.9.9",
            appName,
            appId,
            arch: process.arch,
          }),
        ).rejects.toThrow(/version/);
        await expect(
          prepareCommunityMacUpdate({
            archive,
            target,
            version: "0.1.1",
            appName,
            appId: "wrong",
            arch: process.arch,
          }),
        ).rejects.toThrow(/identity|Community/);
        if (!corrupt) {
          await expect(
            prepareCommunityMacUpdate({
              archive,
              target,
              version: "0.1.1",
              appName,
              appId,
              arch: process.arch === "arm64" ? "x86_64" : "arm64",
            }),
          ).rejects.toThrow();
          const wrongApp = await makeApp(join(root, "wrong-app"), "0.1.1", "io.github.other.app");
          const wrongArchive = join(root, "wrong-app.zip");
          await run("/usr/bin/ditto", ["-c", "-k", "--keepParent", wrongApp, wrongArchive]);
          await expect(
            prepareCommunityMacUpdate({
              archive: wrongArchive,
              target,
              version: "0.1.1",
              appName,
              appId,
              arch: process.arch,
            }),
          ).rejects.toThrow(/identity/);
          expect(await readFile(join(target, "Contents/Info.plist"), "utf8")).toContain("0.1.0");
        }
        const prepared = await prepareCommunityMacUpdate({
          archive,
          target,
          version: "0.1.1",
          appName,
          appId,
          arch: process.arch,
        });
        if (corrupt) await appendFile(join(prepared.next, "Contents/MacOS/fixture"), "tampered");
        parent = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], {
          stdio: "ignore",
        });
        await once(parent, "spawn");
        const child = spawn(
          "/bin/sh",
          [
            prepared.helper,
            String(parent.pid),
            prepared.target,
            prepared.next,
            prepared.backup,
            prepared.staging,
            join(root, "install.log"),
            "0",
          ],
          { stdio: "ignore" },
        );
        const finished = once(child, "exit");
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(await readFile(join(target, "Contents/Info.plist"), "utf8")).toContain("0.1.0");
        const stopped = once(parent, "exit");
        parent.kill();
        await stopped;
        const [exit] = await finished;
        expect(exit === 0).toBe(!corrupt);
        expect(await readFile(join(target, "Contents/Info.plist"), "utf8")).toContain(
          corrupt ? "0.1.0" : "0.1.1",
        );
        await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", target]);
      } finally {
        parent?.kill();
        await rm(root, { recursive: true, force: true });
      }
    },
    30000,
  );
});
