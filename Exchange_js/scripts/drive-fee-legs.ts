// One-off verification driver: drives all CREATED fee-settlement legs
// (SWAP_FEE_SETTLEMENT / WITHDRAW_FEE_SETTLEMENT, both rails) to CLEAR so the
// LOCKED FeeAccruals settle and F_FEE is credited. Boots the full app context
// (so @OnEvent + auto-clear fire). Reports F_FEE balances + accrual status.
import { webcrypto } from 'node:crypto';
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { FundsFlowService } from '../src/modules/funds-layer/domain/funds-flow.service';
import { InternalFundAction } from '../src/modules/asset-treasury/internal-funds/dto/internal-fund.dto';

const OP = 'FEEDRAIN';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const ctx = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma: any = ctx.get(PrismaService);
  const fundsFlow = ctx.get(FundsFlowService);

  async function driveFiatLeg(fundId: string) {
    await fundsFlow.updateStatus(fundId, { action: InternalFundAction.SUBMIT } as any, OP);
    await sleep(120);
    await fundsFlow.updateStatus(fundId, { action: InternalFundAction.CONFIRM } as any, OP);
    await sleep(250);
  }
  async function driveCryptoLeg(fundId: string) {
    for (const action of [
      InternalFundAction.SIGN, InternalFundAction.BROADCAST,
      InternalFundAction.SEEN_IN_MEMPOOL, InternalFundAction.CONFIRM,
    ]) {
      await fundsFlow.updateStatus(fundId, { action } as any, OP);
      await sleep(120);
    }
  }

  const feeTxs = await prisma.internalTransaction.findMany({
    where: { sourceType: { in: ['SWAP_FEE_SETTLEMENT', 'WITHDRAW_FEE_SETTLEMENT'] } },
  });
  console.log(`fee-settlement transfers: ${feeTxs.length}`);
  let driven = 0;
  for (const tx of feeTxs) {
    const leg = await prisma.internalFund.findFirst({
      where: { internalTransactionId: tx.id, status: { not: 'CLEAR' } },
    });
    if (!leg) continue;
    if (tx.medium === 'CHAIN') await driveCryptoLeg(leg.id);
    else await driveFiatLeg(leg.id);
    driven++;
  }
  console.log(`fee legs driven to CLEAR: ${driven}`);
  await sleep(600);

  const accr = await prisma.feeAccrual.groupBy({ by: ['category', 'status'], _count: { _all: true }, _sum: { amount: true } });
  console.log('\nfee_accruals by category/status:');
  for (const r of accr) console.log(`  ${r.category} ${r.status}: n=${r._count._all} Σ=${r._sum.amount}`);

  const ffee = await prisma.wallet.findMany({
    where: { walletRole: 'F_FEE' }, include: { asset: { select: { code: true } } },
  });
  console.log('\nF_FEE balances:');
  for (const w of ffee) console.log(`  ${w.asset.code}: ${w.mockBalance}`);

  await ctx.close();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
