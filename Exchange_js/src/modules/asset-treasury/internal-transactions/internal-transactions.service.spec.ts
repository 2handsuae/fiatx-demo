import { Prisma } from '@prisma/client';
import { InternalTransactionsService } from './internal-transactions.service';
import {
  InternalTransactionApprovalStatus,
  InternalTransactionStatus,
  TreasuryTransferInitiationMode,
  TreasuryTransferPurpose,
  InternalTransactionType,
} from './dto/internal-transaction.dto';

describe('InternalTransactionsService', () => {
  let service: InternalTransactionsService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      auditLogEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve(data)),
      },
      internalTransaction: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      internalTransactionAuditLog: {
        create: jest.fn(),
      },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };

    service = new InternalTransactionsService(
      prisma,
      { recordByActor: jest.fn().mockResolvedValue({}), recordSystem: jest.fn().mockResolvedValue({}) } as any,
    );
    jest.clearAllMocks();
  });

  it('should aggregate to SUCCESS when all internal funds are CONFIRMED/CLEAR', async () => {
    prisma.internalTransaction.findUnique.mockResolvedValue({
      id: 'itx-1',
      internalTxNo: 'ITX001',
      status: InternalTransactionStatus.INTERNAL_FUNDS_PENDING,
      statusHistory: '[]',
      ownerId: 'cust-1',
      ownerType: 'CUSTOMER',
      assetId: 'asset-1',
      amount: new Prisma.Decimal(10),
      netAmount: new Prisma.Decimal(10),
      feeAmount: new Prisma.Decimal(0),
      funds: [{ status: 'CONFIRMED' }, { status: 'CLEAR' }],
    });
    prisma.internalTransaction.update.mockResolvedValue({
      id: 'itx-1',
      internalTxNo: 'ITX001',
      status: InternalTransactionStatus.SUCCESS,
      asset: { type: 'CRYPTO' },
      ownerId: 'cust-1',
      ownerType: 'CUSTOMER',
      assetId: 'asset-1',
      amount: new Prisma.Decimal(10),
      netAmount: new Prisma.Decimal(10),
      feeAmount: new Prisma.Decimal(0),
    });
    prisma.internalTransactionAuditLog.create.mockResolvedValue({ id: 'log-1' });

    const result = await service.syncStatusFromFunds('itx-1', 'SYSTEM');

    expect(result.status).toBe(InternalTransactionStatus.SUCCESS);
  });

  // ── findFundsOrderBySource: enrich trading detail from 资金单 ──────────────

  it('findFundsOrderBySource maps internalTransaction(s) → summary[] with leg exec fields', async () => {
    prisma.internalTransaction.findMany.mockResolvedValue([
      {
        internalTxNo: 'ITX-DEP-1',
        type: 'DEPOSIT',
        status: InternalTransactionStatus.SUCCESS,
        funds: [
          {
            internalFundNo: 'IFD-1',
            status: 'CLEAR',
            txHash: '0xabc',
            confirmations: 12,
            blockNo: '500',
            nonce: '3',
            gasUsed: '21000',
            effectiveGasPrice: '4000000000',
            sentAt: new Date('2026-06-13T00:00:00Z'),
            confirmedAt: new Date('2026-06-13T00:05:00Z'),
          },
        ],
      },
    ]);

    const result = await service.findFundsOrderBySource('DEPOSIT', 'dep-id-1');

    expect(prisma.internalTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sourceType: 'DEPOSIT', sourceId: 'dep-id-1' },
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(
      expect.objectContaining({
        internalTxNo: 'ITX-DEP-1',
        type: 'DEPOSIT',
        status: InternalTransactionStatus.SUCCESS,
      }),
    );
    expect(result[0].legs[0]).toEqual(
      expect.objectContaining({
        internalFundNo: 'IFD-1',
        txHash: '0xabc',
        confirmations: 12,
        blockNo: '500',
        nonce: '3',
        gasUsed: '21000',
        effectiveGasPrice: '4000000000',
      }),
    );
  });

  it('findFundsOrderBySource returns [] when no funds order exists', async () => {
    prisma.internalTransaction.findMany.mockResolvedValue([]);

    const result = await service.findFundsOrderBySource('SWAP', 'swap-x');

    expect(result).toEqual([]);
  });

  it('should trigger fiat success clearing event when internal tx settles to SUCCESS', async () => {
    prisma.internalTransaction.findUnique.mockResolvedValue({
      id: 'itx-fiat-success',
      internalTxNo: 'ITX-FIAT-S',
      status: InternalTransactionStatus.INTERNAL_FUNDS_PENDING,
      statusHistory: '[]',
      ownerId: 'platform',
      ownerType: 'PLATFORM',
      assetId: 'asset-fiat',
      amount: new Prisma.Decimal(20),
      netAmount: new Prisma.Decimal(20),
      feeAmount: new Prisma.Decimal(0),
      funds: [{ status: 'CONFIRMED' }],
    });
    prisma.internalTransaction.update.mockResolvedValue({
      id: 'itx-fiat-success',
      internalTxNo: 'ITX-FIAT-S',
      status: InternalTransactionStatus.SUCCESS,
      asset: { type: 'FIAT' },
      ownerId: 'platform',
      ownerType: 'PLATFORM',
      assetId: 'asset-fiat',
      amount: new Prisma.Decimal(20),
      netAmount: new Prisma.Decimal(20),
      feeAmount: new Prisma.Decimal(0),
    });
    prisma.internalTransactionAuditLog.create.mockResolvedValue({ id: 'log-fiat-s' });

    const result = await service.syncStatusFromFunds('itx-fiat-success', 'SYSTEM');

    expect(result.status).toBe(InternalTransactionStatus.SUCCESS);
  });

  it('should trigger created event when creating from deposit success', async () => {
    prisma.internalTransaction.findUnique.mockResolvedValueOnce(null);
    prisma.internalTransaction.create.mockResolvedValue({
      id: 'itx-created',
      internalTxNo: 'ITX_NEW_1',
      sourceType: 'DEPOSIT',
      sourceId: 'dep-1',
      sourceNo: 'DEP001',
      purpose: TreasuryTransferPurpose.DEPOSIT_COLLECTION,
      initiationMode: TreasuryTransferInitiationMode.AUTOMATED,
      status: InternalTransactionStatus.INTERNAL_FUNDS_PENDING,
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      assetId: 'asset-1',
      amount: new Prisma.Decimal(10),
      netAmount: new Prisma.Decimal(10),
      feeAmount: new Prisma.Decimal(0),
      fromWalletId: 'wallet-deposit',
      toWalletId: 'wallet-master',
      fromWallet: { id: 'wallet-deposit', ownerType: 'CUSTOMER' },
      toWallet: { id: 'wallet-master', ownerType: 'CUSTOMER' },
      asset: { type: 'CRYPTO' },
    });
    prisma.internalTransactionAuditLog.create.mockResolvedValue({ id: 'log-created' });

    const created = await service.createFromDepositSuccess(
      {
        deposit: {
          id: 'dep-1',
          depositNo: 'DEP001',
          ownerType: 'CUSTOMER',
          ownerId: 'cust-1',
          ownerNo: 'C001',
          assetId: 'asset-1',
          amount: new Prisma.Decimal(10),
          netAmount: new Prisma.Decimal(10),
          feeAmount: new Prisma.Decimal(0),
          toWalletId: 'wallet-deposit',
          toAddress: 'addr-deposit',
          toIban: null,
        },
        masterWallet: {
          id: 'wallet-master',
          address: 'addr-master',
          iban: null,
        },
      },
      'SYSTEM',
    );

    expect(created.id).toBe('itx-created');
  });

  it('should trigger FIAT created event when creating standalone FIAT transaction', async () => {
    prisma.internalTransaction.create.mockResolvedValue({
      id: 'itx-fiat-created',
      internalTxNo: 'ITX_FIAT_1',
      status: InternalTransactionStatus.INTERNAL_FUNDS_PENDING,
      ownerType: 'PLATFORM',
      ownerId: 'PLATFORM',
      assetId: 'asset-fiat',
      amount: new Prisma.Decimal(1000),
      netAmount: new Prisma.Decimal(1000),
      feeAmount: new Prisma.Decimal(0),
      fromWalletId: 'wallet-from',
      toWalletId: 'wallet-to',
      fromWallet: { id: 'wallet-from', ownerType: 'CUSTOMER' },
      toWallet: { id: 'wallet-to', ownerType: 'PLATFORM' },
      asset: { type: 'FIAT' },
    });
    prisma.internalTransactionAuditLog.create.mockResolvedValue({
      id: 'log-fiat-created',
    });

    const created = await service.createStandaloneTransaction(
      {
        type: InternalTransactionType.CLIENT_BANK_TO_LIQ_BANK,
        purpose: TreasuryTransferPurpose.POOL_REBALANCING,
        initiationMode: TreasuryTransferInitiationMode.MANUAL,
        sourceType: 'INTERNAL_MANUAL',
        sourceId: 'manual-fiat-1',
        sourceNo: 'MANUAL-FIAT-1',
        ownerType: 'PLATFORM',
        ownerId: 'PLATFORM',
        ownerNo: 'PLATFORM',
        assetId: 'asset-fiat',
        amount: new Prisma.Decimal(1000),
        feeAmount: new Prisma.Decimal(0),
        netAmount: new Prisma.Decimal(1000),
        fromWalletId: 'wallet-from',
        fromIban: 'AE11-CUST',
        toWalletId: 'wallet-to',
        toIban: 'AE22-LIQ',
        referenceNo: 'MANUAL-FIAT-1',
      },
      'SYSTEM',
    );

    expect(created.id).toBe('itx-fiat-created');
  });

  it('should not trigger created event on idempotent createFromDepositSuccess', async () => {
    prisma.internalTransaction.findUnique.mockResolvedValue({
      id: 'itx-existing',
      internalTxNo: 'ITX_EXIST',
      status: InternalTransactionStatus.INTERNAL_FUNDS_PENDING,
    });

    const existing = await service.createFromDepositSuccess(
      {
        deposit: {
          id: 'dep-dup',
          depositNo: 'DEP-DUP',
          ownerType: 'CUSTOMER',
          ownerId: 'cust-1',
          ownerNo: 'C001',
          assetId: 'asset-1',
          amount: new Prisma.Decimal(5),
          netAmount: new Prisma.Decimal(5),
          feeAmount: new Prisma.Decimal(0),
          toWalletId: 'wallet-deposit',
          toAddress: 'addr-deposit',
          toIban: null,
        },
        masterWallet: {
          id: 'wallet-master',
          address: 'addr-master',
          iban: null,
        },
      },
      'SYSTEM',
    );

    expect(existing.id).toBe('itx-existing');
    expect(prisma.internalTransaction.create).not.toHaveBeenCalled();
  });

  it('should aggregate to FAILED when has FAILED/TIMEOUT and no progressing fund', async () => {
    prisma.internalTransaction.findUnique.mockResolvedValue({
      id: 'itx-2',
      internalTxNo: 'ITX002',
      status: InternalTransactionStatus.INTERNAL_FUNDS_PENDING,
      statusHistory: '[]',
      ownerId: 'cust-1',
      ownerType: 'CUSTOMER',
      assetId: 'asset-1',
      amount: new Prisma.Decimal(10),
      netAmount: new Prisma.Decimal(10),
      feeAmount: new Prisma.Decimal(0),
      funds: [{ status: 'FAILED' }, { status: 'TIMEOUT' }],
    });
    prisma.internalTransaction.update.mockResolvedValue({
      id: 'itx-2',
      internalTxNo: 'ITX002',
      status: InternalTransactionStatus.FAILED,
      ownerId: 'cust-1',
      ownerType: 'CUSTOMER',
      assetId: 'asset-1',
      amount: new Prisma.Decimal(10),
      netAmount: new Prisma.Decimal(10),
      feeAmount: new Prisma.Decimal(0),
    });
    prisma.internalTransactionAuditLog.create.mockResolvedValue({ id: 'log-2' });

    const result = await service.syncStatusFromFunds('itx-2', 'SYSTEM');

    expect(result.status).toBe(InternalTransactionStatus.FAILED);
  });

  it('should aggregate to CANCELLED when all internal funds are CANCELLED', async () => {
    prisma.internalTransaction.findUnique.mockResolvedValue({
      id: 'itx-3',
      internalTxNo: 'ITX003',
      status: InternalTransactionStatus.INTERNAL_FUNDS_PENDING,
      statusHistory: '[]',
      ownerId: 'cust-1',
      ownerType: 'CUSTOMER',
      assetId: 'asset-1',
      amount: new Prisma.Decimal(10),
      netAmount: new Prisma.Decimal(10),
      feeAmount: new Prisma.Decimal(0),
      funds: [{ status: 'CANCELLED' }, { status: 'CANCELLED' }],
    });
    prisma.internalTransaction.update.mockResolvedValue({
      id: 'itx-3',
      internalTxNo: 'ITX003',
      status: InternalTransactionStatus.CANCELLED,
      ownerId: 'cust-1',
      ownerType: 'CUSTOMER',
      assetId: 'asset-1',
      amount: new Prisma.Decimal(10),
      netAmount: new Prisma.Decimal(10),
      feeAmount: new Prisma.Decimal(0),
    });
    prisma.internalTransactionAuditLog.create.mockResolvedValue({ id: 'log-3' });

    const result = await service.syncStatusFromFunds('itx-3', 'SYSTEM');

    expect(result.status).toBe(InternalTransactionStatus.CANCELLED);
  });

  it('should sync approval projection and move transaction to terminal status', async () => {
    prisma.internalTransaction.findUnique.mockResolvedValue({
      id: 'itx-approval-1',
      internalTxNo: 'ITX-APPROVAL-1',
      status: InternalTransactionStatus.INTERNAL_FUNDS_PENDING,
      statusHistory: '[]',
      completedAt: null,
      checkerUserId: null,
      checkedAt: null,
      reviewReason: null,
      ownerId: 'platform',
      ownerType: 'PLATFORM',
      assetId: 'asset-aed',
      amount: new Prisma.Decimal(1000),
      netAmount: new Prisma.Decimal(1000),
      feeAmount: new Prisma.Decimal(0),
      approvalCase: null,
      asset: { type: 'FIAT' },
      fromWallet: { id: 'wallet-from', ownerType: 'CUSTOMER' },
      toWallet: { id: 'wallet-to', ownerType: 'PLATFORM' },
    });
    prisma.internalTransaction.update.mockResolvedValue({
      id: 'itx-approval-1',
      internalTxNo: 'ITX-APPROVAL-1',
      status: InternalTransactionStatus.REJECTED,
      statusHistory: '[]',
      completedAt: new Date(),
      checkerUserId: 'checker-1',
      checkedAt: new Date(),
      reviewReason: 'Rejected by approval workflow',
      ownerId: 'platform',
      ownerType: 'PLATFORM',
      assetId: 'asset-aed',
      amount: new Prisma.Decimal(1000),
      netAmount: new Prisma.Decimal(1000),
      feeAmount: new Prisma.Decimal(0),
      approvalCase: {
        id: 'approval-1',
        approvalNo: 'APR-001',
        status: 'REJECTED',
        actionType: 'TREASURY_CROSS_POOL_TRANSFER_APPROVAL',
      },
      asset: { type: 'FIAT' },
      fromWallet: { id: 'wallet-from', ownerType: 'CUSTOMER' },
      toWallet: { id: 'wallet-to', ownerType: 'PLATFORM' },
    });
    prisma.internalTransactionAuditLog.create.mockResolvedValue({ id: 'log-approval-1' });

    const result = await service.syncApprovalProjection(
      'itx-approval-1',
      {
        approvalCaseId: 'approval-1',
        approvalStatus: InternalTransactionApprovalStatus.REJECTED,
        txStatus: InternalTransactionStatus.REJECTED,
        checkerUserId: 'checker-1',
        reviewReason: 'Rejected by approval workflow',
      },
      'checker-1',
    );

    expect(prisma.internalTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'itx-approval-1' },
        data: expect.objectContaining({
          approvalCaseId: 'approval-1',
          approvalStatus: InternalTransactionApprovalStatus.REJECTED,
          checkerUserId: 'checker-1',
          status: InternalTransactionStatus.REJECTED,
        }),
      }),
    );
    expect(prisma.internalTransactionAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          internalTransactionId: 'itx-approval-1',
          oldStatus: InternalTransactionStatus.INTERNAL_FUNDS_PENDING,
          newStatus: InternalTransactionStatus.REJECTED,
        }),
      }),
    );
    expect(result.status).toBe(InternalTransactionStatus.REJECTED);
  });
});
