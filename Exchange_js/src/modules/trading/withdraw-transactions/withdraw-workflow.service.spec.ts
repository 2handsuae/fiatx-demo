import { Prisma } from '@prisma/client';
import { WithdrawWorkflowService } from './withdraw-workflow.service';
import { WithdrawTransactionStatus } from './dto/withdraw-transaction.dto';
import { AuditActions } from '../../audit-logging/constants/audit-actions.constant';
import { InternalFundStatus } from '../../funds-layer/dto/internal-fund.dto';

describe('WithdrawWorkflowService — releaseLock on approval decline', () => {
  let workflow: WithdrawWorkflowService;
  let withdrawService: any;
  let auditLogsService: any;
  let accountingService: any;
  let fundsFlowService: any;

  const declinedWithdrawal = {
    id: 'wd-decline-1',
    withdrawNo: 'WD9001',
    status: WithdrawTransactionStatus.PENDING_APPROVAL,
    ownerType: 'CUSTOMER',
    ownerId: 'user-1',
    traceId: 'trace-1',
    netAmount: new Prisma.Decimal(90),
    feeAmount: new Prisma.Decimal(10),
    tbPendingNetId: '1',
    tbPendingFeeId: '2',
    asset: { decimals: 8 },
  };

  beforeEach(() => {
    withdrawService = {
      findOneInternal: jest.fn().mockResolvedValue(declinedWithdrawal),
      updateStatus: jest.fn().mockResolvedValue(undefined),
    };
    auditLogsService = {
      recordSystem: jest.fn().mockResolvedValue({}),
    };
    accountingService = {
      voidPendingTransferBestEffort: jest.fn().mockResolvedValue(true),
    };
    fundsFlowService = {
      setWithdrawFeeFundStatus: jest.fn().mockResolvedValue(undefined),
    };

    workflow = new WithdrawWorkflowService(
      {} as any, // prisma
      {} as any, // eventEmitter
      withdrawService as any,
      {} as any, // withdrawQuoteService
      auditLogsService as any,
      accountingService as any,
      {} as any, // payoutsService
      {} as any, // approvalsService
      {} as any, // binanceRateProvider
      fundsFlowService as any,
      {} as any, // systemWalletResolver
      {} as any, // tbEvidenceService
    );
  });

  it('releases both pending locks, cancels the fee fund, and audits WITHDRAW_LOCK_RELEASED on decline', async () => {
    await workflow.onLargeValueApprovalDecided({
      decision: 'DECLINED',
      entityRef: declinedWithdrawal.id,
      approvalNo: 'AP-1',
      decisionReason: 'risk',
    });

    // Voids both pending transfers (net + fee).
    expect(accountingService.voidPendingTransferBestEffort).toHaveBeenCalledTimes(2);

    // Cancels the fee InternalFund.
    expect(fundsFlowService.setWithdrawFeeFundStatus).toHaveBeenCalledWith(
      declinedWithdrawal.id,
      InternalFundStatus.CANCELLED,
      expect.any(String),
    );

    // Writes the lock-released audit.
    expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditActions.WITHDRAW_LOCK_RELEASED }),
    );
  });
});
