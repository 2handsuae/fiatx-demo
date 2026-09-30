import { InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { AuditLogsService } from './audit-logs.service';
import {
  AuditOutcome,
  AuditSubjectRole,
  AuditCategory,
} from './dto/audit-log.dto';
import {
  AuditActions,
  AuditEntityTypes,
  AuditBusinessWorkflowTypes,
  AuditUserActions,
  mapRawAuditActionToUserAction,
} from './constants/audit-actions.constant';

/** 行为化 findMany mock：按 where 的 {field:{in:[...]}}、等值与 {OR:[...]} 真过滤——
 * 杜绝"mock 无视 where 直接吐行"的假绿(波一测试反转,2026-09-15)。 */
const mockFindManyByWhere = (rows: any[]) =>
  jest.fn(async (args: any = {}) => {
    const matches = (row: any, where: any): boolean => {
      if (!where) return true;
      if (Array.isArray(where.OR)) return where.OR.some((w: any) => matches(row, w));
      return Object.entries(where).every(([field, cond]: [string, any]) =>
        cond && typeof cond === 'object' && Array.isArray(cond.in)
          ? cond.in.includes(row[field])
          : row[field] === cond,
      );
    };
    return rows.filter((row) => matches(row, args.where));
  });

describe('AuditLogsService', () => {
  let service: AuditLogsService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      auditLogEvent: {
        create: jest.fn(),
        count: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
    auditEvidencePackage: {
      create: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      },
      depositTransaction: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      withdrawTransaction: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      swapTransaction: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      swapQuote: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
    };

    service = new AuditLogsService(prisma);
    jest.clearAllMocks();
  });

  it('should freeze Wave 1 business workflow taxonomy and user-action vocabulary', () => {
    expect(AuditBusinessWorkflowTypes).toEqual({
      ADMIN_LOGIN_ACCESS: 'ADMIN_LOGIN_ACCESS',
      ADMIN_ROLE_BINDING_CHANGE: 'ADMIN_ROLE_BINDING_CHANGE',
      AUDIT_EVIDENCE_EXPORT: 'AUDIT_EVIDENCE_EXPORT',
      ADMIN_INVITE: 'ADMIN_INVITE',
      ADMIN_SUSPENSION: 'ADMIN_SUSPENSION',
      ADMIN_REACTIVATION: 'ADMIN_REACTIVATION',
      ADMIN_FIRST_LOGIN: 'ADMIN_FIRST_LOGIN',
      APPROVAL_POLICY: 'APPROVAL_POLICY',
      ROLE_DEFINITION_CREATE: 'ROLE_DEFINITION_CREATE',
      ROLE_DEFINITION_MODIFY: 'ROLE_DEFINITION_MODIFY',
      ADMIN_PASSWORD_RESET: 'ADMIN_PASSWORD_RESET',
      ADMIN_MFA_RESET: 'ADMIN_MFA_RESET',
      WITHDRAWAL_ADDRESS_REGISTRATION: 'WITHDRAWAL_ADDRESS_REGISTRATION',
      TB_ACCOUNT_MANUAL_CREATE: 'TB_ACCOUNT_MANUAL_CREATE',
      TRADING_TIER_UPGRADE: 'TRADING_TIER_UPGRADE',
      TRANSACTION_LIMIT_CHANGE: 'TRANSACTION_LIMIT_CHANGE',
      TRANSACTION_LIMIT_ENFORCEMENT: 'TRANSACTION_LIMIT_ENFORCEMENT',
      DEPOSIT_CONFISCATION: 'DEPOSIT_CONFISCATION',
      DEPOSIT_RETURN: 'DEPOSIT_RETURN',
      DEPOSIT_SEIZE: 'DEPOSIT_SEIZE',
      DEPOSIT_UNFREEZE: 'DEPOSIT_UNFREEZE',
      // 平账 B 批（2026-09-03）：补单三入口
      DEPOSIT_SUPPLEMENT: 'DEPOSIT_SUPPLEMENT',
      DEPOSIT_CLAWBACK: 'DEPOSIT_CLAWBACK',
      WITHDRAWAL_FEE_LEVEL_CREATION: 'WITHDRAWAL_FEE_LEVEL_CREATION',
      WITHDRAWAL_FEE_LEVEL_CHANGE: 'WITHDRAWAL_FEE_LEVEL_CHANGE',
      WITHDRAWAL_FEE_LEVEL_RETIRE: 'WITHDRAWAL_FEE_LEVEL_RETIRE',
      ASSET_SUSPENSION: 'ASSET_SUSPENSION',
      ASSET_REACTIVATION: 'ASSET_REACTIVATION',
      SWAP_FEE_LEVEL_CREATION: 'SWAP_FEE_LEVEL_CREATION',
      SWAP_FEE_LEVEL_CHANGE: 'SWAP_FEE_LEVEL_CHANGE',
      SWAP_FEE_LEVEL_RETIRE: 'SWAP_FEE_LEVEL_RETIRE',
      WITHDRAW_LARGE_VALUE_APPROVAL: 'WITHDRAW_LARGE_VALUE_APPROVAL',
      WITHDRAW_UNFREEZE: 'WITHDRAW_UNFREEZE',
      WITHDRAW_SANCTION_REFUND: 'WITHDRAW_SANCTION_REFUND',
      // Swap FROZEN Unfreeze/Sanction-Refund（波五 Task 3，2026-09-14）
      SWAP_UNFREEZE: 'SWAP_UNFREEZE',
      SWAP_SANCTION_REFUND: 'SWAP_SANCTION_REFUND',
      // 平账 B 批（2026-09-03）：出款后被银行退回的认领
      WITHDRAW_RETURN_CLAIM: 'WITHDRAW_RETURN_CLAIM',
      INTERNAL_TRANSFER: 'INTERNAL_TRANSFER',
      CUSTOMER_TAG: 'CUSTOMER_TAG',
      // Task 10：限制账「贴/撕便签」两侧审计共用这一条 workflowType。
      // 本清单是守则性冻结表 —— 新增 workflow 必须在此登记，防不经审视地扩表。
      CUSTOMER_RESTRICTION_RELEASE: 'CUSTOMER_RESTRICTION_RELEASE',
      // Task 2（material-request-ledger, 2026-08-17）：向客户要材料
      MATERIAL_REQUEST: 'MATERIAL_REQUEST',
      V8_RECONCILIATION: 'clearing-settle/reconciliation',
      // 平账三期（2026-09-06）：事故登记
      INCIDENT: 'INCIDENT',
      // 入驻波二（2026-09-07）：客户接受声明 maker-checker
      CUSTOMER_ONBOARDING_ACCEPTANCE: 'CUSTOMER_ONBOARDING_ACCEPTANCE',
      // 档位升级波三（2026-09-07）：BASIC→PREMIUM 档位升级 maker-checker
      CUSTOMER_TIER_UPGRADE: 'CUSTOMER_TIER_UPGRADE',
      // 战役甲波二（2026-09-26）：报送台骨架
      REGULATORY_FILING: 'REGULATORY_FILING',
      // 战役甲波三 T4（2026-09-26）：制裁定性裁决——常量早已存在，本清单当时漏登记，
      // 该断言自波三合入起即红；随波四 T2 回归复跑 `src/modules/audit-logging` 全量
      // 测试时发现并补齐（与波四 T2 本身的改动无关，独立修复）。
      SANCTION_DISPOSITION: 'SANCTION_DISPOSITION',
      // 战役甲波四 T2（2026-09-27）：合规办公室义务主体
      COMPLIANCE_OBLIGATION: 'COMPLIANCE_OBLIGATION',
      // 战役甲波四 T4（2026-09-27）：合规办公室两本登记册
      OUTSOURCING_VENDOR: 'OUTSOURCING_VENDOR',
      RESPONSIBLE_INDIVIDUAL: 'RESPONSIBLE_INDIVIDUAL',
      // 战役甲波五 T2（2026-09-28）：投诉主体
      COMPLAINT: 'COMPLAINT',
      // 战役乙波一 T2（2026-09-29）：LP 档案主体
      LP_PROFILE: 'LP_PROFILE',
      // 战役乙波一 T4（2026-09-29）：LP 兑换单主体
      LP_EXCHANGE: 'LP_EXCHANGE',
      // 战役乙波二 T2（2026-09-29）：注资单主体
      CAPITAL_INJECTION: 'CAPITAL_INJECTION',
      // 战役乙波二 T4（2026-09-29）：付款单主体
      VENDOR_PAYMENT: 'VENDOR_PAYMENT',
      // 战役乙波三 T1（2026-09-30）：审慎（NLA）状态主体
      PRUDENTIAL: 'PRUDENTIAL',
    });

    expect(AuditUserActions).toEqual({
      REQUEST_CREATED: 'REQUEST_CREATED',
      SUBMITTED: 'SUBMITTED',
    });
  });

  it('should map raw technical audit actions to user-layer actions', () => {
    expect(mapRawAuditActionToUserAction(AuditActions.APPROVAL_SUBMITTED)).toBe(
      AuditUserActions.SUBMITTED,
    );
    expect(
      mapRawAuditActionToUserAction(AuditActions.AUDIT_EVIDENCE_EXPORT_REQUESTED),
    ).toBe(AuditUserActions.REQUEST_CREATED);
    expect(mapRawAuditActionToUserAction('UNKNOWN_WAVE1_ACTION')).toBeUndefined();
  });


  it('should map evidence export request actions to the user-layer action (workflow derivation retired)', async () => {
    prisma.auditLogEvent.count.mockResolvedValue(1);
    prisma.auditLogEvent.findMany.mockResolvedValue([
      {
        id: 'wf-exp-req-1',
        auditNo: 'AUD2604051001',
        action: AuditActions.AUDIT_EVIDENCE_EXPORT_REQUESTED,
        actorType: 'ADMIN',
        actorNo: 'ADMIN-001',
        outcome: AuditOutcome.SUCCESS,
        metadata: null,
        beforeData: null,
        afterData: null,
        occurredAt: new Date('2026-04-05T10:00:00.000Z'),
      },
    ]);

    const result = await service.findAll({ take: 20 });

    expect(result.items[0]).toMatchObject({
      userAction: AuditUserActions.REQUEST_CREATED,
      userActionLabel: 'Request Created',
    });
    expect(result.items[0]).not.toHaveProperty('businessWorkflow');
    expect(result.items[0]).not.toHaveProperty('workflowType');
  });





  it('should mask sourceIp and generate payloadDigest', async () => {
    prisma.auditLogEvent.findUnique.mockResolvedValue(null);
    prisma.auditLogEvent.create.mockImplementation(({ data }: any) =>
      Promise.resolve({
        id: 'a2',
        auditNo: 'AUD2602180002',
        ...data,
      }),
    );

    const result = await service.recordByActor(
      {
        action: 'WITHDRAW_PAYOUT_PENDING_TO_SUCCESS',
        primarySubjectType: AuditEntityTypes.WITHDRAW_TRANSACTION,
        primarySubjectNo: 'wd-1',
        sourceIp: '192.168.8.50',
      } as any,
      {
        actorType: 'ADMIN',
        actorNo: 'admin-2',
        actorDisplayName: 'admin-2',
      } as any,
    );

    expect(result.sourceIp).toBe('192.168.8.0');
    expect(result.payloadDigest).toHaveLength(64);
  });

  it('should generate stable payloadDigest for semantically equal payloads', async () => {
    prisma.auditLogEvent.findUnique.mockResolvedValue(null);
    prisma.auditLogEvent.create.mockImplementation(({ data }: any) =>
      Promise.resolve({
        id: `d-${Math.random()}`,
        auditNo: `AUD-${Math.random()}`,
        ...data,
      }),
    );

    await service.recordByActor(
      {
        idempotencyKey: 'digest-test-1',
        action: 'WITHDRAW_METADATA_UPDATED',
        primarySubjectType: AuditEntityTypes.WITHDRAW_TRANSACTION,
        primarySubjectNo: 'wd-2',
        metadata: { b: 2, a: 1 },
        occurredAt: '2026-02-18T10:00:00.000Z',
      } as any,
      {
        actorType: 'ADMIN',
        actorNo: 'admin-7',
        actorDisplayName: 'admin-7',
      } as any,
    );

    await service.recordByActor(
      {
        idempotencyKey: 'digest-test-2',
        action: 'WITHDRAW_METADATA_UPDATED',
        primarySubjectType: AuditEntityTypes.WITHDRAW_TRANSACTION,
        primarySubjectNo: 'wd-2',
        metadata: { a: 1, b: 2 },
        occurredAt: '2026-02-18T10:00:00.000Z',
      } as any,
      {
        actorType: 'ADMIN',
        actorNo: 'admin-7',
        actorDisplayName: 'admin-7',
      } as any,
    );

    const firstDigest = prisma.auditLogEvent.create.mock.calls[0][0].data.payloadDigest;
    const secondDigest = prisma.auditLogEvent.create.mock.calls[1][0].data.payloadDigest;
    expect(firstDigest).toBe(secondDigest);
  });

  it('should be idempotent when idempotency key is duplicated', async () => {
    prisma.auditLogEvent.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'a-existing',
        auditNo: 'AUD_EXIST',
        metadata: null,
        beforeData: null,
        afterData: null,
      });

    prisma.auditLogEvent.create.mockImplementationOnce(({ data }: any) =>
      Promise.resolve({
        id: 'a-new',
        auditNo: 'AUD_NEW',
        ...data,
      }),
    );

    const first = await service.recordByActor(
      {
        idempotencyKey: 'fixed-key-1',
        action: 'SYSTEM_RECONCILE_EXECUTED',
        primarySubjectType: 'SYSTEM_TASK',
        primarySubjectNo: 'task-1',
      } as any,
      {
        actorType: 'SYSTEM',
        actorNo: 'SYSTEM',
        actorDisplayName: 'SYSTEM',
      } as any,
    );

    const second = await service.recordByActor(
      {
        idempotencyKey: 'fixed-key-1',
        action: 'SYSTEM_RECONCILE_EXECUTED',
        primarySubjectType: 'SYSTEM_TASK',
        primarySubjectNo: 'task-1',
      } as any,
      {
        actorType: 'SYSTEM',
        actorNo: 'SYSTEM',
        actorDisplayName: 'SYSTEM',
      } as any,
    );

    expect(first.id).toBe('a-new');
    expect(second.id).toBe('a-existing');
    expect(prisma.auditLogEvent.create).toHaveBeenCalledTimes(1);
  });

  it('should list audit logs and parse json payload fields', async () => {
    prisma.auditLogEvent.count.mockResolvedValue(1);
    prisma.auditLogEvent.findMany.mockResolvedValue([
      {
        id: 'a3',
        auditNo: 'AUD2602180003',
        action: 'WITHDRAW_UPDATED',
        actorType: 'ADMIN',
        outcome: AuditOutcome.SUCCESS,
        metadata: JSON.stringify({ source: 'api' }),
        beforeData: JSON.stringify({ status: 'CREATED' }),
        afterData: JSON.stringify({ status: 'SUCCESS' }),
        occurredAt: new Date('2026-02-18T10:00:00.000Z'),
        dbOnlyShadowField: 'should-not-leak',
      },
    ]);

    const result = await service.findAll({ take: 20 });

    expect(result.total).toBe(1);
    expect(result.items[0].metadata).toEqual({ source: 'api' });
    expect(result.items[0]).not.toHaveProperty('dbOnlyShadowField');
    expect(result.items[0].beforeData).toEqual({ status: 'CREATED' });
    expect(result.items[0].afterData).toEqual({ status: 'SUCCESS' });
  });

  it('should pass through group-G/H columns (state transition, money, authorization basis)', async () => {
    prisma.auditLogEvent.count.mockResolvedValue(1);
    prisma.auditLogEvent.findMany.mockResolvedValue([
      {
        id: 'gh-1',
        auditNo: 'AUD2604010001',
        action: AuditActions.APPROVAL_SUBMITTED,
        actorType: 'ADMIN',
        outcome: AuditOutcome.SUCCESS,
        category: 'BUSINESS',
        actionDomain: 'DEPOSIT',
        fromStatus: 'COMPLIANCE_PENDING',
        toStatus: 'SUCCESS',
        amount: '2000',
        currency: 'AED',
        approvalNo: 'APR2609160001',
        policyCode: 'DEPOSIT_SEIZE',
        policyVersion: 3,
        metadata: null,
        beforeData: null,
        afterData: null,
        occurredAt: new Date('2026-04-01T10:00:00.000Z'),
      },
    ]);

    const result = await service.findAll({ take: 20 });

    expect(result.items[0]).toMatchObject({
      category: 'BUSINESS',
      actionDomain: 'DEPOSIT',
      fromStatus: 'COMPLIANCE_PENDING',
      toStatus: 'SUCCESS',
      amount: '2000',
      currency: 'AED',
      approvalNo: 'APR2609160001',
      policyCode: 'DEPOSIT_SEIZE',
      policyVersion: 3,
      userAction: AuditUserActions.SUBMITTED,
      userActionLabel: 'Submitted',
    });
  });


  it('should expose the same aligned shape on detail as on list', async () => {
    prisma.auditLogEvent.findUnique.mockResolvedValue({
      id: 'detail-1',
      auditNo: 'AUD2604010100',
      action: AuditActions.APPROVAL_SUBMITTED,
      traceId: 'trace-role-binding-1',
      actionDomain: 'APPROVAL',
      category: 'GOVERNANCE',
      approvalNo: 'APR2604010001',
      actorType: 'ADMIN',
      outcome: AuditOutcome.SUCCESS,
      metadata: null,
      beforeData: null,
      afterData: null,
      occurredAt: new Date('2026-04-01T12:00:00.000Z'),
    });

    const result = await service.findOne('detail-1');

    expect(result).toMatchObject({
      userAction: AuditUserActions.SUBMITTED,
      userActionLabel: 'Submitted',
      action: AuditActions.APPROVAL_SUBMITTED,
      actionDomain: 'APPROVAL',
      category: 'GOVERNANCE',
      approvalNo: 'APR2604010001',
      traceId: 'trace-role-binding-1',
    });
    expect(result).not.toHaveProperty('businessWorkflowLabel');
  });

  it('should build time-window and keyword filters correctly', async () => {
    prisma.auditLogEvent.count.mockResolvedValue(0);
    prisma.auditLogEvent.findMany.mockResolvedValue([]);

    await service.findAll({
      startAt: '2026-02-18T00:00:00.000Z',
      endAt: '2026-02-18T23:59:59.999Z',
      keyword: 'WITHDRAW',
      includeArchived: false,
      take: 20,
    });

    const where = prisma.auditLogEvent.count.mock.calls[0][0].where;
    expect(where.deletedAt).toBeUndefined();
    expect(where.AND).toEqual(
      expect.arrayContaining([
        { archivedAt: null },
        {
          occurredAt: expect.objectContaining({
            gte: new Date('2026-02-18T00:00:00.000Z'),
            lte: new Date('2026-02-18T23:59:59.999Z'),
          }),
        },
        {
          OR: expect.arrayContaining([
            { action: { contains: 'WITHDRAW' } },
            { reason: { contains: 'WITHDRAW' } },
          ]),
        },
      ]),
    );
  });

  it('should filter SWAP audit rows by workflowType without cross-trace expansion', async () => {
    prisma.auditLogEvent.count.mockResolvedValue(0);
    prisma.auditLogEvent.findMany.mockResolvedValue([]);

    await service.findAll({
      workflowType: 'SWAP',
      take: 20,
    });

    const where = prisma.auditLogEvent.count.mock.calls[0][0].where;
    expect(where.AND).toEqual([
      { workflowType: 'SWAP' },
      { archivedAt: null },
    ]);
    // SWAP expansion helper is removed; queries use workflowType filter only
    expect(prisma.swapTransaction.findMany).not.toHaveBeenCalled();
  });

  it('should throw when audit log detail is missing', async () => {
    prisma.auditLogEvent.findUnique.mockResolvedValue(null);

    await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
  });

  it('finds audit log detail by eventNo (business key, 铁律⑥)', async () => {
    prisma.auditLogEvent.findUnique.mockResolvedValue(null);
    await service.findOne('AUD2603240001').catch(() => undefined);
    expect(prisma.auditLogEvent.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { eventNo: 'AUD2603240001' } }),
    );
  });

  it('should list and parse persisted evidence packages', async () => {
    prisma.auditEvidencePackage.count.mockResolvedValue(1);
    prisma.auditEvidencePackage.findMany.mockResolvedValue([
      {
        id: 'pkg-1',
        packageNo: 'EVP2603010001',
        status: 'READY',
        exportMode: 'SELECTION',
        fileName: 'EVP2603010001.json',
        filterSnapshot: JSON.stringify({ workflowType: 'DEPOSIT' }),
        selectedEventIdsSnapshot: JSON.stringify(['a1', 'a2']),
        itemCount: 2,
        digest: 'd'.repeat(64),
        manifest: JSON.stringify({ version: '1.0' }),
        packageBody: JSON.stringify({ digest: 'd'.repeat(64) }),
        exportedByType: 'ADMIN',
        exportedById: 'admin-1',
        createdAt: new Date('2026-03-01T10:00:00.000Z'),
        updatedAt: new Date('2026-03-01T10:00:00.000Z'),
      },
    ]);

    const result = await service.findEvidencePackages({ take: 20 });

    expect(prisma.auditEvidencePackage.count).toHaveBeenCalledWith({
      where: { deletedAt: null },
    });
    expect(prisma.auditEvidencePackage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deletedAt: null },
      }),
    );
    expect(result.total).toBe(1);
    expect(result.items[0].filterSnapshot).toEqual({ workflowType: 'DEPOSIT' });
    expect(result.items[0].selectedEventIdsSnapshot).toEqual(['a1', 'a2']);
    expect(result.items[0].manifest).toEqual({ version: '1.0' });
  });

  it('should reject soft-deleted evidence packages on detail and download', async () => {
    prisma.auditEvidencePackage.findUnique.mockResolvedValue({
      id: 'pkg-deleted',
      packageNo: 'EVP2603010999',
      deletedAt: new Date('2026-03-01T11:00:00.000Z'),
    });

    await expect(service.findEvidencePackage('pkg-deleted')).rejects.toThrow(NotFoundException);
    await expect(service.downloadEvidencePackage('pkg-deleted')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('finds evidence package by packageNo (business key, 铁律⑥)', async () => {
    prisma.auditEvidencePackage.findUnique.mockResolvedValue(null);
    // brief 给的示例代码此行无 .catch()；findEvidencePackage 在 found 为空时会
    // throw NotFoundException（同下方 detail 场景),不接住会变成未处理 rejection
    // 让本测试恒红——按 findOne 姊妹测试同款 .catch() 补上,断言的仍是 where 子句。
    await service.findEvidencePackage('PKG2603240001').catch(() => undefined);
    expect(prisma.auditEvidencePackage.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { packageNo: 'PKG2603240001' } }),
    );
  });

  it('should download persisted evidence package content without rebuilding it', async () => {
    prisma.auditEvidencePackage.findUnique.mockResolvedValue({
      id: 'pkg-2',
      packageNo: 'EVP2603010002',
      deletedAt: null,
      fileName: 'EVP2603010002.json',
      digest: 'f'.repeat(64),
      manifest: JSON.stringify({ version: '1.0' }),
      packageBody: JSON.stringify({
        manifest: { version: '1.0' },
        records: [{ id: 'a1' }],
        snapshots: { deposits: [] },
        digest: 'f'.repeat(64),
      }),
      exportedByType: 'ADMIN',
      exportedById: 'admin-1',
      status: 'READY',
      exportMode: 'SELECTION',
      itemCount: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.downloadEvidencePackage('pkg-2');

    expect(result.packageNo).toBe('EVP2603010002');
    expect(result.fileName).toBe('EVP2603010002.json');
    expect(result.content).toEqual(
      expect.objectContaining({
        records: [{ id: 'a1' }],
        digest: 'f'.repeat(64),
      }),
    );
  });

  it('should fail fast when audit evidence storage is unavailable', async () => {
    delete prisma.auditEvidencePackage;

    await expect(service.findEvidencePackages({ take: 20 })).rejects.toThrow(
      InternalServerErrorException,
    );
  });

  it('should fail fast when audit event storage is unavailable', async () => {
    delete prisma.auditLogEvent;

    await expect(
      service.recordByActor(
        {
          // 波一 T4：WALLET_STATUS_UPDATED 随钱包状态开关退役，登退役闸后
          // assertActionSpec 会当场拒绝——换一个仍在役、同形状（CONFIG 域、
          // 无必填字段）的码，测试意图不变：只是要触发存储不可用的 fail-fast。
          action: AuditActions.FUNDS_ORDER_ADVANCED,
          actionDomain: 'CONFIG',
          primarySubjectType: AuditEntityTypes.WALLET,
        } as any,
        {
          actorType: 'ADMIN',
          actorNo: 'admin-1',
          actorDisplayName: 'admin-1',
        } as any,
      ),
    ).rejects.toThrow(InternalServerErrorException);

    await expect(service.findAll({ take: 20 })).rejects.toThrow(InternalServerErrorException);
  });

  it('should build full deposit evidence snapshots and chain for export packages', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-24T09:00:00.000Z'));
    prisma.auditLogEvent.findMany.mockResolvedValue([
      {
        id: 'audit-1',
        auditNo: 'AUD2603240001',
        action: AuditActions.DEPOSIT_APPROVED,
        primarySubjectType: AuditEntityTypes.DEPOSIT_TRANSACTION,
        primarySubjectNo: 'DEP2603240001',
        actorType: 'SYSTEM',
        workflowType: 'DEPOSIT',
        metadata: null,
        beforeData: null,
        afterData: null,
        occurredAt: new Date('2026-03-24T08:00:00.000Z'),
      },
    ]);
    prisma.depositTransaction.findMany = mockFindManyByWhere([
      {
        id: 'dep-1',
        depositNo: 'DEP2603240001',
        customer: {
          id: 'cust-1',
          customerNo: 'CU2603240001',
          firstName: 'Ada',
          lastName: 'Lovelace',
          email: 'ada@example.com',
        },
        asset: {
          id: 'asset-1',
          code: 'BTC',
          type: 'CRYPTO',
          network: 'BTC',
          decimals: 8,
        },
      },
    ]);
    try {
      const artifacts = await service.buildEvidencePackageArtifacts(
        {
          selectedEventIds: ['8f89c12b-6c5a-4b8a-8b59-53f59d4b2a70'],
          workflowType: 'DEPOSIT',
        } as any,
        {
          actorType: 'ADMIN',
          actorNo: 'admin-1',
          actorDisplayName: 'admin-1',
        },
      );
      const body: any = artifacts.packageBody;

      expect(body.snapshots.deposits).toHaveLength(1);
      expect(body.snapshots.deposits[0].depositNo).toBe('DEP2603240001');
      expect(body.snapshots.depositEvidenceChain).toEqual([
        { depositId: 'dep-1', depositNo: 'DEP2603240001' },
      ]);
      for (const ghost of ['kytCases', 'travelRuleCases', 'riskDecisionRecords', 'alerts', 'cases', 'journals']) {
        expect(body.snapshots).not.toHaveProperty(ghost);
      }

      const artifactsAgain = await service.buildEvidencePackageArtifacts(
        {
          selectedEventIds: ['8f89c12b-6c5a-4b8a-8b59-53f59d4b2a70'],
          workflowType: 'DEPOSIT',
        } as any,
        {
          actorType: 'ADMIN',
          actorNo: 'admin-1',
          actorDisplayName: 'admin-1',
        },
      );

      expect(artifacts.digest).toBe(artifactsAgain.digest);
    } finally {
      jest.useRealTimers();
    }
  });

  it('should build full swap evidence snapshots and chain for export packages', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-26T12:00:00.000Z'));
    prisma.auditLogEvent.findMany.mockResolvedValue([
      {
        id: 'audit-swap-1',
        auditNo: 'AUD2603260001',
        action: AuditActions.SWAP_CREATED,
        primarySubjectType: AuditEntityTypes.SWAP_TRANSACTION,
        primarySubjectNo: 'SWP2603260001',
        actorType: 'CUSTOMER',
        workflowType: 'SWAP',
        metadata: null,
        beforeData: null,
        afterData: null,
        occurredAt: new Date('2026-03-26T11:00:00.000Z'),
      },
      {
        id: 'audit-swap-2',
        auditNo: 'AUD2603260002',
        action: 'SWAP_KYT_APPROVED',
        primarySubjectType: AuditEntityTypes.SWAP_TRANSACTION,
        primarySubjectNo: 'SWP2603260001',
        actorType: 'SYSTEM',
        workflowType: 'SWAP',
        metadata: null,
        beforeData: null,
        afterData: null,
        occurredAt: new Date('2026-03-26T11:02:00.000Z'),
      },
    ]);
    prisma.swapTransaction.findMany = mockFindManyByWhere([
      {
        id: 'swap-1',
        swapNo: 'SWP2603260001',
        quoteId: 'quote-1',
        quoteSnapshotRef: 'quote-1',
        quoteNo: 'SQT2603260001',
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        ownerNo: 'CU2603260001',
        status: 'SUCCESS',
        fromAssetId: 'asset-usdt',
        fromAssetCode: 'USDT',
        fromAmount: '1000.00',
        toAssetId: 'asset-btc',
        toAssetCode: 'BTC',
        toAmount: '0.01000000',
        netToAmount: '0.00995000',
        feeAmount: '0.00005000',
        feeCurrency: 'BTC',
        exchangeRate: '0.00001000',
        fromAsset: {
          id: 'asset-usdt',
          code: 'USDT',
          type: 'CRYPTO',
          network: 'TRON',
          decimals: 6,
        },
        toAsset: {
          id: 'asset-btc',
          code: 'BTC',
          type: 'CRYPTO',
          network: 'BTC',
          decimals: 8,
        },
        customer: {
          id: 'cust-1',
          customerNo: 'CU2603260001',
          firstName: 'Ada',
          lastName: 'Lovelace',
          email: 'ada@example.com',
          riskRating: 'LOW',
        },
      },
    ]);
    prisma.swapQuote.findMany = mockFindManyByWhere([
      {
        id: 'quote-1',
        quoteNo: 'SQT2603260001',
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        ownerNo: 'CU2603260001',
        status: 'USED',
        quoteType: 'FIRM',
        fromAssetId: 'asset-usdt',
        fromAssetCode: 'USDT',
        toAssetId: 'asset-btc',
        toAssetCode: 'BTC',
        side: 'SELL',
        amountType: 'FROM',
        amountIn: '1000.00',
        currencyIn: 'USDT',
        amountOut: '0.01000000',
        currencyOut: 'BTC',
        rateDisplay: '0.00001000',
        rateAllIn: '0.00001000',
        marketRate: '0.00001020',
        spreadPercent: '0.20',
        spreadBps: 20,
        rateSource: 'BINANCE',
        fetchedAt: new Date('2026-03-26T10:59:30.000Z'),
        feeBreakdown: JSON.stringify([
          { itemCode: 'SWAP_SERVICE_FEE', currency: 'BTC', value: '0.00005000' },
        ]),
        totalsJson: JSON.stringify({
          BTC: '0.00005000',
          amountOutGross: '0.01000000',
          amountOutNet: '0.00995000',
          feeTotal: '0.00005000',
          feeCurrency: 'BTC',
        }),
        policyRef: JSON.stringify({
          policyCode: 'SWAP_PRICING',
          policyId: 'POL-SWAP-ONLINE',
          business: 'SWAP',
          channel: 'ONLINE',
        }),
        pricingSource: JSON.stringify({
          provider: 'BINANCE',
          symbol: 'BTCUSDT',
        }),
        matched: JSON.stringify({
          pairId: 'BTC-USDT',
          tierId: 'tier-1',
        }),
        fromAsset: {
          id: 'asset-usdt',
          code: 'USDT',
          type: 'CRYPTO',
          network: 'TRON',
          decimals: 6,
        },
        toAsset: {
          id: 'asset-btc',
          code: 'BTC',
          type: 'CRYPTO',
          network: 'BTC',
          decimals: 8,
        },
      },
    ]);
    try {
      const artifacts = await service.buildEvidencePackageArtifacts(
        {
          selectedEventIds: ['audit-swap-1', 'audit-swap-2'],
          workflowType: 'SWAP',
        } as any,
        {
          actorType: 'ADMIN',
          actorNo: 'admin-1',
          actorDisplayName: 'admin-1',
        },
      );
      const snapshots = (artifacts.packageBody as any).snapshots;

      expect(artifacts.manifest.workflowSummary).toEqual({
        workflowType: 'SWAP',
        workflowNos: ['SWP2603260001'],
      });
      expect(snapshots.swapTransactions).toHaveLength(1);
      expect(snapshots.swapQuotes).toHaveLength(1);
      expect(snapshots.swapEvidenceChain[0]).toEqual({
        swapId: expect.any(String),
        swapNo: expect.any(String),
        quoteId: expect.anything(),
        quoteNo: expect.anything(),
      });
      for (const ghost of [
        'swapRiskDecisionRecords',
        'swapAlerts',
        'swapCases',
        'swapJournals',
      ]) {
        expect(snapshots).not.toHaveProperty(ghost);
      }
    } finally {
      jest.useRealTimers();
    }
  });

  it('should build full withdraw evidence snapshots and chain for export packages', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-27T15:00:00.000Z'));
    prisma.auditLogEvent.findMany.mockResolvedValue([
      {
        id: 'audit-withdraw-1',
        auditNo: 'AUD2603270001',
        action: 'WITHDRAW_COMPLIANCE_PASSED',
        primarySubjectType: AuditEntityTypes.WITHDRAW_TRANSACTION,
        primarySubjectNo: 'WDR2603270001',
        actorType: 'ADMIN',
        workflowType: 'WITHDRAW',
        metadata: null,
        beforeData: null,
        afterData: null,
        occurredAt: new Date('2026-03-27T10:00:00.000Z'),
      },
    ]);
    prisma.withdrawTransaction.findMany = mockFindManyByWhere([
      {
        id: 'wd-1',
        withdrawNo: 'WDR2603270001',
        customer: {
          id: 'cust-1',
          customerNo: 'CU2603270001',
          firstName: 'Ada',
          lastName: 'Lovelace',
          email: 'ada@example.com',
          riskRating: 'LOW',
        },
        asset: {
          id: 'asset-btc',
          code: 'BTC',
          type: 'CRYPTO',
          network: 'BTC',
          decimals: 8,
        },
      },
    ]);

    try {
      const artifacts = await service.buildEvidencePackageArtifacts(
        {
          selectedEventIds: ['audit-withdraw-1'],
          workflowType: 'WITHDRAW',
        } as any,
        {
          actorType: 'ADMIN',
          actorNo: 'admin-1',
          actorDisplayName: 'admin-1',
        },
      );
      const body: any = artifacts.packageBody;

      expect(artifacts.manifest.workflowSummary).toEqual({
        workflowType: 'WITHDRAW',
        workflowNos: [],
      });
      expect(body.snapshots.withdrawTransactions).toHaveLength(1);
      expect(body.snapshots.withdrawEvidenceChain[0]).toEqual({
        withdrawId: 'wd-1',
        withdrawNo: expect.any(String),
      });
      for (const ghost of [
        'payouts',
        'preKytCases',
        'mainKytCases',
        'travelRuleCases',
        'riskDecisionRecords',
        'alerts',
        'cases',
        'journals',
        'clearings',
      ]) {
        expect(body.snapshots).not.toHaveProperty(ghost);
      }
    } finally {
      jest.useRealTimers();
    }
  });

  it('should resolve swap export workflow summary from primarySubjectNo when a linked swap is present', async () => {
    prisma.swapTransaction.findMany = mockFindManyByWhere([
      {
        id: 'swap-1',
        swapNo: 'SWP2603260001',
        quoteId: 'quote-1',
        quoteNo: 'SQT2603260001',
        quoteSnapshotRef: 'quote-1',
      },
    ]);
    prisma.swapQuote.findMany = mockFindManyByWhere([
      {
        id: 'quote-1',
        quoteNo: 'SQT2603260001',
      },
    ]);
    prisma.auditLogEvent.findMany.mockResolvedValue([
      {
        id: 'audit-swap-1',
        auditNo: 'AUD2603260101',
        action: AuditActions.SWAP_CREATED,
        primarySubjectType: AuditEntityTypes.SWAP_TRANSACTION,
        primarySubjectNo: 'SWP2603260001',
        actorType: 'CUSTOMER',
        workflowType: 'SWAP',
        metadata: null,
        beforeData: null,
        afterData: null,
        occurredAt: new Date('2026-03-26T11:00:00.000Z'),
      },
    ]);

    const result = await service.prepareEvidenceExportSelection({
      selectedEventIds: ['audit-swap-1'],
      workflowType: 'SWAP',
    } as any);

    expect(result.workflowSummary).toEqual({
      workflowType: 'SWAP',
      workflowNos: ['SWP2603260001'],
    });
  });

  it('should reject swap export selection without any linked swap transactions', async () => {
    prisma.swapTransaction.findMany = mockFindManyByWhere([]);
    prisma.swapQuote.findMany = mockFindManyByWhere([]);
    prisma.auditLogEvent.findMany.mockResolvedValue([
      {
        id: 'audit-quote-1',
        auditNo: 'AUD2603260999',
        action: AuditActions.SWAP_QUOTE_CREATED,
        actorType: 'CUSTOMER',
        workflowType: 'SWAP',
        metadata: null,
        beforeData: null,
        afterData: null,
        occurredAt: new Date('2026-03-26T11:00:00.000Z'),
      },
    ]);

    await expect(
      service.prepareEvidenceExportSelection({
        selectedEventIds: ['audit-quote-1'],
        workflowType: 'SWAP',
      } as any),
    ).rejects.toThrow('linked swap');
  });

  describe('第一批 · 写入侧新契约', () => {
    beforeEach(() => {
      prisma.auditLogSubject = { createMany: jest.fn().mockResolvedValue({ count: 0 }) };
      prisma.auditLogEvent.findUnique.mockResolvedValue(null);
      prisma.auditLogEvent.create.mockResolvedValue({ id: 'evt-1', eventNo: 'AUD1' });
    });

    it('subjects 逐行落子表，角色各留一行', async () => {
      await service.recordSystem({
        action: 'ADMIN_SUSPENSION_APPLIED',
        actionDomain: 'IAM',
        category: AuditCategory.GOVERNANCE,
        fromStatus: 'ACTIVE',
        toStatus: 'SUSPENDED',
        approvalNo: 'APR001',
        correlationId: 'corr-susp-1',
        causationId: 'cause-susp-1',
        primarySubjectType: 'ADMIN_USER',
        primarySubjectNo: 'USR001',
        subjects: [
          { subjectType: 'ADMIN_USER',    subjectNo: 'USR001', subjectRole: AuditSubjectRole.PRIMARY },
          { subjectType: 'APPROVAL_CASE', subjectNo: 'APR077', subjectRole: AuditSubjectRole.INSTRUMENT },
        ],
      } as any);

      expect(prisma.auditLogSubject.createMany).toHaveBeenCalledTimes(1);
      const rows = prisma.auditLogSubject.createMany.mock.calls[0][0].data;
      expect(rows).toHaveLength(2);
      expect(rows.every((r: any) => r.eventId === 'evt-1')).toBe(true);
      expect(rows.map((r: any) => r.subjectRole).sort()).toEqual(['INSTRUMENT', 'PRIMARY']);
    });

    it('PRIMARY 多于一个时抛错', async () => {
      await expect(
        service.recordSystem({
          action: 'ADMIN_SUSPENSION_APPLIED',
          actionDomain: 'IAM',
          category: AuditCategory.GOVERNANCE,
          fromStatus: 'ACTIVE',
          toStatus: 'SUSPENDED',
          approvalNo: 'APR001',
          correlationId: 'corr-susp-2',
          causationId: 'cause-susp-2',
          subjects: [
            { subjectType: 'ADMIN_USER', subjectNo: 'U1', subjectRole: AuditSubjectRole.PRIMARY },
            { subjectType: 'ADMIN_USER', subjectNo: 'U2', subjectRole: AuditSubjectRole.PRIMARY },
          ],
        } as any),
      ).rejects.toThrow('exactly one PRIMARY');
    });

    it('PRIMARY 零个是合法的——建单前被拦截时没有主对象', async () => {
      await service.recordSystem({
        action: 'ADMIN_INVITE_REQUESTED',
        actionDomain: 'IAM',
        category: AuditCategory.GOVERNANCE,
        afterData: { status: 'REQUESTED' },
        outcome: AuditOutcome.DENIED,
        reasonCode: 'SOD_CONFLICT',
        subjects: [
          { subjectType: 'ADMIN_USER', subjectNo: 'U1', subjectRole: AuditSubjectRole.OWNER },
        ],
      } as any);

      expect(prisma.auditLogSubject.createMany).toHaveBeenCalledTimes(1);
    });

    it('没传 subjects 时不碰子表', async () => {
      await service.recordSystem({
        action: 'AUDIT_LOG_QUERIED',
        actionDomain: 'AUDIT',
        category: AuditCategory.GOVERNANCE,
      } as any);
      expect(prisma.auditLogSubject.createMany).not.toHaveBeenCalled();
    });

    it('outcome 四值枚举落库，reasonCode 原样保留', async () => {
      await service.recordSystem({
        action: 'APPROVAL_SOD_DENIED',
        actionDomain: 'APPROVAL',
        category: AuditCategory.GOVERNANCE,
        correlationId: 'corr-sod-1',
        outcome: AuditOutcome.DENIED,
        reasonCode: 'SELF_APPROVE',
      } as any);

      const data = prisma.auditLogEvent.create.mock.calls[0][0].data;
      expect(data.outcome).toBe('DENIED');
      expect(data.reasonCode).toBe('SELF_APPROVE');
    });

    it('actorRolesAtTime 以 JSON 数组落库，不是单值字符串', async () => {
      await service.recordByActor(
        {
          action: 'ADMIN_ROLE_CHANGE_APPLIED', actionDomain: 'IAM', category: AuditCategory.GOVERNANCE,
          beforeData: { role: 'OPERATOR' }, afterData: { role: 'ADMIN' }, approvalNo: 'APR002',
          correlationId: 'corr-role-1', causationId: 'cause-role-1',
        } as any,
        { actorType: 'ADMIN', actorNo: 'USR009', actorDisplayName: '张三', actorRolesAtTime: ['MLRO', 'CISO'] } as any,
      );

      const data = prisma.auditLogEvent.create.mock.calls[0][0].data;
      expect(JSON.parse(data.actorRolesAtTime)).toEqual(['MLRO', 'CISO']);
      expect(data.actorDisplayName).toBe('张三');
    });

    it('幂等键含 actionDomain 与 correlationId 两维', async () => {
      await service.recordSystem({
        action: 'APPROVAL_GRANTED',
        actionDomain: 'APPROVAL',
        category: AuditCategory.GOVERNANCE,
        approvalNo: 'APR077',
        primarySubjectNo: 'APR077',
        correlationId: 'corr-1',
        requestId: 'req-1',
      } as any);
      const k1 = prisma.auditLogEvent.create.mock.calls[0][0].data.idempotencyKey;

      prisma.auditLogEvent.create.mockClear();
      await service.recordSystem({
        action: 'APPROVAL_GRANTED',
        actionDomain: 'APPROVAL',
        category: AuditCategory.GOVERNANCE,
        approvalNo: 'APR077',
        primarySubjectNo: 'APR077',
        correlationId: 'corr-2',
        requestId: 'req-1',
      } as any);
      const k2 = prisma.auditLogEvent.create.mock.calls[0][0].data.idempotencyKey;

      expect(k1).not.toBe(k2);
    });

    it('不传 actionDomain/category 时落占位值，不传 undefined 给 NOT NULL 列', async () => {
      await service.recordSystem({
        action: 'SOME_LEGACY_TRADING_ACTION',
        primarySubjectType: 'DEPOSIT_TRANSACTION',
        primarySubjectNo: 'DEP001',
      } as any);

      const data = prisma.auditLogEvent.create.mock.calls[0][0].data;
      expect(data.actionDomain).toBe('UNCLASSIFIED');
      expect(data.category).toBe('UNCLASSIFIED');
      expect(data.actionDomain).not.toBeUndefined();
      expect(data.category).not.toBeUndefined();
    });

    it('幂等命中时不重放 subjects，避免撞子表唯一键', async () => {
      prisma.auditLogEvent.findUnique.mockResolvedValue({ id: 'evt-existing', eventNo: 'AUD-OLD' });
      prisma.auditLogSubject = { createMany: jest.fn() };

      await service.recordSystem({
        action: 'ADMIN_SUSPENSION_APPLIED',
        actionDomain: 'IAM',
        category: AuditCategory.GOVERNANCE,
        fromStatus: 'ACTIVE',
        toStatus: 'SUSPENDED',
        approvalNo: 'APR003',
        correlationId: 'c1',
        causationId: 'cause-susp-3',
        idempotencyKey: 'dup-key',
        subjects: [
          { subjectType: 'ADMIN_USER', subjectNo: 'USR001', subjectRole: AuditSubjectRole.PRIMARY },
        ],
      } as any);

      expect(prisma.auditLogSubject.createMany).not.toHaveBeenCalled();
    });
  });

  describe('第一批 · 按主体检索', () => {
    beforeEach(() => {
      prisma.auditLogEvent.count.mockResolvedValue(0);
      prisma.auditLogEvent.findMany.mockResolvedValue([]);
    });

    it('subjectNo 单给时 OR 命中主表 primarySubjectNo 或子表 subjectNo（波三扩语义）', async () => {
      await service.findAll({ subjectNo: 'CUS889' } as any);
      const where = prisma.auditLogEvent.findMany.mock.calls[0][0].where;
      expect(where.subjects).toBeUndefined();
      expect(where.AND).toEqual(
        expect.arrayContaining([
          {
            OR: [
              { primarySubjectNo: 'CUS889' },
              { subjects: { some: { subjectNo: 'CUS889' } } },
            ],
          },
        ]),
      );
    });

    it('subjectNo 与 subjectRole 同传时落在同一个 some 里', async () => {
      await service.findAll({ subjectNo: 'CUS889', subjectRole: AuditSubjectRole.OWNER } as any);
      expect(prisma.auditLogEvent.findMany.mock.calls[0][0].where.subjects)
        .toEqual({ some: { subjectNo: 'CUS889', subjectRole: 'OWNER' } });
    });

    it('keyword 命中 eventNo（Audit No 假承诺修复）', async () => {
      await service.findAll({ keyword: 'AUD2609' } as any);
      const where = prisma.auditLogEvent.findMany.mock.calls[0][0].where;
      const orClause = (where.AND as any[]).find((c) => Array.isArray(c.OR));
      expect(orClause.OR).toContainEqual({ eventNo: { contains: 'AUD2609' } });
    });

    it('action 精确过滤', async () => {
      await service.findAll({ action: 'DEPOSIT_FROZEN' } as any);
      expect(prisma.auditLogEvent.findMany.mock.calls[0][0].where.action).toBe('DEPOSIT_FROZEN');
    });

    it('两个都不传时不加 subjects 条件', async () => {
      await service.findAll({} as any);
      expect(prisma.auditLogEvent.findMany.mock.calls[0][0].where.subjects).toBeUndefined();
    });

    it('outcome 与 actionDomain 可过滤', async () => {
      await service.findAll({ outcome: AuditOutcome.DENIED, actionDomain: 'IAM' } as any);
      const where = prisma.auditLogEvent.findMany.mock.calls[0][0].where;
      expect(where.outcome).toBe('DENIED');
      expect(where.actionDomain).toBe('IAM');
    });

    it('详情返回 subjects 数组', async () => {
      prisma.auditLogEvent.findUnique.mockResolvedValue({
        id: 'evt-9', eventNo: 'AUD9', action: 'ADMIN_SUSPENSION_APPLIED',
        actionDomain: 'IAM', category: 'GOVERNANCE', actorType: 'ADMIN', actorNo: 'U1',
        actorDisplayName: '张三', actorRolesAtTime: '["CISO"]', occurredAt: new Date(),
        subjects: [{ subjectType: 'ADMIN_USER', subjectNo: 'USR001', subjectRole: 'PRIMARY' }],
      });

      const r: any = await service.findOne('evt-9');
      expect(r.subjects).toEqual([
        { subjectType: 'ADMIN_USER', subjectNo: 'USR001', subjectRole: 'PRIMARY' },
      ]);
      expect(r.actorRolesAtTime).toEqual(['CISO']);
    });
  });

  describe('第一批 · 查询过滤器不得引用已删列', () => {
    beforeEach(() => {
      prisma.auditLogEvent.count.mockResolvedValue(0);
      prisma.auditLogEvent.findMany.mockResolvedValue([]);
    });

    it('keyword 的 OR 列表只用现存列名', async () => {
      await service.findAll({ keyword: 'abc' } as any);
      const where = prisma.auditLogEvent.findMany.mock.calls[0][0].where;
      const json = JSON.stringify(where);
      for (const dead of ['entityType', 'entityId', 'entityNo', 'entityOwnerNo', 'actorId', '"result"']) {
        expect(json).not.toContain(dead);
      }
      expect(json).toContain('primarySubjectNo');
    });

    it('outcome 过滤落在 outcome 列上，不是 result', async () => {
      await service.findAll({ outcome: AuditOutcome.DENIED } as any);
      const json = JSON.stringify(prisma.auditLogEvent.findMany.mock.calls[0][0].where);
      expect(json).toContain('"outcome"');
      expect(json).not.toContain('"result"');
    });
  });

  describe('第一批 · 声明校验', () => {
    beforeEach(() => {
      prisma.auditLogSubject = { createMany: jest.fn() };
      prisma.auditLogEvent.findUnique.mockResolvedValue(null);
      prisma.auditLogEvent.create.mockResolvedValue({ id: 'e', eventNo: 'A' });
    });

    it('缺声明里的必填字段时拒绝写入', async () => {
      await expect(service.recordSystem({
        action: 'ADMIN_ROLE_CHANGE_APPLIED', actionDomain: 'IAM',
        category: AuditCategory.GOVERNANCE, correlationId: 'c1', causationId: 'x1',
      } as any)).rejects.toThrow('missing required field');
    });

    it('INHERIT 的码没有 correlationId 时拒绝写入，不静默生成', async () => {
      await expect(service.recordSystem({
        action: 'ADMIN_INVITE_ACCEPTED', actionDomain: 'IAM',
        category: AuditCategory.GOVERNANCE, fromStatus: 'A', toStatus: 'B',
      } as any)).rejects.toThrow('must inherit an existing correlationId');
    });

    it('actionDomain 与声明不符时拒绝写入', async () => {
      await expect(service.recordSystem({
        action: 'AUDIT_LOG_QUERIED', actionDomain: 'IAM',
        category: AuditCategory.GOVERNANCE,
      } as any)).rejects.toThrow('must carry actionDomain=AUDIT');
    });

    it('退役码拒绝新写入', async () => {
      await expect(service.recordSystem({
        action: 'ADMIN_LOGIN_SUCCESS', actionDomain: 'IAM',
        category: AuditCategory.SECURITY,
      } as any)).rejects.toThrow('deprecated');
    });
  });

  describe('第一批 · requiredFields 成败分流', () => {
    beforeEach(() => {
      prisma.auditLogSubject = { createMany: jest.fn() };
      prisma.auditLogEvent.findUnique.mockResolvedValue(null);
      prisma.auditLogEvent.create.mockResolvedValue({ id: 'e', eventNo: 'A' });
    });

    it('失败路径不强制 requiredFields —— 失败时按定义就产不出那些字段', async () => {
      // AUDIT_EVIDENCE_EXPORT_GENERATED 的 requiredFields 是 ['payloadDigest']（产物摘要），
      // 生成失败时没有产物、也就没有摘要。若一律强制，这条失败分支就永远写不进审计。
      await expect(
        service.recordSystem({
          action: 'AUDIT_EVIDENCE_EXPORT_GENERATED',
          actionDomain: 'AUDIT',
          category: AuditCategory.GOVERNANCE,
          correlationId: 'c1',
          causationId: 'x1',
          outcome: AuditOutcome.FAILED,
          reasonCode: 'GENERATION_ERROR',
        } as any),
      ).resolves.toBeDefined();
    });

    it('成功路径仍然强制 requiredFields', async () => {
      await expect(
        service.recordSystem({
          action: 'AUDIT_EVIDENCE_EXPORT_GENERATED',
          actionDomain: 'AUDIT',
          category: AuditCategory.GOVERNANCE,
          correlationId: 'c1',
          causationId: 'x1',
        } as any),
      ).rejects.toThrow('missing required field');
    });

    it('非成功路径必须带 reasonCode，否则失败无法被机器聚合', async () => {
      await expect(
        service.recordSystem({
          action: 'AUDIT_EVIDENCE_EXPORT_GENERATED',
          actionDomain: 'AUDIT',
          category: AuditCategory.GOVERNANCE,
          correlationId: 'c1',
          causationId: 'x1',
          outcome: AuditOutcome.FAILED,
        } as any),
      ).rejects.toThrow('must carry reasonCode');
    });
  });

  describe('平账二期 Task 3 评审修复 · V7 财资名册接入 assertActionSpec', () => {
    beforeEach(() => {
      prisma.auditLogSubject = { createMany: jest.fn() };
      prisma.auditLogEvent.findUnique.mockResolvedValue(null);
      prisma.auditLogEvent.create.mockResolvedValue({ id: 'e', eventNo: 'A' });
    });

    it('INTERNAL_TRANSFER_REQUESTED 带齐 amount/reason 时写入成功——证明 V7 名册确实在解析链里', async () => {
      await expect(
        service.recordSystem({
          action: 'INTERNAL_TRANSFER_REQUESTED',
          actionDomain: 'TREASURY',
          category: AuditCategory.GOVERNANCE,
          amount: '100.00',
          reason: '内部调拨',
        } as any),
      ).resolves.toBeDefined();
    });

    it('缺 reason 时被 assertActionSpec 拒绝——V7 名册若未接入解析链，这条会静默放行', async () => {
      await expect(
        service.recordSystem({
          action: 'INTERNAL_TRANSFER_REQUESTED',
          actionDomain: 'TREASURY',
          category: AuditCategory.GOVERNANCE,
          amount: '100.00',
        } as any),
      ).rejects.toThrow('missing required field');
    });
  });
});

describe('第一批 · 守则：审计写入不得再用 result 当键名', () => {
  const { execSync } = require('child_process');

  it('全仓生产代码零处 `result: AuditOutcome`', () => {
    const out = execSync(
      `grep -rn "result: AuditOutcome" src/ 2>/dev/null | grep -v "\\.spec\\." || true`,
      { encoding: 'utf8' },
    ).trim();
    // 键名写成 result 会被 DTO 白名单静默丢弃 → 失败记录落库成 outcome=SUCCESS。
    // 这类「失败被记成成功」正是本批要根治的缺陷，加守则防复发。
    expect(out).toBe('');
  });

});

