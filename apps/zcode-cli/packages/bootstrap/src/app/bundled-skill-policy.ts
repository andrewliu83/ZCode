import type { SkillLoadOutcome, SkillMetadata } from "@zcode/contracts";
import { DYNAMIC_WORKFLOW_SKILL_NAME, THINKRAIL_SKILL_NAMES } from "./bundled-skills.js";

export function filterBundledSkillCatalog(
  outcome: SkillLoadOutcome,
  policy: {
    thinkrailEnabled: boolean;
    dynamicWorkflowEnabled: boolean;
  },
): SkillLoadOutcome {
  const skills = outcome.skills.filter((skill: SkillMetadata) => {
    if (skill.source !== "bundled") return true;
    if (THINKRAIL_SKILL_NAMES.includes(skill.name)) return policy.thinkrailEnabled;
    if (skill.name === DYNAMIC_WORKFLOW_SKILL_NAME) return policy.dynamicWorkflowEnabled;
    return true;
  });
  return {
    ...outcome,
    skills,
    totalDiscovered: outcome.totalDiscovered - (outcome.skills.length - skills.length),
  };
}
