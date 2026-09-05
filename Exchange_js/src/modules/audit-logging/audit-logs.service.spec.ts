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
  AuditModules,
  AuditBusinessWorkflowTypes,
  AuditUserActions,
  mapRawAuditActionToUserAction,
} from './constants/audit-actions.constant';

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
      kytCase: {
        findMany: jest.fn(),
      },
      travelRuleCase: {
        findMany: jest.fn(),
      },
      workflowDecisionRecord: {
        findMany: jest.fn(),
      },
      complianceAlert: {
        findMany: jest.fn(),
      },
      complianceIncident: {
        findMany: jest.fn(),
      },
      journal: {
        findMany: jest.fn(),
      },
      clearing: {
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


  it('should map evidence export request actions into the audit evidence export workflow', async () => {
    prisma.auditLogEvent.count.mockResolvedValue(1);
    prisma.auditLogEvent.findMany.mockResolvedValue([
      {
        id: 'wf-exp-req-1',
        auditNo: 'AUD2604051001',
        action: AuditActions.AUDIT_EVIDENCE_EXPORT_REQUESTED,
        entityType: AuditEntityTypes.AUDIT_EVIDENCE_PACKAGE,
        entityId: 'pkg-1',
        entityNo: 'EVP2604050351',
        workflowType: AuditBusinessWorkflowTypes.AUDIT_EVIDENCE_EXPORT,
        actorType: 'ADMIN',
        actorId: 'admin-1',
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
      businessWorkflow: AuditBusinessWorkflowTypes.AUDIT_EVIDENCE_EXPORT,
      userAction: AuditUserActions.REQUEST_CREATED,
    });
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
        entityType: 'WITHDRAW_TRANSACTION',
        entityId: 'wd-1',
        actorType: 'ADMIN',
        actorId: 'admin-1',
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
  });

  it('should derive business workflow and user action display fields for governed and export logs', async () => {
    prisma.auditLogEvent.count.mockResolvedValue(2);
    prisma.auditLogEvent.findMany.mockResolvedValue([
      {
        id: 'wf-ct-1',
        auditNo: 'AUD2604010001',
        action: AuditActions.APPROVAL_SUBMITTED,
        entityType: AuditEntityTypes.APPROVAL_CASE,
        entityId: 'approval-1',
        entityNo: 'APR2604010001',
        workflowType: AuditBusinessWorkflowTypes.ADMIN_ROLE_BINDING_CHANGE,
        actorType: 'ADMIN',
        actorId: 'admin-1',
        outcome: AuditOutcome.SUCCESS,
        metadata: null,
        beforeData: null,
        afterData: null,
        occurredAt: new Date('2026-04-01T10:00:00.000Z'),
      },
      {
        id: 'wf-exp-1',
        auditNo: 'AUD2604010004',
        action: AuditActions.AUDIT_EVIDENCE_EXPORT_REQUESTED,
        entityType: AuditEntityTypes.AUDIT_EVIDENCE_PACKAGE,
        entityId: 'pkg-1',
        entityNo: 'EVP2604010001',
        workflowType: AuditBusinessWorkflowTypes.AUDIT_EVIDENCE_EXPORT,
        actorType: 'ADMIN',
        actorId: 'admin-1',
        outcome: AuditOutcome.SUCCESS,
        metadata: null,
        beforeData: null,
        afterData: null,
        occurredAt: new Date('2026-04-01T10:03:00.000Z'),
      },
    ]);

    const result = await service.findAll({ take: 20 });

    expect(result.items[0]).toMatchObject({
      businessWorkflow: AuditBusinessWorkflowTypes.ADMIN_ROLE_BINDING_CHANGE,
      businessWorkflowLabel: 'Admin Role Binding Change',
      userAction: AuditUserActions.SUBMITTED,
      userActionLabel: 'Submitted',
      action: AuditActions.APPROVAL_SUBMITTED,
    });
    expect(result.items[1]).toMatchObject({
      businessWorkflow: AuditBusinessWorkflowTypes.AUDIT_EVIDENCE_EXPORT,
      businessWorkflowLabel: 'Audit Evidence Export',
      userAction: AuditUserActions.REQUEST_CREATED,
      userActionLabel: 'Request Created',
    });
  });


  it('should expose derived display fields on audit log detail while preserving raw tuple fields', async () => {
    prisma.auditLogEvent.findUnique.mockResolvedValue({
      id: 'detail-1',
      auditNo: 'AUD2604010100',
      action: AuditActions.APPROVAL_SUBMITTED,
      entityType: AuditEntityTypes.APPROVAL_CASE,
      entityId: 'approval-1',
      entityNo: 'APR2604010001',
      workflowType: AuditBusinessWorkflowTypes.ADMIN_ROLE_BINDING_CHANGE,
      traceId: 'trace-role-binding-1',
      actorType: 'ADMIN',
      actorId: 'admin-1',
      outcome: AuditOutcome.SUCCESS,
      metadata: null,
      beforeData: null,
      afterData: null,
      occurredAt: new Date('2026-04-01T12:00:00.000Z'),
    });

    const result = await service.findOne('detail-1');

    expect(result).toMatchObject({
      businessWorkflow: AuditBusinessWorkflowTypes.ADMIN_ROLE_BINDING_CHANGE,
      businessWorkflowLabel: 'Admin Role Binding Change',
      userAction: AuditUserActions.SUBMITTED,
      userActionLabel: 'Submitted',
      action: AuditActions.APPROVAL_SUBMITTED,
      workflowType: AuditBusinessWorkflowTypes.ADMIN_ROLE_BINDING_CHANGE,
      traceId: 'trace-role-binding-1',
    });
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
        action: AuditActions.DEPOSIT_COMPLETED,
        entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
        entityId: 'dep-1',
        entityNo: 'DEP2603240001',
        actorType: 'SYSTEM',
        actorId: 'SYSTEM',
        workflowType: 'DEPOSIT',
        metadata: null,
        beforeData: null,
        afterData: null,
        occurredAt: new Date('2026-03-24T08:00:00.000Z'),
      },
    ]);
    prisma.depositTransaction.findMany.mockResolvedValue([
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
    prisma.kytCase.findMany.mockResolvedValue([
      {
        id: 'kyt-1',
        caseNo: 'KYT2603240001',
        sourceId: 'dep-1',
        screeningStage: 'MAIN',
        status: 'PASS',
        provider: 'CHAINALYSIS',
        providerCaseId: 'provider-kyt-1',
        checkedAt: new Date('2026-03-24T08:02:00.000Z'),
        riskScore: '10',
      },
    ]);
    prisma.travelRuleCase.findMany.mockResolvedValue([
      {
        id: 'tr-1',
        caseNo: 'TR2603240001',
        sourceId: 'dep-1',
        status: 'ACCEPTED',
        required: true,
        provider: 'NOTABENE',
        providerTransferId: 'provider-tr-1',
        checkedAt: new Date('2026-03-24T08:03:00.000Z'),
        counterpartyVasp: 'VASP-A',
      },
    ]);
    prisma.workflowDecisionRecord.findMany.mockResolvedValue([
      {
        id: 'dr-1',
        customerId: 'cust-1',
        contextType: 'TX_DEPOSIT_KYT_MAIN',
        subjectId: 'dep-1',
        policyVersion: 'transaction-risk-policy/v1',
        status: 'COMPLETED',
        inputPayload: JSON.stringify({ trigger: 'KYT' }),
        inputHash: 'h1',
        outputDecision: 'REVIEW',
        recommendedActions: JSON.stringify(['UPSERT_ALERT']),
        outputs: JSON.stringify({ severity: 'MEDIUM' }),
        reasonCodes: JSON.stringify(['KYT_REVIEW']),
        errorMessage: null,
        createdAt: new Date('2026-03-24T08:02:00.000Z'),
        completedAt: new Date('2026-03-24T08:02:10.000Z'),
        updatedAt: new Date('2026-03-24T08:02:10.000Z'),
      },
    ]);
    prisma.complianceAlert.findMany.mockResolvedValue([
      {
        id: 'alert-1',
        alertNo: 'ALT2603240001',
        sourceType: 'DEPOSIT',
        sourceId: 'dep-1',
        sourceNo: 'DEP2603240001',
        stage: 'REVIEW_KYT',
        ruleCode: 'TX_KYT_REVIEW_REQUIRED',
        severity: 'MEDIUM',
        status: 'CLOSED',
        decisionRecommendation: 'ESCALATE_TO_CASE',
        decision: 'FALSE_POSITIVE',
        decisionRecordIds: JSON.stringify(['dr-1']),
        linkedCaseIds: JSON.stringify(['case-1']),
        currentDispositionCode: 'FALSE_POSITIVE',
        finalDispositionCode: 'FALSE_POSITIVE',
        hitCount: 1,
        metadata: JSON.stringify({ reason: 'manual clear' }),
        firstOccurredAt: new Date('2026-03-24T08:02:30.000Z'),
        lastOccurredAt: new Date('2026-03-24T08:03:00.000Z'),
        createdAt: new Date('2026-03-24T08:02:30.000Z'),
        updatedAt: new Date('2026-03-24T08:04:00.000Z'),
      },
    ]);
    prisma.complianceIncident.findMany.mockResolvedValue([
      {
        id: 'case-1',
        incidentNo: 'INC2603240001',
        caseType: 'TRANSACTION',
        status: 'CLOSED',
        severity: 'MEDIUM',
        primaryAlertId: 'alert-1',
        primaryAlertNo: 'ALT2603240001',
        entityId: 'dep-1',
        entityNo: 'DEP2603240001',
        sourceType: 'DEPOSIT',
        stage: 'REVIEW_KYT',
        ruleCode: 'TX_KYT_REVIEW_REQUIRED',
        decision: 'CLEAR',
        proposedWorkflowDecision: 'CLEAR',
        mlroReviewOutcome: 'APPROVED',
        currentDispositionCode: 'CLEAR',
        finalDispositionCode: 'CLEAR',
        decisionRecordIds: JSON.stringify(['dr-1']),
        linkedCaseIds: JSON.stringify([]),
        metadata: JSON.stringify({ note: 'approved' }),
        createdAt: new Date('2026-03-24T08:03:30.000Z'),
        updatedAt: new Date('2026-03-24T08:05:00.000Z'),
      },
    ]);
    prisma.journal.findMany.mockResolvedValue([
      {
        id: 'journal-1',
        journalNo: 'JO2603240001',
        sourceType: 'DEPOSIT',
        sourceId: 'dep-1',
        sourceNo: 'DEP2603240001',
        eventCode: 'EVT_DEPOSIT_CONFIRMED__CRYPTO',
        postingStatus: 'POSTED',
        postedAt: new Date('2026-03-24T08:01:30.000Z'),
        reversalOfJournalId: null,
        baseAssetId: 'asset-1',
        totalAmount: '100.00',
        description: 'Deposit confirmed',
        createdAt: new Date('2026-03-24T08:01:30.000Z'),
        updatedAt: new Date('2026-03-24T08:01:30.000Z'),
      },
      {
        id: 'journal-2',
        journalNo: 'JO2603240002',
        sourceType: 'DEPOSIT',
        sourceId: 'dep-1',
        sourceNo: 'DEP2603240001',
        eventCode: 'EVT_DEPOSIT_SUCCESS__CRYPTO',
        postingStatus: 'POSTED',
        postedAt: new Date('2026-03-24T08:05:30.000Z'),
        reversalOfJournalId: null,
        baseAssetId: 'asset-1',
        totalAmount: '100.00',
        description: 'Deposit success',
        createdAt: new Date('2026-03-24T08:05:30.000Z'),
        updatedAt: new Date('2026-03-24T08:05:30.000Z'),
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
      const snapshots = (artifacts.packageBody as any).snapshots;

      expect(snapshots).toEqual(
        expect.objectContaining({
          deposits: expect.any(Array),
          riskDecisionRecords: expect.any(Array),
          alerts: expect.any(Array),
          cases: expect.any(Array),
          journals: expect.any(Array),
          depositEvidenceChain: expect.any(Array),
        }),
      );
      expect(snapshots.depositEvidenceChain).toEqual([
        expect.objectContaining({
          depositId: 'dep-1',
          payinId: null,
          decisionRecordIds: ['dr-1'],
          kytCaseIds: ['kyt-1'],
          travelRuleCaseIds: ['tr-1'],
          alertIds: ['alert-1'],
          caseIds: ['case-1'],
          journalIds: ['journal-1', 'journal-2'],
        }),
      ]);

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
        entityType: AuditEntityTypes.SWAP_TRANSACTION,
        entityId: 'swap-1',
        entityNo: 'SWP2603260001',
        actorType: 'CUSTOMER',
        actorId: 'customer-1',
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
        entityType: AuditEntityTypes.SWAP_TRANSACTION,
        entityId: 'swap-1',
        entityNo: 'SWP2603260001',
        actorType: 'SYSTEM',
        actorId: 'SYSTEM',
        workflowType: 'SWAP',
        metadata: null,
        beforeData: null,
        afterData: null,
        occurredAt: new Date('2026-03-26T11:02:00.000Z'),
      },
    ]);
    prisma.swapTransaction.findMany.mockResolvedValue([
      {
        id: 'swap-1',
        swapNo: 'SWP2603260001',
        quoteId: 'quote-1',
        quoteSnapshotRef: 'quote-1',
        quoteNo: 'QUO2603260001',
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
          investorTier: 'RETAIL',
        },
      },
    ]);
    prisma.swapQuote.findMany.mockResolvedValue([
      {
        id: 'quote-1',
        quoteNo: 'QUO2603260001',
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
    prisma.workflowDecisionRecord.findMany.mockResolvedValue([
      {
        id: 'dr-swap-1',
        customerId: 'cust-1',
        contextType: 'TX_SWAP_FINAL',
        subjectId: 'swap-1',
        policyVersion: 'transaction-risk-policy/v1',
        status: 'COMPLETED',
        inputPayload: JSON.stringify({ trigger: 'TX_SWAP_FINAL' }),
        inputHash: 'h-swap-1',
        outputDecision: 'REVIEW',
        recommendedActions: JSON.stringify(['UPSERT_ALERT']),
        outputs: JSON.stringify({ severity: 'MEDIUM' }),
        reasonCodes: JSON.stringify(['TX_SWAP_FINAL_REVIEW_REQUIRED']),
        errorMessage: null,
        createdAt: new Date('2026-03-26T11:00:30.000Z'),
        completedAt: new Date('2026-03-26T11:00:40.000Z'),
        updatedAt: new Date('2026-03-26T11:00:40.000Z'),
      },
    ]);
    prisma.complianceAlert.findMany.mockResolvedValue([
      {
        id: 'alert-swap-1',
        alertNo: 'ALT2603260001',
        sourceType: 'SWAP',
        sourceId: 'swap-1',
        sourceNo: 'SWP2603260001',
        stage: 'REVIEW_SWAP_FINAL',
        ruleCode: 'TX_SWAP_FINAL_REVIEW_REQUIRED',
        severity: 'MEDIUM',
        status: 'CLOSED',
        decisionRecommendation: 'REVIEW',
        decision: 'FALSE_POSITIVE',
        decisionRecordIds: JSON.stringify(['dr-swap-1']),
        linkedCaseIds: JSON.stringify(['case-swap-1']),
        currentDispositionCode: 'FALSE_POSITIVE',
        finalDispositionCode: 'FALSE_POSITIVE',
        hitCount: 1,
        metadata: JSON.stringify({ sourceType: 'SWAP' }),
        firstOccurredAt: new Date('2026-03-26T11:00:45.000Z'),
        lastOccurredAt: new Date('2026-03-26T11:01:00.000Z'),
        createdAt: new Date('2026-03-26T11:00:45.000Z'),
        updatedAt: new Date('2026-03-26T11:03:00.000Z'),
      },
    ]);
    prisma.complianceIncident.findMany.mockResolvedValue([
      {
        id: 'case-swap-1',
        incidentNo: 'INC2603260001',
        caseType: 'TRANSACTION',
        status: 'CLOSED',
        severity: 'MEDIUM',
        primaryAlertId: 'alert-swap-1',
        primaryAlertNo: 'ALT2603260001',
        entityId: 'swap-1',
        entityNo: 'SWP2603260001',
        sourceType: 'SWAP',
        stage: 'REVIEW_SWAP_FINAL',
        ruleCode: 'TX_SWAP_FINAL_REVIEW_REQUIRED',
        decision: 'CLEAR',
        proposedWorkflowDecision: 'CLEAR',
        mlroReviewOutcome: 'APPROVED',
        currentDispositionCode: 'FALSE_POSITIVE',
        finalDispositionCode: 'FALSE_POSITIVE',
        decisionRecordIds: JSON.stringify(['dr-swap-1']),
        linkedCaseIds: JSON.stringify([]),
        metadata: JSON.stringify({ sourceType: 'SWAP' }),
        createdAt: new Date('2026-03-26T11:01:10.000Z'),
        updatedAt: new Date('2026-03-26T11:04:00.000Z'),
      },
    ]);
    prisma.journal.findMany.mockResolvedValue([
      {
        id: 'journal-swap-1',
        journalNo: 'JO2603260001',
        sourceType: 'SWAP',
        sourceId: 'swap-1',
        sourceNo: 'SWP2603260001',
        eventCode: 'EVT_SWAP_CREATED',
        postingStatus: 'POSTED',
        postedAt: new Date('2026-03-26T11:00:05.000Z'),
        reversalOfJournalId: null,
        baseAssetId: 'asset-usdt',
        totalAmount: '1000.00',
        description: 'Swap created',
        createdAt: new Date('2026-03-26T11:00:05.000Z'),
        updatedAt: new Date('2026-03-26T11:00:05.000Z'),
      },
      {
        id: 'journal-swap-2',
        journalNo: 'JO2603260002',
        sourceType: 'SWAP',
        sourceId: 'swap-1',
        sourceNo: 'SWP2603260001',
        eventCode: 'EVT_SWAP_SUCCESS',
        postingStatus: 'POSTED',
        postedAt: new Date('2026-03-26T11:02:10.000Z'),
        reversalOfJournalId: null,
        baseAssetId: 'asset-btc',
        totalAmount: '0.00995000',
        description: 'Swap success',
        createdAt: new Date('2026-03-26T11:02:10.000Z'),
        updatedAt: new Date('2026-03-26T11:02:10.000Z'),
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
      expect(snapshots).toEqual(
        expect.objectContaining({
          swapTransactions: expect.any(Array),
          swapQuotes: expect.any(Array),
          swapRiskDecisionRecords: expect.any(Array),
          swapAlerts: expect.any(Array),
          swapCases: expect.any(Array),
          swapJournals: expect.any(Array),
          swapEvidenceChain: expect.any(Array),
        }),
      );
      expect(snapshots.swapEvidenceChain).toEqual([
        expect.objectContaining({
          swapId: 'swap-1',
          quoteId: 'quote-1',
          quoteNo: 'QUO2603260001',
          decisionRecordIds: ['dr-swap-1'],
          alertIds: ['alert-swap-1'],
          caseIds: ['case-swap-1'],
          journalIds: ['journal-swap-1', 'journal-swap-2'],
        }),
      ]);
      expect(snapshots.swapQuotes).toEqual([
        expect.objectContaining({
          id: 'quote-1',
          quoteNo: 'QUO2603260001',
        }),
      ]);
      expect(snapshots.swapTransactions).toEqual([
        expect.objectContaining({
          id: 'swap-1',
          quoteId: 'quote-1',
          feeAmount: '0.00005000',
          feeCurrency: 'BTC',
        }),
      ]);
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
        entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
        entityId: 'withdraw-1',
        entityNo: 'WD2603270001',
        actorType: 'ADMIN',
        actorId: 'admin-1',
        workflowType: 'WITHDRAW',
        metadata: null,
        beforeData: null,
        afterData: null,
        occurredAt: new Date('2026-03-27T10:00:00.000Z'),
      },
    ]);
    prisma.withdrawTransaction.findMany.mockResolvedValue([
      {
        id: 'withdraw-1',
        withdrawNo: 'WD2603270001',
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        ownerNo: 'CU2603270001',
        status: 'SUCCESS',
        amount: '101.00',
        netAmount: '100.00',
        feeAmount: '1.00',
        feeCurrency: 'BTC',
        destinationLabel: 'Ledger cold wallet',
        createdAt: new Date('2026-03-27T09:50:00.000Z'),
        completedAt: new Date('2026-03-27T10:05:00.000Z'),
        asset: {
          id: 'asset-btc',
          code: 'BTC',
          type: 'CRYPTO',
          network: 'BTC',
          decimals: 8,
        },
        customer: {
          id: 'cust-1',
          customerNo: 'CU2603270001',
          firstName: 'Ada',
          lastName: 'Lovelace',
          email: 'ada@example.com',
          riskRating: 'LOW',
        },
      },
    ]);
    prisma.kytCase.findMany.mockResolvedValue([
      {
        id: 'kyt-pre-1',
        caseNo: 'KYT2603270001',
        sourceId: 'withdraw-1',
        screeningStage: 'PRE_TXN',
        status: 'PASS',
        provider: 'CHAINALYSIS',
        providerCaseId: 'provider-pre-1',
        checkedAt: new Date('2026-03-27T09:52:00.000Z'),
        riskScore: '5',
      },
      {
        id: 'kyt-main-1',
        caseNo: 'KYT2603270002',
        sourceId: 'withdraw-1',
        screeningStage: 'MAIN',
        status: 'PASS',
        provider: 'CHAINALYSIS',
        providerCaseId: 'provider-main-1',
        checkedAt: new Date('2026-03-27T09:57:00.000Z'),
        riskScore: '6',
      },
    ]);
    prisma.travelRuleCase.findMany.mockResolvedValue([
      {
        id: 'tr-1',
        caseNo: 'TR2603270001',
        sourceId: 'withdraw-1',
        status: 'ACCEPTED',
        required: true,
        provider: 'NOTABENE',
        providerTransferId: 'provider-tr-1',
        checkedAt: new Date('2026-03-27T09:58:00.000Z'),
        counterpartyVasp: 'VASP-B',
      },
    ]);
    prisma.workflowDecisionRecord.findMany.mockResolvedValue([
      {
        id: 'dr-pre-1',
        customerId: 'cust-1',
        contextType: 'TX_WITHDRAW_PRECHECK',
        subjectId: 'withdraw-1',
        policyVersion: 'transaction-risk-policy/v1',
        status: 'COMPLETED',
        inputPayload: JSON.stringify({ trigger: 'PRECHECK' }),
        inputHash: 'h-pre-1',
        outputDecision: 'CLEAR',
        recommendedActions: JSON.stringify([]),
        outputs: JSON.stringify({ severity: 'LOW' }),
        reasonCodes: JSON.stringify([]),
        errorMessage: null,
        createdAt: new Date('2026-03-27T09:51:00.000Z'),
        completedAt: new Date('2026-03-27T09:51:10.000Z'),
        updatedAt: new Date('2026-03-27T09:51:10.000Z'),
      },
      {
        id: 'dr-final-1',
        customerId: 'cust-1',
        contextType: 'TX_WITHDRAW_FINAL',
        subjectId: 'withdraw-1',
        policyVersion: 'transaction-risk-policy/v1',
        status: 'COMPLETED',
        inputPayload: JSON.stringify({ trigger: 'FINAL' }),
        inputHash: 'h-final-1',
        outputDecision: 'REVIEW',
        recommendedActions: JSON.stringify(['UPSERT_ALERT']),
        outputs: JSON.stringify({ severity: 'MEDIUM' }),
        reasonCodes: JSON.stringify(['TX_WITHDRAW_FINAL_REVIEW_REQUIRED']),
        errorMessage: null,
        createdAt: new Date('2026-03-27T09:59:00.000Z'),
        completedAt: new Date('2026-03-27T09:59:10.000Z'),
        updatedAt: new Date('2026-03-27T09:59:10.000Z'),
      },
    ]);
    prisma.complianceAlert.findMany.mockResolvedValue([
      {
        id: 'alert-final-1',
        alertNo: 'ALT2603270001',
        sourceType: 'WITHDRAW',
        sourceId: 'withdraw-1',
        sourceNo: 'WD2603270001',
        stage: 'REVIEW_WITHDRAW_FINAL',
        ruleCode: 'TX_WITHDRAW_FINAL_REVIEW_REQUIRED',
        severity: 'MEDIUM',
        status: 'CLOSED',
        decisionRecommendation: 'REVIEW',
        decision: 'FALSE_POSITIVE',
        decisionRecordIds: JSON.stringify(['dr-final-1']),
        linkedCaseIds: JSON.stringify(['case-1']),
        currentDispositionCode: 'FALSE_POSITIVE',
        finalDispositionCode: 'FALSE_POSITIVE',
        hitCount: 1,
        metadata: JSON.stringify({ sourceType: 'WITHDRAW' }),
        firstOccurredAt: new Date('2026-03-27T09:59:20.000Z'),
        lastOccurredAt: new Date('2026-03-27T10:00:00.000Z'),
        createdAt: new Date('2026-03-27T09:59:20.000Z'),
        updatedAt: new Date('2026-03-27T10:01:00.000Z'),
      },
      {
        id: 'alert-recon-1',
        alertNo: 'ALT2603270002',
        sourceType: 'WITHDRAW',
        sourceId: 'withdraw-1',
        sourceNo: 'WD2603270001',
        stage: 'REVIEW_WITHDRAW_RECONCILIATION',
        ruleCode: 'TX_RECONCILIATION_BREAK_DETECTED',
        severity: 'HIGH',
        status: 'OPEN',
        decisionRecommendation: null,
        decision: null,
        decisionRecordIds: JSON.stringify([]),
        linkedCaseIds: JSON.stringify([]),
        currentDispositionCode: null,
        finalDispositionCode: null,
        hitCount: 1,
        metadata: JSON.stringify({ breakId: 'break-1' }),
        firstOccurredAt: new Date('2026-03-27T12:00:00.000Z'),
        lastOccurredAt: new Date('2026-03-27T12:00:00.000Z'),
        createdAt: new Date('2026-03-27T12:00:00.000Z'),
        updatedAt: new Date('2026-03-27T12:00:00.000Z'),
      },
    ]);
    prisma.complianceIncident.findMany.mockResolvedValue([
      {
        id: 'case-1',
        incidentNo: 'INC2603270001',
        caseType: 'TRANSACTION',
        status: 'CLOSED',
        severity: 'MEDIUM',
        primaryAlertId: 'alert-final-1',
        primaryAlertNo: 'ALT2603270001',
        entityId: 'withdraw-1',
        entityNo: 'WD2603270001',
        sourceType: 'WITHDRAW',
        stage: 'REVIEW_WITHDRAW_FINAL',
        ruleCode: 'TX_WITHDRAW_FINAL_REVIEW_REQUIRED',
        decision: 'CLEAR',
        proposedWorkflowDecision: 'CLEAR',
        mlroReviewOutcome: 'APPROVED',
        currentDispositionCode: 'CLEAR',
        finalDispositionCode: 'CLEAR',
        decisionRecordIds: JSON.stringify(['dr-final-1']),
        linkedCaseIds: JSON.stringify([]),
        metadata: JSON.stringify({ sourceType: 'WITHDRAW' }),
        createdAt: new Date('2026-03-27T10:01:30.000Z'),
        updatedAt: new Date('2026-03-27T10:03:00.000Z'),
      },
    ]);
    prisma.journal.findMany.mockResolvedValue([
      {
        id: 'journal-withdraw-1',
        journalNo: 'JO2603270001',
        sourceType: 'WITHDRAW',
        sourceId: 'withdraw-1',
        sourceNo: 'WD2603270001',
        eventCode: 'EVT_WITHDRAW_SUCCESS__CRYPTO',
        postingStatus: 'POSTED',
        postedAt: new Date('2026-03-27T10:05:10.000Z'),
        reversalOfJournalId: null,
        baseAssetId: 'asset-btc',
        totalAmount: '100.00',
        description: 'Withdraw success',
        createdAt: new Date('2026-03-27T10:05:10.000Z'),
        updatedAt: new Date('2026-03-27T10:05:10.000Z'),
      },
    ]);
    prisma.clearing.findMany.mockResolvedValue([
      {
        id: 'clearing-1',
        clearingNo: 'CLR2603270001',
        sourceType: 'WITHDRAWAL',
        sourceId: 'withdraw-1',
        outAssetId: 'asset-btc',
        outAmount: '100.00',
        inAssetId: 'asset-btc',
        inAmount: '100.00',
        feeAssetId: 'asset-btc',
        feeAmount: '1.00',
        feeMethod: 'DEDUCT',
        outPayoutId: 'payout-1',
        clearingStatus: 'CLEAR',
        memo: 'withdraw clearing',
        createdAt: new Date('2026-03-27T10:05:05.000Z'),
        updatedAt: new Date('2026-03-27T10:05:05.000Z'),
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
      const snapshots = (artifacts.packageBody as any).snapshots;

      expect(artifacts.manifest.workflowSummary).toEqual({
        workflowType: 'WITHDRAW',
        workflowNos: [],
      });
      expect(snapshots).toEqual(
        expect.objectContaining({
          withdrawTransactions: expect.any(Array),
          payouts: expect.any(Array),
          preKytCases: expect.any(Array),
          mainKytCases: expect.any(Array),
          travelRuleCases: expect.any(Array),
          riskDecisionRecords: expect.any(Array),
          alerts: expect.any(Array),
          cases: expect.any(Array),
          journals: expect.any(Array),
          clearings: expect.any(Array),
          withdrawEvidenceChain: expect.any(Array),
        }),
      );
      expect(snapshots.withdrawEvidenceChain).toEqual([
        expect.objectContaining({
          withdrawId: 'withdraw-1',
          payoutId: null,
          decisionRecordIds: ['dr-final-1', 'dr-pre-1'],
          preKytCaseIds: ['kyt-pre-1'],
          mainKytCaseIds: ['kyt-main-1'],
          travelRuleCaseIds: ['tr-1'],
          alertIds: ['alert-final-1', 'alert-recon-1'],
          caseIds: ['case-1'],
          journalIds: ['journal-withdraw-1'],
          clearingIds: ['clearing-1'],
        }),
      ]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('should resolve swap export workflow summary from entityNo when a linked swap is present', async () => {
    prisma.swapTransaction.findMany.mockResolvedValue([
      {
        id: 'swap-1',
        swapNo: 'SWP2603260001',
        quoteId: 'quote-1',
        quoteNo: 'QUO2603260001',
        quoteSnapshotRef: 'quote-1',
      },
    ]);
    prisma.swapQuote.findMany.mockResolvedValue([
      {
        id: 'quote-1',
        quoteNo: 'QUO2603260001',
      },
    ]);
    prisma.auditLogEvent.findMany.mockResolvedValue([
      {
        id: 'audit-swap-1',
        auditNo: 'AUD2603260101',
        action: AuditActions.SWAP_CREATED,
        entityType: AuditEntityTypes.SWAP_TRANSACTION,
        entityId: 'swap-1',
        entityNo: 'SWP2603260001',
        actorType: 'CUSTOMER',
        actorId: 'customer-1',
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
    prisma.swapTransaction.findMany.mockResolvedValue([]);
    prisma.swapQuote.findMany.mockResolvedValue([]);
    prisma.auditLogEvent.findMany.mockResolvedValue([
      {
        id: 'audit-quote-1',
        auditNo: 'AUD2603260999',
        action: AuditActions.SWAP_QUOTE_CREATED,
        entityType: AuditEntityTypes.SWAP_QUOTE,
        entityId: 'quote-1',
        entityNo: 'QUO2603260999',
        actorType: 'CUSTOMER',
        actorId: 'customer-1',
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

    it('传 subjectNo 时用子表关系过滤', async () => {
      await service.findAll({ subjectNo: 'CUS889' } as any);
      expect(prisma.auditLogEvent.findMany.mock.calls[0][0].where.subjects)
        .toEqual({ some: { subjectNo: 'CUS889' } });
    });

    it('subjectNo 与 subjectRole 同传时落在同一个 some 里', async () => {
      await service.findAll({ subjectNo: 'CUS889', subjectRole: AuditSubjectRole.OWNER } as any);
      expect(prisma.auditLogEvent.findMany.mock.calls[0][0].where.subjects)
        .toEqual({ some: { subjectNo: 'CUS889', subjectRole: 'OWNER' } });
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

