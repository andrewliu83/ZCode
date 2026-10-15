// ============================================================
// Claude-compatible skill matching catalog (docs/agent-kernel-and-skills.md)
// ============================================================

import type { SkillLoadOutcome, SkillMetadata } from "@zcode/contracts";
import type { ContextSection } from "../types.js";
import { estimateTokens } from "../utils.js";

export const DEFAULT_SKILL_LISTING_BUDGET_FRACTION = 0.01;
export const DEFAULT_SKILL_LISTING_MAX_DESCRIPTION_CHARS = 1536;
const DEFAULT_CONTEXT_WINDOW = 200_000;
const CHARS_PER_TOKEN = 4;
const CATALOG_HEADER = "The following skills are available for use with the Skill tool:\n\n";

export interface SkillsSectionOptions {
  outcome: SkillLoadOutcome;
  metadataBudget?: number;
  contextWindow?: number;
  listingBudgetFraction?: number;
  maxDescriptionChars?: number;
}

export function buildSkillsSection(options: SkillsSectionOptions): ContextSection | null {
  const skills = options.outcome.skills.filter(
    (skill) => skill.policy?.allowImplicitInvocation !== false,
  );
  if (skills.length === 0) return null;
  const fraction = options.listingBudgetFraction ?? DEFAULT_SKILL_LISTING_BUDGET_FRACTION;
  const limit = options.maxDescriptionChars ?? DEFAULT_SKILL_LISTING_MAX_DESCRIPTION_CHARS;
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1) {
    throw new RangeError("skillListingBudgetFraction must be greater than 0 and at most 1");
  }
  if (!Number.isInteger(limit) || limit < 1)
    throw new RangeError("skillListingMaxDescChars must be a positive integer");
  const window =
    options.contextWindow && Number.isFinite(options.contextWindow) && options.contextWindow > 0
      ? options.contextWindow
      : DEFAULT_CONTEXT_WINDOW;
  const budget = options.metadataBudget ?? Math.floor(window * fraction * CHARS_PER_TOKEN);
  if (!Number.isFinite(budget) || budget < 0)
    throw new RangeError("skill metadata character budget must be nonnegative");
  const content = buildSkillsContent(skills, Math.floor(budget), limit);
  return {
    name: "Skills",
    source: "skills",
    injectionTarget: "meta_user",
    cacheHint: "dynamic",
    chars: content.length,
    tokens: estimateTokens(content),
    content,
    preview: content.slice(0, 100),
  };
}

function buildSkillsContent(skills: SkillMetadata[], budget: number, limit: number): string {
  const sorted = [...skills].sort((a, b) => displayName(a).localeCompare(displayName(b)));
  const lines = sorted.map((skill) => {
    const description = [skill.description, skill.whenToUse]
      .filter(Boolean)
      .join(" - ")
      .replace(/\s+/gu, " ")
      .trim();
    const text =
      description.length > limit ? description.slice(0, Math.max(0, limit - 1)) + "…" : description;
    return text ? `- ${displayName(skill)}: ${text}` : `- ${displayName(skill)}`;
  });
  let chars = CATALOG_HEADER.length + lines.join("\n").length;
  // 原因：整份超预算就丢掉所有描述会删除 FIRST 等匹配条件。
  // 按 Claude 的频率优先规则逐项裁剪；相同频率用稳定名字顺序，避免提示词随机抖动。
  const victims = sorted
    .map((skill, index) => ({ skill, index }))
    .sort(
      (a, b) =>
        (a.skill.invocationCount ?? 0) - (b.skill.invocationCount ?? 0) ||
        displayName(b.skill).localeCompare(displayName(a.skill)),
    );
  for (const { skill, index } of victims) {
    if (chars <= budget) break;
    const bare = `- ${displayName(skill)}`;
    chars -= lines[index]!.length - bare.length;
    lines[index] = bare;
  }
  // 名字是可调用事实；名字本身超过预算时也不能隐藏技能。
  return CATALOG_HEADER + lines.join("\n");
}

function displayName(skill: SkillMetadata): string {
  return skill.qualifiedName ?? skill.name;
}
