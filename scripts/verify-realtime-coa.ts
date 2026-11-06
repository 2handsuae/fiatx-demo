// scripts/verify-realtime-coa.ts
import { PrismaClient } from '@prisma/client';
import { createClient as tbCreateClient } from 'tigerbeetle-node';
import { TB_ACCOUNT_CODES, TB_CODE_TO_COA, isDebitNormalCode } from '../src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant';

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
      const bal = isDebitNormalCode(a.code)
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

      // 戊波一·总纲附录 A「天平」：现金户按钱包开（每个客户钱包 / 公司钱包一户），按码求和即得合计，按币种（ledger）各算各的。
      //   客户本：Σ(1) == Σ(100) + Σ(101)
      //   公司本：Σ(50) + Σ(300..302) == Σ(200) + Σ(210..212)
      //   退役中的 201 / 203 在码表删除前余额恒 0，暂并入公司本右边不影响（T12 删码时一并去掉）。
      const sumCodes = (codes: number[]) => sumBal((r) => codes.includes(r.code));
      const clientAsset = sumCodes([TB_ACCOUNT_CODES.CLIENT_CASH]);
      const clientLiab = sumCodes([TB_ACCOUNT_CODES.CLIENT_PAYABLE, TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE]);
      const firmLeft = sumCodes([TB_ACCOUNT_CODES.FIRM_CASH, TB_ACCOUNT_CODES.EXPENSE_BANK_CUSTODY, TB_ACCOUNT_CODES.EXPENSE_RECON_LOSS, TB_ACCOUNT_CODES.EXPENSE_OTHER]);
      const firmRight = sumCodes([
        TB_ACCOUNT_CODES.FIRM_EQUITY, TB_ACCOUNT_CODES.FIRM_SET, TB_ACCOUNT_CODES.FIRM_LIQ,
        TB_ACCOUNT_CODES.INCOME_SWAP_FEE, TB_ACCOUNT_CODES.INCOME_WITHDRAW_FEE, TB_ACCOUNT_CODES.INCOME_OTHER,
      ]);

      if (clientAsset !== clientLiab) { failures++; console.log(`✗ ledger ${ledger} CLIENT: Σ(1)=${clientAsset} Σ(100)+Σ(101)=${clientLiab}`); }
      else console.log(`✓ ledger ${ledger} CLIENT 恒等 ${clientAsset}`);
      if (firmLeft !== firmRight) { failures++; console.log(`✗ ledger ${ledger} FIRM: Σ(50)+Σ(300..302)=${firmLeft} Σ(200)+Σ(210..212)=${firmRight}`); }
      else console.log(`✓ ledger ${ledger} FIRM 恒等 ${firmLeft}`);
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
      // 现金户的 ownerType 是 WALLET、ownerNo 是钱包号（户名 description 里也带着），负余额要能直接指到是哪个钱包。
      const owner = r.ownerType === 'SYSTEM' ? 'SYSTEM' : `${r.ownerType}:${r.ownerNo ?? r.ownerUuid}`;
      console.log(`✗ 负余额 ${label} ledger=${r.ledger} ${owner} balance=${bal}${r.description ? ` (${r.description})` : ''}`);
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
