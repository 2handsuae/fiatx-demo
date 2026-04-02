import { InternalFundStatus } from '../../asset-treasury/internal-funds/dto/internal-fund.dto';
import { PoolSettlementBatchStatus } from './dto/pool-settlement-batch.dto';
import { PoolSettlementBatchCloseoutService } from './pool-settlement-batch-closeout.service';

describe('PoolSettlementBatchCloseoutService', () => {
  const makePrisma = () => {
    const prisma: any = {
      internalTransaction: {
        findUnique: jest.fn(),
      },
      poolSettlementBatchItem: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      poolSettlementBatch: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'batch-1', status: PoolSettlementBatchStatus.EXECUTING }),
        update: jest.fn(),
      },
      poolSettlementBatchItemSource: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      outstanding: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      reimbursementObligation: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };

    return prisma;
  };

  const makeEvent = (newStatus: InternalFundStatus) =>
    ({
      internalFundId: 'fund-1',
      internalTransactionId: 'itx-1',
      oldStatus: InternalFundStatus.CONFIRMED,
      newStatus,
      operatorId: 'SYSTEM',
    }) as const;

  it('closes SUCCESS item and linked outstanding source on CLEAR', async () => {
    const prisma = makePrisma();
    prisma.internalTransaction.findUnique.mockResolvedValue({
      id: 'itx-1',
      poolSettlementBatchItemId: 'item-1',
    });
    prisma.poolSettlementBatchItem.findUnique.mockResolvedValue({
      id: 'item-1',
      batchId: 'batch-1',
      status: 'EXECUTING',
    });
    prisma.poolSettlementBatchItem.findMany.mockResolvedValue([
      { id: 'item-1', status: 'SUCCESS' },
      { id: 'item-2', status: 'EXECUTING' },
    ]);
    prisma.poolSettlementBatchItemSource.findMany.mockResolvedValue([
      {
        id: 'source-row-1',
        sourceFamily: 'OUTSTANDING',
        sourceId: 'outstanding-1',
      },
    ]);

    const service = new PoolSettlementBatchCloseoutService(prisma);

    await service.handleInternalFundStatusChanged(
      makeEvent(InternalFundStatus.CLEAR),
    );

    expect(prisma.poolSettlementBatchItem.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'item-1',
        status: 'EXECUTING',
      },
      data: {
        status: 'SUCCESS',
        failedReason: null,
      },
    });
    expect(prisma.poolSettlementBatchItemSource.updateMany).toHaveBeenNthCalledWith(
      1,
      {
        where: {
          id: {
            in: ['source-row-1'],
          },
          status: 'LINKED',
        },
        data: {
          status: 'SETTLED',
          closeReason: 'EXECUTED',
        },
      },
    );
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
        closedAt: expect.any(Date),
        closedByInternalFundId: 'fund-1',
      },
    });
    expect(prisma.reimbursementObligation.updateMany).not.toHaveBeenCalled();
    expect(prisma.poolSettlementBatch.update).not.toHaveBeenCalled();
    expect(prisma.poolSettlementBatch.findUnique).toHaveBeenCalledWith({
      where: { id: 'batch-1' },
      select: {
        id: true,
        status: true,
      },
    });
  });

  it('closes SUCCESS item and reimburses linked reimbursement obligation on CLEAR', async () => {
    const prisma = makePrisma();
    prisma.internalTransaction.findUnique.mockResolvedValue({
      id: 'itx-1',
      poolSettlementBatchItemId: 'item-1',
    });
    prisma.poolSettlementBatchItem.findUnique.mockResolvedValue({
      id: 'item-1',
      batchId: 'batch-1',
      status: 'EXECUTING',
    });
    prisma.poolSettlementBatchItem.findMany.mockResolvedValue([
      { id: 'item-1', status: 'SUCCESS' },
      { id: 'item-2', status: 'EXECUTING' },
    ]);
    prisma.poolSettlementBatchItemSource.findMany.mockResolvedValue([
      {
        id: 'source-row-1',
        sourceFamily: 'REIMBURSEMENT_OBLIGATION',
        sourceId: 'obligation-1',
      },
    ]);

    const service = new PoolSettlementBatchCloseoutService(prisma);

    await service.handleInternalFundStatusChanged(
      makeEvent(InternalFundStatus.CLEAR),
    );

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
        settlementInternalTransactionId: 'itx-1',
        reimbursedAt: expect.any(Date),
      },
    });
    expect(prisma.outstanding.updateMany).not.toHaveBeenCalled();
    expect(prisma.poolSettlementBatch.update).not.toHaveBeenCalled();
  });

  it.each([
    InternalFundStatus.FAILED,
    InternalFundStatus.TIMEOUT,
    InternalFundStatus.RETURNED,
    InternalFundStatus.CANCELLED,
  ])(
    'marks item FAILED on %s but does not release sources before batch is terminal',
    async (terminalStatus) => {
      const prisma = makePrisma();
      prisma.internalTransaction.findUnique.mockResolvedValue({
        id: 'itx-1',
        poolSettlementBatchItemId: 'item-1',
      });
      prisma.poolSettlementBatchItem.findUnique.mockResolvedValue({
        id: 'item-1',
        batchId: 'batch-1',
        status: 'EXECUTING',
      });
      prisma.poolSettlementBatchItem.findMany.mockResolvedValue([
        { id: 'item-1', status: 'FAILED' },
        { id: 'item-2', status: 'EXECUTING' },
      ]);

      const service = new PoolSettlementBatchCloseoutService(prisma);

      await service.handleInternalFundStatusChanged(makeEvent(terminalStatus));

      expect(prisma.poolSettlementBatchItem.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'item-1',
          status: 'EXECUTING',
        },
        data: {
          status: 'FAILED',
          failedReason: terminalStatus,
        },
      });
      expect(prisma.poolSettlementBatchItemSource.findMany).not.toHaveBeenCalled();
      expect(prisma.poolSettlementBatchItemSource.updateMany).not.toHaveBeenCalled();
      expect(prisma.outstanding.updateMany).not.toHaveBeenCalled();
      expect(prisma.reimbursementObligation.updateMany).not.toHaveBeenCalled();
      expect(prisma.poolSettlementBatch.update).not.toHaveBeenCalled();
    },
  );

  it('marks mixed terminal items as PARTIAL_FAILED and only then releases failed item sources', async () => {
    const prisma = makePrisma();
    prisma.internalTransaction.findUnique.mockResolvedValue({
      id: 'itx-2',
      poolSettlementBatchItemId: 'item-success',
    });
    prisma.poolSettlementBatchItem.findUnique.mockResolvedValue({
      id: 'item-success',
      batchId: 'batch-1',
      status: 'EXECUTING',
    });
    prisma.poolSettlementBatchItem.findMany.mockResolvedValue([
      { id: 'item-failed', status: 'FAILED' },
      { id: 'item-success', status: 'SUCCESS' },
    ]);
    prisma.poolSettlementBatchItemSource.findMany
      .mockResolvedValueOnce([
        {
          id: 'success-source-row-1',
          sourceFamily: 'OUTSTANDING',
          sourceId: 'outstanding-success-1',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'failed-source-row-1',
          batchItemId: 'item-failed',
          sourceFamily: 'OUTSTANDING',
          sourceId: 'outstanding-failed-1',
        },
        {
          id: 'failed-source-row-2',
          batchItemId: 'item-failed',
          sourceFamily: 'REIMBURSEMENT_OBLIGATION',
          sourceId: 'obligation-failed-1',
        },
      ]);

    const service = new PoolSettlementBatchCloseoutService(prisma);

    await service.handleInternalFundStatusChanged(
      makeEvent(InternalFundStatus.CLEAR),
    );

    expect(prisma.poolSettlementBatchItemSource.updateMany).toHaveBeenNthCalledWith(
      1,
      {
        where: {
          id: {
            in: ['success-source-row-1'],
          },
          status: 'LINKED',
        },
        data: {
          status: 'SETTLED',
          closeReason: 'EXECUTED',
        },
      },
    );
    expect(prisma.poolSettlementBatchItemSource.updateMany).toHaveBeenNthCalledWith(
      2,
      {
        where: {
          id: {
            in: ['failed-source-row-1', 'failed-source-row-2'],
          },
          status: 'LINKED',
        },
        data: {
          status: 'RELEASED',
          closeReason: 'BATCH_RELEASED',
        },
      },
    );
    expect(prisma.outstanding.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: {
          in: ['outstanding-success-1'],
        },
        status: 'OPEN',
        lockedByPoolSettlementBatchId: 'batch-1',
      },
      data: {
        status: 'CLOSED',
        lockedByPoolSettlementBatchId: null,
        lockedAt: null,
        closedAt: expect.any(Date),
        closedByInternalFundId: 'fund-1',
      },
    });
    expect(prisma.outstanding.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: {
          in: ['outstanding-failed-1'],
        },
        lockedByPoolSettlementBatchId: 'batch-1',
      },
      data: {
        status: 'OPEN',
        lockedByPoolSettlementBatchId: null,
        lockedAt: null,
        closedAt: null,
        closedByInternalFundId: null,
      },
    });
    expect(prisma.reimbursementObligation.updateMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: ['obligation-failed-1'],
        },
        lockedByPoolSettlementBatchId: 'batch-1',
      },
      data: {
        status: 'OPEN',
        lockedByPoolSettlementBatchId: null,
        settlementInternalTransactionId: null,
        reimbursedAt: null,
      },
    });
    expect(prisma.poolSettlementBatch.update).toHaveBeenCalledWith({
      where: { id: 'batch-1' },
      data: {
        status: PoolSettlementBatchStatus.PARTIAL_FAILED,
        closedAt: expect.any(Date),
      },
    });
  });

  it('marks batch SUCCESS when all items succeed', async () => {
    const prisma = makePrisma();
    prisma.internalTransaction.findUnique.mockResolvedValue({
      id: 'itx-1',
      poolSettlementBatchItemId: 'item-2',
    });
    prisma.poolSettlementBatchItem.findUnique.mockResolvedValue({
      id: 'item-2',
      batchId: 'batch-1',
      status: 'EXECUTING',
    });
    prisma.poolSettlementBatchItem.findMany.mockResolvedValue([
      { id: 'item-1', status: 'SUCCESS' },
      { id: 'item-2', status: 'SUCCESS' },
    ]);

    const service = new PoolSettlementBatchCloseoutService(prisma);

    await service.handleInternalFundStatusChanged(
      makeEvent(InternalFundStatus.CLEAR),
    );

    expect(prisma.poolSettlementBatch.update).toHaveBeenCalledWith({
      where: { id: 'batch-1' },
      data: {
        status: PoolSettlementBatchStatus.SUCCESS,
        closedAt: expect.any(Date),
      },
    });
    expect(prisma.poolSettlementBatchItemSource.updateMany).not.toHaveBeenCalled();
  });

  it('marks batch FAILED and releases all failed sources when all items fail', async () => {
    const prisma = makePrisma();
    prisma.internalTransaction.findUnique.mockResolvedValue({
      id: 'itx-2',
      poolSettlementBatchItemId: 'item-2',
    });
    prisma.poolSettlementBatchItem.findUnique.mockResolvedValue({
      id: 'item-2',
      batchId: 'batch-1',
      status: 'EXECUTING',
    });
    prisma.poolSettlementBatchItem.findMany.mockResolvedValue([
      { id: 'item-1', status: 'FAILED' },
      { id: 'item-2', status: 'FAILED' },
    ]);
    prisma.poolSettlementBatchItemSource.findMany.mockResolvedValue([
      {
        id: 'failed-source-row-1',
        batchItemId: 'item-1',
        sourceFamily: 'OUTSTANDING',
        sourceId: 'outstanding-1',
      },
      {
        id: 'failed-source-row-2',
        batchItemId: 'item-2',
        sourceFamily: 'REIMBURSEMENT_OBLIGATION',
        sourceId: 'obligation-1',
      },
    ]);

    const service = new PoolSettlementBatchCloseoutService(prisma);

    await service.handleInternalFundStatusChanged(
      makeEvent(InternalFundStatus.FAILED),
    );

    expect(prisma.poolSettlementBatchItemSource.updateMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: ['failed-source-row-1', 'failed-source-row-2'],
        },
        status: 'LINKED',
      },
      data: {
        status: 'RELEASED',
        closeReason: 'BATCH_RELEASED',
      },
    });
    expect(prisma.poolSettlementBatch.update).toHaveBeenCalledWith({
      where: { id: 'batch-1' },
      data: {
        status: PoolSettlementBatchStatus.FAILED,
        closedAt: expect.any(Date),
      },
    });
  });

  it('is idempotent when repeated terminal events arrive for an already terminal item', async () => {
    const prisma = makePrisma();
    prisma.internalTransaction.findUnique.mockResolvedValue({
      id: 'itx-1',
      poolSettlementBatchItemId: 'item-1',
    });
    prisma.poolSettlementBatchItem.findUnique.mockResolvedValue({
      id: 'item-1',
      batchId: 'batch-1',
      status: 'SUCCESS',
    });

    const service = new PoolSettlementBatchCloseoutService(prisma);

    await service.handleInternalFundStatusChanged(
      makeEvent(InternalFundStatus.CLEAR),
    );

    expect(prisma.poolSettlementBatchItem.updateMany).not.toHaveBeenCalled();
    expect(prisma.poolSettlementBatchItemSource.findMany).not.toHaveBeenCalled();
    expect(prisma.poolSettlementBatchItem.findMany).not.toHaveBeenCalled();
    expect(prisma.poolSettlementBatch.update).not.toHaveBeenCalled();
  });

  it('does not rewrite a batch that is already terminal when a later closeout recompute runs', async () => {
    const prisma = makePrisma();
    prisma.poolSettlementBatch.findUnique.mockResolvedValueOnce({
      id: 'batch-1',
      status: PoolSettlementBatchStatus.SUCCESS,
    });
    prisma.internalTransaction.findUnique.mockResolvedValue({
      id: 'itx-1',
      poolSettlementBatchItemId: 'item-1',
    });
    prisma.poolSettlementBatchItem.findUnique.mockResolvedValue({
      id: 'item-1',
      batchId: 'batch-1',
      status: 'EXECUTING',
    });
    prisma.poolSettlementBatchItemSource.findMany.mockResolvedValue([
      {
        id: 'source-row-1',
        sourceFamily: 'OUTSTANDING',
        sourceId: 'outstanding-1',
      },
    ]);

    const service = new PoolSettlementBatchCloseoutService(prisma);

    await service.handleInternalFundStatusChanged(
      makeEvent(InternalFundStatus.CLEAR),
    );

    expect(prisma.poolSettlementBatch.update).not.toHaveBeenCalled();
  });
});
