import { execFile } from "node:child_process";
import { access, mkdtemp, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

/** 接受最终 Release 中一个 app 的 ZIP，禁止通过条目名逃出私有 staging。 */
export function validateMacUpdateArchive(entries: readonly string[], appName: string): void {
  const root = `${appName}.app`;
  if (!entries.some((entry) => entry.startsWith(`${root}/Contents/`)))
    throw new Error("Update ZIP has no application");
  for (const entry of entries) {
    if (
      !entry ||
      entry.startsWith("/") ||
      entry.includes("\\") ||
      entry.split("/").includes("..") ||
      (entry !== root && !entry.startsWith(`${root}/`) && !entry.startsWith("__MACOSX/"))
    ) {
      throw new Error("Unsafe update ZIP entry");
    }
  }
}

export function validateMacUpdateTarget(path: string): void {
  if (
    !path.endsWith(".app") ||
    path.includes("/AppTranslocation/") ||
    path.startsWith("/Volumes/")
  ) {
    throw new Error("请先将 ZCode Community 移到可写的 Applications 目录，再使用自动更新");
  }
}

/** 路径全部由 argv 传递；退出后才交换目录，失败时恢复旧 app。 */
export const MAC_UPDATE_INSTALL_SCRIPT = `#!/bin/sh
set -eu
parent_pid="$1"
target="$2"
next="$3"
backup="$4"
staging="$5"
log="$6"
relaunch="$7"
exec >> "$log" 2>&1
old_moved=0
installed=0
rollback() {
  result=$?
  if [ "$installed" = 0 ]; then
    if [ "$old_moved" = 1 ]; then
      if [ -e "$target" ]; then /bin/mv "$target" "$next"; fi
      /bin/mv "$backup" "$target"
    fi
    if [ "$relaunch" = 1 ] && [ -d "$target" ]; then /usr/bin/open "$target"; fi
  fi
  exit "$result"
}
trap rollback EXIT
attempt=0
while /bin/kill -0 "$parent_pid" 2>/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 300 ]; then
    echo "Main did not exit; original application retained"
    exit 1
  fi
  /bin/sleep 0.2
done
[ -d "$target" ] && [ -d "$next" ] && [ ! -e "$backup" ]
/bin/mv "$target" "$backup"
old_moved=1
/bin/mv "$next" "$target"
/usr/bin/codesign --verify --deep --strict "$target"
installed=1
if [ "$relaunch" = 1 ]; then /usr/bin/open "$target"; fi
/bin/rm -rf "$backup"
/bin/rm -rf "$staging"
echo "Community update installed"
`;

export interface PreparedMacUpdate {
  target: string;
  next: string;
  backup: string;
  staging: string;
  helper: string;
}

async function readPlist(path: string, key: string): Promise<string> {
  const { stdout } = await execute("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, path]);
  return stdout.trim();
}

const STALE_STAGING_PREFIX = ".zcode-community-update-";
const STALE_STAGING_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * 安装失败（例如父进程超时未退出）会留下 staging 目录；下次准备更新时清掉过期项，
 * 避免残留无限堆积。只处理同一父目录、同前缀且明显过期的目录，不碰正在进行中的安装。
 */
async function removeStaleUpdateStaging(parentDirectory: string, now = Date.now()): Promise<void> {
  const entries = await readdir(parentDirectory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(STALE_STAGING_PREFIX)) continue;
    const path = join(parentDirectory, entry.name);
    const info = await stat(path).catch(() => undefined);
    if (!info || now - info.mtimeMs < STALE_STAGING_MAX_AGE_MS) continue;
    await rm(path, { recursive: true, force: true }).catch(() => {});
  }
}

export async function prepareCommunityMacUpdate(input: {
  archive: string;
  target: string;
  version: string;
  appId: string;
  appName: string;
  arch: string;
}): Promise<PreparedMacUpdate> {
  const target = await realpath(input.target);
  validateMacUpdateTarget(target);
  const currentPlist = join(target, "Contents/Info.plist");
  if ((await readPlist(currentPlist, "CFBundleIdentifier")) !== input.appId)
    throw new Error("Current application is not ZCode Community");
  await access(dirname(target), constants.W_OK);
  const { stdout } = await execute("/usr/bin/unzip", ["-Z", "-1", input.archive], {
    maxBuffer: 32 * 1024 * 1024,
  });
  validateMacUpdateArchive(stdout.trimEnd().split("\n"), input.appName);
  // staging 与目标在同一文件系统，每次 mv 使用 rename；整个替换由备份和失败回滚守护。
  await removeStaleUpdateStaging(dirname(target));
  const staging = await mkdtemp(join(dirname(target), ".zcode-community-update-"));
  try {
    await execute("/usr/bin/ditto", ["-x", "-k", input.archive, staging]);
    const next = join(staging, `${input.appName}.app`);
    if ((await realpath(next)) !== next)
      throw new Error("Update application must not be a symlink");
    const plist = join(next, "Contents/Info.plist");
    if ((await readPlist(plist, "CFBundleIdentifier")) !== input.appId)
      throw new Error("Update application identity mismatch");
    if ((await readPlist(plist, "CFBundleShortVersionString")) !== input.version)
      throw new Error("Update application version mismatch");
    const executable = await readPlist(plist, "CFBundleExecutable");
    if (executable !== basename(executable) || executable === "." || executable === "..")
      throw new Error("Invalid application executable");
    await execute("/usr/bin/lipo", [
      "-verify_arch",
      input.arch,
      join(next, "Contents/MacOS", executable),
    ]);
    await execute("/usr/bin/codesign", ["--verify", "--deep", "--strict", next]);
    // __MACOSX 之外只允许一个 app，不从更新中执行其他安装脚本。
    if (
      (await readdir(staging)).some(
        (name) => name !== `${input.appName}.app` && name !== "__MACOSX",
      )
    )
      throw new Error("Unexpected update payload");
    const helper = resolve(staging, "install.sh");
    await writeFile(helper, MAC_UPDATE_INSTALL_SCRIPT, { mode: 0o700 });
    return { target, next, staging, helper, backup: join(staging, "previous.app") };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}
