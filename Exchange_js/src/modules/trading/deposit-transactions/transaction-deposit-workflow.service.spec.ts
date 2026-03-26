import { BadRequestException } from '@nestjs/common';
import { AuditLogsService } from '../../risk-engine/audit-logs/audit-logs.service';
import { DepositTransactionAction } from './dto/deposit-transaction.dto';
import { DepositTransactionsService } from './deposit-transactions.service';
import { TransactionDepositWorkflowService } from './transaction-deposit-workflow.service';

describe('TransactionDepositWorkflowService', () => {
  const prismaMock: any = {
    depositTransaction: {
      findUnique: jest.fn(),
    },
  };

  const depositTransactionsServiceMock: any = {
    updateStatus: jest.fn(),
  };

  let service: TransactionDepositWorkflowService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(AuditLogsService.prototype, 'recordByActor').mockResolvedValue({} as any);
    jest.spyOn(AuditLogsService.prototype, 'recordSystem').mockResolvedValue({} as any);
    service = new TransactionDepositWorkflowService(
      prismaMock as any,
      depositTransactionsServiceMock as unknown as DepositTransactionsService,
    );
  });

  it('should flag deposit into UNDER_REVIEW from COMPLIANCE_PENDING', async () => {
    prismaMock.depositTransaction.findUnique.mockResolvedValue({
      id: 'dep-1',
      depositNo: 'DEP0001',
      status: 'COMPLIANCE_PENDING',
      ownerType: 'CUSTOMER',
      ownerId: 'customer-1',
    });
    depositTransactionsServiceMock.updateStatus.mockResolvedValue({
      id: 'dep-1',
      status: 'UNDER_REVIEW',
    });

    const result = await service.execute(undefined, {
      depositId: 'dep-1',
      source: 'ALERT',
      sourceId: 'alert-1',
      workflowAction: 'FLAG',
      reasonCode: 'TX_KYT_REVIEW_REQUIRED',
    });

    expect(depositTransactionsServiceMock.updateStatus).toHaveBeenCalledWith(
      'dep-1',
      expect.objectContaining({
        action: DepositTransactionAction.FLAG,
      }),
      expect.objectContaining({
        metadata: expect.objectContaining({
          triggerSource: 'ALERT',
          triggerSourceId: 'alert-1',
        }),
      }),
    );
    expect(result.applied).toBe(true);
    expect(result.depositStatusAfter).toBe('UNDER_REVIEW');
    expect(result.transitionCode).toBe('TX_DEPOSIT_FLAG_TO_UNDER_REVIEW');
  });

  it('should release deposit to SUCCESS when clear is approved', async () => {
    prismaMock.depositTransaction.findUnique.mockResolvedValue({
      id: 'dep-1',
      depositNo: 'DEP0001',
      status: 'UNDER_REVIEW',
      ownerType: 'CUSTOMER',
      ownerId: 'customer-1',
    });
    depositTransactionsServiceMock.updateStatus.mockResolvedValue({
      id: 'dep-1',
      status: 'SUCCESS',
    });

    const result = await service.execute(undefined, {
      depositId: 'dep-1',
      source: 'CASE',
      sourceId: 'case-1',
      workflowAction: 'CLEAR',
      reasonCode: 'CLEAR',
      actor: {
        actorType: 'ADMIN',
        actorId: 'mlro-1',
        actorRole: 'MLRO',
        sourcePlatform: 'ADMIN_API',
      },
      caseId: 'case-1',
    });

    expect(depositTransactionsServiceMock.updateStatus).toHaveBeenCalledWith(
      'dep-1',
      expect.objectContaining({
        action: DepositTransactionAction.SUCCESS,
      }),
      expect.objectContaining({
        actor: expect.objectContaining({
          actorId: 'mlro-1',
          actorRole: 'MLRO',
        }),
      }),
    );
    expect(result.applied).toBe(true);
    expect(result.blocked).toBe(false);
    expect(result.transitionCode).toBe('TX_DEPOSIT_CLEAR_TO_SUCCESS');
  });

  it('should return blocked result when release gate rejects clear', async () => {
    prismaMock.depositTransaction.findUnique.mockResolvedValue({
      id: 'dep-1',
      depositNo: 'DEP0001',
      status: 'UNDER_REVIEW',
      ownerType: 'CUSTOMER',
      ownerId: 'customer-1',
    });
    depositTransactionsServiceMock.updateStatus.mockRejectedValue(
      new BadRequestException({
        code: 'DEPOSIT_RELEASE_BLOCKED',
        blockedReason: 'restrictionStatus=RESTRICTED (expected CLEAR)',
      }),
    );

    const result = await service.execute(undefined, {
      depositId: 'dep-1',
      source: 'CASE',
      sourceId: 'case-1',
      workflowAction: 'CLEAR',
      reasonCode: 'CLEAR',
    });

    expect(result.applied).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.blockedReason).toContain('restrictionStatus=RESTRICTED');
    expect(result.transitionCode).toBe('TX_DEPOSIT_RELEASE_BLOCKED');
  });

  it('should reject deposit from UNDER_REVIEW to REJECTED', async () => {
    prismaMock.depositTransaction.findUnique.mockResolvedValue({
      id: 'dep-1',
      depositNo: 'DEP0001',
      status: 'UNDER_REVIEW',
      ownerType: 'CUSTOMER',
      ownerId: 'customer-1',
    });
    depositTransactionsServiceMock.updateStatus.mockResolvedValue({
      id: 'dep-1',
      status: 'REJECTED',
    });

    const result = await service.execute(undefined, {
      depositId: 'dep-1',
      source: 'CASE',
      sourceId: 'case-1',
      workflowAction: 'REJECT',
      reasonCode: 'RISK_CONFIRMED',
    });

    expect(result.applied).toBe(true);
    expect(result.transitionCode).toBe('TX_DEPOSIT_REJECT_TO_REJECTED');
    expect(result.depositStatusAfter).toBe('REJECTED');
  });

  it('should skip terminal deposits idempotently', async () => {
    prismaMock.depositTransaction.findUnique.mockResolvedValue({
      id: 'dep-1',
      depositNo: 'DEP0001',
      status: 'SUCCESS',
      ownerType: 'CUSTOMER',
      ownerId: 'customer-1',
    });

    const result = await service.execute(undefined, {
      depositId: 'dep-1',
      source: 'ALERT',
      sourceId: 'alert-1',
      workflowAction: 'FLAG',
    });

    expect(depositTransactionsServiceMock.updateStatus).not.toHaveBeenCalled();
    expect(result.applied).toBe(false);
    expect(result.transitionCode).toBe('NO_TRANSITION');
  });
});
