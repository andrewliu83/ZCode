import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SkillMetadata } from "@zcode/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepareClaudeSkillPlugins } from "../src/agent-kernel/skills.js";
import { createNodeSkillAdapter } from "../src/skills/index.js";

let root: string;
let cache: string;
const directoryLinkType = process.platform === "win32" ? "junction" : "dir";

async function skill(directory: string, body: string, pluginName?: string): Promise<SkillMetadata> {
  await mkdir(directory, { recursive: true });
  const path = join(directory, "SKILL.md");
  await writeFile(path, `---\nname: leanrea\ndescription: Fixture\n---\n${body}\n`);
  return {
    name: "leanrea",
    description: "Fixture",
    path,
    directory,
    rootPath: directory,
    scope: "user",
    source: pluginName ? "plugin" : "zcode",
    pluginName,
    safeToAutoLoad: false,
    frontmatterKeys: ["name", "description"],
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "zcode-native-skills-"));
  cache = join(root, "cache");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("native skill plugin projection", () => {
  it("projects duplicate user root links to one real directory without modifying imports", async () => {
    const source = join(root, "library", "leanrea");
    await skill(source, "Shared instructions");
    await writeFile(join(source, "reference.txt"), "Shared resource");
    const home = join(root, "home");
    const links = [
      join(home, ".zcode", "skills", "leanrea"),
      join(home, ".agents", "skills", "leanrea"),
    ];
    for (const link of links) {
      await mkdir(join(link, ".."), { recursive: true });
      await symlink(source, link, directoryLinkType);
    }
    const adapter = createNodeSkillAdapter({ homeDirectory: home });
    const snapshot = await adapter.discoverSkills({ workingDirectory: root });
    expect(snapshot.skills).toHaveLength(2);
    const [plugin] = await prepareClaudeSkillPlugins(snapshot.skills, cache);
    const projected = join(plugin!, "skills", "leanrea");
    expect((await lstat(projected)).isSymbolicLink()).toBe(false);
    expect(await readFile(join(projected, "SKILL.md"), "utf8")).toBe(
      await readFile(join(source, "SKILL.md"), "utf8"),
    );
    expect(await readFile(join(projected, "reference.txt"), "utf8")).toBe("Shared resource");
    for (const link of links) {
      expect((await lstat(link)).isSymbolicLink()).toBe(true);
      expect(await realpath(link)).toBe(await realpath(source));
    }
    expect(await readdir(source)).toEqual(["SKILL.md", "reference.txt"]);
    expect(await readdir(join(cache, "zcode"))).toEqual([plugin!.split(/[\\/]/u).at(-1)]);
  });

  it("materializes a single root link and keeps cached content independent of the source", async () => {
    const original = await skill(join(root, "library", "leanrea"), "Original");
    const link = join(root, "imported");
    await symlink(original.directory, link, directoryLinkType);
    const linked = { ...original, path: join(link, "SKILL.md"), directory: link };
    const first = await prepareClaudeSkillPlugins([linked], cache);
    expect((await lstat(join(first[0]!, "skills", "leanrea"))).isSymbolicLink()).toBe(false);
    await writeFile(original.path, "Changed instructions");
    expect(await readFile(join(first[0]!, "skills", "leanrea", "SKILL.md"), "utf8")).toContain(
      "Original",
    );
    expect(await prepareClaudeSkillPlugins([linked], cache)).not.toEqual(first);
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
  });

  it("selects the first same-name skill without merging lower-priority resources", async () => {
    const first = await skill(join(root, "first"), "First priority");
    const second = await skill(join(root, "second"), "Lower priority");
    await writeFile(join(first.directory, "selected.txt"), "selected");
    await writeFile(join(second.directory, "shadowed.txt"), "shadowed");
    const [plugin] = await prepareClaudeSkillPlugins([first, second], cache);
    expect(await readFile(join(plugin!, "skills", "leanrea", "SKILL.md"), "utf8")).toContain(
      "First priority",
    );
    expect(await readdir(join(plugin!, "skills", "leanrea"))).toEqual(["SKILL.md", "selected.txt"]);
    expect(await prepareClaudeSkillPlugins([first], cache)).toEqual([plugin]);
    const [reversed] = await prepareClaudeSkillPlugins([second, first], cache);
    expect(reversed).not.toBe(plugin);
    expect(await readFile(join(reversed!, "skills", "leanrea", "SKILL.md"), "utf8")).toContain(
      "Lower priority",
    );
  });

  it("filters excluded descendants without rejecting the resolved root's ancestors", async () => {
    const original = await skill(
      join(root, "library", "node_modules", "package", "leanrea"),
      "Imported",
    );
    await mkdir(join(original.directory, "node_modules", "nested"), { recursive: true });
    await writeFile(join(original.directory, "node_modules", "nested", "ignored.txt"), "ignored");
    await mkdir(join(original.directory, "references"));
    await writeFile(join(original.directory, "references", "kept.txt"), "kept");
    const link = join(root, "imported");
    await symlink(original.directory, link, directoryLinkType);
    const [plugin] = await prepareClaudeSkillPlugins(
      [{ ...original, directory: link, path: join(link, "SKILL.md") }],
      cache,
    );
    expect(await readFile(join(plugin!, "skills", "leanrea", "SKILL.md"), "utf8")).toContain(
      "Imported",
    );
    expect(await readdir(join(plugin!, "skills", "leanrea"))).toEqual(["SKILL.md", "references"]);
    expect(
      await readFile(join(plugin!, "skills", "leanrea", "references", "kept.txt"), "utf8"),
    ).toBe("kept");
  });

  it("keeps identical names in different plugins and reuses complete cache entries", async () => {
    const first = await skill(join(root, "first"), "Plugin A", "alpha");
    const second = await skill(join(root, "second"), "Plugin B", "beta");
    const plugins = await prepareClaudeSkillPlugins([first, second], cache);
    expect(plugins).toHaveLength(2);
    expect(await readFile(join(plugins[0]!, "skills", "leanrea", "SKILL.md"), "utf8")).toContain(
      "Plugin A",
    );
    expect(await readFile(join(plugins[1]!, "skills", "leanrea", "SKILL.md"), "utf8")).toContain(
      "Plugin B",
    );
    expect(await prepareClaudeSkillPlugins([first, second], cache)).toEqual(plugins);
  });

  it("does not reuse a completed legacy cache that contains skill root links", async () => {
    const entry = await skill(join(root, "library", "leanrea"), "Current");
    const content = await readFile(entry.path, "utf8");
    const oldDigest = createHash("sha256")
      .update(JSON.stringify([{ path: entry.path, content }]))
      .digest("hex");
    const legacy = join(cache, "zcode", oldDigest);
    await mkdir(join(legacy, ".claude-plugin"), { recursive: true });
    await writeFile(
      join(legacy, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "zcode", version: "1.0.0" }),
    );
    await mkdir(join(legacy, "skills"));
    await symlink(entry.directory, join(legacy, "skills", "leanrea"), directoryLinkType);
    const [plugin] = await prepareClaudeSkillPlugins([entry], cache);
    expect(plugin).not.toBe(legacy);
    expect((await lstat(join(plugin!, "skills", "leanrea"))).isSymbolicLink()).toBe(false);
    expect((await lstat(join(legacy, "skills", "leanrea"))).isSymbolicLink()).toBe(true);
  });

  it("cleans staging on failure and supports a subsequent successful projection", async () => {
    const entry = await skill(join(root, "source"), "Valid");
    const missing = { ...entry, directory: join(root, "missing") };
    await expect(prepareClaudeSkillPlugins([missing], cache)).rejects.toThrow();
    expect((await readdir(join(cache, "zcode"))).filter((name) => name.includes(".tmp-"))).toEqual(
      [],
    );
    const [plugin] = await prepareClaudeSkillPlugins([entry], cache);
    expect(await readFile(join(plugin!, "skills", "leanrea", "SKILL.md"), "utf8")).toContain(
      "Valid",
    );
  });

  it("publishes concurrent identical projections without leaving staging entries", async () => {
    const entry = await skill(join(root, "source"), "Concurrent");
    const results = await Promise.all(
      Array.from({ length: 3 }, () => prepareClaudeSkillPlugins([entry], cache)),
    );
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
    expect(await readdir(join(cache, "zcode"))).toHaveLength(1);
  });
});
