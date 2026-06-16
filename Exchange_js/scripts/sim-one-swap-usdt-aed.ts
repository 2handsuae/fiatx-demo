// Run exactly ONE USDT→AED swap on Sim01 customer (CU2601017032)
// and report swapNo so we can show full trace.

import { webcrypto } from 'node:crypto';
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;

import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { SwapQuoteService } from '../src/modules/trading/swap-fee-level/swap-quote.service';
import { SwapWorkflowService } from '../src/modules/trading/swap-transactions/swap-workflow.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const prisma = app.get(PrismaService);
  const swapQuoteService = app.get(SwapQuoteService);
  const swapWorkflow = app.get(SwapWorkflowService);

  const usdt = await prisma.asset.findFirst({ where: { currency: 'USDT' } });
  const aed = await prisma.asset.findFirst({ where: { currency: 'AED' } });
  // Spec #6 T4 recon — use Alice (CU2601019430), seeded by dev:reset:branch
  const cust: any = await prisma.customerMain.findFirst({
    where: { firstName: 'Alice', lastName: 'Happy' },
  }) || await prisma.customerMain.findFirst({
    where: { firstName: 'Sim01', lastName: 'E2E' },
  });
  if (!usdt || !aed || !cust) throw new Error('missing usdt/aed/customer');

  const amount = 200; // 200 USDT → AED

  console.log(`\n═══ Customer ${cust.customerNo} (${cust.firstName}) about to swap ${amount} USDT → AED ═══\n`);

  // STEP 1: Get a price quote
  console.log('STEP 1 — creating quote ...');
  const quote: any = await swapQuoteService.createQuote({
    ownerType: 'CUSTOMER',
    ownerId: cust.id,
    ownerNo: cust.customerNo,
    fromAssetId: usdt.id,
    fromAssetCode: usdt.currency,
    toAssetId: aed.id,
    toAssetCode: aed.currency,
    amount: new Prisma.Decimal(amount),
    customerId: cust.id,
  } as any);
  console.log(`  → quote.id      = ${quote.id}`);
  console.log(`  → quote.traceId = ${quote.traceId}`);
  console.log(`  → rate display  = ${quote.rateDisplay}  (market = ${quote.marketRate}, spread ${quote.spreadBps}bps)`);
  console.log(`  → in            = ${quote.amountIn} ${quote.currencyIn}`);
  console.log(`  → out (gross)   = ${quote.amountOut} ${quote.currencyOut}`);
  console.log(`  → expires       = ${quote.expiresAt}`);

  // STEP 2: Execute the swap
  console.log('\nSTEP 2 — executing swap ...');
  const swap: any = await swapWorkflow.executeSwap(cust.id, quote.id);
  console.log(`  → swap.id        = ${swap.id}`);
  console.log(`  → swap.swapNo    = ${swap.swapNo}`);
  console.log(`  → swap.traceId   = ${swap.traceId}`);
  console.log(`  → fromAmount     = ${swap.fromAmount} ${swap.fromAssetCode}`);
  console.log(`  → toAmount gross = ${swap.toAmount} ${swap.toAssetCode}`);
  console.log(`  → netToAmount    = ${swap.netToAmount} ${swap.toAssetCode}`);
  console.log(`  → feeAmount      = ${swap.feeAmount} ${swap.feeCurrency}`);
  console.log(`  → spreadAmount   = ${swap.spreadAmount} ${swap.feeCurrency}`);
  console.log(`  → status         = ${swap.status}`);

  // STEP 3: Wait for SWAP_SUCCEEDED listeners to finish
  console.log('\nSTEP 3 — waiting 5s for SWAP_SUCCEEDED listeners (fiat-settlement-workflow + fee-accrual-listener) ...');
  await new Promise((r) => setTimeout(r, 5000));

  // STEP 4: Verify what listeners produced
  const itxs = await (prisma as any).internalTransaction.findMany({
    where: { sourceId: { startsWith: swap.id } },
  });
  console.log(`  → internal_transactions for this swap: ${itxs.length}`);
  for (const itx of itxs) {
    console.log(`    · ${itx.internalTxNo} ${itx.pathLabel} status=${itx.status}`);
  }
  const accs = await (prisma as any).feeAccrual.findMany({
    where: { sourceType: 'SWAP', sourceId: swap.id },
  });
  console.log(`  → fee_accruals for this swap: ${accs.length}`);
  for (const a of accs) {
    console.log(`    · ${a.feeAccrualNo} ${a.feeKind} ${a.amount} ${a.assetCode} status=${a.status}`);
  }

  console.log(`\n═══ DONE — swapNo = ${swap.swapNo} (traceId = ${swap.traceId}) ═══\n`);

  await app.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
