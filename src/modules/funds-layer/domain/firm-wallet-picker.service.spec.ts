import { FirmWalletPickerService } from './firm-wallet-picker.service';

// 戊波二 T3：公司侧「从哪只钱包出」的人选守卫。mock 行为化——真按 where.id 找行，不是恒返回。
const ASSETS: Record<string, any> = {
  'asset-usdt': { id: 'asset-usdt', code: 'USDT-TRON', network: 'TRON' },
  'asset-aed': { id: 'asset-aed', code: 'AED', network: 'AED_ZAND' },
};
const WALLETS: Record<string, any> = {
  'w-ops-tron': { id: 'w-ops-tron', walletNo: 'WAL-OPS-TRON', ownerType: 'PLATFORM', vaultCode: 'F_OPS', network: 'TRON' },
  'w-fee-tron': { id: 'w-fee-tron', walletNo: 'WAL-FEE-TRON', ownerType: 'PLATFORM', vaultCode: 'F_FEE', network: 'TRON' },
  'w-set-aed': { id: 'w-set-aed', walletNo: 'WAL-SET-AED', ownerType: 'PLATFORM', vaultCode: 'F_SET', network: 'AED_ZAND' },
  'w-liq-tron': { id: 'w-liq-tron', walletNo: 'WAL-LIQ-TRON', ownerType: 'PLATFORM', vaultCode: 'F_LIQ', network: 'TRON' },
  'w-ops-aed': { id: 'w-ops-aed', walletNo: 'WAL-OPS-AED', ownerType: 'PLATFORM', vaultCode: 'F_OPS', network: 'AED_ZAND' },
  'w-cust-tron': { id: 'w-cust-tron', walletNo: 'WAL-CU1-TRON', ownerType: 'CUSTOMER', vaultCode: 'CLIENT_DEPOSIT', network: 'TRON' },
};

function makePrisma() {
  return {
    wallet: { findUnique: jest.fn(async ({ where }: any) => WALLETS[where.id] ?? null) },
    asset: { findUnique: jest.fn(async ({ where }: any) => ASSETS[where.id] ?? null) },
  };
}

describe('FirmWalletPickerService.assertEligible（戊波二 T3）', () => {
  const picker = (prisma: any = makePrisma()) => new FirmWalletPickerService(prisma as any);

  it('F_OPS platform wallet on the asset network passes and the wallet row comes back', async () => {
    const w = await picker().assertEligible('w-ops-tron', 'asset-usdt');
    expect(w).toMatchObject({ id: 'w-ops-tron', vaultCode: 'F_OPS' });
  });

  it('F_FEE platform wallet on the asset network passes', async () => {
    const w = await picker().assertEligible('w-fee-tron', 'asset-usdt');
    expect(w).toMatchObject({ id: 'w-fee-tron', vaultCode: 'F_FEE' });
  });

  it('F_SET (settlement — money in flight to customers) is rejected with FROM_WALLET_NOT_ELIGIBLE, message names the wallet by walletNo', async () => {
    const err: any = await picker().assertEligible('w-set-aed', 'asset-aed').catch((e) => e);
    expect(err.getStatus()).toBe(400);
    expect(err.getResponse()).toMatchObject({ code: 'FROM_WALLET_NOT_ELIGIBLE' });
    expect(err.message).toContain('WAL-SET-AED');
    expect(err.message).not.toContain('w-set-aed');
  });

  it('F_LIQ (LP foyer — funds not yet accepted) is rejected', async () => {
    await expect(picker().assertEligible('w-liq-tron', 'asset-usdt')).rejects.toMatchObject({ response: { code: 'FROM_WALLET_NOT_ELIGIBLE' } });
  });

  it('a customer wallet is rejected', async () => {
    const err: any = await picker().assertEligible('w-cust-tron', 'asset-usdt').catch((e) => e);
    expect(err.getStatus()).toBe(400);
    expect(err.getResponse()).toMatchObject({ code: 'FROM_WALLET_NOT_ELIGIBLE' });
    expect(err.message).toContain('WAL-CU1-TRON');
  });

  it('a company wallet on another network than the asset is rejected', async () => {
    await expect(picker().assertEligible('w-ops-aed', 'asset-usdt')).rejects.toMatchObject({ response: { code: 'FROM_WALLET_NOT_ELIGIBLE' } });
  });

  it('a wallet that does not exist is rejected as not eligible', async () => {
    await expect(picker().assertEligible('w-nope', 'asset-usdt')).rejects.toMatchObject({ response: { code: 'FROM_WALLET_NOT_ELIGIBLE' } });
  });

  it('inside a transaction it reads through the tx client, not the global prisma', async () => {
    const prisma = makePrisma();
    const tx = makePrisma();
    await picker(prisma).assertEligible('w-ops-tron', 'asset-usdt', tx as any);
    expect(tx.wallet.findUnique).toHaveBeenCalled();
    expect(prisma.wallet.findUnique).not.toHaveBeenCalled();
  });
});
