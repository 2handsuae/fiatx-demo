import { FeeAccrualService } from './fee-accrual.service';

describe('FeeAccrualService.accrue', () => {
  const created: any[] = [];
  const prisma: any = {
    swapTransaction: { findUnique: jest.fn() },
    withdrawTransaction: { findUnique: jest.fn() },
    feeAccrual: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn((args: any) => { created.push(args.data); return Promise.resolve({ id: 'fa', feeAccrualNo: 'FAC0', ...args.data }); }),
    },
  };
  // constructor: (prisma, transfers, fundsFlow, systemWallets, batchService, auditLogsService)
  const svc = new FeeAccrualService(prisma as any, {} as any, {} as any, {} as any, {} as any, { recordSystem: jest.fn() } as any);
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

  it('retries with a fresh feeAccrualNo on P2002 collision (no existing compound row)', async () => {
    let createCalls = 0;
    const p: any = {
      swapTransaction: { findUnique: jest.fn().mockResolvedValue({
        id: 's4', swapNo: 'SWP4', ownerType: 'CUSTOMER', ownerId: 'c1', ownerNo: 'C1',
        toAssetId: 'a', feeAmount: '3', spreadAmount: '0', toAsset: { code: 'X' },
      }) },
      feeAccrual: {
        findUnique: jest.fn().mockResolvedValue(null), // compound never pre-exists
        create: jest.fn(() => {
          createCalls += 1;
          if (createCalls === 1) {
            const e: any = new Error('Unique constraint failed');
            e.code = 'P2002';
            e.meta = { target: ['feeAccrualNo'] };
            throw e;
          }
          return Promise.resolve({ id: 'fa4' });
        }),
      },
    };
    const s = new FeeAccrualService(p, {} as any, {} as any, {} as any, {} as any, { recordSystem: jest.fn() } as any);
    await s.accrueForSwap('s4', p);
    expect(createCalls).toBe(2); // first throws on feeAccrualNo, retry succeeds
  });

  it('treats P2002 as idempotent when the compound row now exists (race)', async () => {
    const findUnique = jest.fn()
      .mockResolvedValueOnce(null)            // pre-check: not there
      .mockResolvedValueOnce({ id: 'raced' }); // after P2002: a racing tx created it
    const p: any = {
      swapTransaction: { findUnique: jest.fn().mockResolvedValue({
        id: 's5', swapNo: 'SWP5', ownerType: 'CUSTOMER', ownerId: 'c1', ownerNo: 'C1',
        toAssetId: 'a', feeAmount: '3', spreadAmount: '0', toAsset: { code: 'X' },
      }) },
      feeAccrual: {
        findUnique,
        create: jest.fn(() => { const e: any = new Error('dup'); e.code = 'P2002'; throw e; }),
      },
    };
    const s = new FeeAccrualService(p, {} as any, {} as any, {} as any, {} as any, { recordSystem: jest.fn() } as any);
    await s.accrueForSwap('s5', p); // should not throw; returns the raced row
    expect(p.feeAccrual.create).toHaveBeenCalledTimes(1);
  });

  it('accrueForSwap: createAccrual writes originTraceId from swap.traceId + emits FEE_ACCRUAL.CREATED audit on create', async () => {
    const localCreated: any[] = [];
    const auditCalls: any[] = [];
    const p: any = {
      swapTransaction: {
        findUnique: jest.fn().mockResolvedValue({
          id: 's1', swapNo: 'SWP1', traceId: 'SWAP-TRACE',
          ownerType: 'CUSTOMER', ownerId: 'c1', ownerNo: 'C1',
          toAssetId: 'a-aed', feeAmount: '10', spreadAmount: '2.42',
          toAsset: { code: 'AED' },
        }),
      },
      feeAccrual: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn((args: any) => {
          localCreated.push(args.data);
          return Promise.resolve({ id: `fa-${localCreated.length}`, feeAccrualNo: `FAC${localCreated.length}`, ...args.data });
        }),
      },
    };
    const mockAudit: any = { recordSystem: jest.fn((args: any) => { auditCalls.push(args); return Promise.resolve(); }) };
    const s = new FeeAccrualService(p, {} as any, {} as any, {} as any, {} as any, mockAudit);

    await s.accrueForSwap('s1', p);

    expect(localCreated).toHaveLength(2); // SERVICE_FEE + SPREAD
    expect(localCreated.every((c: any) => c.originTraceId === 'SWAP-TRACE')).toBe(true);

    expect(auditCalls).toHaveLength(2);
    expect(auditCalls.every((a: any) =>
      a.action === 'CREATED' && a.entityType === 'FEE_ACCRUAL' && a.traceId === 'SWAP-TRACE'
    )).toBe(true);
  });

  it('createAccrual: existing accrual (idempotent pre-check) — no audit, no create', async () => {
    const p: any = {
      swapTransaction: {
        findUnique: jest.fn().mockResolvedValue({
          id: 's2', swapNo: 'SWP2', traceId: 'SWAP-T2',
          ownerType: 'CUSTOMER', ownerId: 'c1', ownerNo: 'C1',
          toAssetId: 'a', feeAmount: '3', spreadAmount: '0',
          toAsset: { code: 'X' },
        }),
      },
      feeAccrual: {
        findUnique: jest.fn().mockResolvedValue({ id: 'existing' }),
        create: jest.fn(),
      },
    };
    const auditCalls: any[] = [];
    const mockAudit: any = { recordSystem: jest.fn((args: any) => { auditCalls.push(args); return Promise.resolve(); }) };
    const s = new FeeAccrualService(p, {} as any, {} as any, {} as any, {} as any, mockAudit);

    await s.accrueForSwap('s2', p);

    expect(auditCalls).toHaveLength(0);
    expect(p.feeAccrual.create).not.toHaveBeenCalled();
  });

  it('accrueForWithdraw: createAccrual passes withdraw.traceId + emits CREATED audit', async () => {
    const localCreated: any[] = [];
    const auditCalls: any[] = [];
    const p: any = {
      withdrawTransaction: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'w1', withdrawNo: 'WD1', traceId: 'WD-TRACE',
          ownerType: 'CUSTOMER', ownerId: 'c1', ownerNo: 'C1',
          assetId: 'a', feeAmount: '1',
          asset: { code: 'AED' },
        }),
      },
      feeAccrual: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn((args: any) => {
          localCreated.push(args.data);
          return Promise.resolve({ id: 'fa-w', feeAccrualNo: 'FACW', ...args.data });
        }),
      },
    };
    const mockAudit: any = { recordSystem: jest.fn((args: any) => { auditCalls.push(args); return Promise.resolve(); }) };
    const s = new FeeAccrualService(p, {} as any, {} as any, {} as any, {} as any, mockAudit);

    await s.accrueForWithdraw('w1', p);

    expect(localCreated).toHaveLength(1);
    expect(localCreated[0].originTraceId).toBe('WD-TRACE');
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0].action).toBe('CREATED');
    expect(auditCalls[0].entityType).toBe('FEE_ACCRUAL');
    expect(auditCalls[0].traceId).toBe('WD-TRACE');
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
    const batchService: any = { createBatch: jest.fn().mockResolvedValue({ id: 'b1', batchNo: 'OSB1' }), recomputeBatch: jest.fn().mockResolvedValue({} as any) };
    const transfers: any = { createTransfer: jest.fn().mockResolvedValue({ id: 't1', internalTxNo: 'ITX1' }) };
    const fundsFlow: any = { createLeg: jest.fn().mockResolvedValue({ id: 'leg1' }) };
    const systemWallets: any = { resolve: jest.fn().mockResolvedValue({ id: 'w' }), resolveCustomer: jest.fn().mockResolvedValue({ id: 'wv' }) };
    const svc = new FeeAccrualService(prisma, transfers, fundsFlow, systemWallets, batchService, { recordSystem: jest.fn() } as any);
    await svc.settle(accruals, 'SWAP_FEE', 'CRYPTO_SWAP', prisma);
    expect(batchService.createBatch).toHaveBeenCalledWith(expect.objectContaining({ category: 'SWAP_FEE', settlementType: 'CRYPTO_SWAP' }));
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
    const batchService: any = { createBatch: jest.fn().mockResolvedValue({ id: 'b2', batchNo: 'OSB2' }), recomputeBatch: jest.fn().mockResolvedValue({} as any) };
    const transfers: any = { createTransfer: jest.fn().mockResolvedValue({ id: 't2', internalTxNo: 'ITX2' }) };
    const fundsFlow: any = { createLeg: jest.fn().mockResolvedValue({}) };
    const systemWallets: any = { resolve: jest.fn().mockResolvedValue({ id: 'ffee' }), resolveCustomer: jest.fn().mockResolvedValue({ id: 'viban-c1' }) };
    const svc = new FeeAccrualService(prisma, transfers, fundsFlow, systemWallets, batchService, { recordSystem: jest.fn() } as any);
    await svc.settle(accruals, 'WITHDRAW_FEE', 'FIAT_WITHDRAW', prisma);
    expect(systemWallets.resolveCustomer).toHaveBeenCalledWith('aed', 'C_VIBAN', 'c1');
    const t = transfers.createTransfer.mock.calls[0][0];
    expect(t.path).toBe('FIAT_WITHDRAW_FEE_COLLECT');
    expect(t.fromWalletId).toBe('viban-c1');
    expect(t.toWalletId).toBe('ffee');
  });

  it('settle: emits FEE_ACCRUAL.LOCKED for each accrual, traceId=batch.traceId + metadata.originTraceId', async () => {
    const accruals = [
      { id: 'fa1', feeAccrualNo: 'FAC1', originTraceId: 'SWAP-T1', assetId: 'usdt', category: 'SWAP_FEE', amount: '3', ownerType: 'PLATFORM', ownerId: 'P', ownerNo: null },
      { id: 'fa2', feeAccrualNo: 'FAC2', originTraceId: 'SWAP-T2', assetId: 'usdt', category: 'SWAP_FEE', amount: '1', ownerType: 'PLATFORM', ownerId: 'P', ownerNo: null },
    ];
    const updateMany = jest.fn().mockResolvedValue({ count: 2 });
    const prisma: any = {
      asset: { findUnique: jest.fn().mockResolvedValue({ type: 'CRYPTO' }) },
      feeAccrual: { updateMany },
      settlementBatch: { findUnique: jest.fn().mockResolvedValue({ id: 'b1', traceId: 'BATCH-T1' }) },
    };
    const batchService: any = { createBatch: jest.fn().mockResolvedValue({ id: 'b1', batchNo: 'OSB1', traceId: 'BATCH-T1' }), recomputeBatch: jest.fn().mockResolvedValue({} as any) };
    const transfers: any = { createTransfer: jest.fn().mockResolvedValue({ id: 't1', internalTxNo: 'ITX1' }) };
    const fundsFlow: any = { createLeg: jest.fn().mockResolvedValue({ id: 'leg1' }) };
    const systemWallets: any = { resolve: jest.fn().mockResolvedValue({ id: 'w' }), resolveCustomer: jest.fn().mockResolvedValue({ id: 'wv' }) };
    const auditCalls: any[] = [];
    const mockAudit: any = { recordSystem: jest.fn((args: any) => { auditCalls.push(args); return Promise.resolve(); }) };
    const svc = new FeeAccrualService(prisma, transfers, fundsFlow, systemWallets, batchService, mockAudit);

    await svc.settle(accruals, 'SWAP_FEE', 'CRYPTO_SWAP', prisma);

    const lockedCalls = auditCalls.filter((a: any) => a.action === 'LOCKED' && a.entityType === 'FEE_ACCRUAL');
    expect(lockedCalls).toHaveLength(2);
    lockedCalls.forEach((a: any) => {
      expect(a.traceId).toBe('BATCH-T1');
      expect(a.workflowType).toBe('SETTLEMENT');
    });
    expect(JSON.parse(lockedCalls[0].metadata).originTraceId).toBe('SWAP-T1');
    expect(JSON.parse(lockedCalls[1].metadata).originTraceId).toBe('SWAP-T2');
  });

  it('settle: per group calls batchService.recomputeBatch(batch.id, tx) after locking accruals', async () => {
    const accruals = [
      { id: 'a1', assetId: 'usdtId', ownerType: 'CUSTOMER', ownerId: 'c1', ownerNo: 'CU1', amount: '10', feeAccrualNo: 'FA1', originTraceId: 'OT1' },
      { id: 'a2', assetId: 'usdtId', ownerType: 'CUSTOMER', ownerId: 'c1', ownerNo: 'CU1', amount: '15', feeAccrualNo: 'FA2', originTraceId: 'OT2' },
    ];
    const prisma: any = {
      asset: { findUnique: jest.fn().mockResolvedValue({ type: 'CRYPTO' }) },
      feeAccrual: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    };
    const transfers: any = { createTransfer: jest.fn().mockResolvedValue({ id: 't1' }) };
    const fundsFlow: any = { createLeg: jest.fn().mockResolvedValue({}) };
    const systemWallets: any = {
      resolve: jest.fn().mockResolvedValue({ id: 'w1' }),
      resolveCustomer: jest.fn().mockResolvedValue({ id: 'w2' }),
    };
    const recomputeBatch = jest.fn().mockResolvedValue({} as any);
    const batchService: any = {
      createBatch: jest.fn().mockResolvedValue({ id: 'b1', batchNo: 'OSB1', traceId: 'BT1' }),
      recomputeBatch,
    };
    const svc = new FeeAccrualService(prisma, transfers, fundsFlow, systemWallets, batchService, { recordSystem: jest.fn() } as any);

    await svc.settle(accruals, 'SWAP_FEE', 'CRYPTO_SWAP', prisma);

    expect(recomputeBatch).toHaveBeenCalledTimes(1);
    expect(recomputeBatch).toHaveBeenCalledWith('b1', prisma);
  });

  it('settle: 2 distinct assets → 2 batches → recomputeBatch called once per batch', async () => {
    const accruals = [
      { id: 'a1', assetId: 'usdtId', ownerType: 'CUSTOMER', ownerId: 'c1', ownerNo: 'CU1', amount: '10', feeAccrualNo: 'FA1', originTraceId: 'OT1' },
      { id: 'a2', assetId: 'btcId', ownerType: 'CUSTOMER', ownerId: 'c1', ownerNo: 'CU1', amount: '5', feeAccrualNo: 'FA2', originTraceId: 'OT2' },
    ];
    const prisma: any = {
      asset: { findUnique: jest.fn().mockResolvedValue({ type: 'CRYPTO' }) },
      feeAccrual: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const transfers: any = { createTransfer: jest.fn().mockResolvedValue({ id: 't1' }) };
    const fundsFlow: any = { createLeg: jest.fn().mockResolvedValue({}) };
    const systemWallets: any = {
      resolve: jest.fn().mockResolvedValue({ id: 'w1' }),
      resolveCustomer: jest.fn().mockResolvedValue({ id: 'w2' }),
    };
    const recomputeBatch = jest.fn().mockResolvedValue({} as any);
    let batchCounter = 0;
    const batchService: any = {
      createBatch: jest.fn().mockImplementation(async () => {
        batchCounter++;
        return { id: `b${batchCounter}`, batchNo: `OSB${batchCounter}`, traceId: `BT${batchCounter}` };
      }),
      recomputeBatch,
    };
    const svc = new FeeAccrualService(prisma, transfers, fundsFlow, systemWallets, batchService, { recordSystem: jest.fn() } as any);

    await svc.settle(accruals, 'SWAP_FEE', 'CRYPTO_SWAP', prisma);

    expect(recomputeBatch).toHaveBeenCalledTimes(2);
    expect(recomputeBatch).toHaveBeenCalledWith('b1', prisma);
    expect(recomputeBatch).toHaveBeenCalledWith('b2', prisma);
  });
});

