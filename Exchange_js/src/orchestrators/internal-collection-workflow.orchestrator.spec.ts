import { Test, TestingModule } from '@nestjs/testing';
import { InternalCollectionWorkflowOrchestrator } from './internal-collection-workflow.orchestrator';
import { PrismaService } from '../core/prisma/prisma.service';
import { InternalTransactionsService } from '../modules/asset-treasury/internal-transactions/internal-transactions.service';
import { InternalFundsService } from '../modules/asset-treasury/internal-funds/internal-funds.service';
import { DepositTransactionStatus } from '../modules/trading/deposit-transactions/dto/deposit-transaction.dto';

describe('InternalCollectionWorkflowOrchestrator', () => {
  let orchestrator: InternalCollectionWorkflowOrchestrator;
  let prisma: any;
  let internalTransactionsService: any;
  let internalFundsService: any;

  const mockTxClient: any = {};

  const mockPrisma = {
    depositTransaction: {
      findMany: jest.fn(),
    },
    wallet: {
      findFirst: jest.fn(),
    },
    internalTransaction: {
      findUnique: jest.fn(),
    },
    internalFund: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn((cb: any) => cb(mockTxClient)),
  };

  const mockInternalTransactionsService = {
    createFromDepositSuccess: jest.fn(),
  };

  const mockInternalFundsService = {
    createFromInternalTransaction: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InternalCollectionWorkflowOrchestrator,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        {
          provide: InternalTransactionsService,
          useValue: mockInternalTransactionsService,
        },
        {
          provide: InternalFundsService,
          useValue: mockInternalFundsService,
        },
      ],
    }).compile();

    orchestrator = module.get<InternalCollectionWorkflowOrchestrator>(
      InternalCollectionWorkflowOrchestrator,
    );
    prisma = module.get<PrismaService>(PrismaService);
    internalTransactionsService = module.get<InternalTransactionsService>(
      InternalTransactionsService,
    );
    internalFundsService =
      module.get<InternalFundsService>(InternalFundsService);

    jest.clearAllMocks();
  });

  it('should skip when deposit status is not SUCCESS', async () => {
    const result = await orchestrator.onDepositStatusChanged({
      depositId: 'dep-1',
      oldStatus: DepositTransactionStatus.COMPLIANCE_PENDING,
      newStatus: DepositTransactionStatus.UNDER_REVIEW,
    } as any);

    expect(result).toBeNull();
    expect(prisma.depositTransaction.findMany).not.toHaveBeenCalled();
  });

  it('should not auto-create collection when deposit becomes SUCCESS', async () => {
    const reconcileSpy = jest
      .spyOn(orchestrator as any, 'reconcileMissingCollections')
      .mockResolvedValue({
        scanned: 1,
        created: 1,
        idempotent: 0,
        skipped: 0,
        failed: 0,
        items: [
          {
            depositId: 'dep-retry',
            depositNo: 'DEP-RETRY',
            action: 'CREATED',
            internalTransactionId: 'itx-retry',
            internalFundId: 'ifd-retry',
          },
        ],
      });

    const result = await orchestrator.onDepositStatusChanged({
      depositId: 'dep-retry',
      oldStatus: DepositTransactionStatus.COMPLIANCE_PENDING,
      newStatus: DepositTransactionStatus.SUCCESS,
    } as any);

    expect(result).toBeNull();
    expect(reconcileSpy).not.toHaveBeenCalled();
    expect(
      internalTransactionsService.createFromDepositSuccess,
    ).not.toHaveBeenCalled();
    expect(
      internalFundsService.createFromInternalTransaction,
    ).not.toHaveBeenCalled();
  });

  it('should skip non-CRYPTO deposit in reconcile', async () => {
    prisma.depositTransaction.findMany.mockResolvedValue([
      {
        id: 'dep-fiat',
        depositNo: 'DEP-FIAT',
        ownerType: 'CUSTOMER',
        ownerId: 'cust-fiat',
        assetId: 'asset-usd',
        amount: '100',
        netAmount: '100',
        feeAmount: '0',
        toWalletId: 'wallet-fiat',
        toAddress: null,
        toIban: 'IBAN001',
        asset: {
          type: 'FIAT',
          code: 'USD',
          network: null,
        },
        customer: {
          customerNo: 'CF001',
        },
      },
    ]);

    const result = await orchestrator.reconcileMissingCollections({
      depositId: 'dep-fiat',
      onlyMissing: false,
      dryRun: false,
    });

    expect(result.skipped).toBe(1);
    expect(result.created).toBe(0);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        depositId: 'dep-fiat',
        action: 'SKIPPED',
      }),
    );
    expect(prisma.internalTransaction.findUnique).not.toHaveBeenCalled();
    expect(
      internalTransactionsService.createFromDepositSuccess,
    ).not.toHaveBeenCalled();
  });

  it('should create internal transaction and internal fund for crypto success deposit when reconciled explicitly', async () => {
    prisma.depositTransaction.findMany.mockResolvedValue([
      {
        id: 'dep-crypto',
        depositNo: 'DEP-2',
        ownerType: 'CUSTOMER',
        ownerId: 'cust-2',
        assetId: 'asset-btc',
        amount: '0.5',
        netAmount: '0.5',
        feeAmount: '0',
        toWalletId: 'wallet-deposit',
        toAddress: '0xdeposit',
        toIban: null,
        asset: {
          type: 'CRYPTO',
          code: 'BTC',
          network: 'BTC',
        },
        customer: {
          customerNo: 'C002',
        },
      },
    ]);
    prisma.internalTransaction.findUnique.mockResolvedValue(null);
    prisma.internalFund.findFirst.mockResolvedValue(null);
    prisma.wallet.findFirst.mockResolvedValue({
      id: 'wallet-master',
      walletNo: 'WA-MST-BTC-BTC',
      address: '0xmaster',
      iban: null,
    });
    internalTransactionsService.createFromDepositSuccess.mockResolvedValue({
      id: 'itx-1',
    });
    internalFundsService.createFromInternalTransaction.mockResolvedValue({
      id: 'ifd-1',
    });

    const result = await orchestrator.reconcileMissingCollections({
      depositId: 'dep-crypto',
      onlyMissing: false,
      dryRun: false,
    });

    expect(prisma.wallet.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          walletNo: 'WA-MST-BTC-BTC',
          ownerType: 'CUSTOMER',
          ownerId: null,
          assetId: 'asset-btc',
        }),
      }),
    );
    expect(
      internalTransactionsService.createFromDepositSuccess,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        deposit: expect.objectContaining({ id: 'dep-crypto' }),
      }),
      'SYSTEM',
      mockTxClient,
    );
    expect(
      internalFundsService.createFromInternalTransaction,
    ).toHaveBeenCalledWith(
      {
        internalTransactionId: 'itx-1',
      },
      'SYSTEM',
      mockTxClient,
    );
    expect(result).toEqual(
      expect.objectContaining({
        scanned: 1,
        created: 1,
        failed: 0,
        items: [
          expect.objectContaining({
            depositId: 'dep-crypto',
            action: 'CREATED',
            internalTransactionId: 'itx-1',
            internalFundId: 'ifd-1',
          }),
        ],
      }),
    );
  });

  it('should return idempotent when onlyMissing is true and internal transaction exists', async () => {
    prisma.depositTransaction.findMany.mockResolvedValue([
      {
        id: 'dep-existing',
        depositNo: 'DEP-EXIST',
        ownerType: 'CUSTOMER',
        ownerId: 'cust-3',
        assetId: 'asset-btc',
        amount: '1',
        netAmount: '1',
        feeAmount: '0',
        toWalletId: 'wallet-deposit',
        toAddress: '0xdeposit',
        toIban: null,
        asset: {
          type: 'CRYPTO',
          code: 'BTC',
          network: 'BTC',
        },
        customer: {
          customerNo: 'C003',
        },
      },
    ]);
    prisma.internalTransaction.findUnique.mockResolvedValue({
      id: 'itx-existing',
    });
    prisma.internalFund.findFirst.mockResolvedValue({
      id: 'ifd-existing',
    });

    const result = await orchestrator.reconcileMissingCollections({
      onlyMissing: true,
    });

    expect(result.idempotent).toBe(1);
    expect(result.created).toBe(0);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        depositId: 'dep-existing',
        action: 'IDEMPOTENT',
        internalTransactionId: 'itx-existing',
      }),
    );
    expect(
      internalTransactionsService.createFromDepositSuccess,
    ).not.toHaveBeenCalled();
    expect(
      internalFundsService.createFromInternalTransaction,
    ).not.toHaveBeenCalled();
  });

  it('should support dry-run for missing collections', async () => {
    prisma.depositTransaction.findMany.mockResolvedValue([
      {
        id: 'dep-dry-run',
        depositNo: 'DEP-DRY',
        ownerType: 'CUSTOMER',
        ownerId: 'cust-4',
        assetId: 'asset-btc',
        amount: '2',
        netAmount: '2',
        feeAmount: '0',
        toWalletId: 'wallet-deposit',
        toAddress: '0xdeposit',
        toIban: null,
        asset: {
          type: 'CRYPTO',
          code: 'BTC',
          network: 'BTC',
        },
        customer: {
          customerNo: 'C004',
        },
      },
    ]);
    prisma.internalTransaction.findUnique.mockResolvedValue(null);
    prisma.wallet.findFirst.mockResolvedValue({
      id: 'wallet-master',
      walletNo: 'WA-MST-BTC-BTC',
      address: '0xmaster',
      iban: null,
    });

    const result = await orchestrator.reconcileMissingCollections({
      onlyMissing: true,
      dryRun: true,
    });

    expect(result.created).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        depositId: 'dep-dry-run',
        action: 'WOULD_CREATE',
      }),
    );
    expect(
      internalTransactionsService.createFromDepositSuccess,
    ).not.toHaveBeenCalled();
    expect(
      internalFundsService.createFromInternalTransaction,
    ).not.toHaveBeenCalled();
  });
});
