import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InternalFundStatus } from '../../asset-treasury/internal-funds/dto/internal-fund.dto';
import {
  InternalTransactionApprovalStatus,
  InternalTransactionSourceType,
  InternalTransactionStatus,
  InternalTransactionType,
  TreasuryTransferInitiationMode,
  TreasuryTransferPurpose,
} from '../../asset-treasury/internal-transactions/dto/internal-transaction.dto';
import { PoolSettlementBatchStatus } from './dto/pool-settlement-batch.dto';
import { PoolSettlementBatchApprovalProjectionService } from './pool-settlement-batch-approval-projection.service';
import { PoolSettlementBatchesService } from './pool-settlement-batches.service';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';

describe('PoolSettlementBatchApprovalProjectionService', () => {
  const decidedAt = '2026-04-01T12:34:56.000Z';

  const makePrisma = () => {
    const prisma: any = {
      poolSettlementBatch: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
      },
      poolSettlementBatchItem: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue({
          id: 'item-1',
          status: 'READY',
        }),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      internalTransaction: {
        update: jest.fn(),
      },
      outstanding: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      reimbursementObligation: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      poolSettlementBatchItemSource: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };

    return prisma;
  };

  const makeModuleRef = () => {
    const internalTransactionsService = {
      createStandaloneTransaction: jest.fn(),
    };
    const internalFundsService = {
      createFromInternalTransaction: jest.fn(),
    };
    const moduleRef = {
      get: jest.fn((token: any) => {
        if (String(token?.name) === 'InternalTransactionsService') {
          return internalTransactionsService;
        }
        if (String(token?.name) === 'InternalFundsService') {
          return internalFundsService;
        }
        return undefined;
      }),
    };

    return {
      moduleRef,
      internalTransactionsService,
      internalFundsService,
    };
  };

  it('marks batch APPROVED and stamps approvedAt', async () => {
    const prisma = makePrisma();
    prisma.poolSettlementBatch.findUnique.mockResolvedValue({
      id: 'batch-1',
      approvalCaseId: 'approval-1',
      batchNo: 'PSB-001',
      status: PoolSettlementBatchStatus.APPROVAL_PENDING,
    });
    prisma.poolSettlementBatch.update.mockResolvedValue({
      id: 'batch-1',
      status: PoolSettlementBatchStatus.APPROVED,
      approvedAt: new Date(decidedAt),
    });
    const { moduleRef, internalTransactionsService, internalFundsService } =
      makeModuleRef();

    const service = new PoolSettlementBatchApprovalProjectionService(
      prisma,
      moduleRef as any,
    );

    await service.handleApproved({
      actionType: ApprovalActionTypes.POOL_SETTLEMENT_BATCH_APPROVAL,
      entityRef: 'batch-1',
      approvalId: 'approval-1',
      approvalNo: 'APR-001',
      status: 'APPROVED',
      decidedAt,
    } as any);

    expect(prisma.poolSettlementBatch.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'batch-1',
        status: PoolSettlementBatchStatus.APPROVAL_PENDING,
        OR: [
          { approvalCaseId: null },
          { approvalCaseId: 'approval-1' },
        ],
      },
      data: {
        status: PoolSettlementBatchStatus.APPROVED,
        approvedAt: new Date(decidedAt),
      },
    });
    expect(prisma.poolSettlementBatchItem.findMany).toHaveBeenCalledWith({
      where: {
        batchId: 'batch-1',
        netAmount: {
          not: 0,
        },
      },
      include: {
        asset: {
          select: {
            id: true,
            type: true,
          },
        },
        walletA: {
          select: {
            id: true,
            walletRole: true,
            address: true,
            iban: true,
          },
        },
        walletB: {
          select: {
            id: true,
            walletRole: true,
            address: true,
            iban: true,
          },
        },
        internalTransaction: {
          select: {
            id: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
    expect(prisma.poolSettlementBatch.update).toHaveBeenLastCalledWith({
      where: { id: 'batch-1' },
      data: {
        status: PoolSettlementBatchStatus.SUCCESS,
        closedAt: expect.any(Date),
      },
    });
    expect(internalTransactionsService.createStandaloneTransaction).not.toHaveBeenCalled();
    expect(internalFundsService.createFromInternalTransaction).not.toHaveBeenCalled();
    expect(prisma.outstanding.updateMany).not.toHaveBeenCalled();
    expect(prisma.reimbursementObligation.updateMany).not.toHaveBeenCalled();
    expect(prisma.poolSettlementBatchItemSource.updateMany).not.toHaveBeenCalled();
  });

  it('closes zero-net source truth on approval before marking batch SUCCESS', async () => {
    const prisma = makePrisma();
    prisma.poolSettlementBatch.findUnique.mockResolvedValue({
      id: 'batch-1',
      approvalCaseId: 'approval-1',
      batchNo: 'PSB-001',
      status: PoolSettlementBatchStatus.APPROVAL_PENDING,
    });
    prisma.poolSettlementBatchItemSource.findMany.mockResolvedValue([
      {
        sourceFamily: 'OUTSTANDING',
        sourceId: 'outstanding-1',
      },
      {
        sourceFamily: 'REIMBURSEMENT_OBLIGATION',
        sourceId: 'obligation-1',
      },
    ]);
    const { moduleRef } = makeModuleRef();

    const service = new PoolSettlementBatchApprovalProjectionService(
      prisma,
      moduleRef as any,
    );

    await service.handleApproved({
      actionType: ApprovalActionTypes.POOL_SETTLEMENT_BATCH_APPROVAL,
      entityRef: 'batch-1',
      approvalId: 'approval-1',
      approvalNo: 'APR-001',
      status: 'APPROVED',
      decidedAt,
    } as any);

    expect(prisma.poolSettlementBatchItemSource.findMany).toHaveBeenCalledWith({
      where: {
        batchId: 'batch-1',
        batchItemId: null,
        status: 'NETTED',
      },
      select: {
        sourceFamily: true,
        sourceId: true,
      },
    });
    expect(prisma.outstanding.updateMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: ['outstanding-1'],
        },
        status: 'OPEN',
        lockedByPoolSettlementBatchId: 'batch-1',
      },
      data: {
        status: 'CLOSED',
        lockedByPoolSettlementBatchId: null,
        lockedAt: null,
        closedAt: new Date(decidedAt),
        closedByInternalFundId: null,
      },
    });
    expect(prisma.reimbursementObligation.updateMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: ['obligation-1'],
        },
        status: 'OPEN',
        lockedByPoolSettlementBatchId: 'batch-1',
      },
      data: {
        status: 'REIMBURSED',
        lockedByPoolSettlementBatchId: null,
        settlementInternalTransactionId: null,
        reimbursedAt: new Date(decidedAt),
      },
    });
    expect(prisma.poolSettlementBatch.update).toHaveBeenLastCalledWith({
      where: { id: 'batch-1' },
      data: {
        status: PoolSettlementBatchStatus.SUCCESS,
        closedAt: expect.any(Date),
      },
    });
  });

  it('creates one internal transaction and first internal fund per non-zero approved item', async () => {
    const prisma = makePrisma();
    prisma.poolSettlementBatch.findUnique.mockResolvedValue({
      id: 'batch-1',
      batchNo: 'PSB-001',
      approvalCaseId: 'approval-1',
      status: PoolSettlementBatchStatus.APPROVAL_PENDING,
    });
    prisma.poolSettlementBatchItem.findMany.mockResolvedValue([
      {
        id: 'item-1',
        batchId: 'batch-1',
        status: 'READY',
        assetId: 'asset-fiat',
        netAmount: 125,
        netDirection: 'A_TO_B',
        walletAId: 'wallet-cust-bank',
        walletBId: 'wallet-liq-bank',
        asset: { id: 'asset-fiat', type: 'FIAT' },
        walletA: {
          id: 'wallet-cust-bank',
          walletRole: 'C_CMA',
          address: null,
          iban: 'AE11',
        },
        walletB: {
          id: 'wallet-liq-bank',
          walletRole: 'F_LIQ',
          address: null,
          iban: 'AE22',
        },
        internalTransaction: null,
      },
      {
        id: 'item-2',
        batchId: 'batch-1',
        status: 'READY',
        assetId: 'asset-crypto',
        netAmount: 75,
        netDirection: 'B_TO_A',
        walletAId: 'wallet-master',
        walletBId: 'wallet-liq',
        asset: { id: 'asset-crypto', type: 'CRYPTO' },
        walletA: {
          id: 'wallet-master',
          walletRole: 'C_MAIN',
          address: '0xmaster',
          iban: null,
        },
        walletB: {
          id: 'wallet-liq',
          walletRole: 'F_LIQ',
          address: '0xliq',
          iban: null,
        },
        internalTransaction: null,
      },
    ]);
    prisma.poolSettlementBatch.update.mockResolvedValue({ id: 'batch-1' });
    prisma.poolSettlementBatchItem.update.mockResolvedValue({ id: 'item-1' });
    const { moduleRef, internalTransactionsService, internalFundsService } =
      makeModuleRef();
    internalTransactionsService.createStandaloneTransaction
      .mockResolvedValueOnce({ id: 'itx-1' })
      .mockResolvedValueOnce({ id: 'itx-2' });
    internalFundsService.createFromInternalTransaction
      .mockResolvedValueOnce({ id: 'ifd-1' })
      .mockResolvedValueOnce({ id: 'ifd-2' });

    const service = new PoolSettlementBatchApprovalProjectionService(
      prisma,
      moduleRef as any,
    );

    await service.handleApproved({
      actionType: ApprovalActionTypes.POOL_SETTLEMENT_BATCH_APPROVAL,
      entityRef: 'batch-1',
      approvalId: 'approval-1',
      approvalNo: 'APR-001',
      status: 'APPROVED',
      decidedAt,
    } as any);

    expect(internalTransactionsService.createStandaloneTransaction).toHaveBeenCalledTimes(2);
    expect(internalTransactionsService.createStandaloneTransaction).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: InternalTransactionType.CLIENT_BANK_TO_LIQ_BANK,
        purpose: TreasuryTransferPurpose.POOL_REBALANCING,
        initiationMode: TreasuryTransferInitiationMode.AUTOMATED,
        status: InternalTransactionStatus.INTERNAL_FUNDS_PENDING,
        approvalStatus: InternalTransactionApprovalStatus.APPROVED,
        sourceType: InternalTransactionSourceType.POOL_SETTLEMENT_BATCH_ITEM,
        sourceId: 'item-1',
        sourceNo: 'PSB-001',
        ownerType: 'PLATFORM',
        ownerId: 'PLATFORM',
        ownerNo: 'PLATFORM',
        assetId: 'asset-fiat',
        amount: 125,
        feeAmount: expect.anything(),
        netAmount: 125,
        fromWalletId: 'wallet-cust-bank',
        fromAddress: null,
        fromIban: 'AE11',
        toWalletId: 'wallet-liq-bank',
        toAddress: null,
        toIban: 'AE22',
        referenceNo: 'PSB-001',
      }),
      'SYSTEM',
      prisma,
    );
    expect(internalTransactionsService.createStandaloneTransaction).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: InternalTransactionType.LIQ_TO_MASTER,
        purpose: TreasuryTransferPurpose.POOL_REBALANCING,
        initiationMode: TreasuryTransferInitiationMode.AUTOMATED,
        status: InternalTransactionStatus.INTERNAL_FUNDS_PENDING,
        approvalStatus: InternalTransactionApprovalStatus.APPROVED,
        sourceType: InternalTransactionSourceType.POOL_SETTLEMENT_BATCH_ITEM,
        sourceId: 'item-2',
        sourceNo: 'PSB-001',
        ownerType: 'PLATFORM',
        ownerId: 'PLATFORM',
        ownerNo: 'PLATFORM',
        assetId: 'asset-crypto',
        amount: 75,
        feeAmount: expect.anything(),
        netAmount: 75,
        fromWalletId: 'wallet-liq',
        fromAddress: '0xliq',
        fromIban: null,
        toWalletId: 'wallet-master',
        toAddress: '0xmaster',
        toIban: null,
        referenceNo: 'PSB-001',
      }),
      'SYSTEM',
      prisma,
    );
    expect(internalFundsService.createFromInternalTransaction).toHaveBeenNthCalledWith(
      1,
      {
        internalTransactionId: 'itx-1',
        status: InternalFundStatus.CREATED,
        referenceNo: 'PSB-001',
      },
      'SYSTEM',
      prisma,
    );
    expect(internalFundsService.createFromInternalTransaction).toHaveBeenNthCalledWith(
      2,
      {
        internalTransactionId: 'itx-2',
        status: InternalFundStatus.CREATED,
        referenceNo: 'PSB-001',
      },
      'SYSTEM',
      prisma,
    );
    expect(prisma.poolSettlementBatchItem.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'item-1' },
      data: {
        status: 'EXECUTING',
        failedReason: null,
      },
    });
    expect(prisma.poolSettlementBatchItem.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'item-2' },
      data: {
        status: 'EXECUTING',
        failedReason: null,
      },
    });
    expect(prisma.internalTransaction.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'itx-1' },
      data: {
        poolSettlementBatchItemId: 'item-1',
      },
    });
    expect(prisma.internalTransaction.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'itx-2' },
      data: {
        poolSettlementBatchItemId: 'item-2',
      },
    });
    expect(prisma.poolSettlementBatch.update).toHaveBeenLastCalledWith({
      where: { id: 'batch-1' },
      data: {
        status: PoolSettlementBatchStatus.EXECUTING,
      },
    });
  });

  it('keeps approval projection moving forward when dispatch fails and marks the batch FAILED instead of rolling back to APPROVAL_PENDING', async () => {
    const prisma = makePrisma();
    prisma.poolSettlementBatch.findUnique.mockResolvedValue({
      id: 'batch-dispatch-fail-1',
      batchNo: 'PSB-DISPATCH-FAIL-001',
      approvalCaseId: 'approval-dispatch-fail-1',
      status: PoolSettlementBatchStatus.APPROVAL_PENDING,
    });
    prisma.poolSettlementBatchItem.findMany.mockResolvedValue([
      {
        id: 'item-dispatch-fail-1',
        batchId: 'batch-dispatch-fail-1',
        status: 'READY',
        assetId: 'asset-fiat',
        netAmount: 50,
        netDirection: 'B_TO_A',
        walletAId: 'wallet-cust-bank',
        walletBId: 'wallet-liq-bank',
        asset: { id: 'asset-fiat', type: 'FIAT' },
        walletA: {
          id: 'wallet-cust-bank',
          walletRole: 'C_CMA',
          address: null,
          iban: 'AE11',
        },
        walletB: {
          id: 'wallet-liq-bank',
          walletRole: 'F_LIQ',
          address: null,
          iban: 'AE22',
        },
        internalTransaction: null,
      },
    ]);
    prisma.poolSettlementBatchItemSource.findMany.mockResolvedValue([
      {
        id: 'source-link-1',
        batchItemId: 'item-dispatch-fail-1',
        sourceFamily: 'REIMBURSEMENT_OBLIGATION',
        sourceId: 'obligation-1',
      },
    ]);
    prisma.poolSettlementBatchItem.updateMany = jest
      .fn()
      .mockResolvedValue({ count: 1 });
    prisma.poolSettlementBatch.updateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    prisma.poolSettlementBatch.update.mockResolvedValue({
      id: 'batch-dispatch-fail-1',
      status: PoolSettlementBatchStatus.FAILED,
    });
    const { moduleRef, internalTransactionsService, internalFundsService } =
      makeModuleRef();
    internalTransactionsService.createStandaloneTransaction.mockRejectedValue(
      new BadRequestException(
        'Insufficient available balance for wallet wallet-liq-bank',
      ),
    );

    const service = new PoolSettlementBatchApprovalProjectionService(
      prisma,
      moduleRef as any,
    );

    await expect(
      service.handleApproved({
        actionType: ApprovalActionTypes.POOL_SETTLEMENT_BATCH_APPROVAL,
        entityRef: 'batch-dispatch-fail-1',
        approvalId: 'approval-dispatch-fail-1',
        approvalNo: 'APR-DISPATCH-FAIL-001',
        status: 'APPROVED',
        decidedAt,
      } as any),
    ).resolves.toBeUndefined();

    expect(prisma.poolSettlementBatch.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: 'batch-dispatch-fail-1',
        status: PoolSettlementBatchStatus.APPROVAL_PENDING,
        OR: [
          { approvalCaseId: null },
          { approvalCaseId: 'approval-dispatch-fail-1' },
        ],
      },
      data: {
        status: PoolSettlementBatchStatus.APPROVED,
        approvedAt: new Date(decidedAt),
      },
    });
    expect(prisma.poolSettlementBatchItem.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'item-dispatch-fail-1',
        status: 'READY',
      },
      data: {
        status: 'FAILED',
        failedReason: 'Insufficient available balance for wallet wallet-liq-bank',
      },
    });
    expect(prisma.reimbursementObligation.updateMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: ['obligation-1'],
        },
        lockedByPoolSettlementBatchId: 'batch-dispatch-fail-1',
      },
      data: {
        status: 'OPEN',
        lockedByPoolSettlementBatchId: null,
        settlementInternalTransactionId: null,
        reimbursedAt: null,
      },
    });
    expect(prisma.poolSettlementBatchItemSource.updateMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: ['source-link-1'],
        },
        status: 'LINKED',
      },
      data: {
        status: 'RELEASED',
        closeReason: 'BATCH_RELEASED',
      },
    });
    expect(prisma.poolSettlementBatch.update).toHaveBeenLastCalledWith({
      where: { id: 'batch-dispatch-fail-1' },
      data: {
        status: PoolSettlementBatchStatus.FAILED,
        closedAt: expect.any(Date),
      },
    });
    expect(internalFundsService.createFromInternalTransaction).not.toHaveBeenCalled();
  });

  it('does not dispatch when transactional APPROVED transition loses the race', async () => {
    const prisma = makePrisma();
    prisma.poolSettlementBatch.updateMany.mockResolvedValue({ count: 0 });
    const { moduleRef, internalTransactionsService, internalFundsService } =
      makeModuleRef();

    const service = new PoolSettlementBatchApprovalProjectionService(
      prisma,
      moduleRef as any,
    );

    await service.handleApproved({
      actionType: ApprovalActionTypes.POOL_SETTLEMENT_BATCH_APPROVAL,
      entityRef: 'batch-race-1',
      approvalId: 'approval-race-1',
      approvalNo: 'APR-RACE-001',
      status: 'APPROVED',
      decidedAt,
    } as any);

    expect(prisma.poolSettlementBatch.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'batch-race-1',
        status: PoolSettlementBatchStatus.APPROVAL_PENDING,
        OR: [
          { approvalCaseId: null },
          { approvalCaseId: 'approval-race-1' },
        ],
      },
      data: {
        status: PoolSettlementBatchStatus.APPROVED,
        approvedAt: new Date(decidedAt),
      },
    });
    expect(prisma.poolSettlementBatch.findUnique).not.toHaveBeenCalled();
    expect(prisma.poolSettlementBatchItem.findMany).not.toHaveBeenCalled();
    expect(internalTransactionsService.createStandaloneTransaction).not.toHaveBeenCalled();
    expect(internalFundsService.createFromInternalTransaction).not.toHaveBeenCalled();
  });

  it('marks invalid netDirection item as FAILED instead of rolling batch approval back', async () => {
    const prisma = makePrisma();
    prisma.poolSettlementBatch.findUnique.mockResolvedValue({
      id: 'batch-invalid-direction-1',
      batchNo: 'PSB-INVALID-001',
      approvalCaseId: 'approval-invalid-direction-1',
    });
    prisma.poolSettlementBatchItem.findMany.mockResolvedValue([
      {
        id: 'item-invalid-direction-1',
        batchId: 'batch-invalid-direction-1',
        status: 'READY',
        assetId: 'asset-fiat',
        netAmount: 100,
        netDirection: 'SIDEWAYS',
        walletAId: 'wallet-cust-bank',
        walletBId: 'wallet-liq-bank',
        asset: { id: 'asset-fiat', type: 'FIAT' },
        walletA: {
          id: 'wallet-cust-bank',
          walletRole: 'C_CMA',
          address: null,
          iban: 'AE11',
        },
        walletB: {
          id: 'wallet-liq-bank',
          walletRole: 'F_LIQ',
          address: null,
          iban: 'AE22',
        },
        internalTransaction: null,
      },
    ]);
    prisma.poolSettlementBatchItemSource.findMany.mockResolvedValue([
      {
        id: 'source-invalid-direction-1',
        batchItemId: 'item-invalid-direction-1',
        sourceFamily: 'OUTSTANDING',
        sourceId: 'outstanding-invalid-direction-1',
      },
    ]);
    const { moduleRef, internalTransactionsService, internalFundsService } =
      makeModuleRef();

    const service = new PoolSettlementBatchApprovalProjectionService(
      prisma,
      moduleRef as any,
    );

    await expect(
      service.handleApproved({
        actionType: ApprovalActionTypes.POOL_SETTLEMENT_BATCH_APPROVAL,
        entityRef: 'batch-invalid-direction-1',
        approvalId: 'approval-invalid-direction-1',
        approvalNo: 'APR-INVALID-DIRECTION-001',
        status: 'APPROVED',
        decidedAt,
      } as any),
    ).resolves.toBeUndefined();

    expect(internalTransactionsService.createStandaloneTransaction).not.toHaveBeenCalled();
    expect(internalFundsService.createFromInternalTransaction).not.toHaveBeenCalled();
    expect(prisma.poolSettlementBatchItem.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'item-invalid-direction-1',
        status: 'READY',
      },
      data: {
        status: 'FAILED',
        failedReason: 'Unsupported pool settlement netDirection: SIDEWAYS',
      },
    });
    expect(prisma.poolSettlementBatch.update).toHaveBeenLastCalledWith({
      where: { id: 'batch-invalid-direction-1' },
      data: {
        status: PoolSettlementBatchStatus.FAILED,
        closedAt: expect.any(Date),
      },
    });
  });

  it('releases held sources and marks batch FAILED on approval rejected', async () => {
    const prisma = makePrisma();
    prisma.poolSettlementBatch.findUnique.mockResolvedValue({
      id: 'batch-1',
      approvalCaseId: 'approval-1',
      status: PoolSettlementBatchStatus.APPROVAL_PENDING,
    });
    const { moduleRef } = makeModuleRef();

    const service = new PoolSettlementBatchApprovalProjectionService(
      prisma,
      moduleRef as any,
    );

    await service.handleRejected({
      actionType: ApprovalActionTypes.POOL_SETTLEMENT_BATCH_APPROVAL,
      entityRef: 'batch-1',
      approvalId: 'approval-1',
      approvalNo: 'APR-001',
      status: 'REJECTED',
    } as any);

    expect(prisma.poolSettlementBatch.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'batch-1',
        status: PoolSettlementBatchStatus.APPROVAL_PENDING,
        OR: [
          { approvalCaseId: null },
          { approvalCaseId: 'approval-1' },
        ],
      },
      data: {
        status: PoolSettlementBatchStatus.FAILED,
      },
    });
    expect(prisma.outstanding.updateMany).toHaveBeenCalledWith({
      where: {
        status: 'OPEN',
        lockedByPoolSettlementBatchId: 'batch-1',
      },
      data: {
        lockedByPoolSettlementBatchId: null,
      },
    });
    expect(prisma.reimbursementObligation.updateMany).toHaveBeenCalledWith({
      where: {
        status: 'OPEN',
        lockedByPoolSettlementBatchId: 'batch-1',
      },
      data: {
        lockedByPoolSettlementBatchId: null,
      },
    });
    expect(prisma.poolSettlementBatchItemSource.updateMany).toHaveBeenCalledWith({
      where: {
        batchId: 'batch-1',
        status: {
          in: ['LINKED', 'NETTED'],
        },
      },
      data: {
        status: 'RELEASED',
        closeReason: 'BATCH_RELEASED',
      },
    });
    expect(prisma.poolSettlementBatch.update).not.toHaveBeenCalled();
  });

  it('releases held sources and marks batch CANCELLED on approval cancelled', async () => {
    const prisma = makePrisma();
    prisma.poolSettlementBatch.findUnique.mockResolvedValue({
      id: 'batch-2',
      approvalCaseId: 'approval-2',
      status: PoolSettlementBatchStatus.APPROVAL_PENDING,
    });
    const { moduleRef } = makeModuleRef();

    const service = new PoolSettlementBatchApprovalProjectionService(
      prisma,
      moduleRef as any,
    );

    await service.handleCancelled({
      actionType: ApprovalActionTypes.POOL_SETTLEMENT_BATCH_APPROVAL,
      entityRef: 'batch-2',
      approvalId: 'approval-2',
      approvalNo: 'APR-002',
      status: 'CANCELLED',
    } as any);

    expect(prisma.poolSettlementBatch.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'batch-2',
        status: PoolSettlementBatchStatus.APPROVAL_PENDING,
        OR: [
          { approvalCaseId: null },
          { approvalCaseId: 'approval-2' },
        ],
      },
      data: {
        status: PoolSettlementBatchStatus.CANCELLED,
      },
    });
    expect(prisma.poolSettlementBatchItemSource.updateMany).toHaveBeenCalledWith({
      where: {
        batchId: 'batch-2',
        status: {
          in: ['LINKED', 'NETTED'],
        },
      },
      data: {
        status: 'RELEASED',
        closeReason: 'BATCH_RELEASED',
      },
    });
  });

  it('releases held sources and marks batch FAILED on approval expired', async () => {
    const prisma = makePrisma();
    prisma.poolSettlementBatch.findUnique.mockResolvedValue({
      id: 'batch-3',
      approvalCaseId: 'approval-3',
      status: PoolSettlementBatchStatus.APPROVAL_PENDING,
    });
    const { moduleRef } = makeModuleRef();

    const service = new PoolSettlementBatchApprovalProjectionService(
      prisma,
      moduleRef as any,
    );

    await service.handleExpired({
      actionType: ApprovalActionTypes.POOL_SETTLEMENT_BATCH_APPROVAL,
      entityRef: 'batch-3',
      approvalId: 'approval-3',
      approvalNo: 'APR-003',
      status: 'EXPIRED',
    } as any);

    expect(prisma.poolSettlementBatch.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'batch-3',
        status: PoolSettlementBatchStatus.APPROVAL_PENDING,
        OR: [
          { approvalCaseId: null },
          { approvalCaseId: 'approval-3' },
        ],
      },
      data: {
        status: PoolSettlementBatchStatus.FAILED,
      },
    });
    expect(prisma.outstanding.updateMany).toHaveBeenCalled();
    expect(prisma.reimbursementObligation.updateMany).toHaveBeenCalled();
  });

  it.each([
    ['handleRejected', 'REJECTED', PoolSettlementBatchStatus.FAILED],
    ['handleCancelled', 'CANCELLED', PoolSettlementBatchStatus.CANCELLED],
    ['handleExpired', 'EXPIRED', PoolSettlementBatchStatus.FAILED],
  ] as const)(
    'does nothing for %s when transactional terminal transition loses the race',
    async (handlerName, approvalStatus, terminalStatus) => {
      const prisma = makePrisma();
      prisma.poolSettlementBatch.findUnique.mockResolvedValue({
        id: 'batch-stale-terminal-1',
        approvalCaseId: 'approval-stale-terminal-1',
        status: PoolSettlementBatchStatus.APPROVAL_PENDING,
      });
      prisma.poolSettlementBatch.updateMany.mockResolvedValue({ count: 0 });
      const { moduleRef } = makeModuleRef();

      const service = new PoolSettlementBatchApprovalProjectionService(
        prisma,
        moduleRef as any,
      );

      await (service as any)[handlerName]({
        actionType: ApprovalActionTypes.POOL_SETTLEMENT_BATCH_APPROVAL,
        entityRef: 'batch-stale-terminal-1',
        approvalId: 'approval-stale-terminal-1',
        approvalNo: 'APR-STALE-001',
        status: approvalStatus,
      });

      expect(prisma.poolSettlementBatch.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'batch-stale-terminal-1',
          status: PoolSettlementBatchStatus.APPROVAL_PENDING,
          OR: [
            { approvalCaseId: null },
            { approvalCaseId: 'approval-stale-terminal-1' },
          ],
        },
        data: {
          status: terminalStatus,
        },
      });
      expect(prisma.outstanding.updateMany).not.toHaveBeenCalled();
      expect(prisma.reimbursementObligation.updateMany).not.toHaveBeenCalled();
      expect(prisma.poolSettlementBatchItemSource.updateMany).not.toHaveBeenCalled();
      expect(prisma.poolSettlementBatch.update).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['handleRejected', 'REJECTED'],
    ['handleCancelled', 'CANCELLED'],
    ['handleExpired', 'EXPIRED'],
  ] as const)(
    'does nothing for %s when batch is no longer APPROVAL_PENDING',
    async (handlerName, approvalStatus) => {
      const prisma = makePrisma();
      prisma.poolSettlementBatch.findUnique.mockResolvedValue({
        id: 'batch-late-1',
        approvalCaseId: 'approval-late-1',
        status: PoolSettlementBatchStatus.APPROVED,
      });
      const { moduleRef } = makeModuleRef();

      const service = new PoolSettlementBatchApprovalProjectionService(
        prisma,
        moduleRef as any,
      );

      await (service as any)[handlerName]({
        actionType: ApprovalActionTypes.POOL_SETTLEMENT_BATCH_APPROVAL,
        entityRef: 'batch-late-1',
        approvalId: 'approval-late-1',
        approvalNo: 'APR-LATE-001',
        status: approvalStatus,
      });

      expect(prisma.outstanding.updateMany).not.toHaveBeenCalled();
      expect(prisma.reimbursementObligation.updateMany).not.toHaveBeenCalled();
      expect(prisma.poolSettlementBatchItemSource.updateMany).not.toHaveBeenCalled();
      expect(prisma.poolSettlementBatch.update).not.toHaveBeenCalled();
    },
  );

  it('does nothing for repeated APPROVED after batch is already APPROVED', async () => {
    const prisma = makePrisma();
    prisma.poolSettlementBatch.updateMany.mockResolvedValue({ count: 0 });

    const { moduleRef, internalTransactionsService, internalFundsService } =
      makeModuleRef();
    const service = new PoolSettlementBatchApprovalProjectionService(
      prisma,
      moduleRef as any,
    );

    await service.handleApproved({
      actionType: ApprovalActionTypes.POOL_SETTLEMENT_BATCH_APPROVAL,
      entityRef: 'batch-approved-1',
      approvalId: 'approval-approved-1',
      approvalNo: 'APR-APPROVED-001',
      status: 'APPROVED',
      decidedAt,
    } as any);

    expect(prisma.poolSettlementBatch.findUnique).not.toHaveBeenCalled();
    expect(prisma.poolSettlementBatch.update).not.toHaveBeenCalled();
    expect(internalTransactionsService.createStandaloneTransaction).not.toHaveBeenCalled();
    expect(internalFundsService.createFromInternalTransaction).not.toHaveBeenCalled();
  });
});

