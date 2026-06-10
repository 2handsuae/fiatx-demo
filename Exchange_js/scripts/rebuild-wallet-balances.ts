import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  log: ['warn', 'error'],
});

const BALANCE_BUCKET_BY_ACCOUNT: Record<
  string,
  'AVAILABLE' | 'RESTRICTED' | 'IN_TRANSIT'
> = {
  'A.CLIENT_CUSTODY': 'AVAILABLE',
  'A.CLIENT_BANK': 'AVAILABLE',
  'A.CUSTODY_RESTRICTED': 'RESTRICTED',
  'A.BANK_RESTRICTED': 'RESTRICTED',
  'A.CUSTODY_IN_TRANSIT': 'IN_TRANSIT',
  'A.BANK_IN_TRANSIT': 'IN_TRANSIT',
};

type RebuildEntry = {
  journalLineId: string;
  walletId: string;
  assetId: string;
  accountCode: string;
  drCr: string;
  amount: Prisma.Decimal;
  deltaAvailable: Prisma.Decimal;
  deltaRestricted: Prisma.Decimal;
  deltaInTransit: Prisma.Decimal;
};

type SnapshotState = {
  walletId: string;
  assetId: string;
  availableBalance: Prisma.Decimal;
  restrictedBalance: Prisma.Decimal;
  inTransitBalance: Prisma.Decimal;
  totalBalance: Prisma.Decimal;
  lastJournalLineId: string;
};

function toDecimal(value: Prisma.Decimal | string | number | null | undefined) {
  if (value === null || value === undefined) return new Prisma.Decimal(0);
  if (value instanceof Prisma.Decimal) return value;
  return new Prisma.Decimal(value);
}

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size));
  }
  return rows;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const apply = args.has('--apply');
  const dryRun = args.has('--dry-run') || !apply;

  console.log(
    `--- Rebuild wallet balances (${dryRun ? 'dry-run' : 'apply'}) ---`,
  );

  const lines = await prisma.journalLine.findMany({
    where: {
      walletId: { not: null },
      accountCode: { in: Object.keys(BALANCE_BUCKET_BY_ACCOUNT) },
    },
    select: {
      id: true,
      walletId: true,
      assetId: true,
      accountCode: true,
      drCr: true,
      amount: true,
      createdAt: true,
      lineNo: true,
    },
    orderBy: [{ createdAt: 'asc' }, { lineNo: 'asc' }],
  });

  const entries: RebuildEntry[] = [];
  const snapshotByKey = new Map<string, SnapshotState>();

  for (const line of lines) {
    if (!line.walletId || !line.assetId) continue;

    const bucket = BALANCE_BUCKET_BY_ACCOUNT[line.accountCode];
    if (!bucket) continue;

    const amount = toDecimal(line.amount);
    const direction =
      line.drCr === 'DR' ? new Prisma.Decimal(1) : new Prisma.Decimal(-1);
    const delta = amount.mul(direction);
    const deltaAvailable =
      bucket === 'AVAILABLE' ? delta : new Prisma.Decimal(0);
    const deltaRestricted =
      bucket === 'RESTRICTED' ? delta : new Prisma.Decimal(0);
    const deltaInTransit =
      bucket === 'IN_TRANSIT' ? delta : new Prisma.Decimal(0);

    entries.push({
      journalLineId: line.id,
      walletId: line.walletId,
      assetId: line.assetId,
      accountCode: line.accountCode,
      drCr: line.drCr,
      amount,
      deltaAvailable,
      deltaRestricted,
      deltaInTransit,
    });

    const key = `${line.walletId}::${line.assetId}`;
    const snapshot =
      snapshotByKey.get(key) ??
      ({
        walletId: line.walletId,
        assetId: line.assetId,
        availableBalance: new Prisma.Decimal(0),
        restrictedBalance: new Prisma.Decimal(0),
        inTransitBalance: new Prisma.Decimal(0),
        totalBalance: new Prisma.Decimal(0),
        lastJournalLineId: line.id,
      } as SnapshotState);

    snapshot.availableBalance = snapshot.availableBalance.plus(deltaAvailable);
    snapshot.restrictedBalance = snapshot.restrictedBalance.plus(deltaRestricted);
    snapshot.inTransitBalance = snapshot.inTransitBalance.plus(deltaInTransit);
    snapshot.totalBalance = snapshot.totalBalance.plus(delta);
    snapshot.lastJournalLineId = line.id;

    snapshotByKey.set(key, snapshot);
  }

  console.log(`Wallet journal lines scanned: ${lines.length}`);
  console.log(`Projected entry rows: ${entries.length}`);
  console.log(`Projected snapshot rows: ${snapshotByKey.size}`);

  if (dryRun) {
    const preview = Array.from(snapshotByKey.values())
      .slice(0, 10)
      .map((item) => ({
        walletId: item.walletId,
        assetId: item.assetId,
        available: item.availableBalance.toString(),
        restricted: item.restrictedBalance.toString(),
        inTransit: item.inTransitBalance.toString(),
        total: item.totalBalance.toString(),
      }));
    console.table(preview);
    console.log('Dry-run completed. No data was changed.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    await (tx as any).walletBalanceEntry.deleteMany();
    await (tx as any).walletBalanceSnapshot.deleteMany();

    for (const rows of chunk(entries, 500)) {
      await (tx as any).walletBalanceEntry.createMany({
        data: rows,
      });
    }

    const snapshots = Array.from(snapshotByKey.values()).map((item) => ({
      walletId: item.walletId,
      assetId: item.assetId,
      availableBalance: item.availableBalance,
      restrictedBalance: item.restrictedBalance,
      inTransitBalance: item.inTransitBalance,
      totalBalance: item.totalBalance,
      lastJournalLineId: item.lastJournalLineId,
    }));

    for (const rows of chunk(snapshots, 500)) {
      await (tx as any).walletBalanceSnapshot.createMany({
        data: rows,
      });
    }
  });

  console.log('Rebuild applied successfully.');
}

main()
  .catch((error) => {
    console.error('Failed to rebuild wallet balances:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

