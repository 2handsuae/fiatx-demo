import { SystemWalletResolver } from './system-wallet-resolver.service';

describe('SystemWalletResolver.resolveCustomer', () => {
  const wallet = { id: 'w-viban', walletRole: 'C_VIBAN' };
  let prisma: { wallet: { findFirst: jest.Mock } };
  let resolver: SystemWalletResolver;

  beforeEach(() => {
    prisma = { wallet: { findFirst: jest.fn().mockResolvedValue(wallet) } };
    resolver = new SystemWalletResolver(prisma as any);
  });

  it('finds an ACTIVE CUSTOMER-owned wallet by role+asset+owner', async () => {
    const w = await resolver.resolveCustomer('a-aed', 'C_VIBAN', 'cust-1');
    expect(w).toBe(wallet);
    expect(prisma.wallet.findFirst).toHaveBeenCalledWith({
      where: { walletRole: 'C_VIBAN', assetId: 'a-aed', ownerType: 'CUSTOMER', ownerId: 'cust-1', status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('throws CUSTOMER_WALLET_NOT_FOUND when no customer wallet exists', async () => {
    prisma.wallet.findFirst.mockResolvedValue(null);
    await expect(
      resolver.resolveCustomer('a-aed', 'C_VIBAN', 'cust-1'),
    ).rejects.toMatchObject({ response: { code: 'CUSTOMER_WALLET_NOT_FOUND' } });
  });
});
