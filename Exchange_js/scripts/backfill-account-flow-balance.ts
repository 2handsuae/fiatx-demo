// scripts/backfill-account-flow-balance.ts
//
// 历史行回填：为 account_flows.balanceAfter 为 null 的 POSTED 行重建"当时余额"。
// 逐账户按 createdAt 升序累加，类别感知（资产借正=OUT 加；负债/权益贷正=IN 加）。
// 幂等：每次从头重算，重跑结果一致。非 POSTED 行（PENDING/VOID_PENDING 等）保持 null，不触碰。
import { PrismaClient } from '@prisma/client';
import { isAssetCode } from '../src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant';

const prisma = new PrismaClient();

async function main() {
  const accountIds: { tbAccountId: string }[] =
    await prisma.$queryRawUnsafe(`SELECT DISTINCT tbAccountId FROM account_flows`);
  let touched = 0;
  for (const { tbAccountId } of accountIds) {
    const reg = await (prisma as any).tbAccountRegistry.findUnique({ where: { tbAccountId } });
    const asset = reg ? isAssetCode(reg.code) : true;
    const rows = await (prisma as any).accountFlow.findMany({
      where: { tbAccountId, transferType: 'POSTED' },
      orderBy: { createdAt: 'asc' },
    });
    let bal = 0n;
    for (const r of rows) {
      const amt = BigInt(r.amount.toString().split('.')[0]); // 分，整数
      // 该账户上：IN=贷方，OUT=借方。资产借正、负债贷正。
      const up = asset ? r.direction === 'OUT' : r.direction === 'IN';
      bal += up ? amt : -amt;
      await (prisma as any).accountFlow.update({ where: { id: r.id }, data: { balanceAfter: bal.toString() } });
      touched++;
    }
  }
  console.log(`backfilled balanceAfter on ${touched} POSTED rows`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
