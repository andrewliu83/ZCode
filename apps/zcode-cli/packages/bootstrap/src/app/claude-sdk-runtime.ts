import { access, chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";

export const SEA_CLAUDE_SDK_RUNTIME_KEY = "zcode/claude-sdk/runtime";

/** SEA 只解包构建时嵌入的 SDK 资源；普通 Node 交给 SDK 解析它的应用依赖。 */
export async function resolveClaudeSdkExecutable(
  env: NodeJS.ProcessEnv | undefined,
  storageRoot: string,
): Promise<string | undefined> {
  const applicationRuntime = env?.ZCODE_CLAUDE_SDK_RUNTIME_PATH;
  if (applicationRuntime) {
    await access(applicationRuntime);
    return applicationRuntime;
  }
  const sea = process.getBuiltinModule("node:sea");
  if (!sea?.isSea()) return undefined;
  if (!sea.getAssetKeys().includes(SEA_CLAUDE_SDK_RUNTIME_KEY))
    throw new Error("Bundled Claude SDK runtime is missing");
  const bytes = Buffer.from(sea.getAsset(SEA_CLAUDE_SDK_RUNTIME_KEY));
  const hash = createHash("sha256").update(bytes).digest("hex");
  const target = join(
    storageRoot,
    "native-kernels",
    "runtime",
    hash,
    process.platform === "win32" ? "claude.exe" : "claude",
  );
  try {
    await access(target);
    return target;
  } catch {}
  await mkdir(join(storageRoot, "native-kernels", "runtime", hash), { recursive: true });
  const staging = `${target}.tmp-${randomUUID()}`;
  try {
    await writeFile(staging, bytes);
    if (process.platform !== "win32") await chmod(staging, 0o755);
    await rename(staging, target);
  } finally {
    await rm(staging, { force: true });
  }
  return target;
}
