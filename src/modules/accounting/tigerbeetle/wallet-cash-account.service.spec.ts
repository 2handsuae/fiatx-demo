// src/modules/accounting/tigerbeetle/wallet-cash-account.service.spec.ts
import { AccountingService } from './accounting.service';
import { WalletCashAccountService } from './wallet-cash-account.service';

const WALLET_ID = '6f1c2c1e-0b7a-4a52-9d3e-1f2a3b4c5d6e';

/**
 * 钱包 ACTIVE → 开现金户。AccountingService 用真实实例（只替掉 TB 与注册表的底层依赖），
 * 这样「flags 真的写进了 TB 与注册表」是被行为验到的，而不是读自己写的 mock。
 */
describe('WalletCashAccountService', () => {
  let tb: { createAccounts: jest.Mock };
  let registry: { register: jest.Mock; resolve: jest.Mock };
  let service: WalletCashAccountService;

  beforeEach(() => {
    tb = { createAccounts: jest.fn().mockResolvedValue([]) };
    registry = {
      register: jest.fn().mockResolvedValue({}),
      resolve: jest.fn().mockResolvedValue(null),
    };
    const accounting = new AccountingService(tb as any, registry as any, {} as any, {} as any);
    service = new WalletCashAccountService(accounting, registry as any);
  });

  it("opens code 1 for CUSTOMER wallet on USDT ledger with flags 4 and name 'Client Cash · CU… · Deposit address'", async () => {
    const tx: any = { marker: 'tx' };
    await service.ensureForWallet(
      {
        id: WALLET_ID,
        walletNo: 'WA2611060001',
        ownerType: 'CUSTOMER',
        ownerNo: 'CU2601012635',
        vaultCode: 'CLIENT_DEPOSIT',
        walletRole: 'C_DEP',
        network: 'TRON',
      },
      tx,
    );

    // 先查是否已有注册行（同一事务）
    expect(registry.resolve).toHaveBeenCalledWith(
      { code: 1, ledger: 2, ownerType: 'WALLET', ownerUuid: WALLET_ID },
      tx,
    );
    // TB 侧：ledger 2 (USDT)、code 1、flags 4 = credits_must_not_exceed_debits
    expect(tb.createAccounts).toHaveBeenCalledTimes(1);
    const tbAccount = tb.createAccounts.mock.calls[0][0][0];
    expect(tbAccount.ledger).toBe(2);
    expect(tbAccount.code).toBe(1);
    expect(tbAccount.flags).toBe(4);
    // 注册表侧：四元组 + ownerNo = walletNo + 户名写进 description
    expect(registry.register).toHaveBeenCalledTimes(1);
    expect(registry.register).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 1,
        ledger: 2,
        ownerType: 'WALLET',
        ownerUuid: WALLET_ID,
        ownerNo: 'WA2611060001',
        assetCurrency: 'USDT',
        description: 'Client Cash · CU2601012635 · Deposit address',
        flags: 4,
      }),
      tx,
    );
  });

  it('opens code 1 on the AED ledger with the vIBAN name for a CUSTOMER C_VIBAN wallet', async () => {
    await service.ensureForWallet({
      id: WALLET_ID,
      walletNo: 'WA2611060002',
      ownerType: 'CUSTOMER',
      ownerNo: 'CU2601012635',
      vaultCode: 'CLIENT_DEPOSIT',
      walletRole: 'C_VIBAN',
      network: 'AED_ZAND',
    });

    expect(tb.createAccounts.mock.calls[0][0][0].ledger).toBe(1);
    expect(registry.register.mock.calls[0][0].description).toBe('Client Cash · CU2601012635 · vIBAN');
    expect(registry.register.mock.calls[0][0].assetCurrency).toBe('AED');
  });

  it('opens code 50 for PLATFORM wallet', async () => {
    await service.ensureForWallet({
      id: WALLET_ID,
      walletNo: 'WA2611060003',
      ownerType: 'PLATFORM',
      ownerNo: 'PLATFORM',
      vaultCode: 'F_OPS',
      walletRole: 'F_OPS',
      network: 'AED_ZAND',
    });

    const tbAccount = tb.createAccounts.mock.calls[0][0][0];
    expect(tbAccount.code).toBe(50);
    expect(tbAccount.ledger).toBe(1);
    expect(tbAccount.flags).toBe(4);
    expect(registry.register).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 50,
        ledger: 1,
        ownerType: 'WALLET',
        ownerUuid: WALLET_ID,
        ownerNo: 'WA2611060003',
        assetCurrency: 'AED',
        description: 'Company Cash · Company Operations · AED_ZAND',
      }),
      undefined,
    );
  });

  it('returns without createAccounts when registry row exists', async () => {
    registry.resolve.mockResolvedValue({ tbAccountId: 'abc' });

    await service.ensureForWallet({
      id: WALLET_ID,
      walletNo: 'WA2611060001',
      ownerType: 'CUSTOMER',
      ownerNo: 'CU2601012635',
      vaultCode: 'CLIENT_DEPOSIT',
      walletRole: 'C_DEP',
      network: 'TRON',
    });

    expect(tb.createAccounts).not.toHaveBeenCalled();
    expect(registry.register).not.toHaveBeenCalled();
  });
});
