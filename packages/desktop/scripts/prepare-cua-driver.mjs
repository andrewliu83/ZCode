import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { cp, chmod, mkdir, mkdtemp, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { t as listTar, x as extractTar } from "tar";
import {
  assertBinary,
  CUA_DRIVER_TARGETS,
  isSupportedCuaDriverTarget,
  NATIVE_PACKAGE_BY_KEY,
} from "./cua-driver-binaries.mjs";
import yauzl from "yauzl";
import { isCuaDriverInstalled } from "./computer-use-producer.mjs";
import { getTargetPlatform } from "./target-platform.mjs";

const desktopRoot = resolve(import.meta.dirname, "..");
const inventoryPath = resolve(desktopRoot, "../../third-party/cua-driver/sources.json");

export { CUA_DRIVER_TARGETS, isSupportedCuaDriverTarget } from "./cua-driver-binaries.mjs";
export { assertBinary } from "./cua-driver-binaries.mjs";

export async function readCuaDriverSources() {
  return JSON.parse(await readFile(inventoryPath, "utf8"));
}

export async function verifyCuaDriverArchive(archivePath, asset) {
  const info = await stat(archivePath);
  // 修复依据：先验大小再流式校验，损坏或截断的缓存不得进入解包阶段。
  if (!info.isFile() || info.size !== asset.bytes) {
    throw new Error(`Cua Driver archive size mismatch: ${archivePath}`);
  }
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(archivePath)) hash.update(chunk);
  if (hash.digest("hex") !== asset.sha256) {
    throw new Error(`Cua Driver archive SHA-256 mismatch: ${archivePath}`);
  }
}

function assertEntry(path, root, seen) {
  // 独立二进制归档没有外层目录；空 root 表示成员本来就位于归档顶层。
  const inside = root === "" ? !path.startsWith("/") : path === root || path.startsWith(`${root}/`);
  if (
    path.includes("\\") ||
    path.split("/").some((part) => !part || part === "." || part === "..") ||
    !inside ||
    seen.has(path)
  ) {
    return false;
  }
  seen.add(path);
  return true;
}

function openZip(archivePath) {
  return new Promise((resolveZip, rejectZip) => {
    yauzl.open(archivePath, { lazyEntries: true }, (error, zip) =>
      error ? rejectZip(error) : resolveZip(zip),
    );
  });
}

function openZipEntry(zip, entry) {
  return new Promise((resolveEntry, rejectEntry) => {
    zip.openReadStream(entry, (error, stream) =>
      error ? rejectEntry(error) : resolveEntry(stream),
    );
  });
}

/** yauzl 是事件式 API；这里按 entry 顺序串行遍历，避免整包读入内存。 */
async function forEachZipEntry(zip, visit) {
  await new Promise((resolveWalk, rejectWalk) => {
    let failure;
    zip.on("entry", (entry) => {
      Promise.resolve()
        .then(() => visit(entry))
        .then(() => {
          if (!failure) zip.readEntry();
        })
        .catch((error) => {
          failure = error;
          zip.close();
        });
    });
    zip.once("end", () => (failure ? rejectWalk(failure) : resolveWalk()));
    zip.once("error", rejectWalk);
    zip.readEntry();
  });
}

export async function validateCuaDriverArchive(archivePath, asset) {
  const seen = new Set();
  let invalid;
  if (asset.file.endsWith(".zip")) {
    const zip = await openZip(archivePath);
    try {
      await forEachZipEntry(zip, (entry) => {
        const path = entry.fileName.replace(/\/$/u, "");
        // zip 只接受普通文件/目录；符号链接条目在解包前拒绝。
        const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
        if (mode !== 0 && mode !== 0o040000 && mode !== 0o100000) invalid ??= entry.fileName;
        else if (!assertEntry(path, asset.root, seen)) invalid ??= entry.fileName;
      });
      if (invalid) throw new Error(`Unsafe Cua Driver archive entry: ${invalid}`);
    } finally {
      zip.close();
    }
    return;
  }
  await listTar({
    file: archivePath,
    strict: true,
    onReadEntry(entry) {
      // tar 的 entry 回调同步抛出会中断解析流；这里累积首个非法项，结束后统一拒绝。
      if (!["File", "Directory"].includes(entry.type)) invalid ??= entry.path;
      else if (!assertEntry(entry.path.replace(/\/$/u, ""), asset.root, seen))
        invalid ??= entry.path;
    },
  });
  if (invalid) throw new Error(`Unsafe Cua Driver archive entry: ${invalid}`);
}

