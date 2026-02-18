import { NotFoundException } from '@nestjs/common';
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
      auditEvidencePackage: {
        create: jest.fn(),
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

  it('should export evidence package and persist export record', async () => {
    prisma.auditLogEvent.findMany.mockResolvedValue([
      {
        id: 'a4',
        auditNo: 'AUD2602180004',
        triggerType: AuditTriggerType.STATE_TRANSITION,
        action: 'WITHDRAW_APPROVED',
        module: 'trading/withdraw',
        entityType: 'WITHDRAW_TRANSACTION',
        entityId: 'wd-1',
        statusFrom: 'CREATED',
        statusTo: 'PAYOUT_PENDING',
        actorType: 'ADMIN',
        actorId: 'admin-1',
        result: AuditResult.SUCCESS,
        payloadDigest: 'f'.repeat(64),
        metadata: JSON.stringify({ channel: 'admin-web' }),
        beforeData: JSON.stringify({ status: 'CREATED' }),
        afterData: JSON.stringify({ status: 'PAYOUT_PENDING' }),
        occurredAt: new Date('2026-02-18T10:00:00.000Z'),
      },
    ]);

    prisma.auditEvidencePackage.create.mockResolvedValue({
      id: 'pkg-id-1',
      packageNo: 'EVP2602180001',
    });

    prisma.auditLogEvent.findUnique.mockResolvedValue(null);
    prisma.auditLogEvent.create.mockResolvedValue({
      id: 'exp-log-1',
      auditNo: 'AUD2602180100',
      triggerType: AuditTriggerType.EVIDENCE_EXPORT,
      action: AuditActions.AUDIT_EVIDENCE_PACKAGE_EXPORTED,
      module: AuditModules.AUDIT_LOGS,
      entityType: AuditEntityTypes.AUDIT_EVIDENCE_PACKAGE,
      entityId: 'pkg-id-1',
      actorType: 'ADMIN',
      actorId: 'admin-1',
      payloadDigest: 'a'.repeat(64),
      metadata: null,
      beforeData: null,
      afterData: null,
      occurredAt: new Date(),
    });

    const result = await service.exportEvidencePackage(
      { maxItems: 500, includeRecords: true },
      {
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorRole: 'OPS',
      },
    );

    expect(result.packageNo).toBe('EVP2602180001');
    expect(result.itemCount).toBe(1);
    expect(result.digest).toHaveLength(64);
    expect(result.records).toHaveLength(1);
    expect(prisma.auditEvidencePackage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          exportedByType: 'ADMIN',
          exportedById: 'admin-1',
          itemCount: 1,
        }),
      }),
    );
    expect(prisma.auditLogEvent.create).toHaveBeenCalled();
  });
});
