import { ConflictException, ForbiddenException } from '@nestjs/common';
import { AdminReactivationWorkflowService } from './admin-reactivation-workflow.service';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';

describe('AdminReactivationWorkflowService', () => {
  let prisma: any;
  let usersDomainService: any;
  let approvalsService: any;
  let auditLogsService: any;
  let service: AdminReactivationWorkflowService;

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
    status: 'SUSPENDED',
    role: 'COMPLIANCE_OFFICER',
  };

  const buildApprovedEvent = (traceId: string): ApprovalDecidedEvent => ({
    decision: 'APPROVED',
    actionType: 'ADMIN_REACTIVATION_APPROVAL',
    entityRef: 'user-2',
    approvalId: 'apr-2',
    approvalNo: 'APR2608260002',
    traceId,
    workflowType: 'ADMIN_REACTIVATION',
    decisionByUserId: 'admin-1',
    decisionByUserNo: 'USR-A001',
    decisionByRole: 'CISO',
    metadata: {},
  });

  beforeEach(() => {
    prisma = {
      userRole: { findMany: jest.fn().mockResolvedValue([]) },
      approvalCase: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    usersDomainService = {
      findById: jest.fn().mockResolvedValue(targetUser),
      reactivateUser: jest.fn(),
    };
    approvalsService = {
      createAndSubmit: jest.fn().mockResolvedValue({ id: 'apr-2', approvalNo: 'APR2608260002' }),
    };
    auditLogsService = {
      recordByActor: jest.fn().mockResolvedValue(undefined),
      recordSystem: jest.fn().mockResolvedValue(undefined),
    };
    service = new AdminReactivationWorkflowService(
      prisma,
      usersDomainService,
      approvalsService,
      auditLogsService,
    );
  });

  describe('第一批 · 恢复 2 码', () => {
    it('发起与执行是两条记录，PRIMARY 都是目标 Admin', async () => {
      await service.initiateReactivation({ targetUserId: 'user-2', reason: 'cleared review' }, actor);

      const req = auditLogsService.recordByActor.mock.calls.find(
        (c: any[]) => c[0].action === 'ADMIN_REACTIVATION_REQUESTED',
      );
      expect(req).toBeDefined();
      expect(req[0].actionDomain).toBe('IAM');
      expect(req[0].primarySubjectNo).toBe(targetUser.userNo);
      expect(req[0].reason).toBe('cleared review');

      usersDomainService.reactivateUser.mockResolvedValue({
        id: 'user-2', userNo: targetUser.userNo, status: 'ACTIVE',
      });
      await service.handleApprovalDecided(buildApprovedEvent(req[0].correlationId));

      const app = auditLogsService.recordSystem.mock.calls.find(
        (c: any[]) => c[0].action === 'ADMIN_REACTIVATION_APPLIED',
      );
      expect(app).toBeDefined();
      expect(app[0].primarySubjectNo).toBe(targetUser.userNo);
      expect(app[0].fromStatus).toBe('SUSPENDED');
      expect(app[0].toStatus).toBe('ACTIVE');
      expect(app[0].approvalNo).toBe('APR2608260002');
      expect(app[0].causationId).toBe('apr-2');
      expect(app[0].correlationId).toBe(req[0].correlationId);
    });

    it('执行失败时仍写 APPLIED(outcome=FAILED)，带 fromStatus/toStatus 意图值', async () => {
      usersDomainService.reactivateUser.mockRejectedValue(new ConflictException('boom'));

      await expect(
        service.handleApprovalDecided(buildApprovedEvent('trace-y')),
      ).rejects.toThrow(ConflictException);

      const app = auditLogsService.recordSystem.mock.calls.find(
        (c: any[]) => c[0].action === 'ADMIN_REACTIVATION_APPLIED',
      );
      expect(app).toBeDefined();
      expect(app[0].outcome).toBe('FAILED');
      expect(app[0].fromStatus).toBe('SUSPENDED');
      expect(app[0].toStatus).toBe('ACTIVE');
      expect(app[0].correlationId).toBe('trace-y');
    });

    it('刻意没有 CANCELLED 码——代码里无取消路径', () => {
      const src = require('fs').readFileSync(
        'src/modules/identity/users/admin-reactivation-workflow.service.ts', 'utf8');
      expect(src).not.toContain('ADMIN_REACTIVATION_CANCELLED');
    });
  });

  describe('guard rails（既有行为，未受本轮改动影响）', () => {
    it('rejects self-reactivate', async () => {
      await expect(
        service.initiateReactivation({ targetUserId: 'admin-1', reason: 'x' }, actor),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects when target is not SUSPENDED', async () => {
      usersDomainService.findById.mockResolvedValue({ ...targetUser, status: 'ACTIVE' });
      await expect(
        service.initiateReactivation({ targetUserId: 'user-2', reason: 'x' }, actor),
      ).rejects.toThrow(ConflictException);
    });
  });
});
