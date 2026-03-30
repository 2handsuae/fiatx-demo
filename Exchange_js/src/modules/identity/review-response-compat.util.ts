type CaseType = 'CDD' | 'EDD';

export function projectResponseRecord<T extends { caseNo?: string | null }>(
  row: T,
  responseType: CaseType,
): Omit<T, 'caseNo'> & {
  responseNo: string | null;
  responseType: CaseType;
} {
  const { caseNo, ...rest } = row;
  return {
    ...(rest as Omit<T, 'caseNo'>),
    responseNo: caseNo || null,
    responseType,
  };
}

export function resolveLegacyIncidentAssigneeUserId(incident: {
  assigneeUserId?: string | null;
  ownerUserId?: string | null;
}): string | null {
  const assigneeUserId = String((incident as any).assigneeUserId || '').trim();
  if (assigneeUserId) {
    return assigneeUserId;
  }
  const legacyOwnerUserId = String((incident as any).ownerUserId || '').trim();
  return legacyOwnerUserId || null;
}
