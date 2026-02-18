import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const dryRun = args.includes('--dry-run') || !apply;
  const limitArg = args.find((arg) => arg.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.slice('--limit='.length)) : 1000;

  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error('Invalid limit. Use --limit=<positive number>.');
  }

  return { apply, dryRun, limit };
}

function normalize(value?: string | null): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}

async function resolveActorNo(actorType: string, actorId: string): Promise<string | null> {
  if (!actorId) return null;
  const type = String(actorType || '').toUpperCase();

  if (type === 'SYSTEM') {
    return 'SYSTEM';
  }

  if (type === 'ADMIN') {
    const user = await prisma.user.findUnique({
      where: { id: actorId },
      select: { userNo: true },
    });
    return user?.userNo || null;
  }

  if (type === 'CUSTOMER') {
    const customer = await prisma.customerMain.findUnique({
      where: { id: actorId },
      select: { customerNo: true },
    });
    return customer?.customerNo || null;
  }

  return null;
}

async function resolveEntityOwnerNo(ownerType?: string | null, ownerId?: string | null) {
  const normalizedType = String(ownerType || '').toUpperCase();
  const normalizedId = normalize(ownerId);
  if (!normalizedId) return null;

  if (normalizedType === 'CUSTOMER') {
    const customer = await prisma.customerMain.findUnique({
      where: { id: normalizedId },
      select: { customerNo: true },
    });
    return customer?.customerNo || null;
  }

  if (normalizedType === 'USER' || normalizedType === 'ADMIN') {
    const user = await prisma.user.findUnique({
      where: { id: normalizedId },
      select: { userNo: true },
    });
    return user?.userNo || null;
  }

  return null;
}

function buildSubjectNos(input: {
  actorType: string;
  actorId: string;
  actorNo?: string | null;
  entityType: string;
  entityId?: string | null;
  entityNo?: string | null;
  entityOwnerType?: string | null;
  entityOwnerId?: string | null;
  entityOwnerNo?: string | null;
}) {
  const items: Array<{
    subjectRole: string;
    subjectType: string;
    subjectId?: string | null;
    subjectNo: string;
  }> = [];

  if (input.actorNo) {
    items.push({
      subjectRole: 'ACTOR',
      subjectType: input.actorType,
      subjectId: input.actorId,
      subjectNo: input.actorNo,
    });
  }

  if (input.entityOwnerNo) {
    items.push({
      subjectRole: 'OWNER',
      subjectType: input.entityOwnerType || 'OWNER',
      subjectId: input.entityOwnerId,
      subjectNo: input.entityOwnerNo,
    });
  }

  if (input.entityNo) {
    items.push({
      subjectRole: 'ENTITY',
      subjectType: input.entityType,
      subjectId: input.entityId,
      subjectNo: input.entityNo,
    });
  }

  const dedup = new Map<string, (typeof items)[number]>();
  for (const item of items) {
    const key = `${item.subjectRole}|${item.subjectType}|${item.subjectId || ''}|${item.subjectNo}`;
    if (!dedup.has(key)) {
      dedup.set(key, item);
    }
  }

  return Array.from(dedup.values());
}

async function attachSubjectNos(
  eventId: string,
  occurredAt: Date,
  subjectNos: Array<{
    subjectRole: string;
    subjectType: string;
    subjectId?: string | null;
    subjectNo: string;
  }>,
) {
  const model = (prisma as any).auditLogSubjectNo;
  if (!model || !subjectNos.length) return 0;

  const existing = await model.findMany({
    where: { eventId },
    select: {
      subjectRole: true,
      subjectType: true,
      subjectId: true,
      subjectNo: true,
    },
  });

  const existingKeys = new Set(
    existing.map(
      (item: any) =>
        `${item.subjectRole}|${item.subjectType}|${item.subjectId || ''}|${item.subjectNo}`,
    ),
  );

  const rows = subjectNos
    .filter((item) => {
      const key = `${item.subjectRole}|${item.subjectType}|${item.subjectId || ''}|${item.subjectNo}`;
      return !existingKeys.has(key);
    })
    .map((item) => ({
      eventId,
      subjectRole: item.subjectRole,
      subjectType: item.subjectType,
      subjectId: item.subjectId || null,
      subjectNo: item.subjectNo,
      occurredAt,
    }));

  if (!rows.length) return 0;
  const inserted = await model.createMany({ data: rows });
  return Number(inserted.count || 0);
}

async function main() {
  const { apply, dryRun, limit } = parseArgs();

  const where = {
    OR: [
      { actorNo: null },
      { entityOwnerNo: null },
      { subjectNos: { none: {} } },
    ],
  } as const;

  const rows = await (prisma as any).auditLogEvent.findMany({
    where,
    orderBy: { occurredAt: 'asc' },
    take: limit,
    include: {
      subjectNos: {
        select: {
          subjectRole: true,
          subjectType: true,
          subjectId: true,
          subjectNo: true,
        },
      },
    },
  });

  let updated = 0;
  let attachedSubjects = 0;

  for (const row of rows) {
    const actorNo = row.actorNo || (await resolveActorNo(row.actorType, row.actorId));
    const entityOwnerNo =
      row.entityOwnerNo ||
      (await resolveEntityOwnerNo(row.entityOwnerType, row.entityOwnerId));

    const subjectNos = buildSubjectNos({
      actorType: row.actorType,
      actorId: row.actorId,
      actorNo,
      entityType: row.entityType,
      entityId: row.entityId,
      entityNo: row.entityNo,
      entityOwnerType: row.entityOwnerType,
      entityOwnerId: row.entityOwnerId,
      entityOwnerNo,
    });

    if (dryRun) {
      if (actorNo !== row.actorNo || entityOwnerNo !== row.entityOwnerNo) {
        updated += 1;
      }
      attachedSubjects += subjectNos.length;
      continue;
    }

    if (!apply) {
      throw new Error('Use --apply to execute write mode');
    }

    if (actorNo !== row.actorNo || entityOwnerNo !== row.entityOwnerNo) {
      await (prisma as any).auditLogEvent.update({
        where: { id: row.id },
        data: {
          actorNo: actorNo || null,
          entityOwnerNo: entityOwnerNo || null,
        },
      });
      updated += 1;
    }

    attachedSubjects += await attachSubjectNos(row.id, row.occurredAt, subjectNos);
  }

  console.log('[audit-backfill-nos] mode:', dryRun ? 'dry-run' : 'apply');
  console.log('[audit-backfill-nos] scanned:', rows.length);
  console.log('[audit-backfill-nos] events-updated:', updated);
  console.log('[audit-backfill-nos] subject-nos-added:', attachedSubjects);
}

main()
  .catch((error) => {
    console.error('[audit-backfill-nos] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
