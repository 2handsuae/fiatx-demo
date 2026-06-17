// Recover any withdrawals stuck in CREATED state by re-triggering the
// withdraw-workflow listener. Idempotency latch handles the 5 already-advanced ones.

import { webcrypto } from 'node:crypto';
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { WithdrawWorkflowService } from '../src/modules/trading/withdraw-transactions/withdraw-workflow.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma: any = app.get(PrismaService);
  const workflow = app.get(WithdrawWorkflowService);

  const stuck = await prisma.withdrawTransaction.findMany({
    where: { status: 'CREATED' },
    select: { id: true, withdrawNo: true, ownerType: true, ownerId: true, assetId: true, amount: true, traceId: true, status: true },
  });
  console.log(`\n═══ Found ${stuck.length} withdrawals stuck in CREATED — re-triggering listener ═══\n`);

  for (const w of stuck) {
    console.log(`▶ ${w.withdrawNo} amount=${w.amount}`);
    try {
      await workflow.handleWithdrawalCreated({
        withdrawId: w.id,
        withdrawNo: w.withdrawNo,
        status: w.status,
        ownerType: w.ownerType,
        ownerId: w.ownerId,
        assetId: w.assetId,
        amount: String(w.amount),
        traceId: w.traceId ?? '',
      } as any);
      const after = await prisma.withdrawTransaction.findUnique({ where: { id: w.id }, select: { status: true } });
      console.log(`   → ${after?.status}`);
    } catch (err) {
      console.log(`   ✗ FAILED: ${(err as Error).message}`);
    }
  }

  console.log('\n═══ Final status distribution ═══');
  const dist = await prisma.$queryRawUnsafe(
    `SELECT status, COUNT(*) AS n FROM withdraw_transactions GROUP BY status ORDER BY status;`,
  );
  for (const r of dist as any[]) console.log(`  ${r.status}: ${r.n}`);

  await app.close();
  process.exit(0);
}

main().catch((err) => { console.error('FATAL', err); process.exit(1); });
