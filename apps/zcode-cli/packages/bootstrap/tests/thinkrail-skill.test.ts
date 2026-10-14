// ============================================================
// ThinkRail 技能族：随内置技能包发布 + 相互引用完整 + 总开关整族下线
// ============================================================
// 契约见 docs/thinkrail/design.md D2 / D5。
//
// 这个文件守三件事：
//   1. 八个 workflow 技能 + spec-graph 都住在内置技能包，且每份都是必需资产（缺一拒绝整包）；
//   2. **技能之间的相互引用全部解析得到** —— 路由表点名 `brainstorming`、`setting-up-a-project`
//      点名 `starting-a-new-project`…… 一个名字写错就是一条静默失效的指令，和工具名写错一样致命；
//   3. 开关关闭时**整族**一起从技能发现里剔除，且不连坐同一技能包里的 dynamic-workflows。

import { readFile, readdir } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createNodeSkillAdapter } from "@zcode/adapters/skills";
import { describe, expect, it } from "vitest";
import {
  BUNDLED_SKILL_PACK_REQUIRED_PATHS,
  THINKRAIL_SKILL_FILES,
  THINKRAIL_SKILL_NAMES,
  THINKRAIL_SPEC_SKILL_NAME,
  resolveBundledSkillRoots,
} from "../src/app/bundled-skills.js";
import { collectThinkrailDisabledSkillPaths } from "../src/app/dynamic-workflow-gate.js";

const PACKAGES_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PACK_ROOT = join(PACKAGES_ROOT, "bundled-skills");
const SKILLS_DIR = join(PACK_ROOT, "skills");

/** adapters/src/skills/index.ts:20 —— 超长直接丢弃技能，不是警告。 */
const MAX_DESCRIPTION_LENGTH = 1024;

async function readSkill(skill: string, file = "SKILL.md"): Promise<string> {
  return readFile(join(SKILLS_DIR, skill, file), "utf8");
}

/** frontmatter 的单行双引号 description。 */
function descriptionOf(content: string): string {
  const match = content.match(/^description:\s*"([\s\S]*?)"$/m);
  if (!match?.[1]) throw new Error("SKILL.md 必须有单行双引号 description");
  return match[1];
}

