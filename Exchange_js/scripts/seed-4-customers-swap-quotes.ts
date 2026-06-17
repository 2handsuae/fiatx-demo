// Create 1 swap per non-frozen customer (Alice/Bob/Frank/Grace = 4 of the 5 picks).
// Each swap = 1 quote + 1 executeSwap = 8 entities total.
// Direction alternates so we exercise both USDT→AED and AED→USDT paths.

import { webcrypto } from 'node:crypto';
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;

import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { SwapQuoteService } from '../src/modules/trading/swap-fee-level/swap-quote.service';
import { SwapWorkflowService } from '../src/modules/trading/swap-transactions/swap-workflow.service';

// Carol is the 'Frozen' one — skipped per user spec.
const PICKS = ['Alice', 'Bob', 'Frank', 'Grace'];

// idx % 2 === 0 → USDT→AED, else AED→USDT
function pickDirection(idx: number): 'USDT_TO_AED' | 'AED_TO_USDT' {
  return idx % 2 === 0 ? 'USDT_TO_AED' : 'AED_TO_USDT';
}

function amountFor(direction: 'USDT_TO_AED' | 'AED_TO_USDT', idx: number): number {
  // Deterministic but distinct per customer:
  //   USDT→AED: 100..400 USDT
  //   AED→USDT: 500..2000 AED
  const seed = (idx * 7) % 5;
  if (direction === 'USDT_TO_AED') return Math.round((100 + seed * 75) * 100) / 100;
  return Math.round((500 + seed * 375) * 100) / 100;
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma: any = app.get(PrismaService);
  const swapQuote = app.get(SwapQuoteService);
  const swapWorkflow = app.get(SwapWorkflowService);

  const usdt = await prisma.asset.findFirst({ where: { currency: 'USDT' } });
  const aed = await prisma.asset.findFirst({ where: { currency: 'AED' } });
  if (!usdt || !aed) throw new Error('missing usdt/aed');

  const customers = await prisma.customerMain.findMany({
    where: { firstName: { in: PICKS } },
    select: { id: true, customerNo: true, firstName: true, lastName: true },
  });
  if (customers.length < 4) throw new Error(`expected 4 customers, got ${customers.length}`);

  console.log(`\n═══ Creating 4 swaps (skipped Carol/Frozen) — 4 quotes + 4 executeSwap = 8 entities ═══\n`);

  for (let i = 0; i < customers.length; i++) {
    const c = customers[i];
    const direction = pickDirection(i);
    const amount = amountFor(direction, i);
    const isUsdtToAed = direction === 'USDT_TO_AED';
    const fromAsset = isUsdtToAed ? usdt : aed;
    const toAsset = isUsdtToAed ? aed : usdt;

    console.log(`── ${c.customerNo} ${c.firstName} ${c.lastName}  [${direction.replace('_TO_', '→')}] ──`);

    // STEP 1 — Quote
    const quote: any = await swapQuote.createQuote({
      ownerType: 'CUSTOMER',
      ownerId: c.id,
      ownerNo: c.customerNo,
      fromAssetId: fromAsset.id,
      fromAssetCode: fromAsset.currency,
      toAssetId: toAsset.id,
      toAssetCode: toAsset.currency,
      amount: new Prisma.Decimal(amount),
      customerId: c.id,
    } as any);
    console.log(`   QUOTE  ${quote.id.slice(0, 8)}  rate=${quote.rateDisplay}  in=${quote.amountIn} ${quote.currencyIn}  out=${quote.amountOut} ${quote.currencyOut}  spread=${quote.spreadBps}bps  expires=${new Date(quote.expiresAt).toLocaleTimeString()}`);

    // STEP 2 — Execute swap
    const swap: any = await swapWorkflow.executeSwap(c.id, quote.id);
    console.log(`   SWAP   ${swap.swapNo}  ${swap.fromAmount} ${swap.fromAssetCode} → net ${swap.netToAmount} ${swap.toAssetCode}  fee=${swap.feeAmount} spread=${swap.spreadAmount}  status=${swap.status}`);
    console.log();
  }

  const totalQuotes = await prisma.swapQuote.count();
  const totalSwaps = await prisma.swapTransaction.count();
  console.log(`═══ DONE — total quotes=${totalQuotes}  swaps=${totalSwaps}  (= 8 entities) ═══\n`);

  await app.close();
  process.exit(0);
}

main().catch((err) => { console.error('FATAL', err); process.exit(1); });
