import { ConflictException, ForbiddenException } from '@nestjs/common';
import { AdminSuspensionWorkflowService } from './admin-suspension-workflow.service';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';

describe('AdminSuspensionWorkflowService', () => {
  let prisma: any;
  let usersDomainService: any;
  let approvalsService: any;
  let auditLogsService: any;
  let service: AdminSuspensionWorkflowService;

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

  const buildApprovedEvent = (traceId: string): ApprovalDecidedEvent => ({
    decision: 'APPROVED',
    actionType: 'ADMIN_SUSPENSION_APPROVAL',
    entityRef: 'user-2',
    approvalId: 'apr-1',
    approvalNo: 'APR2608260001',
    traceId,
    workflowType: 'ADMIN_SUSPENSION',
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
      findByUserNo: jest.fn().mockResolvedValue(targetUser),
      suspendUser: jest.fn(),
    };
    approvalsService = {
      createAndSubmit: jest.fn().mockResolvedValue({ id: 'apr-1', approvalNo: 'APR2608260001' }),
    };
    auditLogsService = {
      recordByActor: jest.fn().mockResolvedValue(undefined),
      recordSystem: jest.fn().mockResolvedValue(undefined),
    };
    service = new AdminSuspensionWorkflowService(
      prisma,
      usersDomainService,
      approvalsService,
      auditLogsService,
    );
  });

  describe('第一批 · 停用 2 码', () => {
    it('发起与执行是两条记录，PRIMARY 都是目标 Admin', async () => {
      await service.initiateSuspension({ targetUserId: 'user-2', reason: 'policy breach' }, actor);

      const req = auditLogsService.recordByActor.mock.calls.find(
        (c: any[]) => c[0].action === 'ADMIN_SUSPENSION_REQUESTED',
      );
      expect(req).toBeDefined();
      expect(req[0].actionDomain).toBe('IAM');
      expect(req[0].primarySubjectNo).toBe(targetUser.userNo);
      expect(req[0].reason).toBe('policy breach');

      usersDomainService.suspendUser.mockResolvedValue({
        id: 'user-2', userNo: targetUser.userNo, status: 'SUSPENDED',
      });
      await service.handleApprovalDecided(buildApprovedEvent(req[0].correlationId));

      const app = auditLogsService.recordSystem.mock.calls.find(
        (c: any[]) => c[0].action === 'ADMIN_SUSPENSION_APPLIED',
      );
      expect(app).toBeDefined();
      expect(app[0].primarySubjectNo).toBe(targetUser.userNo);
      expect(app[0].fromStatus).toBe('ACTIVE');
      expect(app[0].toStatus).toBe('SUSPENDED');
      expect(app[0].approvalNo).toBe('APR2608260001');
      expect(app[0].causationId).toBe('apr-1');
      expect(app[0].correlationId).toBe(req[0].correlationId);
    });

    it('执行失败时仍写 APPLIED(outcome=FAILED)，带 fromStatus/toStatus 意图值', async () => {
      usersDomainService.suspendUser.mockRejectedValue(new ConflictException('boom'));

      await expect(
        service.handleApprovalDecided(buildApprovedEvent('trace-x')),
      ).rejects.toThrow(ConflictException);

      const app = auditLogsService.recordSystem.mock.calls.find(
        (c: any[]) => c[0].action === 'ADMIN_SUSPENSION_APPLIED',
      );
      expect(app).toBeDefined();
      expect(app[0].outcome).toBe('FAILED');
      expect(app[0].fromStatus).toBe('ACTIVE');
      expect(app[0].toStatus).toBe('SUSPENDED');
      expect(app[0].correlationId).toBe('trace-x');
    });

    it('刻意没有 CANCELLED 码——代码里无取消路径', () => {
      const src = require('fs').readFileSync(
        'src/modules/identity/users/admin-suspension-workflow.service.ts', 'utf8');
      expect(src).not.toContain('ADMIN_SUSPENSION_CANCELLED');
    });
  });

  describe('guard rails（既有行为，未受本轮改动影响）', () => {
    it('rejects self-suspend', async () => {
      await expect(
        service.initiateSuspension({ targetUserId: 'admin-1', reason: 'x' }, actor),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects when target is SUPER_ADMIN', async () => {
      prisma.userRole.findMany.mockResolvedValue([{ role: { code: 'SUPER_ADMIN' } }]);
      await expect(
        service.initiateSuspension({ targetUserId: 'user-2', reason: 'x' }, actor),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
