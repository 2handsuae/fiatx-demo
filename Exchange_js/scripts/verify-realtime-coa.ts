// scripts/verify-realtime-coa.ts
import { PrismaClient } from '@prisma/client';
import { createClient as tbCreateClient } from 'tigerbeetle-node';
import { TB_ACCOUNT_CODES } from '../src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant';

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
      const firmEquity = sumBal((r) => [TB_ACCOUNT_CODES.FIRM_OPS, TB_ACCOUNT_CODES.FIRM_SET, TB_ACCOUNT_CODES.FIRM_FEE, TB_ACCOUNT_CODES.FIRM_LIQ].includes(r.code));

      if (clientAsset !== clientLiab) { failures++; console.log(`✗ ledger ${ledger} CLIENT: asset=${clientAsset} liab=${clientLiab}`); }
      else console.log(`✓ ledger ${ledger} CLIENT 恒等 ${clientAsset}`);
      if (firmAsset !== firmEquity) { failures++; console.log(`✗ ledger ${ledger} FIRM: asset=${firmAsset} equity=${firmEquity}`); }
      else console.log(`✓ ledger ${ledger} FIRM 恒等 ${firmAsset}`);
    }
    if (failures > 0) { console.error(`FAIL: ${failures} invariant breaks`); process.exit(1); }
    console.log('ALL INVARIANTS PASS');
  } finally {
    tb.destroy();
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
