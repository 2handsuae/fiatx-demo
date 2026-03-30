import { Prisma } from '@prisma/client';

export function normalizeCompatibilityString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized.length ? normalized : null;
}

export function getCanonicalIncidentAssigneeUserId(row: {
  assigneeUserId?: string | null;
  ownerUserId?: string | null;
}): string | null {
  return (
    normalizeCompatibilityString((row as any).assigneeUserId) ||
    normalizeCompatibilityString((row as any).ownerUserId)
  );
}

export function getCanonicalIncidentAssigneeUserNo(row: {
  assigneeUserNo?: string | null;
  ownerUserNo?: string | null;
}): string | null {
  return (
    normalizeCompatibilityString((row as any).assigneeUserNo) ||
    normalizeCompatibilityString((row as any).ownerUserNo)
  );
}

export function buildCanonicalIncidentAssigneeWhere(
  assigneeUserId?: string | null,
): Prisma.ComplianceIncidentWhereInput | null {
  const normalized = normalizeCompatibilityString(assigneeUserId);
  if (!normalized) return null;

  return {
    ownerUserId: normalized,
  };
}
