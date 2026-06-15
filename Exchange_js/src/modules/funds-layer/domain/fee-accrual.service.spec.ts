import { FeeAccrualService } from './fee-accrual.service';

describe('FeeAccrualService.accrue', () => {
  const created: any[] = [];
  const prisma: any = {
    swapTransaction: { findUnique: jest.fn() },
    withdrawTransaction: { findUnique: jest.fn() },
    feeAccrual: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn((args: any) => { created.push(args.data); return Promise.resolve({ id: 'fa', ...args.data }); }),
    },
  };
  // constructor: (prisma, transfers, fundsFlow, systemWallets, batchService) — pass {} for unused deps in accrue
  const svc = new FeeAccrualService(prisma as any, {} as any, {} as any, {} as any, {} as any);
  beforeEach(() => { created.length = 0; jest.clearAllMocks(); prisma.feeAccrual.findUnique.mockResolvedValue(null); });

  it('swap → 2 accruals (SERVICE_FEE + SPREAD), category SWAP_FEE', async () => {
    prisma.swapTransaction.findUnique.mockResolvedValue({
      id: 's1', swapNo: 'SWP1', ownerType: 'CUSTOMER', ownerId: 'c1', ownerNo: 'C1',
      toAssetId: 'a-usdt', feeAmount: '3', spreadAmount: '1.5', toAsset: { code: 'USDT-TRON' },
    });
    await svc.accrueForSwap('s1', prisma);
    expect(created).toHaveLength(2);
    expect(created.map((c) => c.feeKind).sort()).toEqual(['SERVICE_FEE', 'SPREAD']);
    expect(created.every((c) => c.category === 'SWAP_FEE')).toBe(true);
    expect(created.every((c) => c.sourceType === 'SWAP' && c.sourceNo === 'SWP1')).toBe(true);
    expect(created.every((c) => c.status === 'ACCRUED')).toBe(true);
  });

  it('withdraw → 1 accrual (WITHDRAW_FEE), category WITHDRAW_FEE', async () => {
    prisma.withdrawTransaction.findUnique.mockResolvedValue({
      id: 'w1', withdrawNo: 'WD1', ownerType: 'CUSTOMER', ownerId: 'c1', ownerNo: 'C1',
      assetId: 'a-usdt', feeAmount: '1', asset: { code: 'USDT-TRON' },
    });
    await svc.accrueForWithdraw('w1', prisma);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ feeKind: 'WITHDRAW_FEE', category: 'WITHDRAW_FEE', sourceType: 'WITHDRAW', sourceNo: 'WD1' });
  });

  it('skips zero-amount fee/spread', async () => {
    prisma.swapTransaction.findUnique.mockResolvedValue({
      id: 's2', swapNo: 'SWP2', ownerType: 'CUSTOMER', ownerId: 'c1', ownerNo: 'C1',
      toAssetId: 'a', feeAmount: '0', spreadAmount: '0', toAsset: { code: 'X' },
    });
    await svc.accrueForSwap('s2', prisma);
    expect(created).toHaveLength(0);
  });

  it('idempotent: existing accrual is not recreated', async () => {
    prisma.feeAccrual.findUnique.mockResolvedValue({ id: 'existing' });
    prisma.swapTransaction.findUnique.mockResolvedValue({
      id: 's3', swapNo: 'SWP3', ownerType: 'CUSTOMER', ownerId: 'c1', ownerNo: 'C1',
      toAssetId: 'a', feeAmount: '3', spreadAmount: '1.5', toAsset: { code: 'X' },
    });
    await svc.accrueForSwap('s3', prisma);
    expect(created).toHaveLength(0);
  });
});
