import { BadRequestException } from '@nestjs/common';
import { RoleDefinitionCreateWorkflowService } from './role-definition-create-workflow.service';

describe('RoleDefinitionCreateWorkflowService', () => {
  let prisma: any;
  let approvalsService: any;
  let auditLogsService: any;
  let service: RoleDefinitionCreateWorkflowService;

  const actor = {
    actorType: 'ADMIN' as const,
    userId: 'admin-1',
    userNo: 'USR-A001',
    role: 'SUPER_ADMIN',
    roleCodes: ['SUPER_ADMIN'],
  };

  const buildDecidedEvent = (decision: string, traceId: string) => ({
    decision,
    actionType: 'ROLE_DEFINITION_CREATE',
    entityRef: 'role-1',
    approvalId: 'apr-1',
    approvalNo: 'APR2608260001',
    traceId,
    workflowType: 'ROLE_DEFINITION_CREATE',
    decisionByUserId: 'checker-1',
    decisionByUserNo: 'USR-C001',
    decisionByRole: 'CISO',
    decisionReason: null as string | null,
    metadata: {},
  });

  beforeEach(() => {
    prisma = {
      role: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined),
        delete: jest.fn().mockResolvedValue(undefined),
      },
      permission: { findMany: jest.fn().mockResolvedValue([]) },
      rolePermission: { createMany: jest.fn().mockResolvedValue(undefined) },
    };
    approvalsService = {
      createAndSubmit: jest.fn().mockResolvedValue({ id: 'apr-1', approvalNo: 'APR2608260001' }),
    };
    auditLogsService = {
      recordByActor: jest.fn().mockResolvedValue(undefined),
      recordSystem: jest.fn().mockResolvedValue(undefined),
    };
    service = new RoleDefinitionCreateWorkflowService(prisma, approvalsService, auditLogsService);
  });

  describe('第一批 · 角色定义创建 3 码', () => {
    it('发起写 REQUESTED(START)，afterData 是提案身份且不含机械字段', async () => {
      prisma.role.findUnique.mockResolvedValue(null);
      prisma.role.create.mockResolvedValue({ id: 'role-1', code: 'OPS_VIEWER' });

      await service.initiateCreate(
        {
          roleCode: 'OPS_VIEWER',
          roleName: 'Ops Viewer',
          permissionGroupCodes: ['BASE_ACCESS'],
          changeReason: 'new team',
        },
        actor,
      );

      const call = auditLogsService.recordByActor.mock.calls.find(
        (c: any[]) => c[0].action === 'ROLE_DEFINITION_CREATE_REQUESTED',
      );
      expect(call).toBeDefined();
      expect(call[0].actionDomain).toBe('CONFIG');
      expect(call[0].primarySubjectType).toBe('ACCESS_CONTROL');
      expect(call[0].primarySubjectNo).toBe('OPS_VIEWER');
      expect(call[0].afterData).toEqual({
        roleName: 'Ops Viewer',
        description: null,
        permissionGroupCodes: ['BASE_ACCESS'],
      });
      expect(Object.keys(call[0].afterData)).not.toContain('updatedAt');
      expect(Object.keys(call[0].afterData)).not.toContain('status');
      expect(call[0].beforeData).toBeUndefined();
      expect(call[0].correlationId).toEqual(expect.any(String));
      expect(call[0].correlationId).not.toHaveLength(0);
    });

    it('审批通过后写 APPLIED(INHERIT+因果)，correlationId/causationId/approvalNo 正确传播', async () => {
      prisma.role.findUnique.mockResolvedValue({
        id: 'role-1',
        code: 'OPS_VIEWER',
        status: 'PENDING_APPROVAL',
        proposedPermissionGroups: JSON.stringify(['BASE_ACCESS']),
      });

      await service.onDecided(buildDecidedEvent('APPROVED', 'trace-99'));

      const call = auditLogsService.recordSystem.mock.calls.find(
        (c: any[]) => c[0].action === 'ROLE_DEFINITION_CREATE_APPLIED',
      );
      expect(call).toBeDefined();
      expect(call[0].correlationId).toBe('trace-99');
      expect(call[0].causationId).toBe('apr-1');
      expect(call[0].approvalNo).toBe('APR2608260001');
      expect(call[0].afterData).toEqual({ permissionGroupCodes: ['BASE_ACCESS'] });
      expect(call[0].outcome).toBe('SUCCESS');
    });

    it('激活失败仍写同一个 APPLIED(outcome=FAILED)，不是退役码 ROLE_ACTIVATE_FAILED', async () => {
      prisma.role.findUnique.mockResolvedValue({
        id: 'role-1',
        code: 'OPS_VIEWER',
        status: 'PENDING_APPROVAL',
        proposedPermissionGroups: JSON.stringify(['BASE_ACCESS']),
      });
      prisma.permission.findMany.mockRejectedValue(new Error('db down'));

      await service.onDecided(buildDecidedEvent('APPROVED', 'trace-99'));

      const applied = auditLogsService.recordSystem.mock.calls.filter(
        (c: any[]) => c[0].action === 'ROLE_DEFINITION_CREATE_APPLIED',
      );
      expect(applied).toHaveLength(1);
      expect(applied[0][0].outcome).toBe('FAILED');
      expect(applied[0][0].causationId).toBe('apr-1');
      expect(applied[0][0].afterData).toEqual({ permissionGroupCodes: ['BASE_ACCESS'] });
      // 铁律1·操作必留痕：非成功记录被合同闸(assertActionSpec)强制要求 reasonCode，
      // 漏带就会在运行时被拒收——状态已变但审计零留痕。这里断言调用入参真的带上了。
      expect(applied[0][0].reasonCode).toBe('EXECUTION_FAILED');

      // 只断言"退役码不再被当作 action 值写入"，不是整份源码都不能出现这个词——
      // 迁移注释里如实提到旧码名是刻意保留的历史留痕（同 Task 5-7 的注释惯例）。
      const src = require('fs').readFileSync(
        'src/modules/identity/access-control/role-definition-create-workflow.service.ts',
        'utf8',
      );
      expect(src).not.toMatch(/action:\s*['"]ROLE_ACTIVATE_FAILED['"]/);
    });

    it('驳回/取消/超时写 CANCELLED(INHERIT+因果，新增码)', async () => {
      prisma.role.findUnique.mockResolvedValue({ id: 'role-1', code: 'OPS_VIEWER' });

      await service.onDecided(buildDecidedEvent('DECLINED', 'trace-77'));

      const call = auditLogsService.recordSystem.mock.calls.find(
        (c: any[]) => c[0].action === 'ROLE_DEFINITION_CREATE_CANCELLED',
      );
      expect(call).toBeDefined();
      expect(call[0].correlationId).toBe('trace-77');
      expect(call[0].causationId).toBe('apr-1');
      expect(call[0].reason).toBeTruthy();
    });
  });
});
