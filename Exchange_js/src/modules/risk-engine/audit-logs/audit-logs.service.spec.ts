import { InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { AuditLogsService } from './audit-logs.service';
import {
  AuditResult,
  AuditTriggerType,
} from './dto/audit-log.dto';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
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
      auditLogSubjectNo: {
        findMany: jest.fn(),
      },
      auditEvidencePackage: {
        create: jest.fn(),
        count: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      payin: {
        findUnique: jest.fn(),
      },
      depositTransaction: {
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
      internalTransaction: {
        findMany: jest.fn(),
      },
      internalFund: {
        findMany: jest.fn(),
      },
    };

    service = new AuditLogsService(prisma);
    jest.clearAllMocks();
  });

  it('should infer trigger type by rule order and persist EVIDENCE_EXPORT first', async () => {
    prisma.auditLogEvent.findUnique.mockResolvedValue(null);
    prisma.auditLogEvent.create.mockResolvedValue({
      id: 'a1',
      auditNo: 'AUD2602180001',
      triggerType: AuditTriggerType.EVIDENCE_EXPORT,
      action: AuditActions.AUDIT_EVIDENCE_PACKAGE_EXPORTED,
      module: AuditModules.AUDIT_LOGS,
      entityType: AuditEntityTypes.AUDIT_EVIDENCE_PACKAGE,
      entityId: 'pkg-1',
      actorType: 'ADMIN',
      actorId: 'admin-1',
      payloadDigest: 'x'.repeat(64),
      metadata: null,
      beforeData: null,
      afterData: null,
      occurredAt: new Date('2026-02-18T10:00:00.000Z'),
    });

    const result = await service.recordByActor(
      {
        action: AuditActions.AUDIT_EVIDENCE_PACKAGE_EXPORTED,
        module: AuditModules.AUDIT_LOGS,
        entityType: AuditEntityTypes.AUDIT_EVIDENCE_PACKAGE,
        entityId: 'pkg-1',
      },
      {
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorRole: 'OPS',
      },
    );

    expect(result.triggerType).toBe(AuditTriggerType.EVIDENCE_EXPORT);
    expect(prisma.auditLogEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          triggerType: AuditTriggerType.EVIDENCE_EXPORT,
        }),
      }),
    );
  });

  it('should keep trigger priority with AUTH before DATA_CREATE and SYSTEM last', async () => {
    prisma.auditLogEvent.findUnique.mockResolvedValue(null);
    prisma.auditLogEvent.create
      .mockImplementationOnce(({ data }: any) =>
        Promise.resolve({
          id: 'a-auth',
          auditNo: 'AUD260218000A',
          ...data,
        }),
      )
      .mockImplementationOnce(({ data }: any) =>
        Promise.resolve({
          id: 'a-create',
          auditNo: 'AUD260218000B',
          ...data,
        }),
      );

    const authResult = await service.recordByActor(
      {
        action: AuditActions.ADMIN_LOGIN_SUCCESS,
        module: 'identity/auth',
        entityType: AuditEntityTypes.AUTH,
        afterData: { sessionId: 's-1' },
      },
      {
        actorType: 'SYSTEM',
        actorId: 'SYSTEM',
        actorRole: 'SYSTEM',
      },
    );

    const createResult = await service.recordByActor(
      {
        action: 'SYSTEM_TASK_CREATED',
        module: 'orchestrators/reconcile',
        entityType: 'RECONCILE_TASK',
        entityId: 'task-1',
        afterData: { status: 'CREATED' },
      },
      {
        actorType: 'SYSTEM',
        actorId: 'SYSTEM',
        actorRole: 'SYSTEM',
      },
    );

    expect(authResult.triggerType).toBe(AuditTriggerType.AUTH_EVENT);
    expect(createResult.triggerType).toBe(AuditTriggerType.DATA_CREATE);
  });

  it('should allow onboarding state-transition action in approved allowlist', async () => {
    prisma.auditLogEvent.findUnique.mockResolvedValue(null);
    prisma.auditLogEvent.create.mockImplementation(({ data }: any) =>
      Promise.resolve({
        id: 'a-onboarding',
        auditNo: 'AUD260218000C',
        ...data,
      }),
    );

    const result = await service.recordByActor(
      {
        triggerType: AuditTriggerType.STATE_TRANSITION,
        action: AuditActions.CDD_APPROVED,
        module: AuditModules.ONBOARDING,
        entityType: AuditEntityTypes.ONBOARDING,
        entityId: 'case-1',
        statusFrom: 'IN_PROGRESS',
        statusTo: 'APPROVED',
      },
      {
        actorType: 'ADMIN',
        actorId: 'admin-9',
        actorRole: 'OPS',
      },
    );

    expect(result.triggerType).toBe(AuditTriggerType.STATE_TRANSITION);
    expect(result.action).toBe(AuditActions.CDD_APPROVED);
  });

  it('should allow alert resolution and canonical workflow actions in state-transition allowlist', async () => {
    prisma.auditLogEvent.findUnique.mockResolvedValue(null);
    prisma.auditLogEvent.create.mockImplementation(({ data }: any) =>
      Promise.resolve({
        id: 'a-alert-resolution',
        auditNo: 'AUD2603250001',
        ...data,
      }),
    );

    const alertResult = await service.recordByActor(
      {
        triggerType: AuditTriggerType.STATE_TRANSITION,
        action: AuditActions.ALERT_RESOLVED,
        module: AuditModules.COMPLIANCE_ALERTS,
        entityType: AuditEntityTypes.COMPLIANCE_ALERT,
        entityId: 'alert-1',
        statusFrom: 'ASSIGNED',
        statusTo: 'CLOSED',
      },
      {
        actorType: 'ADMIN',
        actorId: 'admin-9',
        actorRole: 'COMPLIANCE_LEAD',
      },
    );

    const workflowResult = await service.recordByActor(
      {
        triggerType: AuditTriggerType.STATE_TRANSITION,
        action: 'ONBOARDING_WORKFLOW_CLEAR',
        module: AuditModules.ONBOARDING,
        entityType: AuditEntityTypes.ONBOARDING,
        entityId: 'customer-1',
        statusFrom: 'CDD_UNDER_REVIEW',
        statusTo: 'APPROVED',
      },
      {
        actorType: 'ADMIN',
        actorId: 'admin-9',
        actorRole: 'COMPLIANCE_LEAD',
      },
    );

    expect(alertResult.triggerType).toBe(AuditTriggerType.STATE_TRANSITION);
    expect(alertResult.action).toBe(AuditActions.ALERT_RESOLVED);
    expect(workflowResult.triggerType).toBe(AuditTriggerType.STATE_TRANSITION);
    expect(workflowResult.action).toBe('ONBOARDING_WORKFLOW_CLEAR');
  });

  it('should derive deposit trace and workflow context for payin events', async () => {
    prisma.payin.findUnique.mockResolvedValue({
      id: 'payin-1',
      payinNo: 'PI2603010001',
      depositId: 'dep-1',
      customer: { customerNo: 'CU2603010001' },
      deposit: {
        id: 'dep-1',
        depositNo: 'DEP2603010001',
        ownerId: 'cust-1',
        customer: { customerNo: 'CU2603010001' },
      },
    });
    prisma.auditLogEvent.findUnique.mockResolvedValue(null);
    prisma.auditLogEvent.create.mockImplementation(({ data }: any) =>
      Promise.resolve({
        id: 'a-deposit-workflow',
        auditNo: 'AUD2603010001',
        ...data,
        subjectNos: data.subjectNos?.create?.map((item: any, index: number) => ({
          id: `subject-${index}`,
          eventId: 'a-deposit-workflow',
          createdAt: new Date('2026-03-01T10:00:00.000Z'),
          ...item,
        })),
      }),
    );

    const result = await service.recordSystem({
      triggerType: AuditTriggerType.DATA_CREATE,
      action: AuditActions.PAYIN_CREATED,
      module: AuditModules.PAYINS,
      entityType: AuditEntityTypes.PAYIN,
      entityId: 'payin-1',
      entityNo: 'PI2603010001',
      entityOwnerType: 'CUSTOMER',
      entityOwnerId: 'cust-1',
      workflowType: 'DEPOSIT',
      reason: 'Initial simulation',
      afterData: { status: 'DETECTED' },
    });

    expect(result.traceId).toBe('DEPOSIT:payin-1');
    expect(result.workflowType).toBe('DEPOSIT');
    expect(result.workflowId).toBe('dep-1');
    expect(result.workflowNo).toBe('DEP2603010001');
    expect(result.subjectNos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subjectType: 'DEPOSIT',
          subjectNo: 'DEP2603010001',
        }),
        expect.objectContaining({
          subjectType: 'PAYIN',
          subjectNo: 'PI2603010001',
        }),
      ]),
    );
  });

  it('should mask payload and generate payloadDigest', async () => {
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
        module: AuditModules.WITHDRAW_TRANSACTIONS,
        entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
        entityId: 'wd-1',
        statusFrom: 'PAYOUT_PENDING',
        statusTo: 'SUCCESS',
        sourceIp: '192.168.8.50',
        beforeData: {
          email: 'alice@example.com',
          phone: '13800138000',
          nested: {
            iban: 'AE12345678901234567890',
            authorization: 'Bearer secret-token',
          },
        },
        afterData: {
          status: 'SUCCESS',
          payout: {
            walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
          },
          token: 'raw-token',
        },
      },
      {
        actorType: 'ADMIN',
        actorId: 'admin-2',
        actorRole: 'OPS',
      },
    );

    expect(result.sourceIp).toBe('192.168.8.0');
    expect(result.payloadDigest).toHaveLength(64);
    expect((result.beforeData as any).email).toBe('a***@example.com');
    expect((result.beforeData as any).nested.iban).toMatch(/7890$/);
    expect((result.beforeData as any).nested.authorization).toBe('***');
    expect((result.afterData as any).token).toBe('***');
    expect((result.afterData as any).payout.walletAddress).toMatch(/^0x1234/i);
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
        module: AuditModules.WITHDRAW_TRANSACTIONS,
        entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
        entityId: 'wd-2',
        beforeData: { b: 2, a: 1 },
        afterData: { nested: { y: 2, x: 1 }, ok: true },
        occurredAt: '2026-02-18T10:00:00.000Z',
      },
      {
        actorType: 'ADMIN',
        actorId: 'admin-7',
        actorRole: 'OPS',
      },
    );

    await service.recordByActor(
      {
        idempotencyKey: 'digest-test-2',
        action: 'WITHDRAW_METADATA_UPDATED',
        module: AuditModules.WITHDRAW_TRANSACTIONS,
        entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
        entityId: 'wd-2',
        beforeData: { a: 1, b: 2 },
        afterData: { ok: true, nested: { x: 1, y: 2 } },
        occurredAt: '2026-02-18T10:00:00.000Z',
      },
      {
        actorType: 'ADMIN',
        actorId: 'admin-7',
        actorRole: 'OPS',
      },
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
        module: 'orchestrators/reconcile',
        entityType: 'SYSTEM_TASK',
        entityId: 'task-1',
      },
      {
        actorType: 'SYSTEM',
        actorId: 'SYSTEM',
        actorRole: 'SYSTEM',
      },
    );

    const second = await service.recordByActor(
      {
        idempotencyKey: 'fixed-key-1',
        action: 'SYSTEM_RECONCILE_EXECUTED',
        module: 'orchestrators/reconcile',
        entityType: 'SYSTEM_TASK',
        entityId: 'task-1',
      },
      {
        actorType: 'SYSTEM',
        actorId: 'SYSTEM',
        actorRole: 'SYSTEM',
      },
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
        triggerType: AuditTriggerType.DATA_UPDATE,
        action: 'WITHDRAW_UPDATED',
        module: 'trading/withdraw',
        entityType: 'WITHDRAW_TRANSACTION',
        entityId: 'wd-1',
        actorType: 'ADMIN',
        actorId: 'admin-1',
        result: AuditResult.SUCCESS,
        metadata: JSON.stringify({ source: 'api' }),
        beforeData: JSON.stringify({ status: 'CREATED' }),
        afterData: JSON.stringify({ status: 'SUCCESS' }),
        occurredAt: new Date('2026-02-18T10:00:00.000Z'),
      },
    ]);

    const result = await service.findAll({ take: 20 });

    expect(result.total).toBe(1);
    expect(result.items[0].metadata).toEqual({ source: 'api' });
    expect(result.items[0].beforeData).toEqual({ status: 'CREATED' });
    expect(result.items[0].afterData).toEqual({ status: 'SUCCESS' });
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
    expect(where.archivedAt).toBeNull();
    expect(where.deletedAt).toBeUndefined();
    expect(where.occurredAt.gte.toISOString()).toBe('2026-02-18T00:00:00.000Z');
    expect(where.occurredAt.lte.toISOString()).toBe('2026-02-18T23:59:59.999Z');
    expect(where.OR).toEqual(
      expect.arrayContaining([
        { action: { contains: 'WITHDRAW' } },
        { reason: { contains: 'WITHDRAW' } },
      ]),
    );
  });

  it('should build No filters including subjectNo/actorNo/entityOwnerNo', async () => {
    prisma.auditLogEvent.count.mockResolvedValue(0);
    prisma.auditLogEvent.findMany.mockResolvedValue([]);

    await service.findAll({
      subjectNo: 'CU2602180001',
      subjectType: 'CUSTOMER',
      actorNo: 'US2602180001',
      entityOwnerNo: 'CU2602180001',
      take: 20,
    });

    const where = prisma.auditLogEvent.count.mock.calls[0][0].where;
    expect(where.actorNo).toBe('US2602180001');
    expect(where.entityOwnerNo).toBe('CU2602180001');
    expect(where.subjectNos).toEqual({
      some: {
        subjectNo: 'CU2602180001',
        subjectType: 'CUSTOMER',
      },
    });
  });

  it('should map subjectNos from audit log records', async () => {
    prisma.auditLogEvent.count.mockResolvedValue(1);
    prisma.auditLogEvent.findMany.mockResolvedValue([
      {
        id: 'a-sub-1',
        auditNo: 'AUD2602180999',
        triggerType: AuditTriggerType.DATA_UPDATE,
        action: 'WALLET_STATUS_UPDATED',
        module: 'asset-treasury/wallets',
        entityType: 'WALLET',
        entityId: 'wallet-1',
        actorType: 'ADMIN',
        actorId: 'admin-1',
        result: AuditResult.SUCCESS,
        metadata: null,
        beforeData: null,
        afterData: null,
        subjectNos: [
          {
            id: 'sub-1',
            eventId: 'a-sub-1',
            subjectRole: 'ENTITY',
            subjectType: 'WALLET',
            subjectId: 'wallet-1',
            subjectNo: 'WA2602180001',
            occurredAt: new Date('2026-02-18T10:00:00.000Z'),
            createdAt: new Date('2026-02-18T10:00:00.000Z'),
          },
        ],
        occurredAt: new Date('2026-02-18T10:00:00.000Z'),
      },
    ]);

    const result = await service.findAll({ take: 20 });
    expect(result.items[0].subjectNos).toHaveLength(1);
    expect(result.items[0].subjectNos[0].subjectNo).toBe('WA2602180001');
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
          action: AuditActions.ADMIN_LOGIN_SUCCESS,
          module: AuditModules.AUTH,
          entityType: AuditEntityTypes.AUTH,
        },
        {
          actorType: 'ADMIN',
          actorId: 'admin-1',
          actorRole: 'OPS',
        },
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
        triggerType: AuditTriggerType.DATA_UPDATE,
        action: AuditActions.DEPOSIT_ACCOUNTING_POSTED,
        module: AuditModules.DEPOSIT_TRANSACTIONS,
        entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
        entityId: 'dep-1',
        entityNo: 'DEP2603240001',
        actorType: 'SYSTEM',
        actorId: 'SYSTEM',
        workflowType: 'DEPOSIT',
        workflowId: 'dep-1',
        workflowNo: 'DEP2603240001',
        metadata: null,
        beforeData: null,
        afterData: null,
        occurredAt: new Date('2026-03-24T08:00:00.000Z'),
        subjectNos: [],
      },
    ]);
    prisma.depositTransaction.findMany.mockResolvedValue([
      {
        id: 'dep-1',
        depositNo: 'DEP2603240001',
        payin: {
          id: 'payin-1',
          payinNo: 'PI2603240001',
          status: 'CLEARED',
          type: 'CRYPTO',
          txHash: '0xabc',
          referenceNo: null,
          statusHistory: '[]',
          receivedAt: new Date('2026-03-24T08:00:00.000Z'),
          confirmedAt: new Date('2026-03-24T08:01:00.000Z'),
        },
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
    prisma.internalTransaction.findMany.mockResolvedValue([
      {
        id: 'itx-1',
        internalTxNo: 'ITX2603240001',
        sourceType: 'DEPOSIT',
        sourceId: 'dep-1',
        sourceNo: 'DEP2603240001',
        type: 'DEP_TO_MASTER',
        status: 'SUCCESS',
        approvalStatus: 'APPROVED',
        assetId: 'asset-1',
        amount: '100.00',
        feeAmount: '0',
        netAmount: '100.00',
        fromWalletId: 'wallet-dep',
        toWalletId: 'wallet-master',
        referenceNo: 'DEP2603240001',
        createdAt: new Date('2026-03-24T08:06:00.000Z'),
        updatedAt: new Date('2026-03-24T08:06:00.000Z'),
        completedAt: new Date('2026-03-24T08:06:10.000Z'),
      },
    ]);
    prisma.internalFund.findMany.mockResolvedValue([
      {
        id: 'ifd-1',
        internalFundNo: 'IFD2603240001',
        internalTransactionId: 'itx-1',
        status: 'CLEAR',
        assetId: 'asset-1',
        amount: '100.00',
        feeAmount: '0',
        netAmount: '100.00',
        fromWalletId: 'wallet-dep',
        toWalletId: 'wallet-master',
        referenceNo: 'DEP2603240001',
        txHash: '0xinternal',
        createdAt: new Date('2026-03-24T08:06:20.000Z'),
        updatedAt: new Date('2026-03-24T08:06:20.000Z'),
        confirmedAt: new Date('2026-03-24T08:06:15.000Z'),
        completedAt: new Date('2026-03-24T08:06:20.000Z'),
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
          actorId: 'admin-1',
          actorRole: 'OPS',
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
          internalTransactions: expect.any(Array),
          internalFunds: expect.any(Array),
          depositEvidenceChain: expect.any(Array),
        }),
      );
      expect(snapshots.depositEvidenceChain).toEqual([
        expect.objectContaining({
          depositId: 'dep-1',
          payinId: 'payin-1',
          decisionRecordIds: ['dr-1'],
          kytCaseIds: ['kyt-1'],
          travelRuleCaseIds: ['tr-1'],
          alertIds: ['alert-1'],
          caseIds: ['case-1'],
          journalIds: ['journal-1', 'journal-2'],
          internalTransactionIds: ['itx-1'],
          internalFundIds: ['ifd-1'],
        }),
      ]);

      const artifactsAgain = await service.buildEvidencePackageArtifacts(
        {
          selectedEventIds: ['8f89c12b-6c5a-4b8a-8b59-53f59d4b2a70'],
          workflowType: 'DEPOSIT',
        } as any,
        {
          actorType: 'ADMIN',
          actorId: 'admin-1',
          actorRole: 'OPS',
        },
      );

      expect(artifacts.digest).toBe(artifactsAgain.digest);
    } finally {
      jest.useRealTimers();
    }
  });
});
