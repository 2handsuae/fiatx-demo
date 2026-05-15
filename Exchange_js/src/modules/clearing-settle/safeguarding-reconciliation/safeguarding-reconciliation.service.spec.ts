import { Prisma } from '@prisma/client';
import { SafeguardingReconciliationService } from './safeguarding-reconciliation.service';
import { ReconciliationBreakStatuses } from './constants/safeguarding-reconciliation.constant';

describe('SafeguardingReconciliationService', () => {
  let service: SafeguardingReconciliationService;
  let prisma: any;
  let auditLogsService: { recordByActor: jest.Mock };

  const assetRows = [
    { id: 'asset-btc', code: 'BTC', type: 'CRYPTO', decimals: 8 },
    { id: 'asset-aed', code: 'AED', type: 'FIAT', decimals: 2 },
  ];

  const buildWallet = (overrides: Partial<any> = {}) => ({
    id: 'wallet-1',
    walletNo: 'WA2600000008',
    ownerType: 'CUSTOMER',
    ownerId: 'customer-1',
    ownerNo: 'CU260001',
    type: 'CRYPTO_ADDRESS',
    direction: 'INBOUND',
    walletRole: 'C_DEP',
    assetId: 'asset-btc',
    status: 'ACTIVE',
    address: '0xabc',
    iban: null,
    ...overrides,
  });

  const buildWalletSnapshot = (overrides: Partial<any> = {}) => ({
    id: 'wbs-1',
    walletId: 'wallet-1',
    assetId: 'asset-btc',
    totalBalance: new Prisma.Decimal('2'),
    availableBalance: new Prisma.Decimal('2'),
    restrictedBalance: new Prisma.Decimal('0'),
    updatedAt: new Date('2026-03-30T00:00:00.000Z'),
    ...overrides,
  });

  const buildRun = (overrides: Partial<any> = {}) => ({
    id: 'run-1',
    runNo: 'SRN2603300001',
    businessDate: '2026-03-30',
    status: 'COMPLETED',
    breakCount: 0,
    warningCount: 0,
    traceId: 'SAFEGUARDING:2026-03-30',
    startedAt: new Date('2026-03-30T12:00:00.000Z'),
    finishedAt: new Date('2026-03-30T12:00:05.000Z'),
    createdAt: new Date('2026-03-30T12:00:00.000Z'),
    updatedAt: new Date('2026-03-30T12:00:05.000Z'),
    ...overrides,
  });

  const buildBreak = (overrides: Partial<any> = {}) => ({
    id: 'break-1',
    breakNo: 'RBR2603300001',
    runId: 'run-1',
    businessDate: '2026-03-30',
    sourceType: 'SAFEGUARDING_ASSET',
    sourceId: 'asset-btc',
    sourceNo: 'BTC',
    withdrawId: null,
    withdrawNo: null,
    payoutId: null,
    payoutNo: null,
    assetId: 'asset-btc',
    assetCode: 'BTC',
    expectedNetDelta: new Prisma.Decimal('0'),
    observedNetDelta: new Prisma.Decimal('0'),
    deltaAmount: new Prisma.Decimal('2'),
    reasonCode: 'COVERAGE_BREAK',
    breakType: 'COVERAGE_BREAK',
    liabilityAmount: new Prisma.Decimal('7'),
    poolAmount: new Prisma.Decimal('5'),
    externalAmount: null,
    status: ReconciliationBreakStatuses.OPEN,
    linkedAlertId: null,
    linkedCaseId: null,
    detailsJson: JSON.stringify({ liabilityAmount: '7', poolAmount: '5' }),
    detectedAt: new Date('2026-03-30T12:00:00.000Z'),
    resolvedAt: null,
    reopenedAt: null,
    createdAt: new Date('2026-03-30T12:00:00.000Z'),
    updatedAt: new Date('2026-03-30T12:00:00.000Z'),
    ...overrides,
  });

  const buildWarning = (overrides: Partial<any> = {}) => ({
    id: 'warning-1',
    warningNo: 'RWN2603300001',
    runId: 'run-1',
    businessDate: '2026-03-30',
    assetId: 'asset-btc',
    assetCode: 'BTC',
    warningType: 'DEPOSIT_COLLECTION_OVER_AMOUNT',
    poolRole: 'C_DEP',
    walletId: 'wallet-deposit',
    accountRef: null,
    observedValue: new Prisma.Decimal('2'),
    thresholdValue: new Prisma.Decimal('1'),
    status: 'OPEN',
    detailsJson: JSON.stringify({ ageMinutes: 180 }),
    detectedAt: new Date('2026-03-30T12:00:00.000Z'),
    acknowledgedAt: null,
    resolvedAt: null,
    acceptedAt: null,
    createdAt: new Date('2026-03-30T12:00:00.000Z'),
    updatedAt: new Date('2026-03-30T12:00:00.000Z'),
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn(async (callback: (tx: any) => unknown) =>
        callback(prisma),
      ),
      safeguardingRun: {
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      safeguardingPolicy: {
        findMany: jest.fn(),
      },
      liabilitySnapshot: {
        createMany: jest.fn(),
        findMany: jest.fn(),
      },
      safeguardingPoolSnapshot: {
        createMany: jest.fn(),
        findMany: jest.fn(),
      },
      reconciliationWarning: {
        create: jest.fn(),
        createMany: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      reconciliationBreak: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      fiatStatementImport: {
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      fiatStatementEntry: {
        createMany: jest.fn(),
        findMany: jest.fn(),
      },
      customerMain: {
        findMany: jest.fn(),
      },
      journalLine: {
        findMany: jest.fn(),
      },
      wallet: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      walletBalanceSnapshot: {
        findMany: jest.fn(),
      },
      payout: {
        findMany: jest.fn(),
        update: jest.fn(),
      },
      asset: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
    };
    prisma.fiatStatementImport.findMany.mockResolvedValue([]);
    prisma.fiatStatementImport.updateMany.mockResolvedValue({ count: 0 });
    prisma.customerMain.findMany.mockResolvedValue([
      { id: 'customer-1', customerNo: 'CU260001' },
    ]);
    prisma.reconciliationWarning.create.mockImplementation(
      async ({ data }: any) => ({
        ...buildWarning(),
        ...data,
        id: 'warning-1',
      }),
    );
    auditLogsService = {
      recordByActor: jest.fn().mockResolvedValue(undefined),
    };
    service = new SafeguardingReconciliationService(
      prisma,
      auditLogsService as any,
    );
  });

  it('creates deposit warning without formal break when crypto liability equals safeguarded pool total', async () => {
    prisma.safeguardingRun.create.mockResolvedValue(buildRun({ status: 'RUNNING' }));
    prisma.safeguardingRun.update.mockResolvedValue(
      buildRun({ breakCount: 0, warningCount: 1 }),
    );
    prisma.asset.findMany.mockResolvedValue([assetRows[0]]);
    prisma.journalLine.findMany.mockResolvedValue([
      {
        assetId: 'asset-btc',
        ownerId: 'customer-1',
        accountCode: 'L.CLIENT_CREDIT',
        drCr: 'CR',
        amount: new Prisma.Decimal('7'),
      },
    ]);
    prisma.wallet.findMany.mockResolvedValue([
      buildWallet({
        id: 'wallet-deposit',
        walletNo: 'WA2600000009',
        walletRole: 'C_DEP',
        direction: 'INBOUND',
        ownerType: 'CUSTOMER',
        ownerId: 'customer-1',
        ownerNo: 'CU260001',
      }),
      buildWallet({
        id: 'wallet-master',
        walletNo: 'WA2600000010',
        walletRole: 'C_MAIN',
        direction: 'BIDIRECTIONAL',
        ownerType: 'CUSTOMER',
        ownerId: null,
        ownerNo: 'CUSTOMER_POOL',
      }),
    ]);
    prisma.walletBalanceSnapshot.findMany.mockResolvedValue([
      buildWalletSnapshot({
        walletId: 'wallet-deposit',
        totalBalance: new Prisma.Decimal('2'),
        availableBalance: new Prisma.Decimal('2'),
        updatedAt: new Date('2026-03-29T20:00:00.000Z'),
      }),
      buildWalletSnapshot({
        walletId: 'wallet-master',
        totalBalance: new Prisma.Decimal('5'),
        availableBalance: new Prisma.Decimal('5'),
        updatedAt: new Date('2026-03-30T11:55:00.000Z'),
      }),
    ]);
    prisma.safeguardingPolicy.findMany.mockResolvedValue([
      {
        id: 'policy-1',
        assetId: 'asset-btc',
        poolRole: 'C_DEP',
        collectionAmountThreshold: new Prisma.Decimal('1'),
        collectionMaxAgeMinutes: 60,
        targetMinBalance: null,
        targetMaxBalance: null,
        status: 'ACTIVE',
      },
    ]);
    prisma.payout.findMany.mockResolvedValue([]);
    prisma.reconciliationWarning.createMany.mockResolvedValue({ count: 1 });
    prisma.reconciliationWarning.findMany.mockResolvedValue([buildWarning()]);
    prisma.reconciliationBreak.findUnique.mockResolvedValue(null);

    const result: any = await service.generateDailyDiff(
      { businessDate: '2026-03-30' },
      'admin-1',
    );

    expect(result.breakCount).toBe(0);
    expect(result.warningCount).toBe(1);
    expect(result.summaryByAsset).toEqual([
      expect.objectContaining({
        assetId: 'asset-btc',
        assetCode: 'BTC',
        liabilityAmount: '7',
        poolAmount: '7',
      }),
    ]);
  });

  it('creates coverage break and safeguarding alert when crypto liability does not match pool total', async () => {
    prisma.safeguardingRun.create.mockResolvedValue(buildRun({ status: 'RUNNING' }));
    prisma.safeguardingRun.update.mockResolvedValue(
      buildRun({ breakCount: 1, warningCount: 0 }),
    );
    prisma.asset.findMany.mockResolvedValue([assetRows[0]]);
    prisma.journalLine.findMany.mockResolvedValue([
      {
        assetId: 'asset-btc',
        ownerId: 'customer-1',
        accountCode: 'L.CLIENT_CREDIT',
        drCr: 'CR',
        amount: new Prisma.Decimal('7'),
      },
    ]);
    prisma.wallet.findMany.mockResolvedValue([
      buildWallet({
        id: 'wallet-master',
        walletNo: 'WA2600000010',
        walletRole: 'C_MAIN',
        direction: 'BIDIRECTIONAL',
        ownerType: 'CUSTOMER',
        ownerId: null,
        ownerNo: 'CUSTOMER_POOL',
      }),
    ]);
    prisma.walletBalanceSnapshot.findMany.mockResolvedValue([
      buildWalletSnapshot({
        walletId: 'wallet-master',
        totalBalance: new Prisma.Decimal('5'),
        availableBalance: new Prisma.Decimal('5'),
      }),
    ]);
    prisma.safeguardingPolicy.findMany.mockResolvedValue([]);
    prisma.payout.findMany.mockResolvedValue([]);
    prisma.reconciliationWarning.createMany.mockResolvedValue({ count: 0 });
    prisma.reconciliationWarning.findMany.mockResolvedValue([]);
    prisma.reconciliationBreak.findUnique.mockResolvedValueOnce(null);
    prisma.reconciliationBreak.create.mockResolvedValue(buildBreak());

    const result: any = await service.generateDailyDiff(
      { businessDate: '2026-03-30' },
      'admin-1',
    );

    expect(result.breakCount).toBe(1);
    expect(result.summaryByAsset).toEqual([
      expect.objectContaining({
        assetId: 'asset-btc',
        breakType: 'COVERAGE_BREAK',
        deltaAmount: '2',
      }),
    ]);
  });

  it('creates external-proof break when fiat pool total matches liability but statement balance differs', async () => {
    prisma.safeguardingRun.create.mockResolvedValue(buildRun({ status: 'RUNNING' }));
    prisma.safeguardingRun.update.mockResolvedValue(
      buildRun({ breakCount: 1, warningCount: 0 }),
    );
    prisma.asset.findMany.mockResolvedValue([assetRows[1]]);
    prisma.journalLine.findMany.mockResolvedValue([
      {
        assetId: 'asset-aed',
        ownerId: 'customer-1',
        accountCode: 'L.CLIENT_CREDIT',
        drCr: 'CR',
        amount: new Prisma.Decimal('100'),
      },
    ]);
    prisma.wallet.findMany.mockResolvedValue([
      buildWallet({
        id: 'wallet-bank',
        walletNo: 'WA2600000001',
        walletRole: 'C_CMA',
        type: 'FIAT_BANK',
        direction: 'BIDIRECTIONAL',
        assetId: 'asset-aed',
        ownerType: 'CUSTOMER',
        ownerId: null,
        ownerNo: 'CUSTOMER_POOL',
        iban: 'AE00-CUST',
      }),
    ]);
    prisma.walletBalanceSnapshot.findMany.mockResolvedValue([
      buildWalletSnapshot({
        walletId: 'wallet-bank',
        assetId: 'asset-aed',
        totalBalance: new Prisma.Decimal('100'),
        availableBalance: new Prisma.Decimal('100'),
      }),
    ]);
    prisma.safeguardingPolicy.findMany.mockResolvedValue([]);
    prisma.payout.findMany.mockResolvedValue([]);
    prisma.fiatStatementImport.findMany.mockResolvedValue([
      {
      id: 'stmt-1',
      importNo: 'STI2603300001',
      businessDate: '2026-03-30',
      assetId: 'asset-aed',
      walletId: 'wallet-bank',
      status: 'READY',
      closingBalance: new Prisma.Decimal('95'),
      asset: { code: 'AED' },
      entries: [],
      },
    ]);
    prisma.reconciliationWarning.createMany.mockResolvedValue({ count: 0 });
    prisma.reconciliationWarning.findMany.mockResolvedValue([]);
    prisma.reconciliationBreak.findUnique.mockResolvedValueOnce(null);
    prisma.reconciliationBreak.create.mockResolvedValue(
      buildBreak({
        assetId: 'asset-aed',
        assetCode: 'AED',
        sourceId: 'asset-aed',
        sourceNo: 'AED',
        reasonCode: 'EXTERNAL_PROOF_BREAK',
        breakType: 'EXTERNAL_PROOF_BREAK',
        liabilityAmount: new Prisma.Decimal('100'),
        poolAmount: new Prisma.Decimal('100'),
        externalAmount: new Prisma.Decimal('95'),
        deltaAmount: new Prisma.Decimal('5'),
      }),
    );

    const result: any = await service.generateDailyDiff(
      { businessDate: '2026-03-30' },
      'admin-1',
    );

    expect(result.breakCount).toBe(1);
    expect(result.summaryByAsset).toEqual([
      expect.objectContaining({
        assetId: 'asset-aed',
        breakType: 'EXTERNAL_PROOF_BREAK',
        liabilityAmount: '100',
        poolAmount: '100',
        externalAmount: '95',
      }),
    ]);
  });

  it('imports fiat statement csv and derives closing balance from normalized entries', async () => {
    prisma.asset.findUnique.mockResolvedValue(assetRows[1]);
    prisma.wallet.findUnique.mockResolvedValue(
      buildWallet({
        id: 'wallet-bank',
        walletNo: 'WA2600000001',
        walletRole: 'C_CMA',
        type: 'FIAT_BANK',
        direction: 'BIDIRECTIONAL',
        assetId: 'asset-aed',
        ownerType: 'CUSTOMER',
        ownerId: null,
        ownerNo: 'CUSTOMER_POOL',
        iban: 'AE00-CUST',
        regulatoryEnablementStatus: 'EFFECTIVE',
      }),
    );
    prisma.fiatStatementImport.create.mockResolvedValue({
      id: 'stmt-1',
      importNo: 'STI2603300001',
      businessDate: '2026-03-30',
      assetId: 'asset-aed',
      walletId: 'wallet-bank',
      fileName: 'statement.csv',
      status: 'READY',
      closingBalance: new Prisma.Decimal('95'),
      traceId: 'SAFEGUARDING:2026-03-30:AED',
    });
    prisma.fiatStatementEntry.createMany.mockResolvedValue({ count: 2 });
    prisma.fiatStatementImport.update.mockResolvedValue({
      id: 'stmt-1',
      importNo: 'STI2603300001',
      businessDate: '2026-03-30',
      assetId: 'asset-aed',
      walletId: 'wallet-bank',
      fileName: 'statement.csv',
      status: 'READY',
      closingBalance: new Prisma.Decimal('95'),
      traceId: 'SAFEGUARDING:2026-03-30:AED',
    });

    const result = await (service as any).importFiatStatement(
      {
        businessDate: '2026-03-30',
        assetId: 'asset-aed',
        walletId: 'wallet-bank',
      },
      {
        originalname: 'statement.csv',
        buffer: Buffer.from(
          [
            'referenceNo,valueDate,amount,balance,description',
            'REF-1,2026-03-30,100.00,100.00,credit',
            'REF-2,2026-03-30,-5.00,95.00,fee',
          ].join('\n'),
        ),
      },
      'admin-1',
    );

    expect(result.status).toBe('READY');
    expect(String(result.closingBalance)).toBe('95');
    expect(prisma.fiatStatementEntry.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            referenceNo: 'REF-1',
            amount: new Prisma.Decimal('100'),
            balance: new Prisma.Decimal('100'),
          }),
        ]),
      }),
    );
  });

  it('rejects fiat statement import when C_CMA wallet enablement is not effective', async () => {
    prisma.asset.findUnique.mockResolvedValue(assetRows[1]);
    prisma.wallet.findUnique.mockResolvedValue(
      buildWallet({
        id: 'wallet-bank',
        walletNo: 'WA2600000001',
        walletRole: 'C_CMA',
        type: 'FIAT_BANK',
        direction: 'BIDIRECTIONAL',
        assetId: 'asset-aed',
        ownerType: 'CUSTOMER',
        ownerId: null,
        ownerNo: 'CUSTOMER_POOL',
        iban: 'AE00-CUST',
        regulatoryEnablementStatus: 'PENDING',
      }),
    );

    await expect(
      (service as any).importFiatStatement(
        {
          businessDate: '2026-03-30',
          assetId: 'asset-aed',
          walletId: 'wallet-bank',
        },
        {
          originalname: 'statement.csv',
          buffer: Buffer.from(
            [
              'referenceNo,valueDate,amount,balance,description',
              'REF-1,2026-03-30,100.00,100.00,credit',
            ].join('\n'),
          ),
        },
        'admin-1',
      ),
    ).rejects.toThrow('C_CMA wallet must be regulator-enabled before statement import');
  });

  it('updates break status without mutating payout or withdraw business states', async () => {
    prisma.reconciliationBreak.findUnique.mockResolvedValue(
      buildBreak({ status: ReconciliationBreakStatuses.OPEN }),
    );
    prisma.reconciliationBreak.update.mockResolvedValue(
      buildBreak({
        status: ReconciliationBreakStatuses.RESOLVED,
        resolvedAt: new Date('2026-03-30T13:00:00.000Z'),
      }),
    );
    const result = await service.updateStatus(
      'break-1',
      {
        status: ReconciliationBreakStatuses.RESOLVED,
        note: 'verified by operator',
      },
      'admin-1',
    );

    expect(result.status).toBe(ReconciliationBreakStatuses.RESOLVED);
    expect(prisma.wallet.update).not.toHaveBeenCalled();
    expect(prisma.payout.update).not.toHaveBeenCalled();
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'RECONCILIATION_BREAK',
      }),
      expect.any(Object),
      prisma,
    );
  });
});
