import { cp, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join, relative } from "node:path";
import type { SkillMetadata } from "@zcode/contracts";

/** 从已授权技能快照生成不可变的 SDK 插件资源；不修改用户目录。 */
export async function prepareClaudeSkillPlugins(
  skills: readonly SkillMetadata[],
  root: string,
): Promise<string[]> {
  const groups = new Map<string, Map<string, SkillMetadata>>();
  for (const skill of skills) {
    const name = skill.source === "bundled" ? "thinkrail" : (skill.pluginName ?? "zcode");
    if (!/^[a-zA-Z0-9_-]+$/u.test(name)) throw new Error("Invalid native skill plugin name");
    if (!/^[a-zA-Z0-9_-]+$/u.test(skill.name)) throw new Error("Invalid native skill name");
    const group = groups.get(name) ?? new Map<string, SkillMetadata>();
    // 发现快照保留同名安装项；SDK 只有一个 plugin/name 槽位，须与 loadSkill 一样选首项。
    if (!group.has(skill.name)) group.set(skill.name, skill);
    groups.set(name, group);
  }
  const roots: string[] = [];
  for (const [name, entries] of groups) {
    const sorted = Array.from(entries.values()).toSorted((a, b) => a.name.localeCompare(b.name));
    const contents = await Promise.all(
      sorted.map(async (entry) => ({ entry, content: await readFile(entry.path, "utf8") })),
    );
    const digest = createHash("sha256")
      .update(
        JSON.stringify({
          version: 2,
          skills: contents.map(({ entry, content }) => ({
            name: entry.name,
            path: entry.path,
            content,
          })),
        }),
      )
      .digest("hex");
    const destination = join(root, name, digest);
    const marker = join(destination, ".claude-plugin", "plugin.json");
    try {
      await readFile(marker);
      roots.push(destination);
      continue;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    const staging = `${destination}.tmp-${randomUUID()}`;
    await mkdir(join(staging, ".claude-plugin"), { recursive: true });
    try {
      for (const { entry } of contents) {
        // 只解析技能根链接，避免缓存保留指向源目录的别名，重复复制时误判为复制到自身。
        const sourceDirectory = await realpath(entry.directory);
        await cp(sourceDirectory, join(staging, "skills", entry.name), {
          recursive: true,
          filter: (source) =>
            !/(?:^|[/\\])(?:node_modules|\.git|\.venv|__pycache__)(?:[/\\]|$)/u.test(
              relative(sourceDirectory, source),
            ),
        });
      }
      await writeFile(
        join(staging, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name, version: "1.0.0" }),
      );
      await mkdir(join(root, name), { recursive: true });
      try {
        await rename(staging, destination);
      } catch (error) {
        if (
          !(
            error instanceof Error &&
            "code" in error &&
            (error.code === "ENOTEMPTY" || error.code === "EEXIST")
          )
        )
          throw error;
      }
      roots.push(destination);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
  return roots;
}
