import {
  AuditActorContext,
  AuditSubjectNoDto,
  AuditSubjectRole,
} from '../dto/audit-log.dto';

export interface AuditSubjectNoRecord {
  subjectRole: AuditSubjectRole;
  subjectType: string;
  subjectId?: string | null;
  subjectNo: string;
}

export interface BuildAuditSubjectNosInput {
  actor: AuditActorContext;
  entityType: string;
  entityId?: string | null;
  entityNo?: string | null;
  entityOwnerType?: string | null;
  entityOwnerId?: string | null;
  entityOwnerNo?: string | null;
  explicitSubjectNos?: AuditSubjectNoDto[];
}

function normalizeString(input?: string | null): string | null {
  if (input === undefined || input === null) return null;
  const normalized = String(input).trim();
  return normalized.length ? normalized : null;
}

function normalizeSubjectNo(
  entry: Partial<AuditSubjectNoRecord>,
): AuditSubjectNoRecord | null {
  const subjectNo = normalizeString(entry.subjectNo);
  const subjectType = normalizeString(entry.subjectType);
  const subjectRole = normalizeString(entry.subjectRole as string) as AuditSubjectRole | null;

  if (!subjectNo || !subjectType || !subjectRole) {
    return null;
  }

  return {
    subjectRole,
    subjectType,
    subjectId: normalizeString(entry.subjectId) || null,
    subjectNo,
  };
}

export function dedupeAuditSubjectNos(
  entries: Array<Partial<AuditSubjectNoRecord>>,
): AuditSubjectNoRecord[] {
  const seen = new Set<string>();
  const normalized: AuditSubjectNoRecord[] = [];

  for (const entry of entries) {
    const item = normalizeSubjectNo(entry);
    if (!item) continue;

    const key = [
      item.subjectRole,
      item.subjectType.toUpperCase(),
      item.subjectId || '',
      item.subjectNo,
    ].join('|');

    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(item);
  }

  return normalized;
}

export function buildAuditSubjectNos(input: BuildAuditSubjectNosInput): AuditSubjectNoRecord[] {
  const entries: Array<Partial<AuditSubjectNoRecord>> = [];

  if (Array.isArray(input.explicitSubjectNos) && input.explicitSubjectNos.length) {
    entries.push(...input.explicitSubjectNos);
  }

  if (input.actor.actorNo) {
    entries.push({
      subjectRole: AuditSubjectRole.ACTOR,
      subjectType: input.actor.actorType,
      subjectId: input.actor.actorId,
      subjectNo: input.actor.actorNo,
    });
  }

  if (input.entityOwnerNo) {
    entries.push({
      subjectRole: AuditSubjectRole.OWNER,
      subjectType: input.entityOwnerType || 'OWNER',
      subjectId: input.entityOwnerId,
      subjectNo: input.entityOwnerNo,
    });
  }

  if (input.entityNo) {
    entries.push({
      subjectRole: AuditSubjectRole.ENTITY,
      subjectType: input.entityType,
      subjectId: input.entityId,
      subjectNo: input.entityNo,
    });
  }

  return dedupeAuditSubjectNos(entries);
}
