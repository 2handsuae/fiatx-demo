// scripts/verify-tb-drain.ts
//
// LIVE end-to-end verification that V7's B-class drain zeroes the TigerBeetle
// TRADE_CLEARING and FEE_RECEIVABLE SYSTEM accounts after EOD settlement +
// fee collection.
//
// Run:
//   DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" \
//     npx ts-node -r tsconfig-paths/register scripts/verify-tb-drain.ts 2>&1 | tail -40
//
// Boots a headless Nest application context (no HTTP port), seeds minimal
// state (USDT asset + system wallets + TB clearing/fee balances + one OPEN
// OUT outstanding), runs the EOD + fee-collection workflows, and asserts the
// two drain accounts reach net 0.

import { webcrypto } from 'node:crypto';
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { AccountingService } from '../src/modules/accounting/tigerbeetle/accounting.service';
import { EodSettlementWorkflowService } from '../src/modules/funds-layer/workflow/eod-settlement-workflow.service';
import { FeeCollectionWorkflowService } from '../src/modules/funds-layer/workflow/fee-collection-workflow.service';
import { FundsFlowService } from '../src/modules/funds-layer/domain/funds-flow.service';
import { TB_ACCOUNT_CODES } from '../src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { TB_LEDGERS } from '../src/modules/accounting/tigerbeetle/constants/tb-ledgers.constant';

const LEDGER = TB_LEDGERS.USDT; // 2
const CURRENCY = 'USDT';
const RUN_TAG = Date.now().toString(); // unique per run → fresh source keys

async function ensureAsset(prisma: PrismaService) {
  const existing = await (prisma as any).asset.findFirst({
    where: { status: 'ACTIVE', type: 'CRYPTO', currency: CURRENCY },
  });
  if (existing) return existing;
  return (prisma as any).asset.create({
    data: {
      assetNo: `AST-VERIFY-USDT`,
      type: 'CRYPTO',
      currency: CURRENCY,
      code: 'USDT',
      network: 'TRC20',
      decimals: 6,
      status: 'ACTIVE',
      tbLedgerId: LEDGER,
    },
  });
}

async function ensureWallet(prisma: PrismaService, assetId: string, role: string) {
  const existing = await (prisma as any).wallet.findFirst({
    where: { walletRole: role, assetId, ownerType: 'PLATFORM', status: 'ACTIVE' },
  });
  if (existing) return existing;
  return (prisma as any).wallet.create({
    data: {
      walletNo: `WAL-VERIFY-${role}-${RUN_TAG}`,
      ownerType: 'PLATFORM',
      ownerId: 'PLATFORM',
      type: 'CRYPTO',
      walletRole: role,
      assetId,
      address: `mock-${role}-address`,
      status: 'ACTIVE',
    },
  });
}

// resolveTbAccountId throws if the account isn't registered yet, so create the
// SYSTEM TB account (TB + registry) on first use, then resolve.
async function ensureTbAccount(accounting: AccountingService, code: number) {
  try {
    return await accounting.resolveTbAccountId({ code, ledger: LEDGER, ownerType: 'SYSTEM' });
  } catch {
    await accounting.createAccounts([
      {
        code,
        ledger: LEDGER,
        ownerType: 'SYSTEM',
        assetCurrency: CURRENCY,
        description: `verify-tb-drain ${code}`,
      },
    ]);
    return accounting.resolveTbAccountId({ code, ledger: LEDGER, ownerType: 'SYSTEM' });
  }
}

function net(b: { creditsPosted: bigint; debitsPosted: bigint }) {
  return b.creditsPosted - b.debitsPosted;
}

