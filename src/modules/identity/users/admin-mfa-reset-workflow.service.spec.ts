import { ConflictException, ForbiddenException } from '@nestjs/common';
import { AdminMfaResetWorkflowService } from './admin-mfa-reset-workflow.service';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';

describe('AdminMfaResetWorkflowService', () => {
  let prisma: any;
  let usersDomainService: any;
  let approvalsService: any;
  let auditLogsService: any;
  let service: AdminMfaResetWorkflowService;

  const actor = {
    actorType: 'ADMIN' as const,
    userId: 'admin-1',
    userNo: 'USR-A001',
    role: 'CISO',
    roleCodes: ['CISO'],
  };

  const targetUser = {
    id: 'user-2',
    userNo: 'USR-U002',
    email: 'target@b.com',
    status: 'ACTIVE',
    role: 'COMPLIANCE_OFFICER',
  };

  const buildDecidedEvent = (decision: ApprovalDecidedEvent['decision'], traceId: string): ApprovalDecidedEvent => ({
    decision,
    actionType: 'ADMIN_MFA_RESET',
    entityRef: 'user-2',
    approvalId: 'apr-3',
    approvalNo: 'APR2608260003',
    traceId,
    workflowType: 'ADMIN_MFA_RESET',
    decisionByUserId: 'admin-1',
    decisionByUserNo: 'USR-A001',
    decisionByRole: 'CISO',
    decisionReason: 'reviewed',
    metadata: {},
  });

  beforeEach(() => {
    prisma = {
      userRole: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findFirst: jest.fn().mockResolvedValue({ mfaEnabledAt: new Date() }) },
      approvalCase: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    usersDomainService = {
      findById: jest.fn().mockResolvedValue(targetUser),
      findByUserNo: jest.fn().mockResolvedValue(targetUser),
      findFirstLoginState: jest.fn().mockResolvedValue({ ...targetUser, firstLoginStatus: 'COMPLETED' }),
      resetMfa: jest.fn(),
    };
    approvalsService = {
      createAndSubmit: jest.fn().mockResolvedValue({ id: 'apr-3', approvalNo: 'APR2608260003' }),
    };
    auditLogsService = {
      recordByActor: jest.fn().mockResolvedValue(undefined),
      recordSystem: jest.fn().mockResolvedValue(undefined),
    };
    service = new AdminMfaResetWorkflowService(
      prisma,
      usersDomainService,
      approvalsService,
      auditLogsService,
    );
  });

  describe('第一批 · MFA 重置 3 码', () => {
    it('发起与执行是两条记录，PRIMARY 都是目标 Admin，REQUESTED 带 onBehalfOfNo', async () => {
      await service.initiateAdminMfaReset('user-2', actor);

      const req = auditLogsService.recordByActor.mock.calls.find(
        (c: any[]) => c[0].action === 'ADMIN_MFA_RESET_REQUESTED',
      );
      expect(req).toBeDefined();
      expect(req[0].actionDomain).toBe('IAM');
      expect(req[0].primarySubjectNo).toBe(targetUser.userNo);
      expect(req[0].onBehalfOfNo).toBe(targetUser.userNo);
      // approvalCase.approvalNo 在手（createAndSubmit 刚返回）——双行数组。
      expect(req[0].subjects).toEqual([
        { subjectType: 'ADMIN_USER', subjectNo: targetUser.userNo, subjectRole: 'PRIMARY' },
        { subjectType: 'APPROVAL_CASE', subjectNo: 'APR2608260003', subjectRole: 'INSTRUMENT' },
      ]);

      usersDomainService.resetMfa.mockResolvedValue({
        id: 'user-2', userNo: targetUser.userNo, email: targetUser.email, role: targetUser.role,
      });
      await service.handleApprovalDecided(buildDecidedEvent('APPROVED', req[0].correlationId));

      const app = auditLogsService.recordSystem.mock.calls.find(
        (c: any[]) => c[0].action === 'ADMIN_MFA_RESET_APPLIED',
      );
      expect(app).toBeDefined();
      expect(app[0].primarySubjectNo).toBe(targetUser.userNo);
      expect(app[0].fromStatus).toBe('COMPLETED');
      expect(app[0].toStatus).toBe('PENDING_IDENTITY_CONFIRM');
      expect(app[0].approvalNo).toBe('APR2608260003');
      expect(app[0].causationId).toBe('apr-3');
      expect(app[0].correlationId).toBe(req[0].correlationId);
      expect(app[0].subjects).toEqual([
        { subjectType: 'ADMIN_USER', subjectNo: targetUser.userNo, subjectRole: 'PRIMARY' },
        { subjectType: 'APPROVAL_CASE', subjectNo: 'APR2608260003', subjectRole: 'INSTRUMENT' },
      ]);
    });

    it('执行失败时仍写 APPLIED(outcome=FAILED)', async () => {
      usersDomainService.resetMfa.mockRejectedValue(new ConflictException('boom'));

      await expect(
        service.handleApprovalDecided(buildDecidedEvent('APPROVED', 'trace-z')),
      ).rejects.toThrow(ConflictException);

      const app = auditLogsService.recordSystem.mock.calls.find(
        (c: any[]) => c[0].action === 'ADMIN_MFA_RESET_APPLIED',
      );
      expect(app).toBeDefined();
      expect(app[0].outcome).toBe('FAILED');
      expect(app[0].correlationId).toBe('trace-z');
      expect(app[0].subjects).toEqual([
        { subjectType: 'ADMIN_USER', subjectNo: targetUser.userNo, subjectRole: 'PRIMARY' },
        { subjectType: 'APPROVAL_CASE', subjectNo: 'APR2608260003', subjectRole: 'INSTRUMENT' },
      ]);
    });

    it('驳回/取消/超时写 CANCELLED，带 reason 与 causationId', async () => {
      await service.handleApprovalDecided(buildDecidedEvent('DECLINED', 'trace-cancel'));

      const cancelled = auditLogsService.recordSystem.mock.calls.find(
        (c: any[]) => c[0].action === 'ADMIN_MFA_RESET_CANCELLED',
      );
      expect(cancelled).toBeDefined();
      expect(cancelled[0].reason).toBe('reviewed');
      expect(cancelled[0].causationId).toBe('apr-3');
      expect(cancelled[0].correlationId).toBe('trace-cancel');
      expect(cancelled[0].primarySubjectNo).toBe(targetUser.userNo);
      expect(cancelled[0].subjects).toEqual([
        { subjectType: 'ADMIN_USER', subjectNo: targetUser.userNo, subjectRole: 'PRIMARY' },
        { subjectType: 'APPROVAL_CASE', subjectNo: 'APR2608260003', subjectRole: 'INSTRUMENT' },
      ]);
    });
  });

  describe('guard rails（既有行为，未受本轮改动影响）', () => {
    it('rejects self-reset', async () => {
      await expect(
        service.initiateAdminMfaReset('admin-1', actor),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects when target has no MFA binding', async () => {
      prisma.user.findFirst.mockResolvedValue({ mfaEnabledAt: null });
      await expect(
        service.initiateAdminMfaReset('user-2', actor),
      ).rejects.toThrow(ConflictException);
    });
  });
});
