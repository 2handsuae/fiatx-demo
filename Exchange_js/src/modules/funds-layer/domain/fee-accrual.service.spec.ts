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

describe('FeeAccrualService.settle', () => {
  it('SWAP_FEE crypto: 1 batch + 1 net transfer (F_OPS→F_FEE) for Σ amount, locks accruals', async () => {
    const accruals = [
      { id: 'a1', assetId: 'usdt', category: 'SWAP_FEE', amount: '3', ownerType: 'PLATFORM', ownerId: 'P', ownerNo: null },
      { id: 'a2', assetId: 'usdt', category: 'SWAP_FEE', amount: '1.5', ownerType: 'PLATFORM', ownerId: 'P', ownerNo: null },
    ];
    const updateMany = jest.fn().mockResolvedValue({ count: 2 });
    const prisma: any = { asset: { findUnique: jest.fn().mockResolvedValue({ type: 'CRYPTO' }) }, feeAccrual: { updateMany } };
    const batchService: any = { createBatch: jest.fn().mockResolvedValue({ id: 'b1', batchNo: 'OSB1' }) };
    const transfers: any = { createTransfer: jest.fn().mockResolvedValue({ id: 't1', internalTxNo: 'ITX1' }) };
    const fundsFlow: any = { createLeg: jest.fn().mockResolvedValue({ id: 'leg1' }) };
    const systemWallets: any = { resolve: jest.fn().mockResolvedValue({ id: 'w' }), resolveCustomer: jest.fn().mockResolvedValue({ id: 'wv' }) };
    const svc = new FeeAccrualService(prisma, transfers, fundsFlow, systemWallets, batchService);
    await svc.settle(accruals, 'SWAP_FEE', 'EOD', prisma);
    expect(batchService.createBatch).toHaveBeenCalledWith(expect.objectContaining({ category: 'SWAP_FEE', settlementType: 'EOD' }));
    expect(transfers.createTransfer).toHaveBeenCalledTimes(1);
    const t = transfers.createTransfer.mock.calls[0][0];
    expect(t.path).toBe('CRYPTO_SWAP_FEE_COLLECT');
    expect(t.amount.toString()).toBe('4.5');
    expect(t.settlementBatchId).toBe('b1');
    expect(fundsFlow.createLeg).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['a1', 'a2'] } },
      data: expect.objectContaining({ status: 'LOCKED', settledByTransferId: 't1', settlementBatchId: 'b1' }),
    }));
  });

  it('WITHDRAW_FEE fiat: resolves per-customer C_VIBAN as source, path FIAT_WITHDRAW_FEE_COLLECT', async () => {
    const accruals = [{ id: 'a3', assetId: 'aed', category: 'WITHDRAW_FEE', amount: '2', ownerType: 'CUSTOMER', ownerId: 'c1', ownerNo: 'C1' }];
    const prisma: any = { asset: { findUnique: jest.fn().mockResolvedValue({ type: 'FIAT' }) }, feeAccrual: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
    const batchService: any = { createBatch: jest.fn().mockResolvedValue({ id: 'b2', batchNo: 'OSB2' }) };
    const transfers: any = { createTransfer: jest.fn().mockResolvedValue({ id: 't2', internalTxNo: 'ITX2' }) };
    const fundsFlow: any = { createLeg: jest.fn().mockResolvedValue({}) };
    const systemWallets: any = { resolve: jest.fn().mockResolvedValue({ id: 'ffee' }), resolveCustomer: jest.fn().mockResolvedValue({ id: 'viban-c1' }) };
    const svc = new FeeAccrualService(prisma, transfers, fundsFlow, systemWallets, batchService);
    await svc.settle(accruals, 'WITHDRAW_FEE', 'FIAT_WITHDRAW', prisma);
    expect(systemWallets.resolveCustomer).toHaveBeenCalledWith('aed', 'C_VIBAN', 'c1');
    const t = transfers.createTransfer.mock.calls[0][0];
    expect(t.path).toBe('FIAT_WITHDRAW_FEE_COLLECT');
    expect(t.fromWalletId).toBe('viban-c1');
    expect(t.toWalletId).toBe('ffee');
  });
});

describe('FeeAccrualService.settleByTransfer', () => {
  it('settleByTransfer: flips LOCKED→SETTLED for a transfer', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 2 });
    const prisma: any = { feeAccrual: { updateMany } };
    const svc = new FeeAccrualService(prisma, {} as any, {} as any, {} as any, {} as any);
    await svc.settleByTransfer('t1', 'fund1', prisma);
    expect(updateMany).toHaveBeenCalledWith({
      where: { settledByTransferId: 't1', status: 'LOCKED' },
      data: expect.objectContaining({ status: 'SETTLED', closedByInternalFundId: 'fund1' }),
    });
  });
});

describe('FeeAccrualService.getFeeCollectionStatus', () => {
  it('SETTLED swap → collected true with transfer/batch nos for both components', async () => {
    const prisma: any = { feeAccrual: { findMany: jest.fn().mockResolvedValue([
      { feeKind: 'SERVICE_FEE', category: 'SWAP_FEE', status: 'SETTLED', settledByTransfer: { internalTxNo: 'ITX9' }, settlementBatch: { batchNo: 'OSB9' } },
      { feeKind: 'SPREAD', category: 'SWAP_FEE', status: 'SETTLED', settledByTransfer: { internalTxNo: 'ITX9' }, settlementBatch: { batchNo: 'OSB9' } },
    ]) } };
    const svc = new FeeAccrualService(prisma, {} as any, {} as any, {} as any, {} as any);
    const r = await svc.getFeeCollectionStatus('SWP9');
    expect(prisma.feeAccrual.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { sourceNo: 'SWP9' } }));
    expect(r.collected).toBe(true);
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toMatchObject({ feeKind: 'SERVICE_FEE', settledByTransferNo: 'ITX9', settlementBatchNo: 'OSB9' });
  });

  it('ACCRUED (not yet settled) → collected false', async () => {
    const prisma: any = { feeAccrual: { findMany: jest.fn().mockResolvedValue([
      { feeKind: 'WITHDRAW_FEE', category: 'WITHDRAW_FEE', status: 'ACCRUED', settledByTransfer: null, settlementBatch: null },
    ]) } };
    const svc = new FeeAccrualService(prisma, {} as any, {} as any, {} as any, {} as any);
    const r = await svc.getFeeCollectionStatus('WD9');
    expect(r.collected).toBe(false);
    expect(r.items[0]).toMatchObject({ status: 'ACCRUED', settledByTransferNo: null, settlementBatchNo: null });
  });

  it('no accruals → collected false, empty items', async () => {
    const prisma: any = { feeAccrual: { findMany: jest.fn().mockResolvedValue([]) } };
    const svc = new FeeAccrualService(prisma, {} as any, {} as any, {} as any, {} as any);
    const r = await svc.getFeeCollectionStatus('NONE');
    expect(r).toEqual({ collected: false, items: [] });
  });
});
