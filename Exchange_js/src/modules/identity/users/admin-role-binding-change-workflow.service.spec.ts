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

      const call = auditLogsService.recordByActor.mock.calls.find(
        (c: any[]) => c[0].action === 'ADMIN_ROLE_CHANGE_REQUESTED',
      );
      expect(call).toBeDefined();
      expect(call[0].actionDomain).toBe('IAM');
      expect(call[0].primarySubjectType).toBe('ACCESS_CONTROL');
      expect(call[0].correlationId).toBeTruthy();

      // START：铸造的 correlationId 同一份传给了 approvalsService.createAndSubmit
      // 的 traceId（ApprovalCase.traceId 是过渡期承载列），供 APPLIED/CANCELLED 读回。
      expect(approvalsService.createAndSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'ADMIN_ROLE_BINDING_CHANGE_APPROVAL',
          entityRef: 'req-1',
          traceId: call[0].correlationId,
        }),
        expect.objectContaining({ reason: 'promotion', traceId: call[0].correlationId }),
        actor,
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
        currentRoleCodes: '["COMPLIANCE_OFFICER"]',
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

      // Task 9：AccessControlService.replaceUserRoles 不再接收 auditContext 第 4 参——
      // 它不再自己写审计，ADMIN_ROLE_CHANGE_APPLIED 完全由本方法（编排层）写，
      // 见下方对 auditLogsService.recordByActor 的断言。
      expect(accessControlService.replaceUserRoles).toHaveBeenCalledWith(
        'user-2',
        ['MLRO'],
        expect.objectContaining({ actorId: 'SYSTEM' }),
      );
      expect(prisma.adminRoleChangeRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'APPROVED' }),
        }),
      );

      const call = auditLogsService.recordByActor.mock.calls.find(
        (c: any[]) => c[0].action === 'ADMIN_ROLE_CHANGE_APPLIED',
      );
      expect(call).toBeDefined();
      expect(call[0].outcome).toBe('SUCCESS');
      expect(call[0].beforeData).toBeDefined();
      expect(call[0].afterData).toBeDefined();
      expect(call[0].approvalNo).toBe('APR-1');
      // INHERIT + 异步驱动：correlationId 原样继承事件的 traceId，causationId 指向触发它的审批单。
      expect(call[0].correlationId).toBe('trace-1');
      expect(call[0].causationId).toBe('apr-1');
    });

    it('marks FAILED 且 ADMIN_ROLE_CHANGE_APPLIED 改用 outcome=FAILED 记录（退役码 CHANGE_APPLY_FAILED 收编）', async () => {
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
        currentRoleCodes: '["COMPLIANCE_OFFICER"]',
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

      const call = auditLogsService.recordByActor.mock.calls.find(
        (c: any[]) => c[0].action === 'ADMIN_ROLE_CHANGE_APPLIED' && c[0].outcome === 'FAILED',
      );
      expect(call).toBeDefined();
      expect(call[0].beforeData).toBeDefined();
      expect(call[0].afterData).toBeDefined();
      expect(call[0].approvalNo).toBe('APR-1');
      expect(call[0].causationId).toBe('apr-1');
      // 铁律1·操作必留痕：非成功记录被合同闸(assertActionSpec)强制要求 reasonCode，
      // 漏带就会在运行时被拒收——状态已变但审计零留痕。这里断言调用入参真的带上了。
      expect(call[0].reasonCode).toBe('EXECUTION_FAILED');
    });
  });

  describe('handleApprovalDecided — DECLINED', () => {
    it('updates request status to REJECTED 并写 ADMIN_ROLE_CHANGE_CANCELLED', async () => {
      const event: ApprovalDecidedEvent = {
        decision: 'DECLINED',
        actionType: 'ADMIN_ROLE_BINDING_CHANGE_APPROVAL',
        entityRef: 'req-1',
        approvalId: 'apr-1',
        approvalNo: 'APR-1',
        traceId: 'trace-1',
        workflowType: 'ADMIN_ROLE_BINDING_CHANGE',
        decisionReason: 'Scope too broad',
        metadata: {},
      };

      prisma.adminRoleChangeRequest.findFirst.mockResolvedValue({
        id: 'req-1',
        requestNo: 'RCR-1',
        status: 'PENDING_APPROVAL',
      });

      await service.handleApprovalDecided(event);

      expect(prisma.adminRoleChangeRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'REJECTED' }),
        }),
      );

      const call = auditLogsService.recordByActor.mock.calls.find(
        (c: any[]) => c[0].action === 'ADMIN_ROLE_CHANGE_CANCELLED',
      );
      expect(call).toBeDefined();
      expect(call[0].reason).toBeTruthy();
      expect(call[0].correlationId).toBe('trace-1');
      expect(call[0].causationId).toBe('apr-1');
    });
  });

  describe('handleApprovalDecided — CANCELLED', () => {
    it('第一批 · 取消路径写 ADMIN_ROLE_CHANGE_CANCELLED（本轮新增码）', async () => {
      const event: ApprovalDecidedEvent = {
        decision: 'CANCELLED',
        actionType: 'ADMIN_ROLE_BINDING_CHANGE_APPROVAL',
        entityRef: 'req-1',
        approvalId: 'apr-1',
        approvalNo: 'APR-1',
        traceId: 'trace-1',
        workflowType: 'ADMIN_ROLE_BINDING_CHANGE',
        decisionReason: 'Requester withdrew the request',
        metadata: {},
      };

      prisma.adminRoleChangeRequest.findFirst.mockResolvedValue({
        id: 'req-1',
        requestNo: 'RCR-1',
        status: 'PENDING_APPROVAL',
      });

      await service.handleApprovalDecided(event);

      expect(prisma.adminRoleChangeRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'CANCELLED' }),
        }),
      );

      const call = auditLogsService.recordByActor.mock.calls.find(
        (c: any[]) => c[0].action === 'ADMIN_ROLE_CHANGE_CANCELLED',
      );
      expect(call).toBeDefined();
      expect(call[0].actionDomain).toBe('IAM');
      expect(call[0].reason).toBeTruthy();
      expect(call[0].reason).toBe('Requester withdrew the request');
    });
  });

  describe('handleApprovalDecided — EXPIRED', () => {
    it('updates request status to EXPIRED 并写 ADMIN_ROLE_CHANGE_CANCELLED', async () => {
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
        requestNo: 'RCR-1',
        status: 'PENDING_APPROVAL',
      });

      await service.handleApprovalDecided(event);

      expect(prisma.adminRoleChangeRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'EXPIRED' }),
        }),
      );

      const call = auditLogsService.recordByActor.mock.calls.find(
        (c: any[]) => c[0].action === 'ADMIN_ROLE_CHANGE_CANCELLED',
      );
      expect(call).toBeDefined();
      // 没传 decisionReason 时兜底文案仍要非空——CANCELLED 声明 reason 必填。
      expect(call[0].reason).toBeTruthy();
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
