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
    proposedPermissionGroups: JSON.stringify(['BASE_ACCESS', 'IAM_MEMBER_READ']),
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
          proposedPermissionGroups: ['BASE_ACCESS', 'IAM_MEMBER_READ'],
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
      expect(call[0].afterData.permissionGroups).toEqual(['BASE_ACCESS', 'IAM_MEMBER_READ']);
      expect(Object.keys(call[0].afterData)).not.toContain('updatedAt');
      expect(Object.keys(call[0].afterData)).not.toContain('status');
      expect(call[0].correlationId).toEqual(expect.any(String));
      // 主体号同轴：PRIMARY 是 requestNo（已在 primarySubjectNo 上），被修改的角色本身
      // 补一行 RELATED——不重复传 PRIMARY。
      expect(call[0].subjects).toEqual([
        { subjectType: 'ACCESS_CONTROL', subjectNo: 'OPS_VIEWER', subjectRole: 'RELATED' },
      ]);
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
      expect(call[0].afterData.permissionGroups).toEqual(['BASE_ACCESS', 'IAM_MEMBER_READ']);
      expect(call[0].subjects).toEqual([
        { subjectType: 'ACCESS_CONTROL', subjectNo: 'OPS_VIEWER', subjectRole: 'RELATED' },
      ]);
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
      expect(applied[0][0].afterData.permissionGroups).toEqual(['BASE_ACCESS', 'IAM_MEMBER_READ']);
      expect(applied[0][0].approvalNo).toBe('APR2608260002');
      // 铁律1·操作必留痕：非成功记录被合同闸(assertActionSpec)强制要求 reasonCode，
      // 漏带就会在运行时被拒收——状态已变但审计零留痕。角色未激活分支用通用码。
      expect(applied[0][0].reasonCode).toBe('EXECUTION_FAILED');
      expect(applied[0][0].subjects).toEqual([
        { subjectType: 'ACCESS_CONTROL', subjectNo: 'OPS_VIEWER', subjectRole: 'RELATED' },
      ]);
    });

    it('冲突（权限已变更）时同样写 APPLIED(outcome=FAILED)，reasonCode=ROLE_CONFLICT 与角色未激活分支区分', async () => {
      const request = buildRequestRow();
      prisma.roleDefinitionModifyRequest.findUnique.mockResolvedValue(request);
      // role 本身是 ACTIVE（不落入"未激活"分支），但当前权限（空）与请求发起时的快照
      // (['BASE_ACCESS']) 不一致 —— 命中互斥冲突检测分支，不是同一条判定路径。
      prisma.role.findUnique.mockResolvedValue({ ...activeRole, rolePermissions: [] });

      await service.onDecided(buildDecidedEvent('APPROVED', 'trace-42'));

      const applied = auditLogsService.recordSystem.mock.calls.filter(
        (c: any[]) => c[0].action === 'ROLE_DEFINITION_MODIFY_APPLIED',
      );
      expect(applied).toHaveLength(1);
      expect(applied[0][0].outcome).toBe('FAILED');
      expect(applied[0][0].reason).toMatch(/^Conflict:/);
      expect(applied[0][0].reasonCode).toBe('ROLE_CONFLICT');
      expect(applied[0][0].subjects).toEqual([
        { subjectType: 'ACCESS_CONTROL', subjectNo: 'OPS_VIEWER', subjectRole: 'RELATED' },
      ]);
    });

    it('驳回/取消/超时写 CANCELLED(INHERIT+因果)', async () => {
      const request = buildRequestRow({ role: { code: 'OPS_VIEWER' } });
      prisma.roleDefinitionModifyRequest.findUnique.mockResolvedValue(request);

      await service.onDecided(buildDecidedEvent('DECLINED', 'trace-88', 'checker rejected'));

      const call = auditLogsService.recordSystem.mock.calls.find(
        (c: any[]) => c[0].action === 'ROLE_DEFINITION_MODIFY_CANCELLED',
      );
      expect(call).toBeDefined();
      expect(call[0].correlationId).toBe('trace-88');
      expect(call[0].causationId).toBe('apr-1');
      expect(call[0].reason).toBe('checker rejected');
      expect(call[0].subjects).toEqual([
        { subjectType: 'ACCESS_CONTROL', subjectNo: 'OPS_VIEWER', subjectRole: 'RELATED' },
      ]);
    });

    it('驳回一张修改申请后，单据状态是 REJECTED 而不是 CANCELLED（法二·修边）', async () => {
      const request = buildRequestRow({ role: { code: 'OPS_VIEWER' } });
      prisma.roleDefinitionModifyRequest.findUnique.mockResolvedValue(request);

      await service.onDecided(buildDecidedEvent('DECLINED', 'trace-88', 'checker rejected'));

      // 审批 handler 发的驳回信号是 'DECLINED'（approval-handler.base.ts），此前这里
      // 恒比对永不出现的 'REJECTED' 字面量，三种终止原因全落 CANCELLED——REJECTED
      // 态从建成起不可达。经迁移表显式映射后，DECLINED 必须落 REJECTED。
      expect(prisma.roleDefinitionModifyRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'req-1' },
          data: expect.objectContaining({ status: 'REJECTED' }),
        }),
      );
    });

    it('落地失败的修改申请状态是 FAILED，不再是 APPROVED+failureReason（法二·拆态）', async () => {
      const request = buildRequestRow();
      prisma.roleDefinitionModifyRequest.findUnique.mockResolvedValue(request);
      // role 本身非 ACTIVE——命中"角色未激活"分支，驱动 failRequest 路径。
      prisma.role.findUnique.mockResolvedValue({ ...activeRole, status: 'PENDING_APPROVAL' });

      await service.onDecided(buildDecidedEvent('APPROVED', 'trace-42'));

      // 落地失败此前把 status 写成 'APPROVED'（借 failureReason 字段表达"其实失败了"），
      // 与真正审批通过的终态无法区分。经迁移表 FAIL 动作后必须落独立的 FAILED 态。
      expect(prisma.roleDefinitionModifyRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'req-1' },
          data: expect.objectContaining({
            status: 'FAILED',
            failureReason: expect.any(String),
          }),
        }),
      );
    });
  });
});
