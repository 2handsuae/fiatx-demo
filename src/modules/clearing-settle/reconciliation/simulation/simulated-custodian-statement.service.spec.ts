import { Prisma } from '@prisma/client';
import { SimulatedCustodianStatementService } from './simulated-custodian-statement.service';

describe('SimulatedCustodianStatementService（平账二期 Task 6）', () => {
  const wallets: Record<string, any> = { 'w-ops': { ownerType: 'PLATFORM' }, 'w-cust': { ownerType: 'CUSTOMER' } };
  const make = () => {
    const upserts: any[] = []; const updates: any[] = []; const creates: any[] = [];
    const prisma: any = {
      wallet: { findUnique: jest.fn(async ({ where }: any) => wallets[where.id] ?? null) },
      externalStatementLine: { upsert: jest.fn(async (args: any) => { upserts.push(args); return { id: `line-${upserts.length}` }; }) },
      externalBalance: {
        findUnique: jest.fn(async ({ where }: any) => (where.source_accountRef_cutoffDate.accountRef === 'w-ops' ? { id: 'eb-ops', closingBalance: new Prisma.Decimal('100000000000'), lineCount: 3 } : null)),
        update: jest.fn(async (args: any) => { updates.push(args); return {}; }),
        create: jest.fn(async (args: any) => { creates.push(args); return {}; }),
      },
    };
    const balanceChecker: any = { checkBalance: jest.fn(async () => ({ internal: { total: 2_992_500_000n }, coaCode: 'L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE', ownerNo: 'CU1' })) };
    return { svc: new SimulatedCustodianStatementService(prisma, balanceChecker), prisma, upserts, updates, creates, balanceChecker };
  };
  const at = new Date('2026-09-05T10:00:00.000Z');

  it('写两行：出方 OUT（公司账簿）、入方 IN（客户账簿），同参考号，dedupKey 按资金单号 + 钱包', async () => {
    const { svc, upserts } = make();
    const r = await svc.recordLegMovement({ fundsOrderNo: 'FO1', fromWalletId: 'w-ops', toWalletId: 'w-cust', assetCode: 'USDT-TRON', assetType: 'CRYPTO', amountMinor: 7_500_000n, externalRef: '0xleg1', at, description: 'sim' });
    expect(r.cutoffDate).toBe('2026-09-05');
    expect(upserts.map((u) => u.where.dedupKey)).toEqual(['SIM-FO1-w-ops', 'SIM-FO1-w-cust']);
    expect(upserts[0].create).toMatchObject({ source: 'HEXTRUST', accountRef: 'w-ops', subAccount: 'w-ops', book: 'FIRM', currency: 'USDT-TRON', direction: 'OUT', externalRef: '0xleg1' });
    expect(upserts[1].create).toMatchObject({ source: 'HEXTRUST', accountRef: 'w-cust', book: 'CLIENT', direction: 'IN', externalRef: '0xleg1' });
    expect(upserts[0].create.amount.toString()).toBe('7500000');
  });

  it('出方已有当日余额行 → 收盘减；入方没有 → 以引擎内部余额 + 本笔建行', async () => {
    const { svc, updates, creates, balanceChecker } = make();
    await svc.recordLegMovement({ fundsOrderNo: 'FO1', fromWalletId: 'w-ops', toWalletId: 'w-cust', assetCode: 'USDT-TRON', assetType: 'CRYPTO', amountMinor: 7_500_000n, externalRef: '0xleg1', at, description: 'sim' });
    expect(updates[0].data.closingBalance.toString()).toBe('99992500000');
    expect(creates[0].data).toMatchObject({ source: 'HEXTRUST', accountRef: 'w-cust', currency: 'USDT-TRON', book: 'CLIENT', cutoffDate: '2026-09-05', walletRef: 'w-cust', coaCode: 'L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE', ownerNo: 'CU1' });
    expect(creates[0].data.closingBalance.toString()).toBe('3000000000');
    expect(balanceChecker.checkBalance).toHaveBeenCalledWith({ walletRef: 'w-cust', externalClosing: 0n, cutoff: at });
  });

  it('法币走银行来源 ZAND', async () => {
    const { svc, upserts } = make();
    await svc.recordLegMovement({ fundsOrderNo: 'FO2', fromWalletId: 'w-ops', toWalletId: 'w-cust', assetCode: 'AED', assetType: 'FIAT', amountMinor: 90_000n, externalRef: 'BANK-1', at, description: 'sim' });
    expect(upserts[0].create.source).toBe('ZAND');
  });
});
