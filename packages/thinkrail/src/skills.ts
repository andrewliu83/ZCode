/** ThinkRail 的 spec-graph 技能名（docs/thinkrail/design.md D5）。 */
export const THINKRAIL_SPEC_SKILL_NAME = "spec-graph";

/**
 * ThinkRail 随包发布的技能族（docs/thinkrail/design.md D5）：一个 spec-graph 概念技能 +
 * 八个 workflow 技能。它们不是各自独立的可选技能 —— 开关一关，整族一起下线（减法见
 * dynamic-workflow-gate.ts 的 collectThinkrailDisabledSkillPaths）。
 *
 * `shipping-a-pr` 另带五份阶段文档，由它的 SKILL.md 按名引用（Skill 工具的输出外壳会给出
 * Base directory，按名读到的是同一个目录）。所以这里的清单是「技能 → 它引用的每个文件」，
 * 不是「技能 → SKILL.md」。
 */
export const THINKRAIL_SKILL_FILES: Readonly<Record<string, readonly string[]>> = {
  [THINKRAIL_SPEC_SKILL_NAME]: ["SKILL.md"],
  "choosing-a-workflow": ["SKILL.md"],
  brainstorming: ["SKILL.md"],
  "writing-specs": ["SKILL.md"],
  "asking-user-questions": ["SKILL.md"],
  "setting-up-a-project": ["SKILL.md"],
  "starting-a-new-project": ["SKILL.md"],
  "importing-a-codebase": ["SKILL.md"],
  "shipping-a-pr": [
    "SKILL.md",
    "checks.md",
    "creating.md",
    "review-comments.md",
    "screenshots.md",
    "syncing.md",
  ],
};

/** 技能族里的技能名（供技能减法与测试遍历）。 */
export const THINKRAIL_SKILL_NAMES = Object.keys(THINKRAIL_SKILL_FILES);
