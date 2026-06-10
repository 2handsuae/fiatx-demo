// scripts/seed-fiat-settle-demo.ts
//
// Seeds the "post-swap" ledger state for a LIVE V7 fiat settlement demo, then
// EXITS — it does NOT run the workflow or drive any funds-flow. Everything after
// this (emit SWAP_SUCCEEDED → simulate transfer SUBMIT→CONFIRM hop1; hop2
// auto-SUBMITs; CONFIRM hop2) is done in the browser UI or via simulate endpoints.
//
// What a real AED fiat swap would leave behind, planted directly:
//   • An ACTIVE AED C_VIBAN wallet (with IBAN) for the first seeded customer.
//   • SYSTEM TRADE_CLEARING (AED) carries a +5 AED credit balance.
//   • One OPEN, OUT-direction Outstanding (AED, amount 5, sourceType SWAP).
//
// Run (backend can stay up — TB/SQLite state is shared with the running stack):
//   DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" \
//     npx ts-node -r tsconfig-paths/register scripts/seed-fiat-settle-demo.ts 2>&1 | tail -30

import { webcrypto } from 'node:crypto';
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { AccountingService } from '../src/modules/accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES } from '../src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { TB_LEDGERS } from '../src/modules/accounting/tigerbeetle/constants/tb-ledgers.constant';

const LEDGER = TB_LEDGERS.AED; // 1
const CURRENCY = 'AED';
const RUN_TAG = Date.now().toString();
// TARGET_CLEARING is derived from the asset's real decimals at runtime (AED = 2),
// not hardcoded — see below. 5 AED.
const TARGET_UNITS = 5;

function net(b: { creditsPosted: bigint; debitsPosted: bigint }) {
  return b.creditsPosted - b.debitsPosted;
}

async function main() {
  const ctx = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  const prisma = ctx.get(PrismaService);
  const accounting = ctx.get(AccountingService);

  // ── Use the already-seeded AED asset (do not create a duplicate) ──
  const asset = await (prisma as any).asset.findFirst({
    where: { status: 'ACTIVE', type: 'FIAT', currency: CURRENCY },
  });
  if (!asset) throw new Error('Active AED fiat asset not found — run business seed first.');

  // Seed amount in TB base units, derived from the asset's REAL decimals (AED = 2),
  // not a hardcoded assumption.
  const TARGET_CLEARING = BigInt(TARGET_UNITS) * 10n ** BigInt(asset.decimals);

  const customer = await (prisma as any).customerMain.findFirst({ where: {} });
  if (!customer) throw new Error('No customer found — run business seed first.');

  // ── Ensure an ACTIVE AED C_VIBAN wallet for this customer ──
  let viban = await (prisma as any).wallet.findFirst({
    where: { walletRole: 'C_VIBAN', assetId: asset.id, ownerType: 'CUSTOMER', ownerId: customer.id },
  });
  if (!viban) {
    viban = await (prisma as any).wallet.create({
      data: {
        walletNo: `WA-VIBAN-DEMO-${RUN_TAG}`,
        ownerType: 'CUSTOMER',
        ownerId: customer.id,
        ownerNo: customer.customerNo,
        type: 'FIAT_BANK',
        walletRole: 'C_VIBAN',
        assetId: asset.id,
        iban: `AE00DEMO${RUN_TAG.slice(-12)}`,
        bankName: 'FiatX Internal Bank',
        accountName: `Customer VIBAN (${CURRENCY})`,
        status: 'ACTIVE',
      },
    });
  }

  // ── Seed TRADE_CLEARING(AED) credit to back the settlement (debit BANK → credit TRADE_CLEARING) ──
  const clearingId = await accounting.resolveTbAccountId({
    code: TB_ACCOUNT_CODES.TRADE_CLEARING,
    ledger: LEDGER,
    ownerType: 'SYSTEM',
  });
  const bankId = await accounting.resolveTbAccountId({
    code: TB_ACCOUNT_CODES.CLIENT_BANK,
    ledger: LEDGER,
    ownerType: 'SYSTEM',
  });

  const before = net(await accounting.lookupBalance(clearingId));
  const seed = TARGET_CLEARING - before;
  if (seed > 0n) {
    await accounting.executeTransfer({
      debitAccountId: bankId,
      creditAccountId: clearingId,
      amount: seed,
      ledger: LEDGER,
      code: TB_TRANSFER_CODES.SWAP_CREDIT_TO_CLEARING_POST,
      evidence: {
        sourceType: 'FIAT_DEMO_SEED',
        sourceNo: `SEED-CLEARING-${RUN_TAG}`,
        eventCode: 'FIAT_DEMO_SEED_CLEARING',
        debitCode: 'A.CLIENT_BANK',
        creditCode: 'L.TRADE_CLEARING',
        assetCurrency: CURRENCY,
        traceId: `FIATDEMO:${RUN_TAG}`,
        actorType: 'SYSTEM',
        actorId: 'SYSTEM',
        memo: 'seed-fiat-settle-demo TRADE_CLEARING',
      },
    });
  }

  // ── Create a minimal SwapTransaction so Outstanding.swapTransactionId FK is satisfied ──
  const swapId: string = (globalThis as any).crypto.randomUUID();
  await (prisma as any).swapTransaction.create({
    data: {
      id: swapId,
      swapNo: `FIATDEMO-SWAP-${RUN_TAG}`,
      ownerType: 'CUSTOMER',
      ownerId: customer.id,
      ownerNo: customer.customerNo,
      status: 'SUCCEEDED',
      fromAssetId: asset.id,
      fromAssetCode: CURRENCY,
      fromAmount: 5,
      toAssetId: asset.id,
      toAssetCode: CURRENCY,
      toAmount: 5,
      exchangeRate: 1,
    },
  });

  // ── One OPEN OUT outstanding so the fiat workflow picks it up via findOpenFiatBySwap ──
  const outstanding = await (prisma as any).outstanding.create({
    data: {
      outstandingNo: `OUT-FIATDEMO-${RUN_TAG}`,
      sourceType: 'SWAP',
      sourceId: swapId,
      sourceNo: `FIATDEMO-SWAP-${RUN_TAG}`,
      ownerType: 'CUSTOMER',
      ownerId: customer.id,
      ownerNo: customer.customerNo,
      direction: 'OUT',
      assetId: asset.id,
      assetCode: CURRENCY,
      amount: '5',
      status: 'OPEN',
      swapTransactionId: swapId,
    },
  });

  const after = net(await accounting.lookupBalance(clearingId));
  console.log('=== seed-fiat-settle-demo done ===');
  console.log(`asset=${asset.id} (${CURRENCY}) ledger=${LEDGER}`);
  console.log(`TRADE_CLEARING net = ${after} (target ${TARGET_CLEARING})`);
  console.log(`customer=${customer.customerNo} viban=${viban.iban}`);
  console.log(`OPEN outstanding = ${outstanding.outstandingNo} (OUT, 5 ${CURRENCY}) swapId=${swapId}`);
  console.log(`\nNext: emit SWAP_SUCCEEDED({ swapId: '${swapId}', ownerId: '${customer.id}' })`);
  console.log('  or call the fiat settlement workflow directly, then drive both funds via');
  console.log('  fiat simulate endpoints (SUBMIT→CONFIRM hop1; hop2 auto-SUBMITs; CONFIRM hop2).');

  await ctx.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
