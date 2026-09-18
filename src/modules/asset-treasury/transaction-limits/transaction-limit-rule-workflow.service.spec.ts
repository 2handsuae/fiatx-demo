import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TransactionLimitRuleWorkflowService } from './transaction-limit-rule-workflow.service';
import { AuditOutcome } from '../../audit-logging/dto/audit-log.dto';

const CHANGE_APPLIED = 'TRANSACTION_LIMIT_CHANGE_APPLIED';
const CHANGE_APPLY_FAILED = 'TRANSACTION_LIMIT_CHANGE_APPLY_FAILED';
const CHANGE_CANCELLED = 'TRANSACTION_LIMIT_CHANGE_CANCELLED';

describe('TransactionLimitRuleWorkflowService', () => {
  let svc: TransactionLimitRuleWorkflowService;

  const prisma = {
    transactionLimitRule: { findUnique: jest.fn() },
  } as any;
  const rulesService = {
    validateShape: jest.fn(),
    findByNo: jest.fn(),
    attachApprovalCase: jest.fn(),
    clearApprovalCase: jest.fn(),
    applyAmountChange: jest.fn(),
  } as any;
  const approvalsService = {
    createAndSubmit: jest.fn(),
    getById: jest.fn(),
    list: jest.fn(),
  } as any;
  const auditLogsService = {
    recordByActor: jest.fn(),
    recordSystem: jest.fn(),
  } as any;

  const actor = {
    actorType: 'ADMIN',
    userId: 'u1',
    userNo: 'USR-1',
    role: 'OPS_OFFICER',
    roleCodes: ['OPS_OFFICER'],
  } as any;

  const singleRule = (over: Record<string, any> = {}) => ({
    id: 'r1',
    ruleNo: 'TLR-1',
    gateType: 'SINGLE',
    operationType: 'WITHDRAWAL',
    assetId: 'a1',
    tradingTier: null,
    period: null,
    minAmount: new Prisma.Decimal(10),
    maxAmount: new Prisma.Decimal(100),
    defaultLimit: null,
    threshold: null,
    ...over,
  });

  const failFindFor = (action: string) =>
    auditLogsService.recordSystem.mock.calls.find((c: any[]) => c[0].action === action);

  beforeEach(() => {
    jest.resetAllMocks();
    svc = new TransactionLimitRuleWorkflowService(
      prisma,
      rulesService,
      approvalsService,
      auditLogsService,
    );
  });

  // ── 变更流 ──

  it('APPROVED change with matching before → applyAmountChange called', async () => {
    prisma.transactionLimitRule.findUnique.mockResolvedValue(singleRule());
    approvalsService.getById.mockResolvedValue({
      objectSnapshot: {
        before: { minAmount: '10', maxAmount: '100' },
        after: { minAmount: '10', maxAmount: '200' },
      },
    });

    await svc.onChangeDecided({
      decision: 'APPROVED',
      entityRef: 'TLR-1',
      approvalId: 'ap1',
      approvalNo: 'AP-1',
    } as any);

    expect(rulesService.applyAmountChange).toHaveBeenCalledWith('TLR-1', {
      minAmount: '10',
      maxAmount: '200',
    });
    expect(failFindFor(CHANGE_APPLIED)).toBeTruthy();
  });

  // FIX-1a: the lost-update path — current amounts drifted from the approval snapshot's `before`
  it('APPROVED change where current drifted from snapshot before → apply SKIPPED + FAILURE audit', async () => {
    // snapshot before was maxAmount 100, but current rule maxAmount is now 150 (another change landed)
    prisma.transactionLimitRule.findUnique.mockResolvedValue(
      singleRule({ maxAmount: new Prisma.Decimal(150) }),
    );
    approvalsService.getById.mockResolvedValue({
      objectSnapshot: {
        before: { minAmount: '10', maxAmount: '100' },
        after: { minAmount: '10', maxAmount: '200' },
      },
    });

    await svc.onChangeDecided({
      decision: 'APPROVED',
      entityRef: 'TLR-1',
      approvalId: 'ap1',
      approvalNo: 'AP-1',
    } as any);

    expect(rulesService.applyAmountChange).not.toHaveBeenCalled();
    const failCall = failFindFor(CHANGE_APPLY_FAILED);
    expect(failCall).toBeTruthy();
    expect(failCall[0].outcome).toBe(AuditOutcome.FAILED);
    // 冲突守卫跳过的那条也清挂号——单子已裁决,规则不留死锁在"变更中"。
    expect(rulesService.clearApprovalCase).toHaveBeenCalledWith('TLR-1');
  });

  it('APPROVED change with missing after snapshot → CHANGE_APPLY_FAILED, no apply', async () => {
    prisma.transactionLimitRule.findUnique.mockResolvedValue(singleRule());
    approvalsService.getById.mockResolvedValue({
      objectSnapshot: { before: { minAmount: '10', maxAmount: '100' } },
    });

    await svc.onChangeDecided({
      decision: 'APPROVED',
      entityRef: 'TLR-1',
      approvalId: 'ap1',
    } as any);

    expect(rulesService.applyAmountChange).not.toHaveBeenCalled();
    expect(failFindFor(CHANGE_APPLY_FAILED)).toBeTruthy();
  });

  it('initiateChange rejects an alien amount field for the gate shape', async () => {
    rulesService.findByNo.mockResolvedValue(singleRule());
    approvalsService.list.mockResolvedValue({ total: 0, items: [] });

    // threshold is a LARGE_APPROVAL field, alien to a SINGLE rule
    await expect(
      svc.initiateChange('TLR-1', { threshold: 500, reason: 'x' } as any, actor),
    ).rejects.toThrow(BadRequestException);
    expect(approvalsService.createAndSubmit).not.toHaveBeenCalled();
  });

  it('initiateChange rejects when a pending change approval already exists (FIX-1b)', async () => {
    rulesService.findByNo.mockResolvedValue(singleRule({ approvalCaseNo: 'APR-OPEN' }));

    await expect(
      svc.initiateChange('TLR-1', { maxAmount: 200, reason: 'x' } as any, actor),
    ).rejects.toThrow(ConflictException);
    expect(approvalsService.createAndSubmit).not.toHaveBeenCalled();
  });

  it('initiateChange 成功后 attachApprovalCase(ruleNo, approvalNo)', async () => {
    rulesService.findByNo.mockResolvedValue(singleRule());
    approvalsService.createAndSubmit.mockResolvedValue({ id: 'ap1', approvalNo: 'AP-1' });

    await svc.initiateChange('TLR-1', { maxAmount: 200, reason: 'x' } as any, actor);

    expect(rulesService.attachApprovalCase).toHaveBeenCalledWith('TLR-1', 'AP-1');
  });

  it('APPROVED change → applyAmountChange 后 clearApprovalCase', async () => {
    prisma.transactionLimitRule.findUnique.mockResolvedValue(singleRule({ approvalCaseNo: 'AP-1' }));
    approvalsService.getById.mockResolvedValue({
      objectSnapshot: {
        before: { minAmount: '10', maxAmount: '100' },
        after: { minAmount: '10', maxAmount: '200' },
      },
    });

    await svc.onChangeDecided({
      decision: 'APPROVED',
      entityRef: 'TLR-1',
      approvalId: 'ap1',
      approvalNo: 'AP-1',
    } as any);

    expect(rulesService.applyAmountChange).toHaveBeenCalled();
    expect(rulesService.clearApprovalCase).toHaveBeenCalledWith('TLR-1');
  });

  it('DECLINED change → clearApprovalCase + CANCELLED 审计', async () => {
    prisma.transactionLimitRule.findUnique.mockResolvedValue(singleRule({ approvalCaseNo: 'AP-1' }));

    await svc.onChangeDecided({
      decision: 'DECLINED',
      entityRef: 'TLR-1',
      approvalId: 'ap1',
      approvalNo: 'AP-1',
    } as any);

    expect(rulesService.clearApprovalCase).toHaveBeenCalledWith('TLR-1');
    expect(failFindFor(CHANGE_CANCELLED)).toBeTruthy();
  });

  // ── null-rule routing ──

  it('onChangeDecided: entityRef matches no rule → graceful no-op', async () => {
    prisma.transactionLimitRule.findUnique.mockResolvedValue(null);

    await svc.onChangeDecided({ decision: 'APPROVED', entityRef: 'not-a-rule', approvalId: 'ap1' } as any);

    expect(rulesService.applyAmountChange).not.toHaveBeenCalled();
    expect(rulesService.clearApprovalCase).not.toHaveBeenCalled();
    expect(approvalsService.getById).not.toHaveBeenCalled();
    expect(auditLogsService.recordSystem).not.toHaveBeenCalled();
  });
});
