// scripts/backfill-account-flow-balance.ts
//
// 历史行回填：为 account_flows.balanceAfter 为 null 的 POSTED 行重建"当时余额"。
// 逐账户按 createdAt 升序累加。direction 在入库时已是「钱进这个户 = IN」（借方户借 = IN、贷方户贷 = IN），
// 所以任何账户类别都是 IN 加、OUT 减，不再按类别翻转。
// 幂等：每次从头重算，重跑结果一致。非 POSTED 行（PENDING/VOID_PENDING 等）保持 null，不触碰。
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const accountIds: { tbAccountId: string }[] =
    await prisma.$queryRawUnsafe(`SELECT DISTINCT tbAccountId FROM account_flows`);
  let touched = 0;
  for (const { tbAccountId } of accountIds) {
    const rows = await (prisma as any).accountFlow.findMany({
      where: { tbAccountId, transferType: 'POSTED' },
      orderBy: { createdAt: 'asc' },
    });
    let bal = 0n;
    for (const r of rows) {
      const amt = BigInt(r.amount.toString().split('.')[0]); // 分，整数
      bal += r.direction === 'IN' ? amt : -amt;
      await (prisma as any).accountFlow.update({ where: { id: r.id }, data: { balanceAfter: bal.toString() } });
      touched++;
    }
  }
  console.log(`backfilled balanceAfter on ${touched} POSTED rows`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
