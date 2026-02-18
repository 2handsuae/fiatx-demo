import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const dryRun = args.includes('--dry-run') || !apply;
  const cutoffArg = args.find((arg) => arg.startsWith('--cutoff='));
  const cutoff = cutoffArg ? new Date(cutoffArg.slice('--cutoff='.length)) : new Date();
  const limitArg = args.find((arg) => arg.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.slice('--limit='.length)) : 1000;

  if (Number.isNaN(cutoff.getTime())) {
    throw new Error('Invalid cutoff date. Use --cutoff=YYYY-MM-DD or ISO datetime.');
  }

  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error('Invalid limit. Use --limit=<positive number>.');
  }

  return { apply, dryRun, cutoff, limit };
}

async function buildReport(cutoff: Date) {
  const rows = await (prisma as any).auditLogEvent.findMany({
    where: {
      archivedAt: null,
      retainedUntil: { lt: cutoff },
    },
    select: {
      id: true,
      module: true,
      triggerType: true,
      retainedUntil: true,
    },
    orderBy: { retainedUntil: 'asc' },
    take: 5000,
  });

  const byModule: Record<string, number> = {};
  const byTrigger: Record<string, number> = {};
  rows.forEach((row: any) => {
    byModule[row.module] = (byModule[row.module] || 0) + 1;
    byTrigger[row.triggerType] = (byTrigger[row.triggerType] || 0) + 1;
  });

  return {
    totalCandidates: rows.length,
    sampleIds: rows.slice(0, 20).map((row: any) => row.id),
    byModule,
    byTrigger,
  };
}

async function markArchived(cutoff: Date, limit: number) {
  const candidates = await (prisma as any).auditLogEvent.findMany({
    where: {
      archivedAt: null,
      retainedUntil: { lt: cutoff },
    },
    select: { id: true },
    orderBy: { retainedUntil: 'asc' },
    take: limit,
  });

  if (!candidates.length) {
    return { archived: 0, ids: [] as string[] };
  }

  const ids = candidates.map((row: any) => row.id);
  const updated = await (prisma as any).auditLogEvent.updateMany({
    where: { id: { in: ids } },
    data: { archivedAt: new Date() },
  });

  return {
    archived: updated.count as number,
    ids,
  };
}

async function main() {
  const { apply, dryRun, cutoff, limit } = parseArgs();

  console.log('[audit-retention] cutoff:', cutoff.toISOString());
  console.log('[audit-retention] mode:', dryRun ? 'dry-run' : 'apply');

  const report = await buildReport(cutoff);
  console.log('[audit-retention] candidate report:', JSON.stringify(report, null, 2));

  if (dryRun) {
    console.log('[audit-retention] dry-run done (no archive flag updated)');
    return;
  }

  if (!apply) {
    throw new Error('Use --apply to execute write mode');
  }

  const archived = await markArchived(cutoff, limit);
  console.log('[audit-retention] archived result:', archived);
}

main()
  .catch((error) => {
    console.error('[audit-retention] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
