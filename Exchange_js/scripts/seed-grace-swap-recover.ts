// Recover Grace's SWP2606160102: re-trigger SWAP_SUCCEEDED listeners that
// were race-condition-aborted on first run. Idempotency latches in both
// listeners handle the partial state.

import { webcrypto } from 'node:crypto';
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { FiatSettlementWorkflowService } from '../src/modules/funds-layer/workflow/fiat-settlement-workflow.service';
import { FeeAccrualListenerService } from '../src/modules/funds-layer/workflow/fee-accrual-listener.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma: any = app.get(PrismaService);
  const fiatWf = app.get(FiatSettlementWorkflowService);
  const feeListener = app.get(FeeAccrualListenerService);

  const swap = await prisma.swapTransaction.findFirst({ where: { swapNo: 'SWP2606160102' } });
  if (!swap) throw new Error('SWP2606160102 not found');
  console.log(`\n═══ Recovering Grace swap ${swap.swapNo} (${swap.id}) ═══\n`);

  console.log('STEP 1 — re-run fee-accrual-listener.onSwapSucceeded (补 SPREAD if missing)');
  await feeListener.onSwapSucceeded({ swapId: swap.id } as any);
  console.log('  done\n');

  console.log('STEP 2 — re-run fiat-settlement-workflow.onSwapSucceeded (补 FIAT_SETTLE_OUT + LOCK outstanding)');
  await fiatWf.onSwapSucceeded({ swapId: swap.id } as any);
  console.log('  done\n');

  // Recon
  const fees = await prisma.feeAccrual.findMany({ where: { sourceNo: swap.swapNo } });
  const fiatTransfers = await prisma.internalTransaction.findMany({
    where: { sourceNo: swap.swapNo, pathLabel: { startsWith: 'FIAT_' } },
  });
  const outstandings = await prisma.outstanding.findMany({ where: { swapTransactionId: swap.id } });

  console.log('═══ Post-recovery state ═══');
  console.log(`fee_accruals (${fees.length}):`);
  for (const f of fees) console.log(`  ${f.feeAccrualNo} ${f.feeKind} ${f.amount} ${f.assetCode} status=${f.status}`);
  console.log(`fiat internal_transactions (${fiatTransfers.length}):`);
  for (const t of fiatTransfers) console.log(`  ${t.internalTxNo} ${t.pathLabel} amount=${t.amount} status=${t.status}`);
  console.log(`outstandings (${outstandings.length}):`);
  for (const o of outstandings) console.log(`  ${o.outstandingNo} ${o.direction} ${o.amount} ${o.assetCode} status=${o.status} batch=${o.settlementBatchId?.slice(0, 8) ?? 'NULL'}`);

  await app.close();
  process.exit(0);
}

main().catch((err) => { console.error('FATAL', err); process.exit(1); });
