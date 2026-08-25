import { BadRequestException } from '@nestjs/common';
import { AdminInviteWorkflowService } from './admin-invite-workflow.service';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';

describe('AdminInviteWorkflowService', () => {
  let prisma: any;
  let usersDomainService: any;
  let accessControlService: any;
  let approvalsService: any;
  let adminInvitationsService: any;
  let auditLogsService: any;
  let service: AdminInviteWorkflowService;

  const actor = {
    actorType: 'ADMIN' as const,
    userId: 'admin-1',
    userNo: 'USR-A001',
    role: 'CISO',
    roleCodes: ['CISO'],
  };

  beforeEach(() => {
    prisma = {
      adminUserInvitation: {
        findMany: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined),
      },
    };
    usersDomainService = {
      createProvisionalUser: jest.fn(),
      findById: jest.fn(),
      physicalDelete: jest.fn().mockResolvedValue(undefined),
      updateStatus: jest.fn().mockResolvedValue(undefined),
    };
    accessControlService = {
      replaceUserRoles: jest.fn().mockResolvedValue(undefined),
    };
    approvalsService = {
      createAndSubmit: jest.fn(),
    };
    adminInvitationsService = {
      createInvitationForUser: jest.fn(),
      resendInvitationForUser: jest.fn(),
    };
    auditLogsService = {
      recordByActor: jest.fn().mockResolvedValue(undefined),
      recordSystem: jest.fn().mockResolvedValue(undefined),
    };

    service = new AdminInviteWorkflowService(
      prisma,
      usersDomainService,
      accessControlService,
      approvalsService,
      adminInvitationsService,
      auditLogsService,
    );
  });

  describe('第一批 · 入职邀请 5 码', () => {
    it('发起时 correlationMode=START：生成新 correlationId 并写回审批单的 traceId', async () => {
      usersDomainService.createProvisionalUser.mockResolvedValue({
        id: 'user-1',
        userNo: 'ADM-001',
        email: 'new@fiatx.com',
        status: 'PENDING_INVITE_APPROVAL',
        role: 'OPS',
      });
      approvalsService.createAndSubmit.mockResolvedValue({
        id: 'apr-1',
        approvalNo: 'APR-1',
        status: 'PENDING',
      });

      const result = await service.initiateInvite(
        { email: 'new@fiatx.com', roleCodes: ['OPS'] },
        actor,
      );

      expect(result.approvalNo).toBe('APR-1');

      const call = auditLogsService.recordByActor.mock.calls.find(
        (c: any[]) => c[0].action === 'ADMIN_INVITE_REQUESTED',
      );
      expect(call).toBeDefined();
      expect(call[0].actionDomain).toBe('IAM');
      expect(call[0].correlationId).toBeTruthy();
      expect(call[0].afterData).toBeDefined();
      expect(call[0].outcome).toBe('SUCCESS');

      // correlationId 写回了同一次 createAndSubmit 调用的 traceId（ApprovalCase.traceId
      // 是过渡期承载列），后续 DISPATCHED/CANCELLED 靠 ApprovalDecidedEvent.traceId 原样继承。
      expect(approvalsService.createAndSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ traceId: call[0].correlationId }),
        expect.objectContaining({ traceId: call[0].correlationId }),
        actor,
      );
    });

    it('SoD 硬互斥冲突时写 outcome=DENIED + reasonCode=SOD_CONFLICT，且删掉 provisional user', async () => {
      usersDomainService.createProvisionalUser.mockResolvedValue({
        id: 'user-1',
        userNo: 'ADM-001',
        email: 'conflict@fiatx.com',
        status: 'PENDING_INVITE_APPROVAL',
        role: 'OPS',
      });
      accessControlService.replaceUserRoles.mockRejectedValue(
        new BadRequestException('Role MLRO and COMPLIANCE_OFFICER cannot be assigned to one user.'),
      );

      await expect(
        service.initiateInvite(
          { email: 'conflict@fiatx.com', roleCodes: ['MLRO', 'COMPLIANCE_OFFICER'] },
          actor,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(usersDomainService.physicalDelete).toHaveBeenCalledWith('user-1');
      expect(approvalsService.createAndSubmit).not.toHaveBeenCalled();

      const call = auditLogsService.recordByActor.mock.calls.find(
        (c: any[]) => c[0].outcome === 'DENIED',
      );
      expect(call).toBeDefined();
      expect(call[0].action).toBe('ADMIN_INVITE_REQUESTED');
      expect(call[0].reasonCode).toBe('SOD_CONFLICT');
    });

    it('批准后派发邀请，写 ADMIN_INVITE_DISPATCHED 并 INHERIT 审批单的 correlationId', async () => {
      usersDomainService.findById.mockResolvedValue({
        id: 'user-1',
        userNo: 'ADM-001',
        email: 'new@fiatx.com',
        status: 'PENDING_INVITE_APPROVAL',
      });
      adminInvitationsService.createInvitationForUser.mockResolvedValue({
        inviteExpiresAt: '2026-08-27T00:00:00.000Z',
      });

      const event: ApprovalDecidedEvent = {
        decision: 'APPROVED',
        actionType: 'ADMIN_INVITE_APPROVAL',
        entityRef: 'user-1',
        approvalId: 'apr-1',
        approvalNo: 'APR-1',
        traceId: 'trace-invite-1',
        workflowType: 'ADMIN_INVITE',
        metadata: {},
      };

      await service.handleApprovalDecided(event);

      expect(usersDomainService.updateStatus).toHaveBeenCalledWith('user-1', 'INVITE_SENT');
      expect(adminInvitationsService.createInvitationForUser).toHaveBeenCalledWith(
        expect.objectContaining({
          auditContext: expect.objectContaining({ traceId: 'trace-invite-1' }),
        }),
      );

      const call = auditLogsService.recordByActor.mock.calls.find(
        (c: any[]) => c[0].action === 'ADMIN_INVITE_DISPATCHED',
      );
      expect(call).toBeDefined();
      expect(call[0].actionDomain).toBe('IAM');
      expect(call[0].correlationId).toBe('trace-invite-1');
      expect(call[0].outcome).toBe('SUCCESS');
    });

    it('审批被驳回/取消/超时都物理删除 provisional user 并写 ADMIN_INVITE_CANCELLED + reason', async () => {
      usersDomainService.findById.mockResolvedValue({
        id: 'user-1',
        userNo: 'ADM-001',
        email: 'new@fiatx.com',
        status: 'PENDING_INVITE_APPROVAL',
      });

      const event: ApprovalDecidedEvent = {
        decision: 'DECLINED',
        actionType: 'ADMIN_INVITE_APPROVAL',
        entityRef: 'user-1',
        approvalId: 'apr-1',
        approvalNo: 'APR-1',
        traceId: 'trace-invite-1',
        workflowType: 'ADMIN_INVITE',
        decisionReason: 'Role scope too broad',
        metadata: {},
      };

      await service.handleApprovalDecided(event);

      expect(usersDomainService.physicalDelete).toHaveBeenCalledWith('user-1');

      const call = auditLogsService.recordByActor.mock.calls.find(
        (c: any[]) => c[0].action === 'ADMIN_INVITE_CANCELLED',
      );
      expect(call).toBeDefined();
      expect(call[0].correlationId).toBe('trace-invite-1');
      expect(call[0].reason).toBeTruthy();
    });

    it('链接过期由 sweepExpiredInvites 用 recordSystem 写 ADMIN_INVITE_EXPIRED，sourcePlatform=CRON', async () => {
      prisma.adminUserInvitation.findMany.mockResolvedValue([
        { id: 'invite-1', traceId: 'trace-invite-1', user: { userNo: 'ADM-001' } },
      ]);

      const result = await service.sweepExpiredInvites();

      expect(result.expiredCount).toBe(1);
      expect(prisma.adminUserInvitation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'invite-1' },
          data: expect.objectContaining({ revokedAt: expect.any(Date) }),
        }),
      );

      const call = auditLogsService.recordSystem.mock.calls.find(
        (c: any[]) => c[0].action === 'ADMIN_INVITE_EXPIRED',
      );
      expect(call).toBeDefined();
      expect(call[0].actionDomain).toBe('IAM');
      expect(call[0].sourcePlatform).toBe('CRON');
      expect(call[0].correlationId).toBe('trace-invite-1');
    });
  });

  describe('resendInvitation', () => {
    it('不再传半截 auditContext，交给 AdminInvitationsService 自己补全 workflowType+traceId', async () => {
      usersDomainService.findById.mockResolvedValue({ id: 'user-1', userNo: 'ADM-001' });
      adminInvitationsService.resendInvitationForUser.mockResolvedValue({ inviteStatus: 'PENDING' });

      await service.resendInvitation('user-1', actor);

      expect(adminInvitationsService.resendInvitationForUser).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1' }),
      );
      const call = adminInvitationsService.resendInvitationForUser.mock.calls[0][0];
      expect(call.auditContext).toBeUndefined();
    });
  });
});
