import { access, chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { runCommand } from "./spawn-command.mjs";

/** SDK 运行时按构建目标准备，不从 PATH 搜索用户安装的 CLI。 */
export async function resolveClaudeSdkRuntimeAsset({ repoRoot, platform, arch, libc }) {
  if (!["darwin", "linux", "win32"].includes(platform) || !["arm64", "x64"].includes(arch)) {
    throw new Error(`Unsupported Claude SDK build target: ${platform}-${arch}`);
  }
  const require = createRequire(resolve(repoRoot, "apps/zcode-cli/packages/adapters/package.json"));
  const sdkRoot = dirname(require.resolve("@anthropic-ai/claude-agent-sdk"));
  const metadata = JSON.parse(await readFile(join(sdkRoot, "package.json"), "utf8"));
  const suffix = platform === "linux" && libc === "musl" ? "-musl" : "";
  const name = `@anthropic-ai/claude-agent-sdk-${platform}-${arch}${suffix}`;
  const filename = platform === "win32" ? "claude.exe" : "claude";
  const version = metadata.optionalDependencies?.[name];
  if (typeof version !== "string" || version !== metadata.version)
    throw new Error("SDK runtime version mismatch");
  try {
    const path = require.resolve(`${name}/${filename}`);
    await access(path);
    return { path, name, version, filename };
  } catch (error) {
    if (!error || !("code" in error) || !["MODULE_NOT_FOUND", "ENOENT"].includes(error.code))
      throw error;
  }
  // 交叉打包不应安装全部平台的大文件；固定版本依赖只放在构建缓存中，pnpm 校验下载完整性。
  const cache = resolve(
    repoRoot,
    "node_modules/.cache/claude-sdk-runtime",
    `${platform}-${arch}${suffix}`,
    version,
  );
  await mkdir(cache, { recursive: true });
  const manifest = join(cache, "package.json");
  await writeFile(manifest, JSON.stringify({ private: true, dependencies: { [name]: version } }));
  const binary = join(cache, "node_modules", ...name.split("/"), filename);
  try {
    await access(binary);
  } catch {
    await runCommand(
      process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      ["install", "--ignore-workspace", "--ignore-scripts", "--force"],
      { cwd: cache, env: process.env },
    );
    await access(binary);
  }
  return { path: binary, name, version, filename };
}

export async function stageClaudeSdkRuntime({ repoRoot, platformKey, destination }) {
  const [platform, arch] = platformKey.split("-");
  const asset = await resolveClaudeSdkRuntimeAsset({ repoRoot, platform, arch });
  const target = join(destination, "claude-sdk", asset.filename);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(asset.path, target);
  if (platform !== "win32") await chmod(target, 0o755);
  await writeFile(
    join(dirname(target), "runtime.json"),
    JSON.stringify({ package: asset.name, version: asset.version }),
  );
  return target;
}
