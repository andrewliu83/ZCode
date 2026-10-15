// ============================================================
// ThinkRail 常驻段（spec ground truth + workflow 路由）
// ============================================================
// 两条常驻规则保留指针，spec 判据与路由表仍以技能文件为唯一来源。
// Runtime 从 SkillPort 加载可信入口正文，再附于同一只读段，避免目录裁剪后入口不可见。
//
// 两条规则独立判断工具能力，不依赖工作区是否已有 spec，与 DSH 常驻注入一致。
// 两条规则都需要 Skill 工具；spec 规则还需要读侧工具。
//
// 与 builtInTools 的算子（handlers/index.ts）**各自独立**：技能减法是计划中的第三处（P4）。
// 三处共同的判据只有一条 —— `runtimeFeatures.thinkrail === true`。

import type { SkillContent } from "@zcode/contracts";
import type { ContextSection } from "../types.js";
import { estimateTokens } from "../utils.js";

/** spec 读侧三件：本段主体内容所需的锚点（不用「全部都要」）。 */
const THINKRAIL_SECTION_ANCHORS = ["spec_grep", "spec_get", "spec_graph"] as const;

/** anchor 常量与 @zcode/contracts 的工具名同字面；漂移由 core 的 thinkrail-spec-tools.test.ts 守住。 */

export interface ThinkrailSectionOptions {
  /** 开关和 scope 能力分别决定两条规则是否注入。 */
  readonly enabled: boolean;
  readonly toolNames: readonly string[];
  readonly specRule: string;
  readonly formatRules?: (content: string) => string;
  readonly preloadedSkills?: readonly SkillContent[];
  readonly workflowRule: string;
}

export function thinkrailEntrySkillNames(enabled: boolean, toolNames: readonly string[]): string[] {
  if (!enabled || !toolNames.includes("Skill")) return [];
  return [
    "choosing-a-workflow",
    ...(THINKRAIL_SECTION_ANCHORS.every((name) => toolNames.includes(name)) ? ["spec-graph"] : []),
  ];
}

export function renderPreloadedThinkrailSkills(skills: readonly SkillContent[] = []): string {
  if (!skills.length) return "";
  return [
    "## Runtime-loaded ThinkRail entry skills",
    "The Runtime has already loaded these instructions. Follow choosing-a-workflow first; use spec-graph for graph checks. Do not invoke Skill merely to reload these entry instructions. Load downstream workflow skills normally. This is context loading, not a model tool invocation. This workflow entry belongs to the top-level conversation owner; delegated subagents must stay within their assigned task and must not independently initialize the parent project. Use the available namespaced skill and tool equivalents when a catalog qualifies the source names.",
    ...skills.map((skill) =>
      [
        `<preloaded_skill name="${skill.metadata.name}">`,
        skill.content.replace(
          /\$\{(CLAUDE_SKILL_DIR|ZCODE_SKILL_DIR)\}/gu,
          () => skill.baseDirectory,
        ),
        `Base directory for this skill: ${skill.baseDirectory}`,
        "Relative paths in this skill are relative to this base directory.",
        "</preloaded_skill>",
      ].join("\n\n"),
    ),
  ].join("\n\n");
}

export function buildThinkrailSection(options: ThinkrailSectionOptions): ContextSection | null {
  if (!options.enabled) return null;
  const tools = new Set(options.toolNames);
  // DSH 在无 spec 的项目也注入先查图规则；hasSpec 门槛会使首次导入跳过这一步。
  // 保留工具能力门控，避免给受限 scope 注入无法加载技能或查询 spec 的指令。
  const rules = [
    ...(tools.has("Skill") && THINKRAIL_SECTION_ANCHORS.every((name) => tools.has(name))
      ? [options.specRule]
      : []),
    ...(tools.has("Skill") ? [options.workflowRule] : []),
  ];
  if (rules.length === 0) return null;
  const allowed = thinkrailEntrySkillNames(options.enabled, options.toolNames);
  const preloaded = renderPreloadedThinkrailSkills(
    options.preloadedSkills?.filter(
      (skill) => skill.metadata.source === "bundled" && allowed.includes(skill.metadata.name),
    ),
  );
  const content = [...rules.map((rule) => options.formatRules?.(rule) ?? rule), preloaded]
    .filter(Boolean)
    .join("\n\n");
  return {
    name: "ThinkRail",
    source: "thinkrail",
    injectionTarget: "system",
    cacheHint: "dynamic",
    chars: content.length,
    tokens: estimateTokens(content),
    content,
    preview: content.slice(0, 100),
  };
}
