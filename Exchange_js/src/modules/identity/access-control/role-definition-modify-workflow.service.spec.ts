import { RoleDefinitionModifyWorkflowService } from './role-definition-modify-workflow.service';

describe('RoleDefinitionModifyWorkflowService', () => {
  let prisma: any;
  let approvalsService: any;
  let auditLogsService: any;
  let service: RoleDefinitionModifyWorkflowService;

  const actor = {
    actorType: 'ADMIN' as const,
    userId: 'admin-1',
    userNo: 'USR-A001',
    role: 'SUPER_ADMIN',
    roleCodes: ['SUPER_ADMIN'],
  };

  const activeRole = {
    id: 'role-1',
    code: 'OPS_VIEWER',
    name: 'Ops Viewer',
    description: 'old desc',
    status: 'ACTIVE',
    rolePermissions: [{ permission: { code: 'api.get.auth_me' } }],
  };

  const buildDecidedEvent = (decision: string, traceId: string, decisionReason: string | null = null) => ({
    decision,
    actionType: 'ROLE_DEFINITION_MODIFY',
    entityRef: 'req-1',
    approvalId: 'apr-1',
    approvalNo: 'APR2608260002',
    traceId,
    workflowType: 'ROLE_DEFINITION_MODIFY',
    decisionByUserId: 'checker-1',
    decisionByUserNo: 'USR-C001',
    decisionByRole: 'CISO',
    decisionReason,
    metadata: {},
  });

  const buildRequestRow = (overrides: Partial<any> = {}) => ({
    id: 'req-1',
    requestNo: 'RDM-1',
    roleId: 'role-1',
    currentName: 'Ops Viewer',
    currentDescription: 'old desc',
    currentPermissionGroups: JSON.stringify(['BASE_ACCESS']),
    proposedName: 'Ops Viewer',
    proposedDescription: 'new desc',
    proposedPermissionGroups: JSON.stringify(['BASE_ACCESS', 'IAM_READ']),
    status: 'PENDING_APPROVAL',
    approvalCaseNo: 'APR2608260002',
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      role: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined),
      },
      roleDefinitionModifyRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        create: jest.fn((args: any) => Promise.resolve({ id: 'req-1', ...args.data })),
        update: jest.fn().mockResolvedValue(undefined),
        delete: jest.fn().mockResolvedValue(undefined),
      },
      permission: { findMany: jest.fn().mockResolvedValue([]) },
      rolePermission: {
        deleteMany: jest.fn().mockResolvedValue(undefined),
        createMany: jest.fn().mockResolvedValue(undefined),
      },
    };
    prisma.$transaction = jest.fn((fn: any) => fn(prisma));

    approvalsService = {
      createAndSubmit: jest.fn().mockResolvedValue({ id: 'apr-1', approvalNo: 'APR2608260002' }),
    };
    auditLogsService = {
      recordByActor: jest.fn().mockResolvedValue(undefined),
      recordSystem: jest.fn().mockResolvedValue(undefined),
    };
    service = new RoleDefinitionModifyWorkflowService(prisma, approvalsService, auditLogsService);
  });

  describe('第一批 · 角色定义修改 3 码', () => {
    it('发起写 REQUESTED(START)，beforeData/afterData 只含变更项', async () => {
      prisma.role.findUnique.mockResolvedValue(activeRole);

      await service.initiateModify(
        'role-1',
        {
          proposedName: 'Ops Viewer',
          proposedDescription: 'new desc',
          proposedPermissionGroups: ['BASE_ACCESS', 'IAM_READ'],
          changeReason: 'grant read access',
        },
        actor,
      );

      const call = auditLogsService.recordByActor.mock.calls.find(
        (c: any[]) => c[0].action === 'ROLE_DEFINITION_MODIFY_REQUESTED',
      );
      expect(call).toBeDefined();
      expect(call[0].actionDomain).toBe('CONFIG');
      // name 没变 —— 不该出现在 beforeData/afterData 里
      expect(call[0].beforeData).not.toHaveProperty('name');
      expect(call[0].afterData).not.toHaveProperty('name');
      // description 变了
      expect(call[0].beforeData.description).toBe('old desc');
      expect(call[0].afterData.description).toBe('new desc');
      // permissionGroups 变了
      expect(call[0].beforeData.permissionGroups).toEqual(['BASE_ACCESS']);
      expect(call[0].afterData.permissionGroups).toEqual(['BASE_ACCESS', 'IAM_READ']);
      expect(Object.keys(call[0].afterData)).not.toContain('updatedAt');
      expect(Object.keys(call[0].afterData)).not.toContain('status');
      expect(call[0].correlationId).toEqual(expect.any(String));
    });

    it('审批通过后写 APPLIED(INHERIT+因果)，beforeData/afterData 与 REQUESTED 口径一致', async () => {
      const request = buildRequestRow();
      prisma.roleDefinitionModifyRequest.findUnique.mockResolvedValue(request);
      prisma.role.findUnique.mockResolvedValue(activeRole);
      prisma.permission.findMany.mockResolvedValue([{ code: 'api.get.auth_me', id: 'perm-1' }]);

      await service.onDecided(buildDecidedEvent('APPROVED', 'trace-42'));

      const call = auditLogsService.recordSystem.mock.calls.find(
        (c: any[]) => c[0].action === 'ROLE_DEFINITION_MODIFY_APPLIED',
      );
      expect(call).toBeDefined();
      expect(call[0].correlationId).toBe('trace-42');
      expect(call[0].causationId).toBe('apr-1');
      expect(call[0].approvalNo).toBe('APR2608260002');
      expect(call[0].outcome).toBe('SUCCESS');
      expect(call[0].beforeData).not.toHaveProperty('name');
      expect(call[0].beforeData.description).toBe('old desc');
      expect(call[0].afterData.description).toBe('new desc');
      expect(call[0].beforeData.permissionGroups).toEqual(['BASE_ACCESS']);
      expect(call[0].afterData.permissionGroups).toEqual(['BASE_ACCESS', 'IAM_READ']);
    });

    it('冲突（角色已非 ACTIVE）时仍写同一个 APPLIED(outcome=FAILED)，不是退役码 ROLE_MODIFY_FAILED', async () => {
      const request = buildRequestRow();
      prisma.roleDefinitionModifyRequest.findUnique.mockResolvedValue(request);
      prisma.role.findUnique.mockResolvedValue({ ...activeRole, status: 'PENDING_APPROVAL' });

      await service.onDecided(buildDecidedEvent('APPROVED', 'trace-42'));

      const applied = auditLogsService.recordSystem.mock.calls.filter(
        (c: any[]) => c[0].action === 'ROLE_DEFINITION_MODIFY_APPLIED',
      );
      expect(applied).toHaveLength(1);
      expect(applied[0][0].outcome).toBe('FAILED');
      expect(applied[0][0].causationId).toBe('apr-1');
      expect(applied[0][0].correlationId).toBe('trace-42');
      expect(applied[0][0].beforeData.permissionGroups).toEqual(['BASE_ACCESS']);
      expect(applied[0][0].afterData.permissionGroups).toEqual(['BASE_ACCESS', 'IAM_READ']);
      expect(applied[0][0].approvalNo).toBe('APR2608260002');

      // 只断言"退役码不再被当作 action 值写入"，不是整份源码都不能出现这个词——
      // 迁移注释里如实提到旧码名是刻意保留的历史留痕（同 Task 5-7 的注释惯例）。
      const src = require('fs').readFileSync(
        'src/modules/identity/access-control/role-definition-modify-workflow.service.ts',
        'utf8',
      );
      expect(src).not.toMatch(/action:\s*['"]ROLE_MODIFY_FAILED['"]/);
    });

    it('驳回/取消/超时写 CANCELLED(INHERIT+因果)', async () => {
      const request = buildRequestRow();
      prisma.roleDefinitionModifyRequest.findUnique.mockResolvedValue(request);

      await service.onDecided(buildDecidedEvent('DECLINED', 'trace-88', 'checker rejected'));

      const call = auditLogsService.recordSystem.mock.calls.find(
        (c: any[]) => c[0].action === 'ROLE_DEFINITION_MODIFY_CANCELLED',
      );
      expect(call).toBeDefined();
      expect(call[0].correlationId).toBe('trace-88');
      expect(call[0].causationId).toBe('apr-1');
      expect(call[0].reason).toBe('checker rejected');
    });
  });
});
