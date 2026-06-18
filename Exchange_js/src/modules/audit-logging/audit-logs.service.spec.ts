import { InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { AuditLogsService } from './audit-logs.service';
import {
  AuditResult,
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
      CUSTODIAN_WALLET_CREATE: 'CUSTODIAN_WALLET_CREATE',
      WITHDRAWAL_ADDRESS_REGISTRATION: 'WITHDRAWAL_ADDRESS_REGISTRATION',
      TB_ACCOUNT_MANUAL_CREATE: 'TB_ACCOUNT_MANUAL_CREATE',
      TRADING_TIER_UPGRADE: 'TRADING_TIER_UPGRADE',
      TRANSACTION_LIMIT_CHANGE: 'TRANSACTION_LIMIT_CHANGE',
      TRANSACTION_LIMIT_CREATION: 'TRANSACTION_LIMIT_CREATION',
      WITHDRAWAL_FEE_LEVEL_CREATION: 'WITHDRAWAL_FEE_LEVEL_CREATION',
      WITHDRAWAL_FEE_LEVEL_CHANGE: 'WITHDRAWAL_FEE_LEVEL_CHANGE',
      WITHDRAWAL_FEE_LEVEL_BINDING: 'WITHDRAWAL_FEE_LEVEL_BINDING',
      ASSET_SUSPENSION: 'ASSET_SUSPENSION',
      ASSET_REACTIVATION: 'ASSET_REACTIVATION',
      ASSET_CREATION: 'ASSET_CREATION',
      ASSET_ACTIVATION: 'ASSET_ACTIVATION',
      SWAP_FEE_LEVEL_CREATION: 'SWAP_FEE_LEVEL_CREATION',
      SWAP_FEE_LEVEL_CHANGE: 'SWAP_FEE_LEVEL_CHANGE',
      SWAP_FEE_LEVEL_BINDING: 'SWAP_FEE_LEVEL_BINDING',
      WITHDRAW_LARGE_VALUE_APPROVAL: 'WITHDRAW_LARGE_VALUE_APPROVAL',
      INTERNAL_TRANSFER: 'INTERNAL_TRANSFER',
      V8_RECONCILIATION: 'clearing-settle/reconciliation',
    });

    expect(AuditUserActions).toEqual({
      REQUEST_CREATED: 'REQUEST_CREATED',
      SUBMITTED: 'SUBMITTED',
      APPROVED_FOR_EXECUTION: 'APPROVED_FOR_EXECUTION',
      EXECUTED: 'EXECUTED',
      INVITATION_ISSUED: 'INVITATION_ISSUED',
      INVITATION_RESENT: 'INVITATION_RESENT',
      ACTIVATED: 'ACTIVATED',
      ACTIVATION_FAILED: 'ACTIVATION_FAILED',
      LOGIN_SUCCEEDED: 'LOGIN_SUCCEEDED',
      LOGIN_FAILED: 'LOGIN_FAILED',
      ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
      ACCOUNT_UNLOCKED: 'ACCOUNT_UNLOCKED',
      ROLE_BINDINGS_UPDATED: 'ROLE_BINDINGS_UPDATED',
      CANCELLED: 'CANCELLED',
      EXPORTED: 'EXPORTED',
      EXPORT_FAILED: 'EXPORT_FAILED',
      DOWNLOADED: 'DOWNLOADED',
    });
  });

  it('should map raw technical audit actions to user-layer actions', () => {
    expect(mapRawAuditActionToUserAction(AuditActions.APPROVAL_SUBMITTED)).toBe(
      AuditUserActions.SUBMITTED,
    );
    expect(mapRawAuditActionToUserAction(AuditActions.APPROVAL_APPROVED)).toBe(
      AuditUserActions.APPROVED_FOR_EXECUTION,
    );
    expect(mapRawAuditActionToUserAction(AuditActions.APPROVAL_EXECUTED)).toBe(
      AuditUserActions.EXECUTED,
    );
    expect(mapRawAuditActionToUserAction(AuditActions.ADMIN_INVITATION_CREATED)).toBe(
      AuditUserActions.INVITATION_ISSUED,
    );
    expect(mapRawAuditActionToUserAction(AuditActions.ADMIN_INVITATION_RESENT)).toBe(
      AuditUserActions.INVITATION_RESENT,
    );
    expect(mapRawAuditActionToUserAction(AuditActions.ADMIN_INVITATION_ACCEPTED)).toBe(
      AuditUserActions.ACTIVATED,
    );
    expect(mapRawAuditActionToUserAction(AuditActions.ADMIN_INVITATION_ACCEPT_FAILED)).toBe(
      AuditUserActions.ACTIVATION_FAILED,
    );
    expect(mapRawAuditActionToUserAction(AuditActions.ADMIN_LOGIN_SUCCESS)).toBe(
      AuditUserActions.LOGIN_SUCCEEDED,
    );
    expect(mapRawAuditActionToUserAction(AuditActions.ADMIN_LOGIN_FAILED)).toBe(
      AuditUserActions.LOGIN_FAILED,
    );
    expect(mapRawAuditActionToUserAction(AuditActions.ACCOUNT_LOCKED)).toBe(
      AuditUserActions.ACCOUNT_LOCKED,
    );
    expect(mapRawAuditActionToUserAction(AuditActions.ACCOUNT_UNLOCKED)).toBe(
      AuditUserActions.ACCOUNT_UNLOCKED,
    );
    expect(mapRawAuditActionToUserAction(AuditActions.AUDIT_EVIDENCE_PACKAGE_EXPORTED)).toBe(
      AuditUserActions.EXPORTED,
    );
    expect(
      mapRawAuditActionToUserAction(AuditActions.AUDIT_EVIDENCE_EXPORT_REQUESTED),
    ).toBe(AuditUserActions.REQUEST_CREATED);
    expect(
      mapRawAuditActionToUserAction(AuditActions.AUDIT_EVIDENCE_PACKAGE_DOWNLOADED),
    ).toBe(AuditUserActions.DOWNLOADED);
    expect(mapRawAuditActionToUserAction(AuditActions.APPROVAL_EXECUTION_FAILED)).toBe(
      AuditUserActions.EXPORT_FAILED,
    );
    expect(mapRawAuditActionToUserAction(AuditActions.USER_CREATED)).toBe(
      AuditUserActions.EXECUTED,
    );
    expect(mapRawAuditActionToUserAction(AuditActions.USER_ROLE_BINDING_UPDATED)).toBe(
      AuditUserActions.ROLE_BINDINGS_UPDATED,
    );
    expect(mapRawAuditActionToUserAction('UNKNOWN_WAVE1_ACTION')).toBeUndefined();
  });


  it('should map evidence export request and download actions into the audit evidence export workflow', async () => {
    prisma.auditLogEvent.count.mockResolvedValue(2);
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
        result: AuditResult.SUCCESS,
        metadata: null,
        beforeData: null,
        afterData: null,
        occurredAt: new Date('2026-04-05T10:00:00.000Z'),
      },
      {
        id: 'wf-exp-download-1',
        auditNo: 'AUD2604051002',
        action: AuditActions.AUDIT_EVIDENCE_PACKAGE_DOWNLOADED,
        entityType: AuditEntityTypes.AUDIT_EVIDENCE_PACKAGE,
        entityId: 'pkg-1',
        entityNo: 'EVP2604050351',
        workflowType: AuditBusinessWorkflowTypes.AUDIT_EVIDENCE_EXPORT,
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorNo: 'ADMIN-001',
        result: AuditResult.SUCCESS,
        metadata: null,
        beforeData: null,
        afterData: null,
        occurredAt: new Date('2026-04-05T10:05:00.000Z'),
      },
    ]);

    const result = await service.findAll({ take: 20 });

    expect(result.items[0]).toMatchObject({
      businessWorkflow: AuditBusinessWorkflowTypes.AUDIT_EVIDENCE_EXPORT,
      userAction: AuditUserActions.REQUEST_CREATED,
    });
    expect(result.items[1]).toMatchObject({
      businessWorkflow: AuditBusinessWorkflowTypes.AUDIT_EVIDENCE_EXPORT,
      userAction: AuditUserActions.DOWNLOADED,
    });
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
      action: AuditActions.PAYIN_CREATED,
      entityType: AuditEntityTypes.PAYIN,
      entityId: 'payin-1',
      entityNo: 'PI2603010001',
      entityOwnerType: 'CUSTOMER',
      entityOwnerId: 'cust-1',
      workflowType: 'DEPOSIT',
      reason: 'Initial simulation',
    });

    expect(result.traceId).toBe('DEPOSIT:payin-1');
    expect(result.workflowType).toBe('DEPOSIT');
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
        entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
        entityId: 'wd-1',
        sourceIp: '192.168.8.50',
      },
      {
        actorType: 'ADMIN',
        actorId: 'admin-2',
        actorRole: 'OPS',
      },
    );

    expect(result.sourceIp).toBe('192.168.8.0');
    expect(result.payloadDigest).toHaveLength(64);
  });

  it('should persist multi-anchor subjectNos and digest-backed evidence payloads', async () => {
    prisma.auditLogEvent.findUnique.mockResolvedValue(null);
    prisma.auditLogEvent.create.mockImplementation(({ data, include }: any) => {
      const subjectNos = include?.subjectNos
        ? [
            {
              id: 'subject-1',
              eventId: 'a-contract',
              subjectRole: 'OWNER',
              subjectType: 'CUSTOMER',
              subjectId: 'cust-1',
              subjectNo: 'CUS2602180001',
              occurredAt: new Date('2026-02-18T10:00:00.000Z'),
              createdAt: new Date('2026-02-18T10:00:00.000Z'),
            },
            {
              id: 'subject-2',
              eventId: 'a-contract',
              subjectRole: 'ENTITY',
              subjectType: 'APPLICATION',
              subjectId: 'app-1',
              subjectNo: 'APP2602180001',
              occurredAt: new Date('2026-02-18T10:00:00.000Z'),
              createdAt: new Date('2026-02-18T10:00:00.000Z'),
            },
            {
              id: 'subject-3',
              eventId: 'a-contract',
              subjectRole: 'ACTOR',
              subjectType: 'ADMIN',
              subjectId: 'admin-3',
              subjectNo: 'OP2602180001',
              occurredAt: new Date('2026-02-18T10:00:00.000Z'),
              createdAt: new Date('2026-02-18T10:00:00.000Z'),
            },
          ]
        : undefined;

      return Promise.resolve({
        id: 'a-contract',
        auditNo: 'AUD2602180004',
        ...data,
        ...(subjectNos ? { subjectNos } : {}),
      });
    });

    const result = await service.recordByActor(
      {
        action: 'APPLICATION_STATUS_UPDATED',
        entityType: 'APPLICATION',
        entityId: 'app-1',
        entityNo: 'APP2602180001',
        entityOwnerType: 'CUSTOMER',
        entityOwnerId: 'cust-1',
        entityOwnerNo: 'CUS2602180001',
      },
      {
        actorType: 'ADMIN',
        actorId: 'admin-3',
        actorNo: 'OP2602180001',
        actorRole: 'OPS',
      },
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
        entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
        entityId: 'wd-2',
        metadata: { b: 2, a: 1 },
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
        entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
        entityId: 'wd-2',
        metadata: { a: 1, b: 2 },
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
        action: 'WITHDRAW_UPDATED',
        entityType: 'WITHDRAW_TRANSACTION',
        entityId: 'wd-1',
        actorType: 'ADMIN',
        actorId: 'admin-1',
        result: AuditResult.SUCCESS,
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
    prisma.auditLogEvent.count.mockResolvedValue(4);
    prisma.auditLogEvent.findMany.mockResolvedValue([
      {
        id: 'wf-ct-1',
        auditNo: 'AUD2604010001',
        action: AuditActions.APPROVAL_APPROVED,
        entityType: AuditEntityTypes.APPROVAL_CASE,
        entityId: 'approval-1',
        entityNo: 'APR2604010001',
        workflowType: AuditBusinessWorkflowTypes.ADMIN_ROLE_BINDING_CHANGE,
        actorType: 'ADMIN',
        actorId: 'admin-1',
        result: AuditResult.SUCCESS,
        metadata: null,
        beforeData: null,
        afterData: null,
        occurredAt: new Date('2026-04-01T10:00:00.000Z'),
      },
      {
        id: 'wf-login-1',
        auditNo: 'AUD2604010003',
        action: AuditActions.ADMIN_LOGIN_SUCCESS,
        entityType: AuditEntityTypes.AUTH,
        entityId: null,
        entityNo: null,
        workflowType: null,
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorNo: 'ADM2604010001',
        result: AuditResult.SUCCESS,
        metadata: null,
        beforeData: null,
        afterData: null,
        occurredAt: new Date('2026-04-01T10:02:00.000Z'),
      },
      {
        id: 'wf-exp-1',
        auditNo: 'AUD2604010004',
        action: AuditActions.AUDIT_EVIDENCE_PACKAGE_EXPORTED,
        entityType: AuditEntityTypes.AUDIT_EVIDENCE_PACKAGE,
        entityId: 'pkg-1',
        entityNo: 'EVP2604010001',
        workflowType: AuditBusinessWorkflowTypes.AUDIT_EVIDENCE_EXPORT,
        actorType: 'ADMIN',
        actorId: 'admin-1',
        result: AuditResult.SUCCESS,
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
      userAction: AuditUserActions.APPROVED_FOR_EXECUTION,
      userActionLabel: 'Approved For Execution',
      action: AuditActions.APPROVAL_APPROVED,
    });
    expect(result.items[1]).toMatchObject({
      businessWorkflow: AuditBusinessWorkflowTypes.ADMIN_LOGIN_ACCESS,
      businessWorkflowLabel: 'Admin Login Access',
      userAction: AuditUserActions.LOGIN_SUCCEEDED,
      userActionLabel: 'Login Succeeded',
    });
    expect(result.items[2]).toMatchObject({
      businessWorkflow: AuditBusinessWorkflowTypes.AUDIT_EVIDENCE_EXPORT,
      businessWorkflowLabel: 'Audit Evidence Export',
      userAction: AuditUserActions.EXPORTED,
      userActionLabel: 'Exported',
    });
  });


  it('should not map approval execution failure to EXPORT_FAILED outside audit evidence export workflow', async () => {
    prisma.auditLogEvent.count.mockResolvedValue(1);
    prisma.auditLogEvent.findMany.mockResolvedValue([
      {
        id: 'exec-failed-1',
        auditNo: 'AUD2604010012',
        action: AuditActions.APPROVAL_EXECUTION_FAILED,
        entityType: AuditEntityTypes.APPROVAL_CASE,
        entityId: 'approval-2',
        entityNo: 'APR2604010002',
        workflowType: AuditBusinessWorkflowTypes.ADMIN_ROLE_BINDING_CHANGE,
        actorType: 'ADMIN',
        actorId: 'admin-1',
        result: AuditResult.FAILED,
        metadata: null,
        beforeData: null,
        afterData: null,
        occurredAt: new Date('2026-04-01T11:02:00.000Z'),
      },
    ]);

    const result = await service.findAll({ take: 20 });

    expect(result.items[0]).toMatchObject({
      businessWorkflow: AuditBusinessWorkflowTypes.ADMIN_ROLE_BINDING_CHANGE,
      userAction: AuditActions.APPROVAL_EXECUTION_FAILED,
      userActionLabel: 'Approval Execution Failed',
    });
  });

  it('should expose derived display fields on audit log detail while preserving raw tuple fields', async () => {
    prisma.auditLogEvent.findUnique.mockResolvedValue({
      id: 'detail-1',
      auditNo: 'AUD2604010100',
      action: AuditActions.APPROVAL_APPROVED,
      entityType: AuditEntityTypes.APPROVAL_CASE,
      entityId: 'approval-1',
      entityNo: 'APR2604010001',
      workflowType: AuditBusinessWorkflowTypes.ADMIN_ROLE_BINDING_CHANGE,
      traceId: 'trace-role-binding-1',
      actorType: 'ADMIN',
      actorId: 'admin-1',
      result: AuditResult.SUCCESS,
      metadata: null,
      beforeData: null,
      afterData: null,
      occurredAt: new Date('2026-04-01T12:00:00.000Z'),
    });

    const result = await service.findOne('detail-1');

    expect(result).toMatchObject({
      businessWorkflow: AuditBusinessWorkflowTypes.ADMIN_ROLE_BINDING_CHANGE,
      businessWorkflowLabel: 'Admin Role Binding Change',
      userAction: AuditUserActions.APPROVED_FOR_EXECUTION,
      userActionLabel: 'Approved For Execution',
      action: AuditActions.APPROVAL_APPROVED,
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
          action: AuditActions.ADMIN_LOGIN_SUCCESS,
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
        action: AuditActions.TX_SWAP_RELEASED,
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
        action: AuditActions.SYSTEM_WITHDRAW_APPROVED_ORCHESTRATED,
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
          riskRating: 'LOW',
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

    try {
      const artifacts = await service.buildEvidencePackageArtifacts(
        {
          selectedEventIds: ['audit-withdraw-1'],
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
          payoutId: 'payout-1',
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

  describe('buildDepositTraceId fallback ordering', () => {
    it('prefers deposit.traceId, then payin.traceId, then legacy DEPOSIT:<id>, else null', () => {
      const svc: any = service;

      // 1) deposit.traceId wins
      expect(
        svc.buildDepositTraceId(
          { id: 'p1', traceId: 'PAYIN_T' },
          { id: 'd1', payinId: 'p1', traceId: 'DEPOSIT_T' },
        ),
      ).toBe('DEPOSIT_T');

      // 2) no deposit.traceId — fall to payin.traceId
      expect(
        svc.buildDepositTraceId(
          { id: 'p1', traceId: 'PAYIN_T' },
          { id: 'd1', payinId: 'p1', traceId: null },
        ),
      ).toBe('PAYIN_T');

      // 3) neither traceId — legacy DEPOSIT:<payinId> (payin.id wins over deposit.payinId)
      expect(
        svc.buildDepositTraceId(
          { id: 'p1', traceId: null },
          { id: 'd1', payinId: 'p1', traceId: null },
        ),
      ).toBe('DEPOSIT:p1');

      // 4) only deposit.payinId
      expect(
        svc.buildDepositTraceId(null, { id: 'd1', payinId: 'p9', traceId: null }),
      ).toBe('DEPOSIT:p9');

      // 5) totally empty — null
      expect(svc.buildDepositTraceId(null, null)).toBeNull();
    });
  });

  describe('buildSwapTraceId fallback ordering', () => {
    it('prefers swap.traceId, then quote.traceId, then legacy SWAP:<id>, else null', () => {
      const svc: any = service;

      // 1) swap.traceId wins
      expect(
        svc.buildSwapTraceId(
          { id: 's1', traceId: 'SWAP_T' },
          { id: 'q1', traceId: 'QUOTE_T' },
        ),
      ).toBe('SWAP_T');

      // 2) no swap.traceId — use quote.traceId
      expect(
        svc.buildSwapTraceId(
          { id: 's1', traceId: null },
          { id: 'q1', traceId: 'QUOTE_T' },
        ),
      ).toBe('QUOTE_T');

      // 3) neither — legacy SWAP:<swap.id>
      expect(
        svc.buildSwapTraceId(
          { id: 's1', traceId: null },
          { id: 'q1', traceId: null },
        ),
      ).toBe('SWAP:s1');

      // 4) totally empty — null
      expect(svc.buildSwapTraceId(null, null)).toBeNull();
    });
  });

  describe('buildSettlementTraceId fallback ordering', () => {
    it('prefers batch.traceId, then legacy BATCH:<id>, else null', () => {
      const svc: any = service;

      // 1) batch.traceId wins
      expect(svc.buildSettlementTraceId({ id: 'b1', traceId: 'BATCH-T' })).toBe('BATCH-T');

      // 2) no batch.traceId — legacy BATCH:<id>
      expect(svc.buildSettlementTraceId({ id: 'b1', traceId: null })).toBe('BATCH:b1');

      // 3) totally empty — null
      expect(svc.buildSettlementTraceId(null)).toBeNull();
    });
  });
});
