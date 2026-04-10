import { MaterialRefreshPolicy } from './material-refresh-policy';

export function getRequiredMaterialsForLevel(
  levelName: string,
  policy: MaterialRefreshPolicy,
): string[] {
  const required: string[] = [];
  for (const [materialType, config] of Object.entries(policy.materials)) {
    if (config.alternativeOf) continue; // skip alternatives
    if (config.requiredForLevels.includes(levelName)) {
      required.push(materialType);
    }
  }
  return required;
}