async function main() {
  const ctx = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });

  const prisma = ctx.get(PrismaService);
  const accounting = ctx.get(AccountingService);
  const eod = ctx.get(EodSettlementWorkflowService);
  const fees = ctx.get(FeeCollectionWorkflowService);
  const fundsFlow = ctx.get(FundsFlowService);

  // ── 1. Minimal state ────────────────────────────────────────────────
  const asset = await ensureAsset(prisma);
  await ensureWallet(prisma, asset.id, 'C_MAIN');
  await ensureWallet(prisma, asset.id, 'F_LIQ');
  await ensureWallet(prisma, asset.id, 'F_OPS');

  const custodyId = await ensureTbAccount(accounting, TB_ACCOUNT_CODES.CLIENT_CUSTODY);
  const clearingId = await ensureTbAccount(accounting, TB_ACCOUNT_CODES.TRADE_CLEARING);
  const feeId = await ensureTbAccount(accounting, TB_ACCOUNT_CODES.FEE_RECEIVABLE);

  console.log(`asset=${asset.id} ledger=${LEDGER}`);
  console.log(`CUSTODY=${custodyId} TRADE_CLEARING=${clearingId} FEE_RECEIVABLE=${feeId}`);

  // ── 2. Seed TB so the drain accounts carry a CREDIT balance ──────────
  // CUSTODY is the genesis debit account in the deposit flow, so it can carry
  // a debit balance. Seed only the delta needed to reach the target net.
  const clearingBefore0 = net(await accounting.lookupBalance(clearingId));
  const feeBefore0 = net(await accounting.lookupBalance(feeId));

  const TARGET_CLEARING = 5_000_000n; // 5 USDT
  const TARGET_FEE = 1_000_000n; // 1 USDT

  const clearingSeed = TARGET_CLEARING - clearingBefore0;
  const feeSeed = TARGET_FEE - feeBefore0;

  if (clearingSeed > 0n) {
    await accounting.executeTransfer({
      debitAccountId: custodyId,
      creditAccountId: clearingId,
      amount: clearingSeed,
      ledger: LEDGER,
      code: TB_TRANSFER_CODES.SWAP_CREDIT_TO_CLEARING_POST,
      evidence: {
        sourceType: 'VERIFY_SEED',
        sourceNo: `SEED-CLEARING-${RUN_TAG}`,
        eventCode: 'VERIFY_SEED_CLEARING',
        debitCode: 'A.CLIENT_CUSTODY',
        creditCode: 'L.TRADE_CLEARING',
        assetCurrency: CURRENCY,
        traceId: `VERIFY:${RUN_TAG}`,
        actorType: 'SYSTEM',
        actorId: 'SYSTEM',
        memo: 'verify-tb-drain seed TRADE_CLEARING',
      },
    });
  }

  if (feeSeed > 0n) {
    await accounting.executeTransfer({
      debitAccountId: custodyId,
      creditAccountId: feeId,
      amount: feeSeed,
      ledger: LEDGER,
      code: TB_TRANSFER_CODES.SWAP_CREDIT_TO_FEE,
      evidence: {
        sourceType: 'VERIFY_SEED',
        sourceNo: `SEED-FEE-${RUN_TAG}`,
        eventCode: 'VERIFY_SEED_FEE',
        debitCode: 'A.CLIENT_CUSTODY',
        creditCode: 'L.FEE_RECEIVABLE',
        assetCurrency: CURRENCY,
        traceId: `VERIFY:${RUN_TAG}`,
        actorType: 'SYSTEM',
        actorId: 'SYSTEM',
        memo: 'verify-tb-drain seed FEE_RECEIVABLE',
      },
    });
  }

  // ── 3. Outstanding so EOD has work (net = IN−OUT = −5 → INTERNAL_OUT) ──
  await (prisma as any).outstanding.create({
    data: {
      outstandingNo: `OUT-VERIFY-${RUN_TAG}`,
      sourceType: 'SWAP',
      sourceId: `VERIFY-SWAP-${RUN_TAG}`,
      sourceNo: `VERIFY-SWAP-${RUN_TAG}`,
      ownerType: 'PLATFORM',
      ownerId: 'PLATFORM',
      direction: 'OUT',
      assetId: asset.id,
      assetCode: CURRENCY,
      amount: '5',
      status: 'OPEN',
    },
  });

  // ── 4. BEFORE balances ───────────────────────────────────────────────
  const clearingBefore = net(await accounting.lookupBalance(clearingId));
  const feeBefore = net(await accounting.lookupBalance(feeId));
  console.log('\n=== BEFORE ===');
  console.log(`TRADE_CLEARING net = ${clearingBefore} (expect 5000000)`);
  console.log(`FEE_RECEIVABLE net = ${feeBefore} (expect 1000000)`);

  // ── 5. Run settlement + fee collection ───────────────────────────────
  let eodResult: any = null;
  let feeResult: any = null;
  let eodError: string | null = null;
  let feeError: string | null = null;
  try {
    eodResult = await eod.runEodSettlement('VERIFY');
    console.log('\nrunEodSettlement →', JSON.stringify(eodResult));
  } catch (err: any) {
    eodError = err?.response?.message ?? err?.message ?? String(err);
    console.log('\nrunEodSettlement THREW →', eodError);
  }
  try {
    feeResult = await fees.runFeeCollection('VERIFY');
    console.log('runFeeCollection →', JSON.stringify(feeResult));
  } catch (err: any) {
    feeError = err?.response?.message ?? err?.message ?? String(err);
    console.log('runFeeCollection THREW →', feeError);
  }

  // ── 6. AFTER balances ────────────────────────────────────────────────
  const clearingAfter = net(await accounting.lookupBalance(clearingId));
  const feeAfter = net(await accounting.lookupBalance(feeId));
  console.log('\n=== AFTER ===');
  console.log(`TRADE_CLEARING net = ${clearingAfter}`);
  console.log(`FEE_RECEIVABLE net = ${feeAfter}`);

  // ── 7. Best-effort: drive spawned funds-flow legs → CLEAR, check SETTLED ─
  let clearedNote = 'skipped';
  try {
    const batchNos = [eodResult?.batchNo, feeResult?.batchNo].filter(Boolean);
    const flows = batchNos.length === 0 ? [] : await (prisma as any).internalFund.findMany({
      where: {
        internalTransaction: {
          sourceType: { in: ['EOD_SETTLEMENT', 'FEE_COLLECTION'] },
          sourceNo: { in: batchNos },
        },
      },
      select: { id: true, status: true },
    });
    const seq = ['SIGN', 'BROADCAST', 'SEEN_IN_MEMPOOL', 'CONFIRM', 'CLEAR'];
    for (const f of flows) {
      for (const action of seq) {
        await fundsFlow.updateStatus(f.id, { action } as any, 'VERIFY');
      }
    }
    // Let the FUNDSFLOW_STATUS_CHANGED event handlers run.
    await new Promise((r) => setTimeout(r, 300));
    const settled = await (prisma as any).outstanding.count({
      where: { sourceId: `VERIFY-SWAP-${RUN_TAG}`, status: 'SETTLED' },
    });
    clearedNote = `${flows.length} funds-flow(s) driven to CLEAR; Outstanding SETTLED count=${settled}`;
  } catch (err: any) {
    clearedNote = `CLEAR drive failed (non-fatal): ${err?.message ?? err}`;
  }
  console.log(`\nCLEAR step: ${clearedNote}`);

  // ── 8. ASSERT ────────────────────────────────────────────────────────
  const clearingPass = clearingAfter === 0n;
  const feePass = feeAfter === 0n;
  console.log('\n=== VERDICT ===');
  console.log(
    `TRADE_CLEARING: ${clearingPass ? 'PASS' : 'FAIL'} (before=${clearingBefore} after=${clearingAfter})`,
  );
  console.log(
    `FEE_RECEIVABLE: ${feePass ? 'PASS' : 'FAIL'} (before=${feeBefore} after=${feeAfter})`,
  );
  if (eodError) console.log(`EOD workflow error: ${eodError}`);
  if (feeError) console.log(`Fee workflow error: ${feeError}`);

  await ctx.close();
  process.exit(clearingPass && feePass ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
