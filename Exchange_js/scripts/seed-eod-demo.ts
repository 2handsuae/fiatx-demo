// scripts/seed-eod-demo.ts
//
// Seeds the "post-swap" ledger state for a LIVE V7 EOD settlement demo, then
// EXITS — it does NOT run EOD or drive any funds-flow. Everything after this
// (Run EOD → simulate transfer → SETTLED + drain) is done in the browser UI.
//
// What a real USDT↔AED swap would leave behind, planted directly (same approach
// as verify-tb-drain.ts):
//   • SYSTEM TRADE_CLEARING (USDT) carries a +5 USDT credit balance.
//   • One OPEN, OUT-direction Outstanding (USDT, amount 5, sourceType SWAP).
//
// Run (backend can stay up — TB/SQLite state is shared with the running stack):
//   DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" \
//     npx ts-node -r tsconfig-paths/register scripts/seed-eod-demo.ts 2>&1 | tail -30

import { webcrypto } from 'node:crypto';
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { AccountingService } from '../src/modules/accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES } from '../src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { TB_LEDGERS } from '../src/modules/accounting/tigerbeetle/constants/tb-ledgers.constant';

const LEDGER = TB_LEDGERS.USDT; // 2
const CURRENCY = 'USDT';
const RUN_TAG = Date.now().toString();
const TARGET_CLEARING = 5_000_000n; // 5 USDT (6 decimals)

function net(b: { creditsPosted: bigint; debitsPosted: bigint }) {
  return b.creditsPosted - b.debitsPosted;
}

async function main() {
  const ctx = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  const prisma = ctx.get(PrismaService);
  const accounting = ctx.get(AccountingService);

  // ── Use the already-seeded USDT asset (do not create a duplicate) ──
  const asset = await (prisma as any).asset.findFirst({
    where: { status: 'ACTIVE', type: 'CRYPTO', currency: CURRENCY },
  });
  if (!asset) throw new Error('Active USDT crypto asset not found — run business seed first.');

  const clearingId = await accounting.resolveTbAccountId({
    code: TB_ACCOUNT_CODES.TRADE_CLEARING,
    ledger: LEDGER,
    ownerType: 'SYSTEM',
  });
  const custodyId = await accounting.resolveTbAccountId({
    code: TB_ACCOUNT_CODES.CUSTODY,
    ledger: LEDGER,
    ownerType: 'SYSTEM',
  });

  // ── Seed TRADE_CLEARING up to target credit (debit CUSTODY → credit CLEARING) ──
  const before = net(await accounting.lookupBalance(clearingId));
  const seed = TARGET_CLEARING - before;
  if (seed > 0n) {
    await accounting.executeTransfer({
      debitAccountId: custodyId,
      creditAccountId: clearingId,
      amount: seed,
      ledger: LEDGER,
      code: TB_TRANSFER_CODES.SWAP_CREDIT_TO_CLEARING_POST,
      evidence: {
        sourceType: 'EOD_DEMO_SEED',
        sourceNo: `SEED-CLEARING-${RUN_TAG}`,
        eventCode: 'EOD_DEMO_SEED_CLEARING',
        debitCode: 'A.CUSTODY',
        creditCode: 'L.TRADE_CLEARING',
        assetCurrency: CURRENCY,
        traceId: `EODDEMO:${RUN_TAG}`,
        actorType: 'SYSTEM',
        actorId: 'SYSTEM',
        memo: 'seed-eod-demo TRADE_CLEARING',
      },
    });
  }

  // ── One OPEN OUT outstanding so EOD nets to INTERNAL_OUT ──
  const outstanding = await (prisma as any).outstanding.create({
    data: {
      outstandingNo: `OUT-EODDEMO-${RUN_TAG}`,
      sourceType: 'SWAP',
      sourceId: `EODDEMO-SWAP-${RUN_TAG}`,
      sourceNo: `EODDEMO-SWAP-${RUN_TAG}`,
      ownerType: 'PLATFORM',
      ownerId: 'PLATFORM',
      direction: 'OUT',
      assetId: asset.id,
      assetCode: CURRENCY,
      amount: '5',
      status: 'OPEN',
    },
  });

  const after = net(await accounting.lookupBalance(clearingId));
  console.log('=== seed-eod-demo done ===');
  console.log(`asset=${asset.id} (${CURRENCY}) ledger=${LEDGER}`);
  console.log(`TRADE_CLEARING net = ${after} (target ${TARGET_CLEARING})`);
  console.log(`OPEN outstanding = ${outstanding.outstandingNo} (OUT, 5 ${CURRENCY})`);
  console.log('\nNext: in admin UI → Settlement Batches → Run EOD Settlement.');

  await ctx.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
