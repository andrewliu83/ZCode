import { join } from "node:path";
import type { SkillRoot } from "@zcode/contracts";
import { DYNAMIC_WORKFLOW_SKILL_NAME, THINKRAIL_SKILL_NAMES } from "./bundled-skills.js";

/**
 * 动态工作流灰度门在 App 装配层的技能减法（docs/dynamic-workflow/launch.md「Gray release」）。
 * 工具面的减法在 core 的 registerBuiltInTools，`/` 目录与 `/workflow` 展开的减法分别在
 * zcode-protocol/slash-commands.ts 与 builtin-prompt-command.ts；这里只放需要 bootstrap 侧路径推导的技能剔除。
 */

const SKILL_MANIFEST_FILE_NAME = "SKILL.md";

/**
 * 动态工作流关闭时要从技能发现中剔除的 SKILL.md 绝对路径。
 *
 * 为什么按路径而不是按 root 过滤：NodeSkillAdapter 只提供 `disabledPaths` 这一个剔除机制
 * （config.json 的 `skill.<path>.enable=false` 走的也是它）。传入的是内置技能包的根
 * （bundled-skills.ts），路径不存在时只是一个永不命中的 Set 成员，没有副作用；技能包日后再放
 * 与灰度无关的技能时，它们也不会被连坐。
 */
export function collectDynamicWorkflowDisabledSkillPaths(
  bundledSkillRoots: readonly SkillRoot[],
): string[] {
  return bundledSkillRoots.map((root) =>
    join(root.path, DYNAMIC_WORKFLOW_SKILL_NAME, SKILL_MANIFEST_FILE_NAME),
  );
}

/**
 * ThinkRail 总开关在 App 装配层的技能减法（docs/thinkrail/design.md D5/D2）。
 *
 * 与上面同构、同一条判据（`runtimeFeatures.thinkrail`）：工具面的减法在 core 的
 * registerBuiltInTools，常驻段的减法在 core 的 context section，这里补上技能发现这一处。
 * 关闭时不提供 `spec-graph` 技能 —— 七个 spec_* 工具都不在场，再让模型读到「怎么用这里的
 * spec 工具」只会诱导它去调不存在的工具。
 */
export function collectThinkrailDisabledSkillPaths(
  bundledSkillRoots: readonly SkillRoot[],
): string[] {
  // 整族一起下线：只藏 spec-graph 而留下 choosing-a-workflow，就让模型读到一个会把它路由到
  // speculative 技能的入口（那些技能同样不在），比一条都不给更糟。
  return bundledSkillRoots.flatMap((root) =>
    THINKRAIL_SKILL_NAMES.map((name) => join(root.path, name, SKILL_MANIFEST_FILE_NAME)),
  );
}
