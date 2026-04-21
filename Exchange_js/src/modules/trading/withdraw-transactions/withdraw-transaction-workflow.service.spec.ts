import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { WithdrawTransactionStatus } from './dto/withdraw-transaction.dto';
import { WithdrawTransactionWorkflowService } from './withdraw-transaction-workflow.service';

describe('WithdrawTransactionWorkflowService', () => {
  const prismaMock: any = {
    withdrawTransaction: {
      findUnique: jest.fn(),
    },
  };
  const withdrawTransactionsServiceMock = {
    updateStatus: jest.fn(),
  };

  let service: WithdrawTransactionWorkflowService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(AuditLogsService.prototype, 'recordSystem').mockResolvedValue({} as any);
    jest.spyOn(AuditLogsService.prototype, 'recordByActor').mockResolvedValue({} as any);
    prismaMock.withdrawTransaction.findUnique.mockResolvedValue({
      id: 'wd-1',
      withdrawNo: 'WD0001',
      status: WithdrawTransactionStatus.PENDING_COMPLIANCE,
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      payoutId: null,
      payoutNo: null,
      statusHistory: '[]',
    });
    withdrawTransactionsServiceMock.updateStatus.mockResolvedValue({
      id: 'wd-1',
      withdrawNo: 'WD0001',
      status: WithdrawTransactionStatus.PAYOUT_PENDING,
    });
    service = new WithdrawTransactionWorkflowService(
      prismaMock as any,
      withdrawTransactionsServiceMock as any,
    );
  });

  it('should keep withdraw clear path on final review only', async () => {
    const result = await service.execute(undefined, {
      withdrawId: 'wd-1',
      source: 'ALERT',
      sourceId: 'alert-1',
      workflowAction: 'CLEAR',
    });

    expect(withdrawTransactionsServiceMock.updateStatus).toHaveBeenCalledWith(
      'wd-1',
      expect.objectContaining({
        action: 'approve',
      }),
      expect.objectContaining({
        source: 'WORKFLOW',
      }),
      undefined,
    );
    expect(result.transitionCode).toBe('TX_WITHDRAW_CLEAR_TO_PAYOUT_PENDING');
    expect(result.withdrawStatusAfter).toBe(WithdrawTransactionStatus.PAYOUT_PENDING);
  });

  it('should reject legacy precheck workflow stage execution', async () => {
    await expect(
      service.execute(undefined, {
        withdrawId: 'wd-1',
        source: 'ALERT',
        sourceId: 'alert-legacy-1',
        workflowAction: 'CLEAR',
        triggerStage: 'REVIEW_WITHDRAW_PRECHECK',
      }),
    ).rejects.toThrow('legacy review stage is read-only');

    expect(withdrawTransactionsServiceMock.updateStatus).not.toHaveBeenCalled();
  });
});
