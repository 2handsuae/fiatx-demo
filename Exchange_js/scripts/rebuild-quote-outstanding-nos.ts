import { PrismaClient } from '@prisma/client';
import { generateReferenceNo } from '../src/common/utils/no-generator.util';

type Mode = 'dry-run' | 'apply';

type StatsBucket = {
  scanned: number;
  updated: number;
  conflictsRetried: number;
  failures: number;
};

type SummaryStats = {
  quotes: StatsBucket;
  outstandings: StatsBucket;
  swapQuoteSnapshots: StatsBucket;
};

const MAX_RETRIES = 10;

function parseMode(argv: string[]): Mode {
  if (argv.includes('--apply')) return 'apply';
  return 'dry-run';
}

function createStatsBucket(): StatsBucket {
  return {
    scanned: 0,
    updated: 0,
    conflictsRetried: 0,
    failures: 0,
  };
}

function createStats(): SummaryStats {
  return {
    quotes: createStatsBucket(),
    outstandings: createStatsBucket(),
    swapQuoteSnapshots: createStatsBucket(),
  };
}

function isUniqueConflict(error: unknown, field: string): boolean {
  const maybeError = error as {
    code?: string;
    meta?: { target?: string[] | string };
  };
  if (maybeError?.code !== 'P2002') return false;

  const target = maybeError.meta?.target;
  if (Array.isArray(target)) return target.includes(field);
  if (typeof target === 'string') return target.includes(field);
  return false;
}

async function generateUniqueNo(params: {
  prefix: 'QUO' | 'OTS';
  field: 'quoteNo' | 'outstandingNo';
  id: string;
  prisma: PrismaClient;
  stats: StatsBucket;
}): Promise<string> {
  const { prefix, field, id, prisma, stats } = params;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    const candidate = generateReferenceNo(prefix);

    if (field === 'quoteNo') {
      const existing = await prisma.swapQuote.findUnique({
        where: { quoteNo: candidate },
        select: { id: true },
      });
      if (existing && existing.id !== id) {
        stats.conflictsRetried += 1;
        continue;
      }
      return candidate;
    }

    const existing = await prisma.outstanding.findUnique({
      where: { outstandingNo: candidate },
      select: { id: true },
    });
    if (existing && existing.id !== id) {
      stats.conflictsRetried += 1;
      continue;
    }
    return candidate;
  }

  throw new Error(
    `Failed to generate unique ${field} for ${id} after ${MAX_RETRIES} attempts`,
  );
}

async function rebuildQuoteNos(
  prisma: PrismaClient,
  mode: Mode,
  stats: SummaryStats,
  failures: string[],
) {
  const quotes = await prisma.swapQuote.findMany({
    select: { id: true, quoteNo: true },
    orderBy: { createdAt: 'asc' },
  });
  stats.quotes.scanned = quotes.length;

  for (const quote of quotes) {
    try {
      if (mode === 'dry-run') {
        stats.quotes.updated += 1;
        continue;
      }

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
        const nextNo = await generateUniqueNo({
          prefix: 'QUO',
          field: 'quoteNo',
          id: quote.id,
          prisma,
          stats: stats.quotes,
        });

        try {
          await prisma.swapQuote.update({
            where: { id: quote.id },
            data: { quoteNo: nextNo },
          });
          stats.quotes.updated += 1;
          break;
        } catch (error) {
          if (isUniqueConflict(error, 'quoteNo')) {
            stats.quotes.conflictsRetried += 1;
            continue;
          }
          throw error;
        }
      }
    } catch (error) {
      stats.quotes.failures += 1;
      failures.push(`quote(${quote.id}) => ${(error as Error).message}`);
    }
  }
}

async function rebuildOutstandingNos(
  prisma: PrismaClient,
  mode: Mode,
  stats: SummaryStats,
  failures: string[],
) {
  const outstandings = await prisma.outstanding.findMany({
    select: { id: true, outstandingNo: true },
    orderBy: { createdAt: 'asc' },
  });
  stats.outstandings.scanned = outstandings.length;

  for (const outstanding of outstandings) {
    try {
      if (mode === 'dry-run') {
        stats.outstandings.updated += 1;
        continue;
      }

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
        const nextNo = await generateUniqueNo({
          prefix: 'OTS',
          field: 'outstandingNo',
          id: outstanding.id,
          prisma,
          stats: stats.outstandings,
        });

        try {
          await prisma.outstanding.update({
            where: { id: outstanding.id },
            data: { outstandingNo: nextNo },
          });
          stats.outstandings.updated += 1;
          break;
        } catch (error) {
          if (isUniqueConflict(error, 'outstandingNo')) {
            stats.outstandings.conflictsRetried += 1;
            continue;
          }
          throw error;
        }
      }
    } catch (error) {
      stats.outstandings.failures += 1;
      failures.push(`outstanding(${outstanding.id}) => ${(error as Error).message}`);
    }
  }
}

async function syncSwapQuoteSnapshots(
  prisma: PrismaClient,
  mode: Mode,
  stats: SummaryStats,
  failures: string[],
) {
  const swaps = await prisma.swapTransaction.findMany({
    where: { quoteId: { not: null } },
    select: { id: true, quoteId: true, quoteNo: true },
    orderBy: { createdAt: 'asc' },
  });
  stats.swapQuoteSnapshots.scanned = swaps.length;

  const quotes = await prisma.swapQuote.findMany({
    select: { id: true, quoteNo: true },
  });
  const quoteNoMap = new Map(quotes.map((item) => [item.id, item.quoteNo]));

  for (const swap of swaps) {
    const quoteId = swap.quoteId as string;
    const expectedQuoteNo = quoteNoMap.get(quoteId) || null;

    if (!expectedQuoteNo) {
      stats.swapQuoteSnapshots.failures += 1;
      failures.push(`swap(${swap.id}) => quoteNo missing for quoteId(${quoteId})`);
      continue;
    }

    if (swap.quoteNo === expectedQuoteNo) {
      continue;
    }

    if (mode === 'dry-run') {
      stats.swapQuoteSnapshots.updated += 1;
      continue;
    }

    try {
      await prisma.swapTransaction.update({
        where: { id: swap.id },
        data: { quoteNo: expectedQuoteNo },
      });
      stats.swapQuoteSnapshots.updated += 1;
    } catch (error) {
      stats.swapQuoteSnapshots.failures += 1;
      failures.push(`swap(${swap.id}) => ${(error as Error).message}`);
    }
  }
}

function printSummary(mode: Mode, stats: SummaryStats, failures: string[]) {
  console.log('--- Rebuild Quote/Outstanding Nos ---');
  console.log(`Mode: ${mode}`);
  console.table([
    { entity: 'swap_quotes', ...stats.quotes },
    { entity: 'outstandings', ...stats.outstandings },
    { entity: 'swap_transactions.quoteNo', ...stats.swapQuoteSnapshots },
  ]);

  if (failures.length > 0) {
    console.log('Failures:');
    for (const failure of failures) {
      console.log(`- ${failure}`);
    }
  } else {
    console.log('No failures.');
  }
}

async function main() {
  const mode = parseMode(process.argv.slice(2));
  const prisma = new PrismaClient({ log: ['warn', 'error'] });
  const stats = createStats();
  const failures: string[] = [];

  try {
    await rebuildQuoteNos(prisma, mode, stats, failures);
    await rebuildOutstandingNos(prisma, mode, stats, failures);
    await syncSwapQuoteSnapshots(prisma, mode, stats, failures);
    printSummary(mode, stats, failures);

    if (failures.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
