import { MaterialRefreshPolicy } from './material-refresh-policy';

export function getRequiredMaterialsForTier(
  tier: string,
  policy: MaterialRefreshPolicy,
): string[] {
  const required: string[] = [];
  for (const [materialType, config] of Object.entries(policy.materials)) {
    if (config.alternativeOf) continue; // skip alternatives (PASSPORT is alt of EMIRATES_ID)
    if (config.requiredForTiers.includes(tier)) {
      required.push(materialType);
    }
  }
  return required;
}
