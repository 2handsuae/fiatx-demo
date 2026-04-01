import { BadRequestException } from '@nestjs/common';
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
        update: jest.fn(),
      },
      outstanding: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      reimbursementObligation: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      poolSettlementBatchItemSource: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };

    return prisma;
  };

  it('marks batch APPROVED and stamps approvedAt', async () => {
    const prisma = makePrisma();
    prisma.poolSettlementBatch.findUnique.mockResolvedValue({
      id: 'batch-1',
      approvalCaseId: 'approval-1',
      status: PoolSettlementBatchStatus.APPROVAL_PENDING,
    });
    prisma.poolSettlementBatch.update.mockResolvedValue({
      id: 'batch-1',
      status: PoolSettlementBatchStatus.APPROVED,
      approvedAt: new Date(decidedAt),
    });

    const service = new PoolSettlementBatchApprovalProjectionService(prisma);

    await service.handleApproved({
      actionType: ApprovalActionTypes.POOL_SETTLEMENT_BATCH_APPROVAL,
      entityRef: 'batch-1',
      approvalId: 'approval-1',
      approvalNo: 'APR-001',
      status: 'APPROVED',
      decidedAt,
    } as any);

    expect(prisma.poolSettlementBatch.update).toHaveBeenCalledWith({
      where: { id: 'batch-1' },
      data: {
        status: PoolSettlementBatchStatus.APPROVED,
        approvedAt: new Date(decidedAt),
      },
    });
    expect(prisma.outstanding.updateMany).not.toHaveBeenCalled();
    expect(prisma.reimbursementObligation.updateMany).not.toHaveBeenCalled();
    expect(prisma.poolSettlementBatchItemSource.updateMany).not.toHaveBeenCalled();
  });

  it('releases held sources and marks batch FAILED on approval rejected', async () => {
    const prisma = makePrisma();
    prisma.poolSettlementBatch.findUnique.mockResolvedValue({
      id: 'batch-1',
      approvalCaseId: 'approval-1',
      status: PoolSettlementBatchStatus.APPROVAL_PENDING,
    });

    const service = new PoolSettlementBatchApprovalProjectionService(prisma);

    await service.handleRejected({
      actionType: ApprovalActionTypes.POOL_SETTLEMENT_BATCH_APPROVAL,
      entityRef: 'batch-1',
      approvalId: 'approval-1',
      approvalNo: 'APR-001',
      status: 'REJECTED',
    } as any);

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
      where: { batchId: 'batch-1' },
      data: {
        status: 'RELEASED',
        closeReason: 'BATCH_RELEASED',
      },
    });
    expect(prisma.poolSettlementBatch.update).toHaveBeenCalledWith({
      where: { id: 'batch-1' },
      data: {
        status: PoolSettlementBatchStatus.FAILED,
      },
    });
  });

  it('releases held sources and marks batch CANCELLED on approval cancelled', async () => {
    const prisma = makePrisma();
    prisma.poolSettlementBatch.findUnique.mockResolvedValue({
      id: 'batch-2',
      approvalCaseId: 'approval-2',
      status: PoolSettlementBatchStatus.APPROVAL_PENDING,
    });

    const service = new PoolSettlementBatchApprovalProjectionService(prisma);

    await service.handleCancelled({
      actionType: ApprovalActionTypes.POOL_SETTLEMENT_BATCH_APPROVAL,
      entityRef: 'batch-2',
      approvalId: 'approval-2',
      approvalNo: 'APR-002',
      status: 'CANCELLED',
    } as any);

    expect(prisma.poolSettlementBatch.update).toHaveBeenCalledWith({
      where: { id: 'batch-2' },
      data: {
        status: PoolSettlementBatchStatus.CANCELLED,
      },
    });
    expect(prisma.poolSettlementBatchItemSource.updateMany).toHaveBeenCalledWith({
      where: { batchId: 'batch-2' },
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

    const service = new PoolSettlementBatchApprovalProjectionService(prisma);

    await service.handleExpired({
      actionType: ApprovalActionTypes.POOL_SETTLEMENT_BATCH_APPROVAL,
      entityRef: 'batch-3',
      approvalId: 'approval-3',
      approvalNo: 'APR-003',
      status: 'EXPIRED',
    } as any);

    expect(prisma.poolSettlementBatch.update).toHaveBeenCalledWith({
      where: { id: 'batch-3' },
      data: {
        status: PoolSettlementBatchStatus.FAILED,
      },
    });
    expect(prisma.outstanding.updateMany).toHaveBeenCalled();
    expect(prisma.reimbursementObligation.updateMany).toHaveBeenCalled();
  });
});

describe('PoolSettlementBatchesService submitBatch', () => {
  const makePrisma = () => {
    const prisma: any = {
      poolSettlementBatch: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
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
    );

    const result = await service.submitBatch('batch-1', 'admin-1');

    expect(approvalsService.createAndSubmit).toHaveBeenCalledTimes(1);
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
      data: expect.objectContaining({
        status: PoolSettlementBatchStatus.APPROVAL_PENDING,
        approvalCaseId: 'approval-1',
        submittedAt: expect.any(Date),
      }),
    });
    expect(result).toEqual(
      expect.objectContaining({
        id: 'batch-1',
        batchNo: 'PSB-001',
        status: PoolSettlementBatchStatus.APPROVAL_PENDING,
        approvalCaseId: 'approval-1',
        submittedAt: expect.any(Date),
      }),
    );
  });
});
