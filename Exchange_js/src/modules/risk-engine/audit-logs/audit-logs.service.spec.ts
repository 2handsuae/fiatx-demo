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
      withdrawTransaction: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      payout: {
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
      reconciliationBreak: {
        findMany: jest.fn(),
      },
      outstanding: {
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

  it('should allow canonical swap state-transition actions without allowlist entries', async () => {
    prisma.auditLogEvent.findUnique.mockResolvedValue(null);
    prisma.auditLogEvent.create.mockImplementation(({ data }: any) =>
      Promise.resolve({
        id: 'a-swap-transition',
        auditNo: 'AUD2603260099',
        ...data,
      }),
    );

    const result = await service.recordSystem({
      triggerType: AuditTriggerType.STATE_TRANSITION,
      action: 'SWAP_PENDING_COMPLIANCE_TO_SUCCESS',
      module: AuditModules.SWAP_TRANSACTIONS,
      entityType: AuditEntityTypes.SWAP_TRANSACTION,
      entityId: 'swap-1',
      statusFrom: 'PENDING_COMPLIANCE',
      statusTo: 'SUCCESS',
    });

    expect(result.triggerType).toBe(AuditTriggerType.STATE_TRANSITION);
    expect(result.action).toBe('SWAP_PENDING_COMPLIANCE_TO_SUCCESS');
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

  it('should persist multi-anchor subjectNos and digest-backed evidence payloads', async () => {
    prisma.auditLogEvent.findUnique.mockResolvedValue(null);
    prisma.auditLogEvent.create.mockImplementation(({ data }: any) =>
      Promise.resolve({
        id: 'a-contract',
        auditNo: 'AUD2602180004',
        ...data,
        subjectNos: data.subjectNos?.create?.map((item: any, index: number) => ({
          id: `subject-${index}`,
          eventId: 'a-contract',
          createdAt: new Date('2026-02-18T10:00:00.000Z'),
          ...item,
        })),
      }),
    );

    const result = await service.recordByActor(
      {
        action: 'APPLICATION_STATUS_UPDATED',
        module: 'onboarding/applications',
        entityType: 'APPLICATION',
        entityId: 'app-1',
        entityNo: 'APP2602180001',
        entityOwnerType: 'CUSTOMER',
        entityOwnerId: 'cust-1',
        entityOwnerNo: 'CUS2602180001',
        beforeData: { status: 'PENDING' },
        afterData: { status: 'APPROVED' },
      },
      {
        actorType: 'ADMIN',
        actorId: 'admin-3',
        actorNo: 'OP2602180001',
        actorRole: 'OPS',
      },
    );

    expect(result.subjectNos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subjectNo: 'CUS2602180001',
        }),
        expect.objectContaining({
          subjectNo: 'APP2602180001',
        }),
      ]),
    );
    expect(result.beforeData).toEqual(
      expect.objectContaining({
        digest: expect.any(String),
      }),
    );
    expect(result.afterData).toEqual(
      expect.objectContaining({
        digest: expect.any(String),
      }),
    );
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
    expect(where.AND).toEqual(
      expect.arrayContaining([
        { actorNo: 'US2602180001' },
        { entityOwnerNo: 'CU2602180001' },
        {
          subjectNos: {
            some: {
              subjectNo: 'CU2602180001',
              subjectType: 'CUSTOMER',
            },
          },
        },
      ]),
    );
  });

  it('should keep swap workflowNo queries canonicalized to linked swap records only', async () => {
    prisma.swapTransaction.findMany
      .mockResolvedValueOnce([
        {
          id: 'swap-1',
          swapNo: 'SWP2603260001',
          quoteId: 'quote-1',
          quoteNo: 'QUO2603260001',
        },
      ])
      .mockResolvedValueOnce([]);
    prisma.swapQuote.findMany.mockResolvedValue([]);
    prisma.auditLogEvent.count.mockResolvedValue(0);
    prisma.auditLogEvent.findMany.mockResolvedValue([]);

    await service.findAll({
      workflowType: 'SWAP',
      workflowNo: 'SWP2603260001',
      take: 20,
    });

    const where = prisma.auditLogEvent.count.mock.calls[0][0].where;
    expect(where).toEqual(
      expect.objectContaining({
        AND: expect.arrayContaining([
          { workflowType: 'SWAP' },
          {
            OR: expect.arrayContaining([
              { workflowNo: { in: ['SWP2603260001'] } },
              {
                subjectNos: {
                  some: {
                    subjectNo: { in: ['SWP2603260001'] },
                  },
                },
              },
              {
                traceId: { in: ['SWAP:swap-1'] },
              },
            ]),
          },
          { archivedAt: null },
        ]),
      }),
    );
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

  it('should build full swap evidence snapshots and chain for export packages', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-26T12:00:00.000Z'));
    prisma.auditLogEvent.findMany.mockResolvedValue([
      {
        id: 'audit-swap-1',
        auditNo: 'AUD2603260001',
        triggerType: AuditTriggerType.DATA_UPDATE,
        action: AuditActions.SWAP_CREATED,
        module: AuditModules.SWAP_TRANSACTIONS,
        entityType: AuditEntityTypes.SWAP_TRANSACTION,
        entityId: 'swap-1',
        entityNo: 'SWP2603260001',
        actorType: 'CUSTOMER',
        actorId: 'customer-1',
        workflowType: 'SWAP',
        workflowId: 'quote-1',
        workflowNo: 'QUO2603260001',
        metadata: null,
        beforeData: null,
        afterData: null,
        occurredAt: new Date('2026-03-26T11:00:00.000Z'),
        subjectNos: [],
      },
      {
        id: 'audit-swap-2',
        auditNo: 'AUD2603260002',
        triggerType: AuditTriggerType.DATA_UPDATE,
        action: AuditActions.TX_SWAP_RELEASED,
        module: AuditModules.SWAP_TRANSACTIONS,
        entityType: AuditEntityTypes.SWAP_TRANSACTION,
        entityId: 'swap-1',
        entityNo: 'SWP2603260001',
        actorType: 'SYSTEM',
        actorId: 'SYSTEM',
        workflowType: 'SWAP',
        workflowId: 'swap-1',
        workflowNo: 'SWP2603260001',
        metadata: null,
        beforeData: null,
        afterData: null,
        occurredAt: new Date('2026-03-26T11:02:00.000Z'),
        subjectNos: [],
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
          amlRiskTier: 'LOW',
          investorClassification: 'RETAIL',
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
    prisma.outstanding.findMany.mockResolvedValue([
      {
        id: 'os-swap-1',
        outstandingNo: 'OUT2603260001',
        sourceType: 'SWAP',
        sourceId: 'swap-1',
        sourceNo: 'SWP2603260001',
        direction: 'OUT',
        assetId: 'asset-usdt',
        assetCode: 'USDT',
        amount: '1000.00',
        status: 'OPEN',
        createdAt: new Date('2026-03-26T11:02:15.000Z'),
        updatedAt: new Date('2026-03-26T11:02:15.000Z'),
        closedAt: null,
      },
      {
        id: 'os-swap-2',
        outstandingNo: 'OUT2603260002',
        sourceType: 'SWAP',
        sourceId: 'swap-1',
        sourceNo: 'SWP2603260001',
        direction: 'IN',
        assetId: 'asset-btc',
        assetCode: 'BTC',
        amount: '0.00995000',
        status: 'OPEN',
        createdAt: new Date('2026-03-26T11:02:15.000Z'),
        updatedAt: new Date('2026-03-26T11:02:15.000Z'),
        closedAt: null,
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
          actorId: 'admin-1',
          actorRole: 'OPS',
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
          swapOutstandings: expect.any(Array),
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
          outstandingIds: ['os-swap-1', 'os-swap-2'],
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
        triggerType: AuditTriggerType.DATA_UPDATE,
        action: AuditActions.SYSTEM_WITHDRAW_APPROVED_ORCHESTRATED,
        module: AuditModules.WITHDRAW_TRANSACTIONS,
        entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
        entityId: 'withdraw-1',
        entityNo: 'WD2603270001',
        actorType: 'ADMIN',
        actorId: 'admin-1',
        workflowType: 'WITHDRAW',
        workflowId: 'withdraw-1',
        workflowNo: 'WD2603270001',
        metadata: null,
        beforeData: null,
        afterData: null,
        occurredAt: new Date('2026-03-27T10:00:00.000Z'),
        subjectNos: [],
      },
      {
        id: 'audit-withdraw-2',
        auditNo: 'AUD2603270002',
        triggerType: AuditTriggerType.DATA_UPDATE,
        action: AuditActions.TX_RECONCILIATION_BREAK_DETECTED,
        module: AuditModules.SAFEGUARDING_RECONCILIATION,
        entityType: AuditEntityTypes.RECONCILIATION_BREAK,
        entityId: 'break-1',
        entityNo: 'RBR2603270001',
        actorType: 'SYSTEM',
        actorId: 'SYSTEM',
        workflowType: 'WITHDRAW',
        workflowId: 'withdraw-1',
        workflowNo: 'WD2603270001',
        metadata: null,
        beforeData: null,
        afterData: null,
        occurredAt: new Date('2026-03-27T12:00:00.000Z'),
        subjectNos: [],
      },
    ]);
    prisma.withdrawTransaction.findMany.mockResolvedValue([
      {
        id: 'withdraw-1',
        withdrawNo: 'WD2603270001',
        payoutId: 'payout-1',
        payoutNo: 'PO2603270001',
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
          amlRiskTier: 'LOW',
        },
        payout: {
          id: 'payout-1',
          payoutNo: 'PO2603270001',
          status: 'CLEAR',
          amount: '100.00',
          referenceNo: 'BANKREF-1',
          txHash: '0xwithdraw',
          asset: {
            id: 'asset-btc',
            code: 'BTC',
            type: 'CRYPTO',
            network: 'BTC',
            decimals: 8,
          },
        },
      },
    ]);
    prisma.payout.findMany.mockResolvedValue([
      {
        id: 'payout-1',
        payoutNo: 'PO2603270001',
        status: 'CLEAR',
        amount: '100.00',
        txHash: '0xwithdraw',
        referenceNo: 'BANKREF-1',
        createdAt: new Date('2026-03-27T09:55:00.000Z'),
        completedAt: new Date('2026-03-27T10:05:00.000Z'),
        asset: {
          id: 'asset-btc',
          code: 'BTC',
          type: 'CRYPTO',
          network: 'BTC',
          decimals: 8,
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
    prisma.reconciliationBreak.findMany.mockResolvedValue([
      {
        id: 'break-1',
        breakNo: 'RBR2603270001',
        businessDate: '2026-03-27',
        sourceType: 'WITHDRAW',
        sourceId: 'withdraw-1',
        sourceNo: 'WD2603270001',
        withdrawId: 'withdraw-1',
        withdrawNo: 'WD2603270001',
        payoutId: 'payout-1',
        payoutNo: 'PO2603270001',
        assetId: 'asset-btc',
        assetCode: 'BTC',
        expectedNetDelta: '100.00',
        observedNetDelta: '100.00',
        deltaAmount: '0.00',
        reasonCode: 'SUCCESS_CLOSEOUT_INCOMPLETE',
        status: 'RESOLVED',
        linkedAlertId: 'alert-recon-1',
        linkedCaseId: null,
        detailsJson: JSON.stringify({ observedSource: 'PAYOUT' }),
        detectedAt: new Date('2026-03-27T12:00:00.000Z'),
        resolvedAt: new Date('2026-03-27T12:10:00.000Z'),
        reopenedAt: null,
        createdAt: new Date('2026-03-27T12:00:00.000Z'),
        updatedAt: new Date('2026-03-27T12:10:00.000Z'),
      },
    ]);

    try {
      const artifacts = await service.buildEvidencePackageArtifacts(
        {
          selectedEventIds: ['audit-withdraw-1', 'audit-withdraw-2'],
          workflowType: 'WITHDRAW',
        } as any,
        {
          actorType: 'ADMIN',
          actorId: 'admin-1',
          actorRole: 'OPS',
        },
      );
      const snapshots = (artifacts.packageBody as any).snapshots;

      expect(artifacts.manifest.workflowSummary).toEqual({
        workflowType: 'WITHDRAW',
        workflowNos: ['WD2603270001'],
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
          reconciliationBreaks: expect.any(Array),
          withdrawEvidenceChain: expect.any(Array),
        }),
      );
      expect(snapshots.withdrawEvidenceChain).toEqual([
        expect.objectContaining({
          withdrawId: 'withdraw-1',
          payoutId: 'payout-1',
          decisionRecordIds: ['dr-final-1', 'dr-pre-1'],
          preKytCaseIds: ['kyt-pre-1'],
          mainKytCaseIds: ['kyt-main-1'],
          travelRuleCaseIds: ['tr-1'],
          alertIds: ['alert-final-1', 'alert-recon-1'],
          caseIds: ['case-1'],
          journalIds: ['journal-withdraw-1'],
          clearingIds: ['clearing-1'],
          reconciliationBreakIds: ['break-1'],
        }),
      ]);
      expect(snapshots.reconciliationBreaks).toEqual([
        expect.objectContaining({
          id: 'break-1',
          breakNo: 'RBR2603270001',
          withdrawId: 'withdraw-1',
          payoutId: 'payout-1',
        }),
      ]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('should canonicalize swap export workflow summary and filter snapshot to swapNo when a linked swap is resolved', async () => {
    prisma.swapTransaction.findMany
      .mockResolvedValueOnce([
        {
          id: 'swap-1',
          swapNo: 'SWP2603260001',
          quoteId: 'quote-1',
          quoteNo: 'QUO2603260001',
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
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
        triggerType: AuditTriggerType.DATA_UPDATE,
        action: AuditActions.SWAP_CREATED,
        module: AuditModules.SWAP_TRANSACTIONS,
        entityType: AuditEntityTypes.SWAP_TRANSACTION,
        entityId: 'swap-1',
        entityNo: 'SWP2603260001',
        actorType: 'CUSTOMER',
        actorId: 'customer-1',
        workflowType: 'SWAP',
        workflowId: 'quote-1',
        workflowNo: 'QUO2603260001',
        metadata: null,
        beforeData: null,
        afterData: null,
        occurredAt: new Date('2026-03-26T11:00:00.000Z'),
        subjectNos: [],
      },
    ]);

    const result = await service.prepareEvidenceExportSelection({
      selectedEventIds: ['audit-swap-1'],
      workflowType: 'SWAP',
      workflowNo: 'QUO2603260001',
    } as any);

    expect(result.workflowSummary).toEqual({
      workflowType: 'SWAP',
      workflowNos: ['SWP2603260001'],
    });
    expect(result.normalizedCriteria.workflowNo).toBe('SWP2603260001');
    expect(result.filterSnapshot.workflowNo).toBe('SWP2603260001');
  });

  it('should reject quote-only swap export selection without a linked swap', async () => {
    prisma.swapTransaction.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    prisma.swapQuote.findMany.mockResolvedValue([
      {
        id: 'quote-1',
        quoteNo: 'QUO2603260999',
      },
    ]);
    prisma.auditLogEvent.findMany.mockResolvedValue([
      {
        id: 'audit-quote-1',
        auditNo: 'AUD2603260999',
        triggerType: AuditTriggerType.DATA_CREATE,
        action: AuditActions.SWAP_QUOTE_CREATED,
        module: AuditModules.SWAP_TRANSACTIONS,
        entityType: AuditEntityTypes.SWAP_QUOTE,
        entityId: 'quote-1',
        entityNo: 'QUO2603260999',
        actorType: 'CUSTOMER',
        actorId: 'customer-1',
        workflowType: 'SWAP',
        workflowId: 'quote-1',
        workflowNo: 'QUO2603260999',
        metadata: null,
        beforeData: null,
        afterData: null,
        occurredAt: new Date('2026-03-26T11:00:00.000Z'),
        subjectNos: [],
      },
    ]);

    await expect(
      service.prepareEvidenceExportSelection({
        selectedEventIds: ['audit-quote-1'],
        workflowType: 'SWAP',
        workflowNo: 'QUO2603260999',
      } as any),
    ).rejects.toThrow('linked swap');
  });
});
