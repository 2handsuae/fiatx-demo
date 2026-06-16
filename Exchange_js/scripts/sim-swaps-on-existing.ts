// scripts/sim-swaps-on-existing.ts
//
// Runs 10 random-direction random-amount swaps on the existing Sim01..Sim10
// customers (CU2601017032..CU2601018666) created by sim-e2e-demo. Does NOT
// reset the DB, does NOT create new customers. Used when sim-e2e-demo TASK 3
// has been blocked by the cross-cutting SQLite tx-timeout (P2028) issue.
//
// REQUIRES: swap-workflow.service.ts tx timeout temporarily raised to 30s
// (revert after this run — do not commit).
//
// Run:
//   DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" TB_ADDRESS=127.0.0.1:3503 \
//     node -r ts-node/register -r tsconfig-paths/register scripts/sim-swaps-on-existing.ts

import { webcrypto } from 'node:crypto';
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;

import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { SwapQuoteService } from '../src/modules/trading/swap-fee-level/swap-quote.service';
import { SwapWorkflowService } from '../src/modules/trading/swap-transactions/swap-workflow.service';
import { FundsFlowService } from '../src/modules/funds-layer/domain/funds-flow.service';
import { InternalFundAction } from '../src/modules/asset-treasury/internal-funds/dto/internal-fund.dto';

const SIM = 'SIME2E-SWAPS-ONLY';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(
  label: string,
  fn: () => Promise<T | null | undefined | false>,
  timeoutMs = 15000,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() - start > timeoutMs)
      throw new Error(`Timeout (${timeoutMs}ms) waiting for: ${label}`);
    await sleep(120);
  }
}

// Deterministic-per-customer "random"
function seeded(idx: number): () => number {
  let s = idx * 2654435761;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const prisma = app.get(PrismaService);
  const swapQuoteService = app.get(SwapQuoteService);
  const swapWorkflow = app.get(SwapWorkflowService);
  const fundsFlow = app.get(FundsFlowService);

  async function driveFiatLeg(fundId: string) {
    await fundsFlow.updateStatus(fundId, { action: InternalFundAction.SUBMIT } as any, SIM);
    await sleep(120);
    await fundsFlow.updateStatus(fundId, { action: InternalFundAction.CONFIRM } as any, SIM);
    await sleep(250);
  }

  // Load assets
  const usdt = await prisma.asset.findFirst({ where: { currency: 'USDT' } });
  const aed = await prisma.asset.findFirst({ where: { currency: 'AED' } });
  if (!usdt || !aed) throw new Error('USDT or AED asset missing');

  // Load 10 Sim customers (last names = 'E2E')
  const custs = await prisma.customerMain.findMany({
    where: { lastName: 'E2E', firstName: { startsWith: 'Sim' } },
    orderBy: { firstName: 'asc' },
    take: 10,
  });
  if (custs.length < 10) throw new Error(`Expected 10 Sim01..Sim10 customers, found ${custs.length}`);

  console.log(`\n═══ Found ${custs.length} Sim customers: ${custs.map((c: any) => c.customerNo).join(', ')} ═══\n`);

  console.log('═══ Running 10× random swaps ═══');
  const swaps: any[] = [];
  for (let i = 0; i < custs.length; i++) {
    const c: any = custs[i];
    const idx = i + 1;
    const rnd = seeded(idx);
    const usdtToAed = idx % 2 === 1; // alternate: 5 USDT→AED, 5 AED→USDT
    const from = usdtToAed ? usdt : aed;
    const to = usdtToAed ? aed : usdt;
    const amount = usdtToAed
      ? Math.round(50 + rnd() * 450) // 50..500 USDT
      : Math.round(200 + rnd() * 1800); // 200..2000 AED

    // Wait between swaps so prior tx releases SQLite write lock + audit-logs
    // independent prisma connection has time to drain (backlog B1 workaround).
    if (i > 0) await new Promise((r) => setTimeout(r, 2000));

    try {
      const quote: any = await swapQuoteService.createQuote({
        ownerType: 'CUSTOMER',
        ownerId: c.id,
        ownerNo: c.customerNo,
        fromAssetId: from.id,
        fromAssetCode: from.currency,
        toAssetId: to.id,
        toAssetCode: to.currency,
        amount: new Prisma.Decimal(amount),
        customerId: c.id,
      } as any);
      const swap: any = await swapWorkflow.executeSwap(c.id, quote.id);
      swaps.push({
        customer: c.customerNo,
        dir: usdtToAed ? 'USDT→AED' : 'AED→USDT',
        amount,
        swapNo: swap.swapNo,
        swapId: swap.id,
        toAmount: swap.toAmount,
        netToAmount: swap.netToAmount,
        fee: swap.feeAmount,
        spread: swap.spreadAmount,
      });
      console.log(
        `  ${c.customerNo}: ${swap.swapNo} ${usdtToAed ? 'USDT→AED' : 'AED→USDT'} ${amount} → ${swap.toAmount} (net ${swap.netToAmount}, fee ${swap.feeAmount}, spread ${swap.spreadAmount})`,
      );
    } catch (err: any) {
      console.error(`  ${c.customerNo}: FAIL — ${err.code ?? ''} ${err.message?.slice(0, 200)}`);
    }
  }

  console.log(`\n═══ Completed ${swaps.length} / ${custs.length} swaps ═══`);

  // ════════════════════════════════════════════════════════════════
  // Drive FIAT_SETTLE_IN hop1/hop2 to CLEAR so collectSwapFees fires
  // (creates fiat-side FeeAccrual rows for USDT→AED direction swaps).
  // ════════════════════════════════════════════════════════════════
  console.log('\n═══ Driving FIAT_SETTLE_IN legs for fiat-side swaps (USDT→AED) ═══');
  const fiatSwaps = swaps.filter((s: any) => s.dir === 'USDT→AED');
  for (const s of fiatSwaps) {
    try {
      const settleTx: any = await waitFor(`FIAT settle tx for ${s.swapNo}`, () =>
        (prisma as any).internalTransaction.findFirst({
          where: { sourceType: 'FIAT_SETTLEMENT', sourceId: { startsWith: s.swapId } },
        }),
      );
      const legs = await (prisma as any).internalFund.findMany({
        where: { internalTransactionId: settleTx.id },
        orderBy: { createdAt: 'asc' },
      });
      const hop1 = legs[0];
      const hop2 = legs[1];
      await driveFiatLeg(hop1.id);
      if (hop2) {
        await waitFor(`${s.swapNo} hop2 CONFIRMING`, async () => {
          const f = await (prisma as any).internalFund.findUnique({ where: { id: hop2.id } });
          return f && f.status === 'CONFIRMING' ? f : null;
        });
        await fundsFlow.updateStatus(hop2.id, { action: InternalFundAction.CONFIRM } as any, SIM);
      }
      console.log(`  ${s.swapNo}: hop1+hop2 driven to CLEAR`);
    } catch (err: any) {
      console.error(`  ${s.swapNo}: FAIL — ${err.code ?? ''} ${err.message?.slice(0, 150)}`);
    }
  }
  await sleep(500);

  console.log(`\n═══ All done. Query DB: ═══`);
  console.log(`  sqlite3 /tmp/exchange_js_branch/dev.db "SELECT feeAccrualNo, sourceNo, feeKind, assetCode, amount, status FROM fee_accruals ORDER BY createdAt DESC LIMIT 30;"`);

  await app.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