describe('PoolSettlementBatchesService submitBatch', () => {
  const makePrisma = () => {
    const prisma: any = {
      poolSettlementBatch: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
      },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };

    return prisma;
  };

  const makeApprovalsService = () => ({
    createAndSubmit: jest.fn(),
    emitSubmittedSideEffects: jest.fn(),
  });

  it('only allows CREATED batches to be submitted', async () => {
    const prisma = makePrisma();
    const approvalsService = makeApprovalsService();
    prisma.poolSettlementBatch.findUnique.mockResolvedValue({
      id: 'batch-1',
      batchNo: 'PSB-001',
      status: PoolSettlementBatchStatus.APPROVED,
    });
    prisma.poolSettlementBatch.findUniqueOrThrow.mockResolvedValue({
      id: 'batch-1',
      batchNo: 'PSB-001',
      status: PoolSettlementBatchStatus.APPROVED,
    });

    const service = new PoolSettlementBatchesService(
      prisma,
      approvalsService as any,
      {} as any,
      {} as any,
    );

    await expect(service.submitBatch('batch-1', 'admin-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(approvalsService.createAndSubmit).not.toHaveBeenCalled();
  });

  it('stores approvalCaseId, submittedAt, and APPROVAL_PENDING status', async () => {
    const prisma = makePrisma();
    const approvalsService = makeApprovalsService();
    prisma.poolSettlementBatch.findUnique.mockResolvedValue({
      id: 'batch-1',
      batchNo: 'PSB-001',
      status: PoolSettlementBatchStatus.CREATED,
    });
    prisma.poolSettlementBatch.findUniqueOrThrow.mockResolvedValue({
      id: 'batch-1',
      batchNo: 'PSB-001',
      status: PoolSettlementBatchStatus.CREATED,
      approvalCaseId: null,
    });
    approvalsService.createAndSubmit.mockResolvedValue({
      id: 'approval-1',
      approvalNo: 'APR-001',
      status: 'PENDING',
    });
    prisma.poolSettlementBatch.update.mockImplementation(({ data }: any) =>
      Promise.resolve({
        id: 'batch-1',
        batchNo: 'PSB-001',
        ...data,
      }),
    );

    const service = new PoolSettlementBatchesService(
      prisma,
      approvalsService as any,
      {} as any,
      {} as any,
    );

    const result = await service.submitBatch('batch-1', 'admin-1');

    expect(approvalsService.createAndSubmit).toHaveBeenCalledTimes(1);
    expect(prisma.poolSettlementBatch.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'batch-1',
        status: PoolSettlementBatchStatus.CREATED,
        approvalCaseId: null,
      },
      data: expect.objectContaining({
        status: PoolSettlementBatchStatus.APPROVAL_PENDING,
        submittedAt: expect.any(Date),
      }),
    });
    expect(approvalsService.createAndSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: ApprovalActionTypes.POOL_SETTLEMENT_BATCH_APPROVAL,
        entityRef: 'batch-1',
        workflowType: 'POOL_SETTLEMENT_BATCH',
        workflowId: 'batch-1',
        workflowNo: 'PSB-001',
      }),
      expect.objectContaining({
        workflowType: 'POOL_SETTLEMENT_BATCH',
        workflowId: 'batch-1',
        workflowNo: 'PSB-001',
      }),
      expect.objectContaining({
        actorType: 'ADMIN',
        userId: 'admin-1',
      }),
      prisma,
      expect.anything(),
    );
    expect(prisma.poolSettlementBatch.update).toHaveBeenCalledWith({
      where: { id: 'batch-1' },
      data: {
        approvalCaseId: 'approval-1',
      },
    });
    expect(result).toEqual(
      expect.objectContaining({
        id: 'batch-1',
        batchNo: 'PSB-001',
        approvalCaseId: 'approval-1',
      }),
    );
  });

  it('serializes duplicate submits under a batch lock and prevents a second approval case', async () => {
    const lifecycle: string[] = [];
    const batchState = {
      id: 'batch-serial-1',
      batchNo: 'PSB-SERIAL-001',
      status: PoolSettlementBatchStatus.CREATED,
      approvalCaseId: null as string | null,
      submittedAt: null as Date | null,
    };

    const prisma = makePrisma();
    const approvalsService = makeApprovalsService();
    prisma.poolSettlementBatch.findUniqueOrThrow.mockImplementation(() => {
      lifecycle.push(`read:${batchState.status}`);
      return Promise.resolve({ ...batchState });
    });
    prisma.poolSettlementBatch.updateMany.mockImplementation(({ where, data }: any) => {
      lifecycle.push(`claim:${batchState.status}`);
      if (
        where.id === batchState.id &&
        where.status === PoolSettlementBatchStatus.CREATED &&
        where.approvalCaseId === null &&
        batchState.status === PoolSettlementBatchStatus.CREATED &&
        batchState.approvalCaseId === null
      ) {
        Object.assign(batchState, data);
        return Promise.resolve({ count: 1 });
      }

      return Promise.resolve({ count: 0 });
    });
    approvalsService.createAndSubmit.mockImplementation(() => {
      lifecycle.push('createApproval');
      return Promise.resolve({
        id: 'approval-serial-1',
        approvalNo: 'APR-SERIAL-001',
        status: 'PENDING',
      });
    });
    prisma.poolSettlementBatch.update.mockImplementation(({ data }: any) => {
      lifecycle.push('updateBatch');
      Object.assign(batchState, data);
      return Promise.resolve({
        ...batchState,
      });
    });

    const service = new PoolSettlementBatchesService(
      prisma,
      approvalsService as any,
      {} as any,
      {} as any,
    );

    await service.submitBatch('batch-serial-1', 'admin-1');
    await expect(
      service.submitBatch('batch-serial-1', 'admin-2'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(approvalsService.createAndSubmit).toHaveBeenCalledTimes(1);
    expect(lifecycle).toEqual([
      'read:CREATED',
      'claim:CREATED',
      'createApproval',
      'updateBatch',
      'read:APPROVAL_PENDING',
    ]);
  });
});
