import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { JournalsService } from '../src/modules/accounting/journals/journals.service';
import { AcctConfigService } from '../src/modules/accounting/acct-events/acct-config.service';

type Mode = 'dry-run' | 'apply';

interface CliArgs {
  mode: Mode;
  internalTxNo?: string;
}

type BackfillItemAction =
  | 'WOULD_CREATE'
  | 'CREATED'
  | 'SKIPPED_EXISTING'
  | 'SKIPPED_UNSUPPORTED'
  | 'FAILED';

interface BackfillItemResult {
  internalTxNo: string;
  status: string;
  eventCode?: string;
  action: BackfillItemAction;
  reason?: string;
}

const FIAT_STATUS_EVENT_SEQUENCE: Record<string, string[]> = {
  INTERNAL_FUNDS_PENDING: ['EVT_INTERNAL_TX_CREATED__FIAT'],
  SUCCESS: ['EVT_INTERNAL_TX_CREATED__FIAT', 'EVT_INTERNAL_TX_SUCCESS__FIAT'],
  FAILED: ['EVT_INTERNAL_TX_CREATED__FIAT', 'EVT_INTERNAL_TX_FAILED__FIAT'],
  CANCELLED: ['EVT_INTERNAL_TX_CREATED__FIAT', 'EVT_INTERNAL_TX_CANCELLED__FIAT'],
  REJECTED: ['EVT_INTERNAL_TX_CREATED__FIAT', 'EVT_INTERNAL_TX_REJECTED__FIAT'],
};

const FIAT_EVENT_TO_STATUS: Record<string, string> = {
  EVT_INTERNAL_TX_CREATED__FIAT: 'INTERNAL_FUNDS_PENDING',
  EVT_INTERNAL_TX_SUCCESS__FIAT: 'SUCCESS',
  EVT_INTERNAL_TX_FAILED__FIAT: 'FAILED',
  EVT_INTERNAL_TX_CANCELLED__FIAT: 'CANCELLED',
  EVT_INTERNAL_TX_REJECTED__FIAT: 'REJECTED',
};

const LEGACY_EVENT_CODE_BY_FIAT_EVENT: Record<string, string> = {
  EVT_INTERNAL_TX_CREATED__FIAT: 'EVT_INTERNAL_TX_CREATED',
  EVT_INTERNAL_TX_SUCCESS__FIAT: 'EVT_INTERNAL_TX_SUCCESS',
  EVT_INTERNAL_TX_FAILED__FIAT: 'EVT_INTERNAL_TX_FAILED',
  EVT_INTERNAL_TX_CANCELLED__FIAT: 'EVT_INTERNAL_TX_CANCELLED',
  EVT_INTERNAL_TX_REJECTED__FIAT: 'EVT_INTERNAL_TX_REJECTED',
};

function parseArgs(argv: string[]): CliArgs {
  let mode: Mode = 'apply';
  let internalTxNo: string | undefined;

  for (const arg of argv) {
    if (arg === '--dry-run') {
      mode = 'dry-run';
      continue;
    }

    if (arg.startsWith('--internalTxNo=')) {
      internalTxNo = arg.slice('--internalTxNo='.length).trim();
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: ts-node scripts/backfill-fiat-internal-tx-accounting.ts [--dry-run] [--internalTxNo=ITX2602180357]',
      );
      process.exit(0);
    }

    throw new Error(`Unsupported argument: ${arg}`);
  }

  return {
    mode,
    internalTxNo: internalTxNo || undefined,
  };
}

function buildAccountingContext(item: any) {
  return {
    src: {
      id: item.id,
      internalTxNo: item.internalTxNo,
      type: item.type,
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      sourceNo: item.sourceNo,
      ownerType: item.ownerType,
      ownerId: item.ownerId,
      ownerNo: item.ownerNo,
      assetId: item.assetId,
      amount: item.amount?.toString?.() ?? String(item.amount ?? '0'),
      feeAmount: item.feeAmount?.toString?.() ?? String(item.feeAmount ?? '0'),
      netAmount: item.netAmount?.toString?.() ?? String(item.netAmount ?? '0'),
      fromWalletId: item.fromWalletId,
      fromWalletOwnerType: item.fromWallet?.ownerType ?? null,
      fromAddress: item.fromAddress,
      fromIban: item.fromIban,
      toWalletId: item.toWalletId,
      toWalletOwnerType: item.toWallet?.ownerType ?? null,
      toAddress: item.toAddress,
      toIban: item.toIban,
    },
  };
}

