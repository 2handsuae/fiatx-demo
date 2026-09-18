export interface AudienceInput {
  requiredTagsJson: string;
  validFrom: Date | null;
  validTo: Date | null;
}

export function matchesAudience(level: AudienceInput, effectiveTags: Set<string>, now: Date): boolean {
  if (level.validFrom && now < level.validFrom) return false;
  if (level.validTo && now > level.validTo) return false;
  const req: string[] = JSON.parse(level.requiredTagsJson || '[]');
  return req.every((t) => effectiveTags.has(t));
}
