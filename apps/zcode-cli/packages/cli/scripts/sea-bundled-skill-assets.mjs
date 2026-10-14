import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

// 随 CLI 内置的技能包（apps/zcode-cli/packages/bundled-skills）。它不是官方插件：不进市场目录、
// 没有版本身份，运行时按内容 hash 解压到 `<cli storage>/bundled-skills/<hash>/`
// （bootstrap/src/app/bundled-skills.ts）。这里的 manifest 形状与那边的读取逐字对应。
export const seaBundledSkillAssetPrefix = "zcode-bundled-skills/";
export const seaBundledSkillManifestAssetKey = `${seaBundledSkillAssetPrefix}manifest.json`;
export const bundledSkillPackRootPath = join("packages", "bundled-skills");
export const bundledSkillPackSkillsDirectory = "skills";
// 与 bootstrap 的 BUNDLED_SKILL_PACK_REQUIRED_PATHS **逐字相等**（缺任一项即中止 SEA 构建，
// 不把一个引用文件残缺的技能包发进正式二进制；运行时那边同样按这份清单拒绝整包，
// 所以构建期漏过就意味着运行时连 /workflow 一起消失）。
//
// 两份清单为什么不合成一份：这里跑在 pnpm 构建的脚本上下文里，bootstrap 那份住在 TS 源码中，
// 直接 import 会把脚本绑上「bootstrap 的 dist 必须先构建」。改为由测试守住相等：
// packages/bootstrap/tests/bundled-skills.test.ts 的「两份必需资产清单逐字相等」。
export const bundledSkillPackRequiredPaths = [
  "skills/dynamic-workflows/SKILL.md",
  "skills/dynamic-workflows/patterns.md",
  "skills/dynamic-workflows/examples.md",
  "skills/spec-graph/SKILL.md",
  "skills/choosing-a-workflow/SKILL.md",
  "skills/brainstorming/SKILL.md",
  "skills/writing-specs/SKILL.md",
  "skills/asking-user-questions/SKILL.md",
  "skills/setting-up-a-project/SKILL.md",
  "skills/starting-a-new-project/SKILL.md",
  "skills/importing-a-codebase/SKILL.md",
  "skills/shipping-a-pr/SKILL.md",
  "skills/shipping-a-pr/checks.md",
  "skills/shipping-a-pr/creating.md",
  "skills/shipping-a-pr/review-comments.md",
  "skills/shipping-a-pr/screenshots.md",
  "skills/shipping-a-pr/syncing.md",
];

export const collectSeaBundledSkillAssets = async ({ root, stagingDirectory }) => {
  const packRoot = resolve(root, bundledSkillPackRootPath);
  assertBundledSkillPack(packRoot);

  await rm(stagingDirectory, { force: true, recursive: true });

  const files = [];
  const assets = {};
  for await (const sourcePath of walkFiles(join(packRoot, bundledSkillPackSkillsDirectory))) {
    const relativePath = relative(packRoot, sourcePath);
    if (!shouldIncludeFile(relativePath)) continue;
    const bytes = await readFile(sourcePath);
    const sourceStats = await stat(sourcePath);
    const posixPath = toPosixPath(relativePath);
    assets[`${seaBundledSkillAssetPrefix}${posixPath}`] = sourcePath;
    files.push({
      mode: modeForFile(sourceStats.mode),
      path: posixPath,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  files.sort((left, right) => left.path.localeCompare(right.path));

  const manifest = {
    hash: createHash("sha256")
      .update(JSON.stringify(files.map(({ path, sha256, mode }) => [path, sha256, mode])))
      .digest("hex"),
    files,
    version: 1,
  };
  const manifestPath = resolve(stagingDirectory, "bundled-skills-manifest.json");
  await mkdir(stagingDirectory, { recursive: true });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  assets[seaBundledSkillManifestAssetKey] = manifestPath;

  return { assets, manifest };
};

function assertBundledSkillPack(packRoot) {
  if (!existsSync(join(packRoot, bundledSkillPackSkillsDirectory))) {
    throw new Error(`Missing bundled skill pack at ${packRoot}`);
  }
  for (const relativePath of bundledSkillPackRequiredPaths) {
    const assetPath = join(packRoot, ...relativePath.split("/"));
    if (!existsSync(assetPath)) {
      throw new Error(`Missing bundled skill pack required asset at ${assetPath}`);
    }
  }
}

async function* walkFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".turbo") continue;
    const fullPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(fullPath);
      continue;
    }
    if (entry.isFile()) yield fullPath;
  }
}

const shouldIncludeFile = (relativePath) => !relativePath.split(sep).includes(".DS_Store");

const toPosixPath = (value) => value.split(sep).join("/");

const modeForFile = (sourceMode) => ((sourceMode & 0o111) !== 0 ? 0o755 : 0o644);
