export const DEFAULT_SKILL_LISTING_BUDGET_FRACTION = 0.01;
export const DEFAULT_SKILL_LISTING_MAX_DESCRIPTION_CHARS = 1536;
const DEFAULT_CONTEXT_WINDOW = 200_000;
const CHARS_PER_TOKEN = 4;

export interface SkillListingPolicyOptions {
  metadataBudget?: number;
  contextWindow?: number;
  listingBudgetFraction?: number;
  maxDescriptionChars?: number;
}

/** Runtime 解析一次本轮事实；各内核消费相同预算，不从模型名猜容量。 */
export interface SkillListingPolicy {
  characterBudget: number;
  maxDescriptionChars: number;
}

export function resolveSkillListingPolicy(
  options: SkillListingPolicyOptions = {},
): SkillListingPolicy {
  const fraction = options.listingBudgetFraction ?? DEFAULT_SKILL_LISTING_BUDGET_FRACTION;
  const limit = options.maxDescriptionChars ?? DEFAULT_SKILL_LISTING_MAX_DESCRIPTION_CHARS;
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1)
    throw new RangeError("skillListingBudgetFraction must be greater than 0 and at most 1");
  if (!Number.isInteger(limit) || limit < 1)
    throw new RangeError("skillListingMaxDescChars must be a positive integer");
  const window =
    options.contextWindow && Number.isFinite(options.contextWindow) && options.contextWindow > 0
      ? options.contextWindow
      : DEFAULT_CONTEXT_WINDOW;
  const budget = options.metadataBudget ?? Math.floor(window * fraction * CHARS_PER_TOKEN);
  if (!Number.isFinite(budget) || budget < 0)
    throw new RangeError("skill metadata character budget must be nonnegative");
  return { characterBudget: Math.floor(budget), maxDescriptionChars: limit };
}