describe('FeeAccrualService.settleByTransfer', () => {
  it('settleByTransfer: flips LOCKED→SETTLED for a transfer', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 2 });
    // Defensive default: settleByTransfer now also reads the transfer's batch id
    // + queries pre-flip LOCKED rows for audit; existing test gets a null findUnique
    // and an empty findMany so it stays a pure flip-status assertion.
    const findUnique = jest.fn().mockResolvedValue(null);
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma: any = {
      feeAccrual: { updateMany, findMany },
      internalTransaction: { findUnique },
    };
    const svc = new FeeAccrualService(prisma, {} as any, {} as any, {} as any, {} as any, { recordSystem: jest.fn() } as any);
    await svc.settleByTransfer('t1', 'fund1', prisma);
    expect(updateMany).toHaveBeenCalledWith({
      where: { settledByTransferId: 't1', status: 'LOCKED' },
      data: expect.objectContaining({ status: 'SETTLED', closedByInternalFundId: 'fund1' }),
    });
  });

  it('settleByTransfer: when transfer has settlementBatchId, triggers recomputeBatch with that id + same tx', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 2 });
    const findUnique = jest.fn().mockResolvedValue({ settlementBatchId: 'b1' });
    const findMany = jest.fn().mockResolvedValue([]);
    const recomputeBatch = jest.fn().mockResolvedValue({} as any);
    const prisma: any = {
      feeAccrual: { updateMany, findMany },
      internalTransaction: { findUnique },
    };
    const batchService: any = { recomputeBatch };
    const svc = new FeeAccrualService(prisma, {} as any, {} as any, {} as any, batchService, { recordSystem: jest.fn() } as any);

    await svc.settleByTransfer('t1', 'fund1', prisma);

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 't1' },
      select: { settlementBatchId: true },
    });
    expect(recomputeBatch).toHaveBeenCalledWith('b1', prisma);
  });

  it('settleByTransfer: when transfer has no settlementBatchId, does NOT call recomputeBatch', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const findUnique = jest.fn().mockResolvedValue({ settlementBatchId: null });
    const findMany = jest.fn().mockResolvedValue([]);
    const recomputeBatch = jest.fn().mockResolvedValue({} as any);
    const prisma: any = {
      feeAccrual: { updateMany, findMany },
      internalTransaction: { findUnique },
    };
    const batchService: any = { recomputeBatch };
    const svc = new FeeAccrualService(prisma, {} as any, {} as any, {} as any, batchService, { recordSystem: jest.fn() } as any);

    await svc.settleByTransfer('t2', 'fund1', prisma);

    expect(recomputeBatch).not.toHaveBeenCalled();
  });

  it('settleByTransfer: emits FEE_ACCRUAL.SETTLED for each, traceId=batch.traceId + metadata.originTraceId', async () => {
    const prisma: any = {
      feeAccrual: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'fa1', feeAccrualNo: 'FAC1', originTraceId: 'SWAP-T1', settlementBatchId: 'b1' },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      internalTransaction: {
        findUnique: jest.fn().mockResolvedValue({ settlementBatchId: 'b1' }),
      },
      settlementBatch: {
        findMany: jest.fn().mockResolvedValue([{ id: 'b1', traceId: 'BATCH-T1' }]),
      },
    };
    const batchService: any = { recomputeBatch: jest.fn().mockResolvedValue({} as any) };
    const auditCalls: any[] = [];
    const mockAudit: any = { recordSystem: jest.fn((args: any) => { auditCalls.push(args); return Promise.resolve(); }) };
    const svc = new FeeAccrualService(prisma, {} as any, {} as any, {} as any, batchService, mockAudit);

    await svc.settleByTransfer('t1', 'fund1', prisma);

    const settledCalls = auditCalls.filter((a: any) => a.action === 'SETTLED' && a.entityType === 'FEE_ACCRUAL');
    expect(settledCalls).toHaveLength(1);
    expect(settledCalls[0].traceId).toBe('BATCH-T1');
    expect(JSON.parse(settledCalls[0].metadata).originTraceId).toBe('SWAP-T1');
  });
});

