import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TransactionLimitRuleWorkflowService } from './transaction-limit-rule-workflow.service';
import { AuditOutcome } from '../../audit-logging/dto/audit-log.dto';

const CHANGE_APPLIED = 'CHANGE_APPLIED';
const CHANGE_APPLY_FAILED = 'CHANGE_APPLY_FAILED';

describe('TransactionLimitRuleWorkflowService', () => {
  let svc: TransactionLimitRuleWorkflowService;

  const prisma = {
    transactionLimitRule: { findUnique: jest.fn() },
  } as any;
  const rulesService = {
    validateShape: jest.fn(),
    assertUnique: jest.fn(),
    findByNo: jest.fn(),
    createPending: jest.fn(),
    attachApprovalCase: jest.fn(),
    activate: jest.fn(),
    deletePending: jest.fn(),
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
    status: 'ACTIVE',
    gateType: 'SINGLE',
    operationType: 'WITHDRAWAL',
    assetId: 'a1',
    tradingTier: null,
    period: null,
    minAmount: new Prisma.Decimal(10),
    maxAmount: new Prisma.Decimal(100),
    defaultLimit: null,
    cap: null,
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

  // ── 创建流 ──

  it('initiateCreate validates, inserts PENDING, submits approval, links, audits', async () => {
    rulesService.createPending.mockResolvedValue({ id: 'r1', ruleNo: 'TLR-x' });
    approvalsService.createAndSubmit.mockResolvedValue({ id: 'ap1', approvalNo: 'AP-1' });

    const res = await svc.initiateCreate(
      { gateType: 'SINGLE', operationType: 'WITHDRAWAL', assetId: 'a1', minAmount: 1, maxAmount: 5, reason: 'r' } as any,
      actor,
    );

    expect(rulesService.validateShape).toHaveBeenCalled();
    expect(rulesService.assertUnique).toHaveBeenCalled();
    expect(rulesService.createPending).toHaveBeenCalled();
    expect(approvalsService.createAndSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'TRANSACTION_LIMIT_CREATION', entityRef: 'r1' }),
      expect.anything(),
      actor,
    );
    expect(rulesService.attachApprovalCase).toHaveBeenCalled();
    expect(auditLogsService.recordByActor).toHaveBeenCalled();
    expect(res.status).toBe('PENDING_APPROVAL');
  });

  it('APPROVED creation decided → activate (status→ACTIVE)', async () => {
    prisma.transactionLimitRule.findUnique.mockResolvedValue(
      singleRule({ status: 'PENDING_APPROVAL' }),
    );

    await svc.onCreationDecided({
      decision: 'APPROVED',
      entityRef: 'r1',
      approvalId: 'ap1',
      approvalNo: 'AP-1',
      traceId: 't',
    } as any);

    expect(rulesService.activate).toHaveBeenCalledWith('TLR-1');
    expect(rulesService.deletePending).not.toHaveBeenCalled();
    expect(auditLogsService.recordSystem).toHaveBeenCalled();
  });

  it('DECLINED creation decided → deletePending (physical delete)', async () => {
    prisma.transactionLimitRule.findUnique.mockResolvedValue(
      singleRule({ status: 'PENDING_APPROVAL' }),
    );

    await svc.onCreationDecided({
      decision: 'DECLINED',
      entityRef: 'r1',
      approvalId: 'ap1',
    } as any);

    expect(rulesService.deletePending).toHaveBeenCalledWith('TLR-1');
    expect(rulesService.activate).not.toHaveBeenCalled();
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
      entityRef: 'r1',
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
      entityRef: 'r1',
      approvalId: 'ap1',
      approvalNo: 'AP-1',
    } as any);

    expect(rulesService.applyAmountChange).not.toHaveBeenCalled();
    const failCall = failFindFor(CHANGE_APPLY_FAILED);
    expect(failCall).toBeTruthy();
    expect(failCall[0].outcome).toBe(AuditOutcome.FAILED);
  });

  it('APPROVED change with missing after snapshot → CHANGE_APPLY_FAILED, no apply', async () => {
    prisma.transactionLimitRule.findUnique.mockResolvedValue(singleRule());
    approvalsService.getById.mockResolvedValue({
      objectSnapshot: { before: { minAmount: '10', maxAmount: '100' } },
    });

    await svc.onChangeDecided({
      decision: 'APPROVED',
      entityRef: 'r1',
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
    rulesService.findByNo.mockResolvedValue(singleRule());
    approvalsService.list.mockResolvedValue({ total: 1, items: [{ status: 'PENDING' }] });

    await expect(
      svc.initiateChange('TLR-1', { maxAmount: 200, reason: 'x' } as any, actor),
    ).rejects.toThrow(ConflictException);
    expect(approvalsService.createAndSubmit).not.toHaveBeenCalled();
  });

  // ── coexistence routing ──

  it('decided event whose entityRef matches no rule → graceful no-op', async () => {
    prisma.transactionLimitRule.findUnique.mockResolvedValue(null);

    await svc.onCreationDecided({ decision: 'APPROVED', entityRef: 'not-a-rule', approvalId: 'ap1' } as any);
    await svc.onChangeDecided({ decision: 'APPROVED', entityRef: 'not-a-rule', approvalId: 'ap1' } as any);

    expect(rulesService.activate).not.toHaveBeenCalled();
    expect(rulesService.deletePending).not.toHaveBeenCalled();
    expect(rulesService.applyAmountChange).not.toHaveBeenCalled();
    expect(approvalsService.getById).not.toHaveBeenCalled();
    expect(auditLogsService.recordSystem).not.toHaveBeenCalled();
  });
});