describe("ThinkRail 技能族（内置技能包）", () => {
  it("九份技能都在包里，名字与清单一一对应", async () => {
    const entries = (await readdir(SKILLS_DIR, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect([...THINKRAIL_SKILL_NAMES].sort()).toEqual(
      [
        "asking-user-questions",
        "brainstorming",
        "choosing-a-workflow",
        "importing-a-codebase",
        "setting-up-a-project",
        "shipping-a-pr",
        "spec-graph",
        "starting-a-new-project",
        "writing-specs",
      ].sort(),
    );
    for (const name of THINKRAIL_SKILL_NAMES) expect(entries, name).toContain(name);
  });

  it("每份技能、以及它引用的每个附属文件，都是必需资产且真的在盘上", async () => {
    const pinned = new Set(BUNDLED_SKILL_PACK_REQUIRED_PATHS);
    for (const [skill, files] of Object.entries(THINKRAIL_SKILL_FILES)) {
      for (const file of files) {
        expect(pinned, `${skill}/${file}`).toContain(`skills/${skill}/${file}`);
        const content = await readSkill(skill, file);
        expect(content.length, `${skill}/${file}`).toBeGreaterThan(0);
      }
    }
  });

  it("ship 的附属文件与清单一致（多一个少一个都红）", async () => {
    for (const [skill, files] of Object.entries(THINKRAIL_SKILL_FILES)) {
      const shipped = (await readdir(join(SKILLS_DIR, skill))).sort();
      expect(shipped, skill).toEqual([...files].sort());
    }
  });

  it("描述不超适配器上限，且 SKILL.md 的 frontmatter 名字与目录名一致", async () => {
    for (const name of THINKRAIL_SKILL_NAMES) {
      const content = await readSkill(name);
      expect(content.startsWith("---\n"), name).toBe(true);
      expect(content, name).toContain(`name: ${name}`);
      expect(descriptionOf(content).length, name).toBeLessThan(MAX_DESCRIPTION_LENGTH);
    }
  });

  it("技能之间的相互引用全部解析得到（名字写错就是一条静默失效的指令）", async () => {
    // 握手图：每份技能必须点名谁。它同时是「路由表真的连到下游」的断言 —— 改名或写错名字在这里红，
    // 而不是让模型在运行时去找一个不存在的技能。
    const handoffs: Record<string, readonly string[]> = {
      "choosing-a-workflow": [
        "setting-up-a-project",
        "shipping-a-pr",
        "brainstorming",
        "asking-user-questions",
      ],
      "setting-up-a-project": [
        "starting-a-new-project",
        "importing-a-codebase",
        "brainstorming",
        "writing-specs",
      ],
      "starting-a-new-project": ["writing-specs", "asking-user-questions", "brainstorming"],
      "importing-a-codebase": [
        "writing-specs",
        "asking-user-questions",
        "setting-up-a-project",
        "spec-graph",
      ],
      brainstorming: ["spec-graph", "asking-user-questions", "writing-specs"],
      "shipping-a-pr": ["choosing-a-workflow"],
      "writing-specs": ["spec-graph"],
      "asking-user-questions": [],
      "spec-graph": [],
    };
    expect(Object.keys(handoffs).sort()).toEqual([...THINKRAIL_SKILL_NAMES].sort());
    for (const [skill, routes] of Object.entries(handoffs)) {
      const content = await readSkill(skill);
      for (const route of routes) {
        expect(content, `${skill} 应当点名 ${route}`).toContain(route);
      }
    }
  });

  it("正文里每一个「… skill」点名的都是族里的技能（没有指向族外的东西）", async () => {
    const known = new Set(THINKRAIL_SKILL_NAMES);
    // 泛指的短语不是点名：「the workflow skill that governs it」「the referencing skill」。
    const generic = new Set(["workflow", "referencing", "matching"]);
    // 「the foo-bar skill」「the **`foo-bar`** concept skill」——技能总是这样被点名。
    const reference = /\bthe\s+(?:\*\*)?`?([a-z][a-z0-9-]{2,})`?(?:\*\*)?(?:\s+concept)?\s+skill/gu;
    for (const [skill, files] of Object.entries(THINKRAIL_SKILL_FILES)) {
      for (const file of files) {
        const content = await readSkill(skill, file);
        for (const match of content.matchAll(reference)) {
          const named = match[1]!;
          if (generic.has(named)) continue;
          expect(known, `${skill}/${file} 点名了族外的技能: ${named}`).toContain(named);
        }
      }
    }
  });

  it("正文不残留 DSH 时代的宿主专名与工具名", async () => {
    for (const [skill, files] of Object.entries(THINKRAIL_SKILL_FILES)) {
      for (const file of files) {
        const content = await readSkill(skill, file);
        const where = `${skill}/${file}`;
        // 技能包是 ZCode 的，不是那个中间宿主插件的：草稿目录、插件措辞、工具名都要换过。
        expect(content, where).not.toContain(".dsh-thinkrail");
        expect(content, where).not.toContain("ask_user_question");
        expect(content, where).not.toContain("web_search");
        expect(content, where).not.toContain("web_fetch");
        expect(content, where).not.toContain("thinkrail_delegate");
        expect(content, where).not.toContain("mcp__");
      }
    }
  });

  it("开关关闭时整族下线，同一技能包里的其它技能不受影响", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "zcode-thinkrail-skills-"));
    try {
      const roots = resolveBundledSkillRoots({ cliStorageRoot: join(tempRoot, "cli") });
      const disabled = collectThinkrailDisabledSkillPaths(roots);
      expect(disabled.sort()).toEqual(
        roots
          .flatMap((root) => THINKRAIL_SKILL_NAMES.map((name) => join(root.path, name, "SKILL.md")))
          .sort(),
      );

      const adapter = createNodeSkillAdapter({
        extraResolvedRoots: roots,
        disabledPaths: disabled,
      });
      const names = (await adapter.discoverSkills({ workingDirectory: PACKAGES_ROOT })).skills.map(
        (skill) => skill.name,
      );
      for (const name of THINKRAIL_SKILL_NAMES) expect(names, name).not.toContain(name);
      // 不连坐：同一技能包里的 dynamic-workflows 仍然在。
      expect(names).toContain("dynamic-workflows");
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  });

  it("开关打开时整族都在（减法只在关掉时生效）", async () => {
    const roots = resolveBundledSkillRoots({ cliStorageRoot: join(PACKAGES_ROOT, "unused") });
    const adapter = createNodeSkillAdapter({ extraResolvedRoots: roots });
    const names = (await adapter.discoverSkills({ workingDirectory: PACKAGES_ROOT })).skills.map(
      (skill) => skill.name,
    );
    for (const name of THINKRAIL_SKILL_NAMES) expect(names, name).toContain(name);
    expect(THINKRAIL_SPEC_SKILL_NAME).toBe("spec-graph");
  });
});
