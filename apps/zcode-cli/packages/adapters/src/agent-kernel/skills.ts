import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import type { SkillMetadata } from "@zcode/contracts";

/** 从已授权技能快照生成不可变的 SDK 插件资源；不修改用户目录。 */
export async function prepareClaudeSkillPlugins(
  skills: readonly SkillMetadata[],
  root: string,
): Promise<string[]> {
  const groups = new Map<string, SkillMetadata[]>();
  for (const skill of skills) {
    const name = skill.source === "bundled" ? "thinkrail" : (skill.pluginName ?? "zcode");
    if (!/^[a-zA-Z0-9_-]+$/u.test(name)) throw new Error("Invalid native skill plugin name");
    const group = groups.get(name) ?? [];
    group.push(skill);
    groups.set(name, group);
  }
  const roots: string[] = [];
  for (const [name, entries] of groups) {
    const sorted = entries.toSorted((a, b) => a.name.localeCompare(b.name));
    const contents = await Promise.all(
      sorted.map(async (entry) => ({ entry, content: await readFile(entry.path, "utf8") })),
    );
    const digest = createHash("sha256")
      .update(JSON.stringify(contents.map(({ entry, content }) => ({ path: entry.path, content }))))
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
        if (!/^[a-zA-Z0-9_-]+$/u.test(entry.name)) throw new Error("Invalid native skill name");
        await cp(entry.directory, join(staging, "skills", entry.name), {
          recursive: true,
          filter: (source) =>
            !/(?:^|[/\\])(?:node_modules|\.git|\.venv|__pycache__)(?:[/\\]|$)/u.test(source),
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
