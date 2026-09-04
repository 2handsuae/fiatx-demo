import { SystemWalletResolver } from './system-wallet-resolver.service';

describe('SystemWalletResolver', () => {
  let prisma: { asset: { findUnique: jest.Mock }; wallet: { findFirst: jest.Mock } };
  let resolver: SystemWalletResolver;

  beforeEach(() => {
    prisma = { asset: { findUnique: jest.fn() }, wallet: { findFirst: jest.fn() } };
    resolver = new SystemWalletResolver(prisma as any);
  });

  it('resolve：先取资产的 network，再按 (vaultCode, network, PLATFORM) 找 ACTIVE 行', async () => {
    prisma.asset.findUnique.mockResolvedValue({ network: 'TRON', code: 'USDT-TRON' });
    prisma.wallet.findFirst.mockResolvedValue({ id: 'w-fee' });
    const w = await resolver.resolve('a-usdt', 'F_FEE');
    expect(w.id).toBe('w-fee');
    expect(prisma.wallet.findFirst).toHaveBeenCalledWith({
      where: { vaultCode: 'F_FEE', network: 'TRON', ownerType: 'PLATFORM', ownerNo: 'PLATFORM', status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('resolveCustomer：按 (CLIENT_DEPOSIT, role, network, ownerId) 找', async () => {
    prisma.asset.findUnique.mockResolvedValue({ network: 'AED_ZAND', code: 'AED' });
    prisma.wallet.findFirst.mockResolvedValue({ id: 'w-viban' });
    await resolver.resolveCustomer('a-aed', 'C_VIBAN', 'c1');
    expect(prisma.wallet.findFirst).toHaveBeenCalledWith({
      where: { vaultCode: 'CLIENT_DEPOSIT', walletRole: 'C_VIBAN', network: 'AED_ZAND', ownerType: 'CUSTOMER', ownerId: 'c1', status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('finds an ACTIVE CUSTOMER-owned wallet by role+owner+the asset network', async () => {
    prisma.asset.findUnique.mockResolvedValue({ network: 'AED_ZAND', code: 'AED' });
    const wallet = { id: 'w-viban', walletRole: 'C_VIBAN' };
    prisma.wallet.findFirst.mockResolvedValue(wallet);
    const w = await resolver.resolveCustomer('a-aed', 'C_VIBAN', 'cust-1');
    expect(w).toBe(wallet);
    expect(prisma.wallet.findFirst).toHaveBeenCalledWith({
      where: { vaultCode: 'CLIENT_DEPOSIT', walletRole: 'C_VIBAN', network: 'AED_ZAND', ownerType: 'CUSTOMER', ownerId: 'cust-1', status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('throws CUSTOMER_WALLET_NOT_FOUND when no customer wallet exists', async () => {
    prisma.asset.findUnique.mockResolvedValue({ network: 'AED_ZAND', code: 'AED' });
    prisma.wallet.findFirst.mockResolvedValue(null);
    await expect(
      resolver.resolveCustomer('a-aed', 'C_VIBAN', 'cust-1'),
    ).rejects.toMatchObject({ response: { code: 'CUSTOMER_WALLET_NOT_FOUND' } });
  });
});
