import { Prisma } from '@prisma/client';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import {
  ApprovalActionTypes,
  type ApprovalActorContext,
} from '../../governance/approvals/constants/approval.constants';
import { InternalFundsService } from '../internal-funds/internal-funds.service';
import { InternalFundStatus } from '../internal-funds/dto/internal-fund.dto';
import { InternalTransactionsService } from '../internal-transactions/internal-transactions.service';
import {
  InternalTransactionApprovalStatus,
  InternalTransactionStatus,
  InternalTransactionType,
  TreasuryTransferInitiationMode,
  TreasuryTransferPurpose,
} from '../internal-transactions/dto/internal-transaction.dto';
import { InternalTransactionWorkflowService } from './internal-transaction-workflow.service';
import { ManualInternalTransactionReviewAction } from './dto/review-manual-internal-transaction.dto';

describe('InternalTransactionWorkflowService', () => {
  const originalSelfApproval = process.env.INTERNAL_TX_ALLOW_SELF_APPROVAL;

  let service: InternalTransactionWorkflowService;
  let prisma: any;
  let txClient: any;
  let internalTransactionsService: any;
  let internalFundsService: any;
  let approvalsService: any;

  const adminActor: ApprovalActorContext = {
    actorType: 'ADMIN',
    userId: 'admin-1',
    userNo: 'ADM-001',
    role: 'SUPER_ADMIN',
    roleCodes: ['SUPER_ADMIN'],
  };

  beforeEach(() => {
    process.env.INTERNAL_TX_ALLOW_SELF_APPROVAL = 'true';

    txClient = {
      internalTransaction: {
        findUnique: jest.fn(),
      },
      internalFund: {
        findFirst: jest.fn(),
      },
      asset: {
        findUnique: jest.fn(),
      },
      wallet: {
        findUnique: jest.fn(),
      },
    };

    prisma = {
      $transaction: jest.fn((cb: any) => cb(txClient)),
    };

    internalTransactionsService = {
      createStandaloneTransaction: jest.fn(),
      syncApprovalProjection: jest.fn(),
      approveManualReview: jest.fn(),
      rejectManualReview: jest.fn(),
    };

    internalFundsService = {
      createFromInternalTransaction: jest.fn(),
    };

    approvalsService = {
      createAndSubmit: jest.fn(),
      emitSubmittedSideEffects: jest.fn(),
    };

    service = new InternalTransactionWorkflowService(
      prisma,
      internalTransactionsService as unknown as InternalTransactionsService,
      internalFundsService as unknown as InternalFundsService,
      approvalsService as unknown as ApprovalsService,
    );
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env.INTERNAL_TX_ALLOW_SELF_APPROVAL = originalSelfApproval;
  });

  it('creates direct-execution manual transaction and first fund for in-pool routes', async () => {
    txClient.internalTransaction.findUnique.mockResolvedValue(null);
    txClient.asset.findUnique.mockResolvedValue({
      id: 'asset-btc',
      type: 'CRYPTO',
      code: 'BTC',
      network: 'BITCOIN',
      decimals: 8,
    });
    txClient.wallet.findUnique
      .mockResolvedValueOnce({
        id: 'wallet-master',
        walletRole: 'MASTER',
        ownerType: 'CUSTOMER',
        ownerId: null,
        ownerNo: 'CUSTOMER_POOL',
        assetId: 'asset-btc',
        status: 'ACTIVE',
        address: 'bc1qmasterxxx',
        iban: null,
      })
      .mockResolvedValueOnce({
        id: 'wallet-payout',
        walletRole: 'PAYOUT',
        ownerType: 'CUSTOMER',
        ownerId: null,
        ownerNo: 'CUSTOMER_POOL',
        assetId: 'asset-btc',
        status: 'ACTIVE',
        address: 'bc1qpayoutxxx',
        iban: null,
      });
    internalTransactionsService.createStandaloneTransaction.mockResolvedValue({
      id: 'itx-1',
      internalTxNo: 'ITX-001',
      referenceNo: 'REF-1',
    });
    internalFundsService.createFromInternalTransaction.mockResolvedValue({
      id: 'ifd-1',
      status: InternalFundStatus.CREATED,
    });

    const result = await service.createManualTransaction(
      {
        purpose: TreasuryTransferPurpose.PAYOUT_FUNDING,
        assetId: 'asset-btc',
        fromWalletId: 'wallet-master',
        toWalletId: 'wallet-payout',
        amount: '1.25',
        referenceNo: 'REF-1',
        reason: 'Prefund payout hot wallet',
      },
      adminActor,
    );

    expect(internalTransactionsService.createStandaloneTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: InternalTransactionType.MASTER_TO_PAYOUT,
        purpose: TreasuryTransferPurpose.PAYOUT_FUNDING,
        initiationMode: TreasuryTransferInitiationMode.MANUAL,
        status: InternalTransactionStatus.INTERNAL_FUNDS_PENDING,
        approvalStatus: InternalTransactionApprovalStatus.APPROVED,
        makerUserId: 'admin-1',
        sourceType: 'INTERNAL_MANUAL',
        amount: expect.any(Prisma.Decimal),
      }),
      'admin-1',
      txClient,
    );
    expect(internalFundsService.createFromInternalTransaction).toHaveBeenCalledWith(
      {
        internalTransactionId: 'itx-1',
        status: InternalFundStatus.CREATED,
        referenceNo: 'REF-1',
      },
      'admin-1',
      txClient,
    );
    expect(approvalsService.createAndSubmit).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        idempotent: false,
        internalTransaction: expect.objectContaining({ id: 'itx-1' }),
        internalFund: expect.objectContaining({ id: 'ifd-1' }),
        approvalCase: null,
      }),
    );
  });

  it('creates shared approval and skips fund creation for cross-pool routes', async () => {
    txClient.internalTransaction.findUnique.mockResolvedValue(null);
    txClient.asset.findUnique.mockResolvedValue({
      id: 'asset-aed',
      type: 'FIAT',
      code: 'AED',
      network: null,
      decimals: 2,
    });
    txClient.wallet.findUnique
      .mockResolvedValueOnce({
        id: 'wallet-cust-bank',
        walletRole: 'CUST_BANK',
        ownerType: 'CUSTOMER',
        ownerId: null,
        ownerNo: 'CUSTOMER_POOL',
        assetId: 'asset-aed',
        status: 'ACTIVE',
        iban: 'AE11-CUST',
        address: null,
        regulatoryEnablementStatus: 'EFFECTIVE',
      })
      .mockResolvedValueOnce({
        id: 'wallet-liq-bank',
        walletRole: 'LIQ_BANK',
        ownerType: 'PLATFORM',
        ownerId: null,
        ownerNo: 'PLATFORM',
        assetId: 'asset-aed',
        status: 'ACTIVE',
        iban: 'AE22-LIQ',
        address: null,
      });
    internalTransactionsService.createStandaloneTransaction.mockResolvedValue({
      id: 'itx-fiat-1',
      internalTxNo: 'ITX-FIAT-001',
      referenceNo: 'POOL-001',
      sourceType: 'INTERNAL_MANUAL',
      sourceNo: 'MANUAL-001',
    });
    approvalsService.createAndSubmit.mockResolvedValue({
      id: 'approval-1',
      approvalNo: 'APR-001',
      status: 'SUBMITTED',
      actionType: ApprovalActionTypes.TREASURY_CROSS_POOL_TRANSFER_APPROVAL,
    });
    internalTransactionsService.syncApprovalProjection.mockResolvedValue({
      id: 'itx-fiat-1',
      internalTxNo: 'ITX-FIAT-001',
      approvalStatus: InternalTransactionApprovalStatus.PENDING,
      approvalCaseId: 'approval-1',
    });

    const result = await service.createManualTransaction(
      {
        purpose: TreasuryTransferPurpose.POOL_REBALANCING,
        assetId: 'asset-aed',
        fromWalletId: 'wallet-cust-bank',
        toWalletId: 'wallet-liq-bank',
        amount: '1000.25',
        referenceNo: 'POOL-001',
        reason: 'Cross-pool fiat rebalance',
      },
      adminActor,
    );

    expect(internalTransactionsService.createStandaloneTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: InternalTransactionType.CLIENT_BANK_TO_LIQ_BANK,
        purpose: TreasuryTransferPurpose.POOL_REBALANCING,
        approvalStatus: InternalTransactionApprovalStatus.PENDING,
      }),
      'admin-1',
      txClient,
    );
    expect(approvalsService.createAndSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: ApprovalActionTypes.TREASURY_CROSS_POOL_TRANSFER_APPROVAL,
        entityRef: 'itx-fiat-1',
        traceId: 'INTERNAL_TX:ITX-FIAT-001',
      }),
      expect.objectContaining({
        traceId: 'INTERNAL_TX:ITX-FIAT-001',
        reason: 'Cross-pool fiat rebalance',
      }),
      adminActor,
      txClient,
      { emitSideEffects: false },
    );
    expect(internalTransactionsService.syncApprovalProjection).toHaveBeenCalledWith(
      'itx-fiat-1',
      {
        approvalCaseId: 'approval-1',
        approvalStatus: InternalTransactionApprovalStatus.PENDING,
        reviewReason: 'Cross-pool fiat rebalance',
      },
      'admin-1',
      txClient,
    );
    expect(internalFundsService.createFromInternalTransaction).not.toHaveBeenCalled();
    expect(approvalsService.emitSubmittedSideEffects).toHaveBeenCalledWith(
      'approval-1',
      adminActor,
      'Cross-pool fiat rebalance',
    );
    expect(result).toEqual(
      expect.objectContaining({
        idempotent: false,
        internalTransaction: expect.objectContaining({ id: 'itx-fiat-1' }),
        internalFund: null,
        approvalCase: expect.objectContaining({ id: 'approval-1' }),
      }),
    );
  });

  it('returns existing transaction and fund for idempotent manual requests', async () => {
    txClient.asset.findUnique.mockResolvedValue({
      id: 'asset-btc',
      type: 'CRYPTO',
      code: 'BTC',
      network: 'BITCOIN',
      decimals: 8,
    });
    txClient.wallet.findUnique
      .mockResolvedValueOnce({
        id: 'wallet-master',
        walletRole: 'MASTER',
        ownerType: 'CUSTOMER',
        ownerId: null,
        ownerNo: 'CUSTOMER_POOL',
        assetId: 'asset-btc',
        status: 'ACTIVE',
      })
      .mockResolvedValueOnce({
        id: 'wallet-payout',
        walletRole: 'PAYOUT',
        ownerType: 'CUSTOMER',
        ownerId: null,
        ownerNo: 'CUSTOMER_POOL',
        assetId: 'asset-btc',
        status: 'ACTIVE',
      });
    txClient.internalTransaction.findUnique.mockResolvedValue({
      id: 'itx-existing',
      internalTxNo: 'ITX-EXIST',
    });
    txClient.internalFund.findFirst.mockResolvedValue({
      id: 'ifd-existing',
      internalFundNo: 'IFD-EXIST',
    });

    const result = await service.createManualTransaction(
      {
        purpose: TreasuryTransferPurpose.PAYOUT_FUNDING,
        assetId: 'asset-btc',
        fromWalletId: 'wallet-master',
        toWalletId: 'wallet-payout',
        amount: '3',
        requestId: 'REQ-001',
        reason: 'Hot wallet top-up',
      },
      adminActor,
    );

    expect(internalTransactionsService.createStandaloneTransaction).not.toHaveBeenCalled();
    expect(internalFundsService.createFromInternalTransaction).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        idempotent: true,
        internalTransaction: expect.objectContaining({ id: 'itx-existing' }),
        internalFund: expect.objectContaining({ id: 'ifd-existing' }),
      }),
    );
  });

  it('rejects wallet route mismatch for selected purpose', async () => {
    txClient.internalTransaction.findUnique.mockResolvedValue(null);
    txClient.asset.findUnique.mockResolvedValue({
      id: 'asset-aed',
      type: 'FIAT',
      code: 'AED',
      network: null,
      decimals: 2,
    });
    txClient.wallet.findUnique
      .mockResolvedValueOnce({
        id: 'wallet-wrong',
        walletRole: 'F_LIQ',
        ownerType: 'PLATFORM',
        ownerId: null,
        ownerNo: 'PLATFORM',
        assetId: 'asset-aed',
        status: 'ACTIVE',
      })
      .mockResolvedValueOnce({
        id: 'wallet-liq-bank',
        walletRole: 'F_LIQ',
        ownerType: 'PLATFORM',
        ownerId: null,
        ownerNo: 'PLATFORM',
        assetId: 'asset-aed',
        status: 'ACTIVE',
      });

    await expect(
      service.createManualTransaction(
        {
          purpose: TreasuryTransferPurpose.POOL_REBALANCING,
          assetId: 'asset-aed',
          fromWalletId: 'wallet-wrong',
          toWalletId: 'wallet-liq-bank',
          amount: '10',
          reason: 'invalid fiat route',
        },
        adminActor,
      ),
    ).rejects.toThrow('wallet route');
  });

  it('approves legacy review and creates first internal fund', async () => {
    txClient.internalTransaction.findUnique.mockResolvedValue({
      id: 'itx-1',
      sourceType: 'INTERNAL_MANUAL',
      status: InternalTransactionStatus.INTERNAL_FUNDS_PENDING,
      approvalStatus: InternalTransactionApprovalStatus.PENDING,
      makerUserId: 'admin-maker',
    });
    internalTransactionsService.approveManualReview.mockResolvedValue({
      id: 'itx-1',
      referenceNo: 'REF-1',
    });
    internalFundsService.createFromInternalTransaction.mockResolvedValue({
      id: 'ifd-1',
      status: InternalFundStatus.CREATED,
    });

    const result = await service.reviewManualTransaction(
      'itx-1',
      {
        action: ManualInternalTransactionReviewAction.APPROVE,
        reason: 'approved',
      },
      'admin-checker',
    );

    expect(internalTransactionsService.approveManualReview).toHaveBeenCalledWith(
      'itx-1',
      'admin-checker',
      'approved',
      txClient,
    );
    expect(internalFundsService.createFromInternalTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        internalTransactionId: 'itx-1',
        status: InternalFundStatus.CREATED,
      }),
      'admin-checker',
      txClient,
    );
    expect(result).toEqual(
      expect.objectContaining({
        internalTransaction: expect.objectContaining({ id: 'itx-1' }),
        internalFund: expect.objectContaining({ id: 'ifd-1' }),
        reviewed: true,
      }),
    );
  });

  it('blocks self approval in legacy review flow when self approval is disabled', async () => {
    process.env.INTERNAL_TX_ALLOW_SELF_APPROVAL = 'false';
    txClient.internalTransaction.findUnique.mockResolvedValue({
      id: 'itx-3',
      sourceType: 'INTERNAL_MANUAL',
      status: InternalTransactionStatus.INTERNAL_FUNDS_PENDING,
      approvalStatus: InternalTransactionApprovalStatus.PENDING,
      makerUserId: 'admin-1',
    });

    await expect(
      service.reviewManualTransaction(
        'itx-3',
        {
          action: ManualInternalTransactionReviewAction.APPROVE,
        },
        'admin-1',
      ),
    ).rejects.toThrow('maker and checker must be different');
  });

  it('blocks legacy review when the transaction is linked to shared approval', async () => {
    txClient.internalTransaction.findUnique.mockResolvedValue({
      id: 'itx-4',
      sourceType: 'INTERNAL_MANUAL',
      status: InternalTransactionStatus.INTERNAL_FUNDS_PENDING,
      approvalStatus: InternalTransactionApprovalStatus.PENDING,
      makerUserId: 'admin-maker',
      approvalCaseId: 'approval-1',
    });

    await expect(
      service.reviewManualTransaction(
        'itx-4',
        {
          action: ManualInternalTransactionReviewAction.APPROVE,
        },
        'admin-checker',
      ),
    ).rejects.toThrow('shared approval');
  });
});