async function verifyApp(root, source, asset) {
  const app = join(root, asset.app);
  const plist = await readFile(join(app, "Contents/Info.plist"), "utf8");
  for (const [key, expected] of Object.entries({
    CFBundleIdentifier: asset.bundleId,
    CFBundleExecutable: "cua-driver",
    CFBundleShortVersionString: source.version,
    CFBundleVersion: source.version,
    LSMinimumSystemVersion: asset.minimumSystemVersion,
  })) {
    const actual = plist.match(
      new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`, "u"),
    )?.[1];
    if (actual !== expected) throw new Error(`Cua Driver ${key} mismatch: ${actual}`);
  }
  await assertBinary(join(app, asset.executable), "arm64", true);
  await assertBinary(join(app, "Contents/MacOS/cua-cursor-theme"), "arm64", true);
}

async function verifyStandalone(root, key, asset) {
  await assertBinary(join(root, asset.executable), CUA_DRIVER_TARGETS[key].arch, true);
}

async function findSdkPackage(packageName, packageRoot) {
  for (let directory = packageRoot; ; directory = dirname(directory)) {
    const candidate = join(directory, "node_modules", packageName);
    try {
      await stat(join(candidate, "package.json"));
      return candidate;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (directory === dirname(directory))
      throw new Error(`Missing Cua Driver SDK package: ${packageName}`);
  }
}

async function verifySdk(root, source, key) {
  const packages = { ...source.sdkPackages, ...source.sdkNativePackages[key] };
  for (const [name, version] of Object.entries(packages)) {
    const manifest = JSON.parse(
      await readFile(join(root, "node_modules", name, "package.json"), "utf8"),
    );
    if (manifest.name !== name || manifest.version !== version) {
      throw new Error(`Cua Driver SDK package mismatch: ${name}@${manifest.version}`);
    }
  }
  for (const file of [
    "@trycua/cua-driver/dist/index.js",
    "@trycua/cua-driver/dist/native/node-runtime.js",
    "@ubjs/node/typescript/dist/resolve-lib.js",
  ]) {
    if (!(await stat(join(root, "node_modules", file))).isFile())
      throw new Error(`Missing Cua Driver SDK file: ${file}`);
  }
  const native = NATIVE_PACKAGE_BY_KEY[key];
  for (const file of native.files) {
    await assertBinary(join(root, "node_modules", native.name, file), CUA_DRIVER_TARGETS[key].arch);
  }
}

export async function verifyCuaDriverAssets(root, source, targetKey = "darwin-arm64") {
  source ??= await readCuaDriverSources();
  const asset = source.archives[targetKey];
  if (!asset) throw new Error(`Cua Driver target is not pinned: ${targetKey}`);
  if (asset.app) await verifyApp(root, source, asset);
  else await verifyStandalone(root, targetKey, asset);
  await verifySdk(root, source, targetKey);
  for (const notice of source.notices) {
    const actual = createHash("sha256")
      .update(await readFile(join(root, notice.member)))
      .digest("hex");
    if (actual !== notice.sha256)
      throw new Error(`Cua Driver notice SHA-256 mismatch: ${notice.member}`);
  }
}

async function extractArchive(archivePath, asset, destination) {
  if (asset.file.endsWith(".zip")) {
    const zip = await openZip(archivePath);
    try {
      await forEachZipEntry(zip, async (entry) => {
        const path = join(destination, entry.fileName);
        if (entry.fileName.endsWith("/")) {
          await mkdir(path, { recursive: true });
          return;
        }
        await mkdir(dirname(path), { recursive: true });
        const stream = await openZipEntry(zip, entry);
        await pipeline(
          stream,
          createWriteStream(path, { flags: "wx", mode: entry.mode & 0o777 || 0o644 }),
        );
      });
    } finally {
      zip.close();
    }
    return;
  }
  await extractTar({ file: archivePath, cwd: destination, strict: true });
}

async function resolveArchive({ archivePath, cacheDir, asset, source, fetchImpl }) {
  if (archivePath) {
    await verifyCuaDriverArchive(archivePath, asset);
    return archivePath;
  }
  await mkdir(cacheDir, { recursive: true });
  const cachedPath = join(cacheDir, asset.file);
  try {
    await stat(cachedPath);
    await verifyCuaDriverArchive(cachedPath, asset);
    return cachedPath;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const temporary = await mkdtemp(join(cacheDir, ".download-"));
  try {
    const downloaded = join(temporary, asset.file);
    const response = await fetchImpl(`${source.releaseBase}${asset.file}`, {
      signal: AbortSignal.timeout(300_000),
    });
    if (!response.ok || !response.body)
      throw new Error(`Cua Driver download failed: HTTP ${response.status}`);
    await pipeline(response.body, createWriteStream(downloaded, { flags: "wx" }));
    await verifyCuaDriverArchive(downloaded, asset);
    await rename(downloaded, cachedPath);
    return cachedPath;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function replaceCuaDriverAssets(prepared, output, renamePath = rename) {
  const backup = `${output}.backup-${randomUUID()}`;
  let previous = false;
  try {
    await renamePath(output, backup);
    previous = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    await renamePath(prepared, output);
  } catch (error) {
    // 修复依据：替换失败仍须恢复上一份已校验资源，不能先删旧目录再让失败留下空运行时。
    if (previous) await renamePath(backup, output);
    throw error;
  }
  if (previous) await rm(backup, { recursive: true, force: true });
}

export async function prepareCuaDriverAssets({
  desktopPackageRoot = desktopRoot,
  targetPlatform = getTargetPlatform(),
  env = process.env,
  archivePath = env.ZCODE_CUA_DRIVER_ARCHIVE_PATH?.trim(),
  cacheDir = env.ZCODE_CUA_DRIVER_CACHE_DIR?.trim() ||
    join(desktopPackageRoot, "bundled-tools/cua-driver/.cache"),
  source,
  fetchImpl = fetch,
} = {}) {
  if (!isSupportedCuaDriverTarget(targetPlatform)) return { skipped: true };
  const key = `${targetPlatform.os}-${targetPlatform.arch}`;
  source ??= await readCuaDriverSources();
  const asset = source.archives[key];
  if (!asset) return { skipped: true };
  const archive = await resolveArchive({ archivePath, cacheDir, asset, source, fetchImpl });
  await validateCuaDriverArchive(archive, asset);
  const outputRoot = join(desktopPackageRoot, "bundled-tools/cua-driver");
  await mkdir(outputRoot, { recursive: true });
  const staging = await mkdtemp(join(outputRoot, ".stage-"));
  const output = join(outputRoot, key);
  try {
    await extractArchive(archive, asset, staging);
    const extracted = asset.root ? join(staging, asset.root) : staging;
    const prepared = join(staging, "prepared");
    await mkdir(prepared);
    if (asset.app) {
      await cp(join(extracted, asset.app), join(prepared, asset.app), { recursive: true });
    } else {
      // 独立二进制归档保留随包的主题/UIA/wayland 辅助文件；executable 只标记主程序权限。
      const members = asset.members ?? [asset.executable];
      for (const member of members)
        await cp(join(extracted, member), join(prepared, member), { recursive: true });
      await chmod(join(prepared, asset.executable), 0o755);
    }
    // 独立二进制归档不附许可文件；统一从仓内固定副本复制，保证三平台内容一致。
    for (const notice of source.notices) {
      const local = resolve(desktopRoot, "../../third-party/cua-driver", notice.member);
      const fromArchive = join(extracted, notice.member);
      const sourceFile = await stat(fromArchive)
        .then(() => fromArchive)
        .catch(() => local);
      await cp(sourceFile, join(prepared, notice.member));
    }
    // 只复制通用 SDK 与该目标平台的原生包，避免把其它架构打进发行物。
    const packages = { ...source.sdkPackages, ...source.sdkNativePackages[key] };
    for (const name of Object.keys(packages)) {
      const packageRoot = await findSdkPackage(name, desktopPackageRoot);
      const target = join(prepared, "node_modules", name);
      await mkdir(dirname(target), { recursive: true });
      // 必须复制实际文件：发行资源不能依赖 pnpm 链接、仓库路径或用户机器上的 SDK。
      await cp(packageRoot, target, {
        recursive: true,
        dereference: true,
        filter: (path) =>
          path === packageRoot ||
          !path
            .slice(packageRoot.length + 1)
            .split(/[\\/]/u)
            .includes("node_modules"),
      });
    }
    await verifyCuaDriverAssets(prepared, source, key);
    await replaceCuaDriverAssets(prepared, output);
    return {
      skipped: false,
      outputDir: output,
      executable: asset.app
        ? join(output, asset.app, asset.executable)
        : join(output, asset.executable),
      ...(asset.app ? { appPath: join(output, asset.app) } : {}),
      sdkPath: join(output, "node_modules/@trycua/cua-driver"),
    };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (isCuaDriverInstalled({ desktopPackageRoot: desktopRoot })) {
    console.log("[prepare:cua-driver]", await prepareCuaDriverAssets());
  } else {
    console.log("[prepare:cua-driver] skip: no pinned Driver runtime");
  }
}
