// src/modules/asset-treasury/lp-desk/lp-receivable-account.service.spec.ts
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { LpReceivableAccountService } from './lp-receivable-account.service';

const LP_ID = '9b2f6d1e-3c4a-4f58-8a77-0d1e2f3a4b5c';
const LP_ROW = { id: LP_ID, lpNo: 'LPP2611070001', name: 'Falcon Liquidity FZE' };

/**
 * LP 档案 →ACTIVE → 开它的应收户（码 51，每 ledger 一户：AED + USDT）。
 * AccountingService 用真实实例（只替掉 TB 与注册表底层依赖），flags / 注册表四元组是被行为验到的，而不是读自己写的 mock。
 */
describe('LpReceivableAccountService', () => {
  let tb: { createAccounts: jest.Mock };
  let registry: { register: jest.Mock; resolve: jest.Mock };
  let prisma: { liquidityProvider: { findUniqueOrThrow: jest.Mock } };
  let service: LpReceivableAccountService;

  beforeEach(() => {
    tb = { createAccounts: jest.fn().mockResolvedValue([]) };
    registry = {
      register: jest.fn().mockResolvedValue({}),
      resolve: jest.fn().mockResolvedValue(null),
    };
    prisma = { liquidityProvider: { findUniqueOrThrow: jest.fn().mockResolvedValue(LP_ROW) } };
    const accounting = new AccountingService(tb as any, registry as any, {} as any, {} as any);
    service = new LpReceivableAccountService(prisma as any, accounting, registry as any);
  });

  it("opens code 51 on both ledgers (AED 1 + USDT 2) with ownerType 'LP', ownerUuid = lp.id, ownerNo = lpNo, flags 4", async () => {
    const tx: any = { liquidityProvider: { findUniqueOrThrow: jest.fn().mockResolvedValue(LP_ROW) } };
    await service.ensureForLp(LP_ID, tx);

    // 档案行经同一事务读（tx 优先，不另走全局 prisma）
    expect(tx.liquidityProvider.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: LP_ID } });
    expect(prisma.liquidityProvider.findUniqueOrThrow).not.toHaveBeenCalled();
    // 先按 ledger 逐个查是否已有注册行
    expect(registry.resolve).toHaveBeenCalledWith({ code: 51, ledger: 1, ownerType: 'LP', ownerUuid: LP_ID }, tx);
    expect(registry.resolve).toHaveBeenCalledWith({ code: 51, ledger: 2, ownerType: 'LP', ownerUuid: LP_ID }, tx);
    // TB 侧：一批两户
    expect(tb.createAccounts).toHaveBeenCalledTimes(1);
    const tbAccounts = tb.createAccounts.mock.calls[0][0];
    expect(tbAccounts.map((a: any) => [a.code, a.ledger, a.flags])).toEqual([[51, 1, 4], [51, 2, 4]]);
    // 注册表侧：四元组 + ownerNo = lpNo + 户名进 description
    expect(registry.register).toHaveBeenCalledTimes(2);
    expect(registry.register).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 51, ledger: 1, ownerType: 'LP', ownerUuid: LP_ID, ownerNo: 'LPP2611070001',
        assetCurrency: 'AED', description: 'Due from LP · Falcon Liquidity FZE', flags: 4,
      }),
      tx,
    );
    expect(registry.register).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 51, ledger: 2, ownerType: 'LP', ownerUuid: LP_ID, ownerNo: 'LPP2611070001',
        assetCurrency: 'USDT', description: 'Due from LP · Falcon Liquidity FZE', flags: 4,
      }),
      tx,
    );
  });

  it('returns without createAccounts when both registry rows already exist (reactivate of an LP that had them)', async () => {
    registry.resolve.mockResolvedValue({ tbAccountId: 'abc' });

    await service.ensureForLp(LP_ID);

    expect(tb.createAccounts).not.toHaveBeenCalled();
    expect(registry.register).not.toHaveBeenCalled();
  });

  it('opens only the missing ledger when one of the two accounts already exists', async () => {
    registry.resolve.mockImplementation(async (p: any) => (p.ledger === 1 ? { tbAccountId: 'abc' } : null));

    await service.ensureForLp(LP_ID);

    expect(tb.createAccounts.mock.calls[0][0].map((a: any) => [a.code, a.ledger])).toEqual([[51, 2]]);
    expect(registry.register).toHaveBeenCalledTimes(1);
    expect(registry.register.mock.calls[0][0]).toMatchObject({ ledger: 2, assetCurrency: 'USDT' });
  });
});
