// Swap-only sim: for each of the 10 dep_c?? customers seeded by sim-deposits-only,
// run ONE swap (random direction, random amount within their available balance),
// then drive the fiat-settlement legs to CLEAR and any spawned fee-settlement
// legs to CLEAR so the swap fully completes (Outstanding + fee both SETTLED).
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

const OP = 'SWAP10';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function seeded(idx: number) {
  let s = idx * 0x10001 + 7919;
  return () => { s = (s * 1664525 + 1013904223) & 0x7fffffff; return s / 0x7fffffff; };
}
async function waitFor<T>(label: string, fn: () => Promise<T | null | undefined>, timeoutMs = 12000): Promise<T> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await fn(); if (r) return r;
    await sleep(150);
  }
  throw new Error(`timeout: ${label}`);
}

async function main() {
  const ctx = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma: any = ctx.get(PrismaService);
  const swapQuoteService = ctx.get(SwapQuoteService);
  const swapWorkflow = ctx.get(SwapWorkflowService);
  const fundsFlow = ctx.get(FundsFlowService);

  const usdt = await prisma.asset.findFirst({ where: { status: 'ACTIVE', type: 'CRYPTO', currency: 'USDT' } });
  const aed = await prisma.asset.findFirst({ where: { status: 'ACTIVE', type: 'FIAT', currency: 'AED' } });
  const custs = await prisma.customerMain.findMany({
    where: { email: { startsWith: 'dep_c' } },
    select: { id: true, customerNo: true, email: true },
    orderBy: { email: 'asc' },
  });
  if (custs.length === 0) throw new Error('no dep_c customers — run sim-deposits-only first');
  console.log(`\n═══ ${custs.length} customers × 1 swap each ═══`);

  async function driveFiatLeg(fundId: string) {
    await fundsFlow.updateStatus(fundId, { action: InternalFundAction.SUBMIT } as any, OP);
    await sleep(120);
    await fundsFlow.updateStatus(fundId, { action: InternalFundAction.CONFIRM } as any, OP);
    await sleep(250);
  }

  const swaps: any[] = [];
  for (let i = 0; i < custs.length; i++) {
    const c = custs[i];
    const idx = i + 1;
    const rnd = seeded(idx);

    // alternate direction by index for guaranteed variety (5 each way), random amount
    const usdtToAed = idx % 2 === 1;
    const from = usdtToAed ? usdt : aed;
    const to = usdtToAed ? aed : usdt;

    // pick amounts comfortably inside the deposited range (USDT 50..250, AED 200..1200)
    const amount = usdtToAed
      ? Math.round((50 + rnd() * 200))
      : Math.round((200 + rnd() * 1000));

    const quote = await swapQuoteService.createQuote({
      ownerType: 'CUSTOMER', ownerId: c.id, ownerNo: c.customerNo,
      fromAssetId: from.id, fromAssetCode: from.currency,
      toAssetId: to.id, toAssetCode: to.currency,
      amount: new Prisma.Decimal(amount), customerId: c.id,
    } as any);
    const swap = await swapWorkflow.executeSwap(c.id, quote.id);
    swaps.push({ c, dir: usdtToAed ? 'USDT→AED' : 'AED→USDT', amount, swapId: swap.id, swapNo: swap.swapNo, fee: swap.feeAmount, spread: swap.spreadAmount });
    console.log(`  ${c.customerNo}: ${swap.swapNo} ${usdtToAed ? 'USDT→AED' : 'AED→USDT'} ${amount} → ${swap.netToAmount} ${to.currency} (fee ${swap.feeAmount}, spread ${swap.spreadAmount})`);
  }

  // Drive swap-spawned FIAT settlement legs (FIAT_SETTLE_IN for buy-fiat, FIAT_SETTLE_OUT for sell-fiat).
  console.log('\n  driving swap-spawned FIAT settlement legs...');
  for (const s of swaps) {
    const settleTx: any = await waitFor(`FIAT settle tx for ${s.swapNo}`, () =>
      prisma.internalTransaction.findFirst({ where: { sourceType: 'FIAT_SETTLEMENT', sourceId: { startsWith: s.swapId } } }));
    const legs = await prisma.internalFund.findMany({ where: { internalTransactionId: settleTx.id }, orderBy: { createdAt: 'asc' } });
    const hop1 = legs[0];
    const hop2 = legs[1];
    await driveFiatLeg(hop1.id);
    if (hop2) {
      await waitFor(`${s.swapNo} hop2 CONFIRMING`, async () => {
        const f = await prisma.internalFund.findUnique({ where: { id: hop2.id } });
        return f && f.status === 'CONFIRMING' ? f : null;
      });
      await fundsFlow.updateStatus(hop2.id, { action: InternalFundAction.CONFIRM } as any, OP);
    }
  }
  await sleep(500);

  // Drive any swap-spawned FEE settlement legs (SWAP_FEE_SETTLEMENT, fiat immediate-settle).
  console.log('\n  driving SWAP_FEE legs (fiat immediate-settle)...');
  const feeTxs = await prisma.internalTransaction.findMany({
    where: { sourceType: 'SWAP_FEE_SETTLEMENT' },
  });
  let driven = 0;
  for (const tx of feeTxs) {
    const leg = await prisma.internalFund.findFirst({
      where: { internalTransactionId: tx.id, status: { not: 'CLEAR' } },
    });
    if (!leg) continue;
    if (tx.medium === 'CHAIN') {
      for (const action of [InternalFundAction.SIGN, InternalFundAction.BROADCAST, InternalFundAction.SEEN_IN_MEMPOOL, InternalFundAction.CONFIRM]) {
        await fundsFlow.updateStatus(leg.id, { action } as any, OP);
        await sleep(120);
      }
    } else {
      await driveFiatLeg(leg.id);
    }
    driven++;
  }
  console.log(`  fee legs driven: ${driven}`);

  // RECON
  console.log('\n═══ RECON ═══');
  const out = await prisma.outstanding.groupBy({
    by: ['assetCode', 'direction', 'status'], _count: { _all: true }, _sum: { amount: true },
  });
  console.log('outstandings (by asset/direction/status):');
  for (const r of out) console.log(`  ${r.assetCode} ${r.direction} ${r.status}: n=${r._count._all} Σ=${r._sum.amount}`);

  const acc = await prisma.feeAccrual.groupBy({
    by: ['category', 'status', 'assetCode'], _count: { _all: true }, _sum: { amount: true },
  });
  console.log('fee_accruals (by category/asset/status):');
  for (const r of acc) console.log(`  ${r.category} ${r.assetCode} ${r.status}: n=${r._count._all} Σ=${r._sum.amount}`);

  const ffee = await prisma.wallet.findMany({
    where: { walletRole: 'F_FEE' }, include: { asset: { select: { code: true } } },
  });
  console.log('F_FEE balances:');
  for (const w of ffee) console.log(`  ${w.asset.code}: ${w.mockBalance}`);

  console.log('\n═══ DONE ═══');
  await sleep(500);
  await ctx.close();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