function printSummary(
  mode: Mode,
  items: BackfillItemResult[],
  scanned: number,
  filteredByInternalTxNo: boolean,
) {
  const wouldCreate = items.filter((item) => item.action === 'WOULD_CREATE').length;
  const created = items.filter((item) => item.action === 'CREATED').length;
  const skippedExisting = items.filter(
    (item) => item.action === 'SKIPPED_EXISTING',
  ).length;
  const skippedUnsupported = items.filter(
    (item) => item.action === 'SKIPPED_UNSUPPORTED',
  ).length;
  const failed = items.filter((item) => item.action === 'FAILED').length;

  console.log('--- FIAT INTERNAL_TX Accounting Backfill Summary ---');
  console.log(`Mode: ${mode}`);
  console.log(`Scanned transactions: ${scanned}`);
  console.log(`Created: ${created}`);
  console.log(`WouldCreate: ${wouldCreate}`);
  console.log(`SkippedExisting: ${skippedExisting}`);
  console.log(`SkippedUnsupportedStatus: ${skippedUnsupported}`);
  console.log(`Failed: ${failed}`);
  if (filteredByInternalTxNo) {
    console.log('Filter: internalTxNo mode');
  }

  const failures = items.filter((item) => item.action === 'FAILED');
  if (failures.length) {
    console.log('Failures:');
    for (const failure of failures) {
      console.log(
        `- ${failure.internalTxNo} ${failure.eventCode || ''}: ${failure.reason || 'Unknown error'}`,
      );
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const prisma = app.get(PrismaService);
    const journalsService = app.get(JournalsService);
    const acctConfigService = app.get(AcctConfigService);

    if (args.mode === 'apply') {
      await acctConfigService.syncDefaults();
    }

    const where: any = {
      asset: { type: 'FIAT' },
    };
    if (args.internalTxNo) {
      where.internalTxNo = args.internalTxNo;
    }

    const txs = await (prisma as any).internalTransaction.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      include: {
        asset: {
          select: {
            id: true,
            code: true,
            type: true,
          },
        },
        fromWallet: {
          select: {
            id: true,
            ownerType: true,
          },
        },
        toWallet: {
          select: {
            id: true,
            ownerType: true,
          },
        },
      },
    });

    const results: BackfillItemResult[] = [];

    for (const tx of txs) {
      const status = String(tx.status || '');
      const sequence = FIAT_STATUS_EVENT_SEQUENCE[status];
      if (!sequence || !sequence.length) {
        results.push({
          internalTxNo: tx.internalTxNo,
          status,
          action: 'SKIPPED_UNSUPPORTED',
          reason: `Unsupported status for FIAT backfill: ${status}`,
        });
        continue;
      }

      for (const eventCode of sequence) {
        const legacyCode = LEGACY_EVENT_CODE_BY_FIAT_EVENT[eventCode];
        const existing = await (prisma as any).journal.findFirst({
          where: {
            sourceType: 'INTERNAL_TX',
            sourceId: tx.id,
            eventCode: {
              in: [eventCode, legacyCode],
            },
          },
          select: { id: true, eventCode: true },
        });

        if (existing) {
          results.push({
            internalTxNo: tx.internalTxNo,
            status,
            eventCode,
            action: 'SKIPPED_EXISTING',
            reason: `Existing journal ${existing.eventCode}`,
          });
          continue;
        }

        if (args.mode === 'dry-run') {
          results.push({
            internalTxNo: tx.internalTxNo,
            status,
            eventCode,
            action: 'WOULD_CREATE',
          });
          continue;
        }

        try {
          const triggered = await journalsService.triggerEvent(
            {
              entityType: 'INTERNAL_TX',
              triggerKey: 'status',
              fromStatus: null,
              toStatus: FIAT_EVENT_TO_STATUS[eventCode],
              assetType: 'FIAT',
              context: buildAccountingContext(tx),
              sourceId: tx.id,
            },
            prisma as any,
          );

          if (!triggered) {
            results.push({
              internalTxNo: tx.internalTxNo,
              status,
              eventCode,
              action: 'FAILED',
              reason: 'No matching accounting event or journal creation skipped',
            });
            continue;
          }

          results.push({
            internalTxNo: tx.internalTxNo,
            status,
            eventCode,
            action: 'CREATED',
          });
        } catch (error: any) {
          results.push({
            internalTxNo: tx.internalTxNo,
            status,
            eventCode,
            action: 'FAILED',
            reason: error?.message || String(error),
          });
        }
      }
    }

    printSummary(args.mode, results, txs.length, Boolean(args.internalTxNo));
    if (results.some((item) => item.action === 'FAILED')) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

void main();
