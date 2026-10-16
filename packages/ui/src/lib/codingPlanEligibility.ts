import { BUILTIN_MODEL_PROVIDER_IDS } from "@zcode/shared";
import type { ProviderSettingsView } from "@zcode/services";

const codingPlanIds: readonly string[] = [
  BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
  BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
  BUILTIN_MODEL_PROVIDER_IDS.zaiTeamCodingPlan,
  BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan,
];

/** 闲时任务依据连接的套餐权益，不再依赖购买漏斗的分析状态。 */
export function hasCodingPlanEntitlement(view: ProviderSettingsView | null): boolean {
  return (
    view?.providers.some(
      (provider) =>
        provider.effectiveConfig.access?.type === "zhipu-account" &&
        provider.effectiveConfig.access.entitled === true &&
        codingPlanIds.includes(provider.providerId),
    ) ?? false
  );
}