describe('FeeAccrualService.getFeeCollectionStatus', () => {
  it('SETTLED swap → collected true with transfer/batch nos for both components', async () => {
    const prisma: any = { feeAccrual: { findMany: jest.fn().mockResolvedValue([
      { feeKind: 'SERVICE_FEE', category: 'SWAP_FEE', status: 'SETTLED', settledByTransfer: { internalTxNo: 'ITX9' }, settlementBatch: { batchNo: 'OSB9' } },
      { feeKind: 'SPREAD', category: 'SWAP_FEE', status: 'SETTLED', settledByTransfer: { internalTxNo: 'ITX9' }, settlementBatch: { batchNo: 'OSB9' } },
    ]) } };
    const svc = new FeeAccrualService(prisma, {} as any, {} as any, {} as any, {} as any, { recordSystem: jest.fn() } as any);
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
    const svc = new FeeAccrualService(prisma, {} as any, {} as any, {} as any, {} as any, { recordSystem: jest.fn() } as any);
    const r = await svc.getFeeCollectionStatus('WD9');
    expect(r.collected).toBe(false);
    expect(r.items[0]).toMatchObject({ status: 'ACCRUED', settledByTransferNo: null, settlementBatchNo: null });
  });

  it('no accruals → collected false, empty items', async () => {
    const prisma: any = { feeAccrual: { findMany: jest.fn().mockResolvedValue([]) } };
    const svc = new FeeAccrualService(prisma, {} as any, {} as any, {} as any, {} as any, { recordSystem: jest.fn() } as any);
    const r = await svc.getFeeCollectionStatus('NONE');
    expect(r).toEqual({ collected: false, items: [] });
  });
});
