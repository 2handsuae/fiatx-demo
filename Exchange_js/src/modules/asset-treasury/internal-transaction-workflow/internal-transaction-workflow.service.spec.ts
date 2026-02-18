import { Prisma } from '@prisma/client';
import { InternalFundsService } from '../internal-funds/internal-funds.service';
import { InternalFundStatus } from '../internal-funds/dto/internal-fund.dto';
import { InternalTransactionsService } from '../internal-transactions/internal-transactions.service';
import {
  InternalTransactionApprovalStatus,
  InternalTransactionStatus,
  InternalTransactionType,
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
      approveManualReview: jest.fn(),
      rejectManualReview: jest.fn(),
    };

    internalFundsService = {
      createFromInternalTransaction: jest.fn(),
    };

    service = new InternalTransactionWorkflowService(
      prisma,
      internalTransactionsService as unknown as InternalTransactionsService,
      internalFundsService as unknown as InternalFundsService,
    );
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env.INTERNAL_TX_ALLOW_SELF_APPROVAL = originalSelfApproval;
  });

  it('creates pending manual transaction without creating initial fund', async () => {
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
        id: 'wallet-liq',
        walletRole: 'LIQ',
        ownerType: 'PLATFORM',
        ownerId: null,
        ownerNo: 'PLATFORM',
        assetId: 'asset-btc',
        status: 'ACTIVE',
        address: 'bc1qliqxxx',
        iban: null,
      });
    internalTransactionsService.createStandaloneTransaction.mockResolvedValue({
      id: 'itx-1',
    });

    const result = await service.createManualTransaction(
      {
        type: InternalTransactionType.MASTER_TO_LIQ,
        assetId: 'asset-btc',
        fromWalletId: 'wallet-master',
        toWalletId: 'wallet-liq',
        amount: '1.25',
        referenceNo: 'REF-1',
        reason: 'Treasury rebalance',
      },
      'admin-1',
    );

    expect(internalTransactionsService.createStandaloneTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: InternalTransactionType.MASTER_TO_LIQ,
        sourceType: 'INTERNAL_MANUAL',
        status: InternalTransactionStatus.INTERNAL_FUNDS_PENDING,
        approvalStatus: InternalTransactionApprovalStatus.PENDING,
        makerUserId: 'admin-1',
        ownerType: 'CUSTOMER',
        ownerId: 'CUSTOMER_POOL',
        reviewReason: 'Treasury rebalance',
        amount: expect.any(Prisma.Decimal),
      }),
      'admin-1',
      txClient,
    );
    const createdTxInput =
      internalTransactionsService.createStandaloneTransaction.mock.calls[0][0];
    expect(createdTxInput.amount.toString()).toBe('1.25');
    expect(internalFundsService.createFromInternalTransaction).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        idempotent: false,
        internalTransaction: { id: 'itx-1' },
        internalFund: null,
      }),
    );
  });

  it('creates pending manual FIAT transaction for bank pool route', async () => {
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
        address: null,
        iban: 'AE11-CUST',
      })
      .mockResolvedValueOnce({
        id: 'wallet-liq-bank',
        walletRole: 'LIQ_BANK',
        ownerType: 'PLATFORM',
        ownerId: null,
        ownerNo: 'PLATFORM',
        assetId: 'asset-aed',
        status: 'ACTIVE',
        address: null,
        iban: 'AE22-LIQ',
      });
    internalTransactionsService.createStandaloneTransaction.mockResolvedValue({
      id: 'itx-fiat-1',
    });

    const result = await service.createManualTransaction(
      {
        type: InternalTransactionType.CLIENT_BANK_TO_LIQ_BANK,
        assetId: 'asset-aed',
        fromWalletId: 'wallet-cust-bank',
        toWalletId: 'wallet-liq-bank',
        amount: '1000.25',
        reason: 'Fiat bank pool rebalance',
      },
      'admin-1',
    );

    expect(internalTransactionsService.createStandaloneTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: InternalTransactionType.CLIENT_BANK_TO_LIQ_BANK,
        assetId: 'asset-aed',
        fromWalletId: 'wallet-cust-bank',
        toWalletId: 'wallet-liq-bank',
      }),
      'admin-1',
      txClient,
    );
    expect(result).toEqual(
      expect.objectContaining({
        idempotent: false,
        internalTransaction: { id: 'itx-fiat-1' },
        internalFund: null,
      }),
    );
  });

  it('rejects when type-asset pair is mismatched', async () => {
    txClient.internalTransaction.findUnique.mockResolvedValue(null);
    txClient.asset.findUnique.mockResolvedValue({
      id: 'asset-aed',
      type: 'FIAT',
      code: 'AED',
      network: null,
      decimals: 2,
    });

    await expect(
      service.createManualTransaction({
        type: InternalTransactionType.MASTER_TO_LIQ,
        assetId: 'asset-aed',
        fromWalletId: 'wallet-master',
        toWalletId: 'wallet-liq',
        amount: '1',
        reason: 'invalid pair',
      }),
    ).rejects.toThrow('Asset type mismatch');
  });

  it('returns existing transaction and existing fund for same requestId idempotency', async () => {
    txClient.internalTransaction.findUnique.mockResolvedValue({
      id: 'itx-existing',
      internalTxNo: 'ITX0001',
    });
    txClient.internalFund.findFirst.mockResolvedValue({
      id: 'ifd-existing',
      internalFundNo: 'IFD0001',
    });

    const result = await service.createManualTransaction({
      type: InternalTransactionType.LIQ_TO_PAYOUT,
      assetId: 'asset-btc',
      fromWalletId: 'wallet-liq',
      toWalletId: 'wallet-payout',
      amount: '3',
      requestId: 'REQ-001',
      reason: 'Hot wallet top-up',
    });

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

  it('rejects wallet role mismatch for selected type', async () => {
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
        walletRole: 'PAYOUT',
        ownerType: 'CUSTOMER',
        ownerId: null,
        ownerNo: 'CUSTOMER_POOL',
        assetId: 'asset-btc',
        status: 'ACTIVE',
      })
      .mockResolvedValueOnce({
        id: 'wallet-liq',
        walletRole: 'LIQ',
        ownerType: 'PLATFORM',
        ownerId: null,
        ownerNo: 'PLATFORM',
        assetId: 'asset-btc',
        status: 'ACTIVE',
      });

    await expect(
      service.createManualTransaction({
        type: InternalTransactionType.MASTER_TO_LIQ,
        assetId: 'asset-btc',
        fromWalletId: 'wallet-master',
        toWalletId: 'wallet-liq',
        amount: '1',
        reason: 'invalid route',
      }),
    ).rejects.toThrow('fromWallet role mismatch');
  });

  it('rejects FIAT route when wallet role does not match', async () => {
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
        walletRole: 'LIQ',
        ownerType: 'PLATFORM',
        ownerId: null,
        ownerNo: 'PLATFORM',
        assetId: 'asset-aed',
        status: 'ACTIVE',
      })
      .mockResolvedValueOnce({
        id: 'wallet-liq-bank',
        walletRole: 'LIQ_BANK',
        ownerType: 'PLATFORM',
        ownerId: null,
        ownerNo: 'PLATFORM',
        assetId: 'asset-aed',
        status: 'ACTIVE',
      });

    await expect(
      service.createManualTransaction({
        type: InternalTransactionType.CLIENT_BANK_TO_LIQ_BANK,
        assetId: 'asset-aed',
        fromWalletId: 'wallet-wrong',
        toWalletId: 'wallet-liq-bank',
        amount: '10',
        reason: 'invalid fiat route',
      }),
    ).rejects.toThrow('fromWallet role mismatch');
  });

  it('approves review and creates first internal fund', async () => {
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

  it('rejects review and does not create fund', async () => {
    txClient.internalTransaction.findUnique.mockResolvedValue({
      id: 'itx-2',
      sourceType: 'INTERNAL_MANUAL',
      status: InternalTransactionStatus.INTERNAL_FUNDS_PENDING,
      approvalStatus: InternalTransactionApprovalStatus.PENDING,
      makerUserId: 'admin-maker',
    });
    internalTransactionsService.rejectManualReview.mockResolvedValue({
      id: 'itx-2',
      status: InternalTransactionStatus.REJECTED,
    });

    const result = await service.reviewManualTransaction(
      'itx-2',
      {
        action: ManualInternalTransactionReviewAction.REJECT,
        reason: 'insufficient justification',
      },
      'admin-checker',
    );

    expect(internalTransactionsService.rejectManualReview).toHaveBeenCalledWith(
      'itx-2',
      'admin-checker',
      'insufficient justification',
      txClient,
    );
    expect(internalFundsService.createFromInternalTransaction).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        internalTransaction: expect.objectContaining({ id: 'itx-2' }),
        internalFund: null,
      }),
    );
  });

  it('blocks self approval when INTERNAL_TX_ALLOW_SELF_APPROVAL=false', async () => {
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
});
