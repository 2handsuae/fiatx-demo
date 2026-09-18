import { ApprovalPolicyChangeWorkflowService } from './approval-policy-change-workflow.service';
import { ApprovalDecidedEvent } from './approval-handler.base';

describe('ApprovalPolicyChangeWorkflowService', () => {
  let prisma: any;
  let approvalsService: any;
  let policyService: any;
  let auditLogsService: any;
  let service: ApprovalPolicyChangeWorkflowService;

  const actor = {
    actorType: 'ADMIN' as const,
    userId: 'admin-1',
    userNo: 'USR-A001',
    role: 'SUPER_ADMIN',
    roleCodes: ['SUPER_ADMIN'],
  };

  const targetActionType = 'ROLE_DEFINITION_CREATE';
  const currentSteps = [{ stepNo: 1, roles: ['CISO'] }];
  const proposedSteps = [{ stepNo: 1, roles: ['CISO', 'COMPLIANCE_OFFICER'] }];

  const buildDecidedEvent = (decision: ApprovalDecidedEvent['decision'], traceId: string): ApprovalDecidedEvent => ({
    decision,
    actionType: 'APPROVAL_POLICY_CHANGE',
    entityRef: 'req-1',
    approvalId: 'apr-1',
    approvalNo: 'APR2608260003',
    traceId,
    workflowType: 'APPROVAL_POLICY',
    decisionByUserId: 'checker-1',
    decisionByUserNo: 'USR-C001',
    decisionByRole: 'CISO',
    decisionReason: null,
    metadata: {},
  });

  beforeEach(() => {
    prisma = {
      approvalPolicyChangeRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn((args: any) => Promise.resolve({ id: 'req-1', ...args.data })),
        update: jest.fn().mockResolvedValue(undefined),
      },
    };
    prisma.$transaction = jest.fn((fn: any) => fn(prisma));

    approvalsService = {
      createAndSubmit: jest.fn().mockResolvedValue({ id: 'apr-1', approvalNo: 'APR2608260003' }),
    };
    policyService = {
      getPolicy: jest.fn().mockResolvedValue({
        actionType: targetActionType,
        steps: currentSteps,
        checkerRoles: ['CISO'],
        timeoutHours: 24,
        allowCancel: true,
      }),
      upsertStepsConfig: jest.fn().mockResolvedValue(undefined),
    };
    auditLogsService = {
      recordByActor: jest.fn().mockResolvedValue(undefined),
    };

    service = new ApprovalPolicyChangeWorkflowService(prisma, approvalsService, policyService, auditLogsService);
  });

  describe('第一批 · 审批策略 2 码', () => {
    it('发起变更写独立的 REQUESTED 码，不复用 APPROVAL_SUBMITTED，PRIMARY 是审批策略', async () => {
      const result = await service.requestChange(targetActionType, proposedSteps, 'widen approver pool', actor);

      const call = auditLogsService.recordByActor.mock.calls.find(
        (c: any[]) => c[0].action === 'APPROVAL_POLICY_CHANGE_REQUESTED',
      );
      expect(call).toBeDefined();
      expect(call[0].action).not.toBe('APPROVAL_SUBMITTED');
      expect(call[0].actionDomain).toBe('CONFIG');
      expect(call[0].primarySubjectType).toBe('APPROVAL_POLICY');
      expect(call[0].beforeData).toEqual({ steps: currentSteps });
      expect(call[0].afterData).toEqual({ steps: proposedSteps });
      expect(call[0].correlationId).toEqual(expect.any(String));
      expect(call[0].subjects).toEqual([
        { subjectType: 'APPROVAL_POLICY', subjectNo: result.requestNo, subjectRole: 'PRIMARY' },
        { subjectType: 'APPROVAL_POLICY', subjectNo: targetActionType, subjectRole: 'RELATED' },
        { subjectType: 'APPROVAL_CASE', subjectNo: 'APR2608260003', subjectRole: 'INSTRUMENT' },
      ]);
    });

    it('审批通过后写 APPLIED(INHERIT+因果)，带 policyVersion 与 approvalNo', async () => {
      prisma.approvalPolicyChangeRequest.findFirst.mockResolvedValue({
        id: 'req-1',
        requestNo: 'APC260826001',
        targetActionType,
        currentStepsConfig: JSON.stringify(currentSteps),
        proposedStepsConfig: JSON.stringify(proposedSteps),
        proposedCheckerRoles: 'CISO,COMPLIANCE_OFFICER',
      });

      await service.handleApprovalDecided(buildDecidedEvent('APPROVED', 'trace-55'));

      const call = auditLogsService.recordByActor.mock.calls.find(
        (c: any[]) => c[0].action === 'APPROVAL_POLICY_CHANGE_APPLIED',
      );
      expect(call).toBeDefined();
      expect(call[0].correlationId).toBe('trace-55');
      expect(call[0].causationId).toBe('apr-1');
      expect(call[0].approvalNo).toBe('APR2608260003');
      expect(call[0].policyVersion).toBe(1);
      expect(call[0].outcome).toBe('SUCCESS');
      expect(call[0].beforeData).toEqual({ steps: currentSteps });
      expect(call[0].afterData).toEqual({ steps: proposedSteps });
      expect(policyService.upsertStepsConfig).toHaveBeenCalledWith(targetActionType, proposedSteps, expect.anything());
      expect(call[0].subjects).toEqual([
        { subjectType: 'APPROVAL_POLICY', subjectNo: 'APC260826001', subjectRole: 'PRIMARY' },
        { subjectType: 'APPROVAL_POLICY', subjectNo: targetActionType, subjectRole: 'RELATED' },
        { subjectType: 'APPROVAL_CASE', subjectNo: 'APR2608260003', subjectRole: 'INSTRUMENT' },
      ]);
    });

    it('落库失败仍写同一个 APPLIED(outcome=FAILED)，不是退役码 MODIFICATION_APPLY_FAILED', async () => {
      prisma.approvalPolicyChangeRequest.findFirst.mockResolvedValue({
        id: 'req-1',
        requestNo: 'APC260826001',
        targetActionType,
        currentStepsConfig: JSON.stringify(currentSteps),
        proposedStepsConfig: JSON.stringify(proposedSteps),
        proposedCheckerRoles: 'CISO,COMPLIANCE_OFFICER',
      });
      policyService.upsertStepsConfig.mockRejectedValue(new Error('db down'));

      await service.handleApprovalDecided(buildDecidedEvent('APPROVED', 'trace-55'));

      const applied = auditLogsService.recordByActor.mock.calls.filter(
        (c: any[]) => c[0].action === 'APPROVAL_POLICY_CHANGE_APPLIED',
      );
      expect(applied).toHaveLength(1);
      expect(applied[0][0].outcome).toBe('FAILED');
      expect(applied[0][0].reason).toContain('db down');
      expect(applied[0][0].causationId).toBe('apr-1');
      expect(applied[0][0].subjects).toEqual([
        { subjectType: 'APPROVAL_POLICY', subjectNo: 'APC260826001', subjectRole: 'PRIMARY' },
        { subjectType: 'APPROVAL_POLICY', subjectNo: targetActionType, subjectRole: 'RELATED' },
        { subjectType: 'APPROVAL_CASE', subjectNo: 'APR2608260003', subjectRole: 'INSTRUMENT' },
      ]);
    });

    it('刻意没有 CANCELLED 码——只声明了 2 码，驳回/取消/超时不写审计', async () => {
      prisma.approvalPolicyChangeRequest.findFirst.mockResolvedValue({
        id: 'req-1',
        requestNo: 'APC260826001',
        targetActionType,
      });

      await service.handleApprovalDecided(buildDecidedEvent('DECLINED', 'trace-55'));

      expect(auditLogsService.recordByActor).not.toHaveBeenCalled();
    });
  });
});
