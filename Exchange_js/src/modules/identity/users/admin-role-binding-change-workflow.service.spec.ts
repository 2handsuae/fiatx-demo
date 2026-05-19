import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminRoleBindingChangeWorkflowService } from './admin-role-binding-change-workflow.service';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';

describe('AdminRoleBindingChangeWorkflowService', () => {
  let prisma: any;
  let accessControlService: any;
  let approvalsService: any;
  let auditLogsService: any;
  let service: AdminRoleBindingChangeWorkflowService;

  const actor = {
    actorType: 'ADMIN' as const,
    userId: 'admin-1',
    userNo: 'USR-A001',
    role: 'CISO',
    roleCodes: ['CISO'],
  };

  beforeEach(() => {
    prisma = {
      user: {
        findFirst: jest.fn(),
      },
      adminRoleChangeRequest: {
        create: jest.fn(),
        update: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };

    accessControlService = {
      getUserRoleCodes: jest.fn(),
      validateHardMutex: jest.fn(),
      replaceUserRoles: jest.fn(),
    };

    approvalsService = {
      createAndSubmit: jest.fn(),
    };

    auditLogsService = {
      recordByActor: jest.fn().mockResolvedValue(undefined),
    };

    service = new AdminRoleBindingChangeWorkflowService(
      prisma,
      accessControlService,
      approvalsService,
      auditLogsService,
    );
  });

  describe('createRoleChangeRequest', () => {
    it('rejects self-change', async () => {
      await expect(
        service.createRoleChangeRequest(
          { targetUserId: 'admin-1', roleCodes: ['MLRO'], changeReason: 'test' },
          actor,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when target user not found', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.createRoleChangeRequest(
          { targetUserId: 'user-2', roleCodes: ['MLRO'], changeReason: 'test' },
          actor,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates request, submits approval, writes audit on success', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'user-2', userNo: 'USR-U002' });
      accessControlService.getUserRoleCodes.mockResolvedValue(['COMPLIANCE_OFFICER']);
      prisma.adminRoleChangeRequest.create.mockResolvedValue({
        id: 'req-1',
        requestNo: 'RCR-2605050001',
        status: 'PENDING_APPROVAL',
        targetUserId: 'user-2',
        currentRoleCodes: '["COMPLIANCE_OFFICER"]',
        proposedRoleCodes: '["MLRO"]',
        changeReason: 'promotion',
        createdAt: new Date('2026-05-05T00:00:00Z'),
      });
      approvalsService.createAndSubmit.mockResolvedValue({
        id: 'apr-1',
        approvalNo: 'APR2605050001',
        status: 'PENDING',
      });
      prisma.adminRoleChangeRequest.update.mockResolvedValue({
        id: 'req-1',
        requestNo: 'RCR-2605050001',
        status: 'PENDING_APPROVAL',
        approvalCaseId: 'apr-1',
        approvalCaseNo: 'APR2605050001',
      });

      const result = await service.createRoleChangeRequest(
        { targetUserId: 'user-2', roleCodes: ['MLRO'], changeReason: 'promotion' },
        actor,
      );

      expect(result.status).toBe('PENDING_APPROVAL');
      expect(approvalsService.createAndSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'ADMIN_ROLE_BINDING_CHANGE_APPROVAL',
          entityRef: 'req-1',
        }),
        expect.objectContaining({ reason: 'promotion' }),
        actor,
      );
      expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CHANGE_REQUESTED',
          entityType: 'ACCESS_CONTROL',
        }),
        expect.any(Object),
      );
    });
  });

  describe('handleApprovalDecided — APPROVED', () => {
    it('executes role change and writes CHANGE_APPLIED audit', async () => {
      const event: ApprovalDecidedEvent = {
        decision: 'APPROVED',
        actionType: 'ADMIN_ROLE_BINDING_CHANGE_APPROVAL',
        entityRef: 'req-1',
        approvalId: 'apr-1',
        approvalNo: 'APR-1',
        traceId: 'trace-1',
        workflowType: 'ADMIN_ROLE_BINDING_CHANGE',
        metadata: {},
      };

      prisma.adminRoleChangeRequest.findFirst.mockResolvedValue({
        id: 'req-1',
        requestNo: 'RCR-1',
        targetUserId: 'user-2',
        proposedRoleCodes: '["MLRO"]',
        status: 'PENDING_APPROVAL',
        approvalCaseId: 'apr-1',
      });
      prisma.user.findFirst.mockResolvedValue({ id: 'user-2', userNo: 'USR-U002' });
      accessControlService.replaceUserRoles.mockResolvedValue({
        userId: 'user-2',
        roles: ['MLRO'],
      });

      await service.handleApprovalDecided(event);

      expect(accessControlService.replaceUserRoles).toHaveBeenCalledWith(
        'user-2',
        ['MLRO'],
        expect.objectContaining({ actorId: 'SYSTEM' }),
        expect.objectContaining({ workflowType: 'ADMIN_ROLE_BINDING_CHANGE' }),
      );
      expect(prisma.adminRoleChangeRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'APPROVED' }),
        }),
      );
      expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CHANGE_APPLIED' }),
        expect.any(Object),
      );
    });

    it('marks FAILED and writes CHANGE_APPLY_FAILED on execution error', async () => {
      const event: ApprovalDecidedEvent = {
        decision: 'APPROVED',
        actionType: 'ADMIN_ROLE_BINDING_CHANGE_APPROVAL',
        entityRef: 'req-1',
        approvalId: 'apr-1',
        approvalNo: 'APR-1',
        traceId: 'trace-1',
        workflowType: 'ADMIN_ROLE_BINDING_CHANGE',
        metadata: {},
      };

      prisma.adminRoleChangeRequest.findFirst.mockResolvedValue({
        id: 'req-1',
        requestNo: 'RCR-1',
        targetUserId: 'user-2',
        proposedRoleCodes: '["MLRO","CISO"]',
        status: 'PENDING_APPROVAL',
        approvalCaseId: 'apr-1',
      });
      prisma.user.findFirst.mockResolvedValue({ id: 'user-2', userNo: 'USR-U002' });
      accessControlService.replaceUserRoles.mockRejectedValue(
        new BadRequestException('Role CISO and MLRO cannot be assigned to one user.'),
      );

      await service.handleApprovalDecided(event);

      expect(prisma.adminRoleChangeRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'FAILED',
            failureReason: expect.stringContaining('cannot be assigned'),
          }),
        }),
      );
      expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CHANGE_APPLY_FAILED' }),
        expect.any(Object),
      );
    });
  });

  describe('handleApprovalDecided — DECLINED', () => {
    it('updates request status to REJECTED', async () => {
      const event: ApprovalDecidedEvent = {
        decision: 'DECLINED',
        actionType: 'ADMIN_ROLE_BINDING_CHANGE_APPROVAL',
        entityRef: 'req-1',
        approvalId: 'apr-1',
        approvalNo: 'APR-1',
        traceId: 'trace-1',
        workflowType: 'ADMIN_ROLE_BINDING_CHANGE',
        metadata: {},
      };

      prisma.adminRoleChangeRequest.findFirst.mockResolvedValue({
        id: 'req-1',
        status: 'PENDING_APPROVAL',
      });

      await service.handleApprovalDecided(event);

      expect(prisma.adminRoleChangeRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'REJECTED' }),
        }),
      );
    });
  });

  describe('handleApprovalDecided — EXPIRED', () => {
    it('updates request status to EXPIRED', async () => {
      const event: ApprovalDecidedEvent = {
        decision: 'EXPIRED',
        actionType: 'ADMIN_ROLE_BINDING_CHANGE_APPROVAL',
        entityRef: 'req-1',
        approvalId: 'apr-1',
        approvalNo: 'APR-1',
        traceId: 'trace-1',
        workflowType: 'ADMIN_ROLE_BINDING_CHANGE',
        metadata: {},
      };

      prisma.adminRoleChangeRequest.findFirst.mockResolvedValue({
        id: 'req-1',
        status: 'PENDING_APPROVAL',
      });

      await service.handleApprovalDecided(event);

      expect(prisma.adminRoleChangeRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'EXPIRED' }),
        }),
      );
    });
  });

  describe('findRoleChangeRequests', () => {
    it('returns paginated results', async () => {
      prisma.adminRoleChangeRequest.findMany.mockResolvedValue([]);
      prisma.adminRoleChangeRequest.count.mockResolvedValue(0);

      const result = await service.findRoleChangeRequests({ page: 1, limit: 20 });

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe('findRoleChangeRequest', () => {
    it('throws NotFoundException when not found', async () => {
      prisma.adminRoleChangeRequest.findFirst.mockResolvedValue(null);

      await expect(service.findRoleChangeRequest('bad-id')).rejects.toThrow(NotFoundException);
    });

    it('returns the request when found', async () => {
      prisma.adminRoleChangeRequest.findFirst.mockResolvedValue({
        id: 'req-1',
        requestNo: 'RCR-1',
      });

      const result = await service.findRoleChangeRequest('req-1');
      expect(result.id).toBe('req-1');
    });
  });
});
