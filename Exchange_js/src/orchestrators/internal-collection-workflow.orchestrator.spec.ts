import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../core/prisma/prisma.service';
import { InternalFundsService } from '../modules/asset-treasury/internal-funds/internal-funds.service';
import { InternalFundStatus } from '../modules/asset-treasury/internal-funds/dto/internal-fund.dto';
import { InternalTransactionsService } from '../modules/asset-treasury/internal-transactions/internal-transactions.service';
import {
  InternalTransactionApprovalStatus,
  InternalTransactionStatus,
  TreasuryTransferInitiationMode,
  TreasuryTransferPurpose,
} from '../modules/asset-treasury/internal-transactions/dto/internal-transaction.dto';
import { DepositTransactionStatus } from '../modules/trading/deposit-transactions/dto/deposit-transaction.dto';
import { InternalCollectionWorkflowOrchestrator } from './internal-collection-workflow.orchestrator';

describe('InternalCollectionWorkflowOrchestrator', () => {
  let orchestrator: InternalCollectionWorkflowOrchestrator;
  let prisma: any;
  let internalTransactionsService: any;
  let internalFundsService: any;
  const mockTxClient: any = {};

  const mockPrisma = {
    safeguardingPolicy: {
      findUnique: jest.fn(),
    },
    depositTransaction: {
      findMany: jest.fn(),
    },
    wallet: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    internalTransaction: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    internalFund: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn((cb: any) => cb(mockTxClient)),
  };

  const mockInternalTransactionsService = {
    createFromDepositSuccess: jest.fn(),
    createStandaloneTransaction: jest.fn(),
  };

  const mockInternalFundsService = {
    createFromInternalTransaction: jest.fn(),
  };

  const depositWallet = {
    id: 'wallet-deposit',
    walletNo: 'WA2600000007',
    walletRole: 'C_DEP',
    ownerType: 'CUSTOMER',
    ownerId: 'customer-1',
    ownerNo: 'CUST-001',
    ownerName: 'Demo Customer',
    assetId: 'asset-btc',
    availableBalance: '2.50000000',
    address: 'bc1qdeposit',
    iban: null,
    status: 'ACTIVE',
    asset: {
      code: 'BTC',
      type: 'CRYPTO',
      network: 'BITCOIN',
    },
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
    internalFundsService = module.get<InternalFundsService>(InternalFundsService);

    jest.clearAllMocks();
  });

  it('does not auto-create collection when deposit becomes SUCCESS', async () => {
    const reconcileSpy = jest.spyOn(orchestrator as any, 'reconcileMissingCollections');

    const result = await orchestrator.onDepositStatusChanged({
      depositId: 'dep-retry',
      oldStatus: DepositTransactionStatus.COMPLIANCE_PENDING,
      newStatus: DepositTransactionStatus.SUCCESS,
    } as any);

    expect(result).toBeNull();
    expect(reconcileSpy).not.toHaveBeenCalled();
    expect(internalTransactionsService.createFromDepositSuccess).not.toHaveBeenCalled();
    expect(internalFundsService.createFromInternalTransaction).not.toHaveBeenCalled();
  });

  it('lists deposit wallets with collection thresholds and shouldCollect flag', async () => {
    prisma.wallet.findMany.mockResolvedValue([depositWallet]);
    prisma.wallet.count.mockResolvedValue(1);
    prisma.wallet.findUnique.mockResolvedValue(depositWallet);
    prisma.safeguardingPolicy.findUnique.mockResolvedValue({
      collectionAmountThreshold: '1.00000000',
      collectionMaxAgeMinutes: 60,
    });
    prisma.internalTransaction.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    prisma.depositTransaction.findMany.mockResolvedValue([
      {
        id: 'dep-1',
        depositNo: 'DEP-001',
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      },
    ]);

    const result = await orchestrator.listCollectionWallets({
      take: 20,
    });

    expect(prisma.wallet.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          walletRole: 'C_DEP',
          status: 'ACTIVE',
        }),
      }),
    );
    expect(result.total).toBe(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        walletId: 'wallet-deposit',
        walletNo: 'WA2600000007',
        assetCode: 'BTC',
        shouldCollect: true,
        collectionAmountThreshold: '1',
        collectionMaxAgeMinutes: 60,
      }),
    );
  });

  it('returns dry-run WOULD_CREATE for eligible deposit wallet collection', async () => {
    prisma.wallet.findUnique.mockResolvedValue(depositWallet);
    prisma.safeguardingPolicy.findUnique.mockResolvedValue({
      collectionAmountThreshold: '1.00000000',
      collectionMaxAgeMinutes: 60,
    });
    prisma.internalTransaction.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    prisma.depositTransaction.findMany.mockResolvedValue([
      {
        id: 'dep-1',
        depositNo: 'DEP-001',
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      },
    ]);
    prisma.wallet.findFirst.mockResolvedValue({
      id: 'wallet-master',
      walletNo: 'WA2600000003',
      address: 'bc1qmaster',
      iban: null,
    });

    const result = await orchestrator.reconcileCollectionWallet({
      walletId: 'wallet-deposit',
      dryRun: true,
      operatorId: 'admin-1',
    });

    expect(result).toEqual(
      expect.objectContaining({
        walletId: 'wallet-deposit',
        action: 'WOULD_CREATE',
        shouldCollect: true,
        availableBalance: '2.5',
      }),
    );
    expect(internalTransactionsService.createStandaloneTransaction).not.toHaveBeenCalled();
  });

  it('returns IDEMPOTENT when a pending collection already exists for the wallet', async () => {
    prisma.wallet.findUnique.mockResolvedValue(depositWallet);
    prisma.safeguardingPolicy.findUnique.mockResolvedValue({
      collectionAmountThreshold: '1.00000000',
      collectionMaxAgeMinutes: 60,
    });
    prisma.internalTransaction.findFirst
      .mockResolvedValueOnce({
        id: 'itx-pending',
        sourceType: 'DEPOSIT_WALLET',
        amount: '2.50000000',
        funds: [{ id: 'ifd-pending' }],
      })
      .mockResolvedValueOnce({
        id: 'itx-pending',
        internalTxNo: 'ITX-PENDING',
        status: 'INTERNAL_FUNDS_PENDING',
        createdAt: new Date('2026-03-31T00:00:00Z'),
        completedAt: null,
      })
      .mockResolvedValueOnce(null);
    prisma.depositTransaction.findMany.mockResolvedValue([]);

    const result = await orchestrator.reconcileCollectionWallet({
      walletId: 'wallet-deposit',
      dryRun: false,
      operatorId: 'admin-1',
    });

    expect(result).toEqual(
      expect.objectContaining({
        walletId: 'wallet-deposit',
        action: 'IDEMPOTENT',
        internalTransactionId: 'itx-pending',
        internalFundId: 'ifd-pending',
      }),
    );
  });

  it('does not reuse a legacy pending collection when amount does not match current wallet balance', async () => {
    prisma.wallet.findUnique.mockResolvedValue(depositWallet);
    prisma.safeguardingPolicy.findUnique.mockResolvedValue({
      collectionAmountThreshold: '1.00000000',
      collectionMaxAgeMinutes: 60,
    });
    prisma.internalTransaction.findFirst
      .mockResolvedValueOnce({
        id: 'itx-legacy',
        sourceType: 'DEPOSIT',
        amount: '0.25000000',
        funds: [{ id: 'ifd-legacy' }],
      })
      .mockResolvedValueOnce({
        id: 'itx-legacy',
        internalTxNo: 'ITX-LEGACY',
        status: 'INTERNAL_FUNDS_PENDING',
        createdAt: new Date('2026-03-31T00:00:00Z'),
        completedAt: null,
      })
      .mockResolvedValueOnce(null);
    prisma.depositTransaction.findMany.mockResolvedValue([
      {
        id: 'dep-1',
        depositNo: 'DEP-001',
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      },
    ]);

    const result = await orchestrator.reconcileCollectionWallet({
      walletId: 'wallet-deposit',
      dryRun: false,
      operatorId: 'admin-1',
    });

    expect(result).toEqual(
      expect.objectContaining({
        walletId: 'wallet-deposit',
        action: 'FAILED',
        reason: expect.stringContaining('Pending collection amount mismatch'),
        internalTransactionId: 'itx-legacy',
        internalFundId: 'ifd-legacy',
        existingPendingAmount: '0.25',
        expectedCollectionAmount: '2.5',
      }),
    );
    expect(internalTransactionsService.createStandaloneTransaction).not.toHaveBeenCalled();
  });

  it('creates wallet-driven collection transaction and first internal fund', async () => {
    prisma.wallet.findUnique.mockResolvedValue(depositWallet);
    prisma.safeguardingPolicy.findUnique.mockResolvedValue({
      collectionAmountThreshold: '1.00000000',
      collectionMaxAgeMinutes: 60,
    });
    prisma.internalTransaction.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    prisma.depositTransaction.findMany.mockResolvedValue([
      {
        id: 'dep-1',
        depositNo: 'DEP-001',
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      },
    ]);
    prisma.wallet.findFirst.mockResolvedValue({
      id: 'wallet-master',
      walletNo: 'WA2600000003',
      address: 'bc1qmaster',
      iban: null,
    });
    internalTransactionsService.createStandaloneTransaction.mockResolvedValue({
      id: 'itx-created',
      internalTxNo: 'ITX-COLL-001',
    });
    internalFundsService.createFromInternalTransaction.mockResolvedValue({
      id: 'ifd-created',
      status: InternalFundStatus.CREATED,
    });

    const result = await orchestrator.reconcileCollectionWallet({
      walletId: 'wallet-deposit',
      dryRun: false,
      operatorId: 'admin-1',
    });

    expect(internalTransactionsService.createStandaloneTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: TreasuryTransferPurpose.DEPOSIT_COLLECTION,
        initiationMode: TreasuryTransferInitiationMode.AUTOMATED,
        approvalStatus: InternalTransactionApprovalStatus.APPROVED,
        status: InternalTransactionStatus.INTERNAL_FUNDS_PENDING,
        fromWalletId: 'wallet-deposit',
        toWalletId: 'wallet-master',
      }),
      'admin-1',
      mockTxClient,
    );
    expect(internalFundsService.createFromInternalTransaction).toHaveBeenCalledWith(
      {
        internalTransactionId: 'itx-created',
        status: InternalFundStatus.CREATED,
        referenceNo: 'COLL-WA2600000007',
      },
      'admin-1',
      mockTxClient,
    );
    expect(result).toEqual(
      expect.objectContaining({
        action: 'CREATED',
        internalTransactionId: 'itx-created',
        internalFundId: 'ifd-created',
      }),
    );
  });

  it('supports legacy deposit-driven dry-run reconciliation', async () => {
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
      walletNo: 'WA2600000011',
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
    expect(internalTransactionsService.createFromDepositSuccess).not.toHaveBeenCalled();
    expect(internalFundsService.createFromInternalTransaction).not.toHaveBeenCalled();
  });
});
