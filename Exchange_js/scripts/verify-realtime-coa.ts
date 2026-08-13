// scripts/verify-realtime-coa.ts
import { PrismaClient } from '@prisma/client';
import { createClient as tbCreateClient } from 'tigerbeetle-node';
import { TB_ACCOUNT_CODES, TB_CODE_TO_COA } from '../src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant';

const ASSET = new Set<number>([TB_ACCOUNT_CODES.CLIENT_ASSET, TB_ACCOUNT_CODES.FIRM_ASSET]);

async function main() {
  const prisma = new PrismaClient();
  const tbAddress = process.env.TB_ADDRESS;
  if (!tbAddress) throw new Error('TB_ADDRESS not set');
  const tb = tbCreateClient({ cluster_id: 0n, replica_addresses: [tbAddress] });
  try {
    const regs = await (prisma as any).tbAccountRegistry.findMany({ where: { status: 'ACTIVE' } });
    const accounts = await tb.lookupAccounts(regs.map((r: any) => BigInt('0x' + r.tbAccountId)));
    const balById = new Map<string, bigint>();
    for (const a of accounts) {
      const isAsset = ASSET.has(a.code);
      const bal = isAsset
        ? a.debits_posted - a.credits_posted
        : a.credits_posted - a.debits_posted;
      balById.set(a.id.toString(), bal);
    }
    const ledgers = [...new Set(regs.map((r: any) => r.ledger))];
    let failures = 0;
    for (const ledger of ledgers) {
      const inLedger = regs.filter((r: any) => r.ledger === ledger);
      const sumBal = (pred: (r: any) => boolean) =>
        inLedger.filter(pred).reduce((s: bigint, r: any) => s + (balById.get(BigInt('0x' + r.tbAccountId).toString()) ?? 0n), 0n);

      const clientAsset = sumBal((r) => r.code === TB_ACCOUNT_CODES.CLIENT_ASSET);
      const clientLiab = sumBal((r) => r.code === TB_ACCOUNT_CODES.CLIENT_PAYABLE || r.code === TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE);
      const firmAsset = sumBal((r) => r.code === TB_ACCOUNT_CODES.FIRM_ASSET);
      const firmEquity = sumBal((r) => [TB_ACCOUNT_CODES.FIRM_OPS, TB_ACCOUNT_CODES.FIRM_SET, TB_ACCOUNT_CODES.INCOME_SWAP_FEE, TB_ACCOUNT_CODES.INCOME_WITHDRAW_FEE, TB_ACCOUNT_CODES.INCOME_OTHER].includes(r.code));

      if (clientAsset !== clientLiab) { failures++; console.log(`✗ ledger ${ledger} CLIENT: asset=${clientAsset} liab=${clientLiab}`); }
      else console.log(`✓ ledger ${ledger} CLIENT 恒等 ${clientAsset}`);
      if (firmAsset !== firmEquity) { failures++; console.log(`✗ ledger ${ledger} FIRM: asset=${firmAsset} equity=${firmEquity}`); }
      else console.log(`✓ ledger ${ledger} FIRM 恒等 ${firmAsset}`);
    }
    // 负余额断言:任何科目(class-aware 口径)余额都不得为负。
    // 两条恒等式只比"总数对不对",对"某个客户账户被记成负数"是瞎的——凭空造余额
    // 与超额提现这两类错账恰好两边同增同减,恒等式照样全绿。这条是唯一能报警的。
    const negatives = regs
      .map((r: any) => ({ r, bal: balById.get(BigInt('0x' + r.tbAccountId).toString()) ?? 0n }))
      .filter((x: any) => x.bal < 0n);
    for (const { r, bal } of negatives) {
      failures++;
      const label = TB_CODE_TO_COA[r.code] ?? `code=${r.code}`;
      const owner = r.ownerType === 'SYSTEM' ? 'SYSTEM' : `${r.ownerType}:${r.ownerNo ?? r.ownerUuid}`;
      console.log(`✗ 负余额 ${label} ledger=${r.ledger} ${owner} balance=${bal}`);
    }
    if (negatives.length === 0) console.log(`✓ 负余额检查 通过 (${regs.length} 个科目全部 ≥ 0)`);

    if (failures > 0) { console.error(`FAIL: ${failures} invariant breaks`); process.exit(1); }
    console.log('ALL INVARIANTS PASS');
  } finally {
    tb.destroy();
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
