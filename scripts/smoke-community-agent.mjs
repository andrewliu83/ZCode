import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { COMMUNITY_DISTRIBUTION } from "./community-distribution.mjs";
import { resolveCommunityReleaseTarget } from "./community-release-targets.mjs";
import { runReleaseCommand } from "./apple-signing.mjs";

/** 直接使用随包 Electron Node 执行 Agent；不启动 UI、不发送模型请求，也不使用用户数据目录。 */
export async function smokeCommunityAgent({
  appPath,
  productName = COMMUNITY_DISTRIBUTION.name,
  os,
  env = process.env,
}) {
  const target = resolveCommunityReleaseTarget(os);
  const executable =
    target.os === "mac"
      ? resolve(appPath, "Contents/MacOS", productName)
      : resolve(
          appPath,
          target.os === "win" ? `${productName}.exe` : COMMUNITY_DISTRIBUTION.executableName,
        );
  const agent = resolve(appPath, target.resources, "glm/zcode.cjs");
  const dataBaseDir = await mkdtemp(join(tmpdir(), "community-agent-smoke-"));
  try {
    const output = await runReleaseCommand(executable, [agent, "--version"], {
      cwd: dataBaseDir,
      capture: true,
      timeout: 60_000,
      env: { ...env, ELECTRON_RUN_AS_NODE: "1", ZCODE_DATA_BASE_DIR: dataBaseDir },
    });
    const version = output.match(/\b\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\b/)?.[0];
    if (!version) throw new Error("Packaged Agent did not report a version");
    return version;
  } finally {
    await rm(dataBaseDir, { recursive: true, force: true });
  }
}
