import { Test, TestingModule } from '@nestjs/testing';
import { AdminPasswordResetWorkflowService } from './admin-password-reset-workflow.service';
import { UsersDomainService } from './users.domain.service';
import { UsersService } from './users.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { JwtService } from '@nestjs/jwt';
import { ConflictException, ForbiddenException } from '@nestjs/common';

const mockAuditLogsService = {
  recordByActor: jest.fn().mockResolvedValue({}),
  recordSystem: jest.fn().mockResolvedValue({}),
};

const mockApprovalsService = {
  createAndSubmit: jest.fn().mockResolvedValue({ approvalNo: 'APR001' }),
};

const mockPrisma: any = {
  passwordResetToken: {
    findFirst: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    updateMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  user: {
    findFirst: jest.fn(),
  },
  approvalCase: {
    findFirst: jest.fn().mockResolvedValue(null),
  },
  $transaction: jest.fn((fn: any) => fn(mockPrisma)),
};

const mockUsersService = {
  findByIdentifier: jest.fn(),
};

const mockUsersDomainService = {
  resetPassword: jest.fn(),
  findById: jest.fn().mockResolvedValue(null),
  findByUserNo: jest.fn().mockResolvedValue(null),
};

const mockJwtService = {
  sign: jest.fn().mockReturnValue('mock-mfa-token'),
};

const mockAdminActor = {
  actorType: 'ADMIN' as const,
  userId: 'u1',
  userNo: 'ADM001',
  role: 'CISO',
  roleCodes: ['CISO'],
};

describe('AdminPasswordResetWorkflowService', () => {
  let service: AdminPasswordResetWorkflowService;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Reset findMany to return empty array by default
    mockPrisma.passwordResetToken.findMany.mockResolvedValue([]);
    mockPrisma.approvalCase.findFirst.mockResolvedValue(null);
    mockUsersDomainService.findById.mockResolvedValue(null);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminPasswordResetWorkflowService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: UsersService, useValue: mockUsersService },
        { provide: UsersDomainService, useValue: mockUsersDomainService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: AuditLogsService, useValue: mockAuditLogsService },
        { provide: ApprovalsService, useValue: mockApprovalsService },
      ],
    }).compile();
    service = module.get(AdminPasswordResetWorkflowService);
  });

  describe('requestSelfServiceReset', () => {
    it('should return MFA_REQUIRED with token for valid active user', async () => {
      mockUsersService.findByIdentifier.mockResolvedValue({
        id: 'u1', userNo: 'ADM001', email: 'a@b.com',
        status: 'ACTIVE', firstLoginStatus: 'COMPLETED',
        mfaEnabledAt: new Date(), deletedAt: null,
      });
      const result = await service.requestSelfServiceReset('a@b.com');
      expect(result).toEqual({ status: 'MFA_REQUIRED', mfaSessionToken: 'mock-mfa-token' });
      expect(mockJwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: 'password_reset_mfa',
          traceId: expect.any(String),
        }),
        { expiresIn: '5m' },
      );
    });

    it('should return MFA_REQUIRED without token for non-existent user (anti-enumeration)', async () => {
      mockUsersService.findByIdentifier.mockResolvedValue(null);
      const result = await service.requestSelfServiceReset('nobody@b.com');
      expect(result).toEqual({ status: 'MFA_REQUIRED' });
    });

    it('should return MFA_REQUIRED without token for SUSPENDED user (anti-enumeration)', async () => {
      mockUsersService.findByIdentifier.mockResolvedValue({
        id: 'u1', userNo: 'ADM001', email: 'a@b.com',
        status: 'SUSPENDED', firstLoginStatus: 'COMPLETED',
        mfaEnabledAt: new Date(), deletedAt: null,
      });
      const result = await service.requestSelfServiceReset('a@b.com');
      expect(result).toEqual({ status: 'MFA_REQUIRED' });
    });

    it('should return MFA_REQUIRED without token for user without MFA (anti-enumeration)', async () => {
      mockUsersService.findByIdentifier.mockResolvedValue({
        id: 'u1', userNo: 'ADM001', email: 'a@b.com',
        status: 'ACTIVE', firstLoginStatus: 'COMPLETED',
        mfaEnabledAt: null, deletedAt: null,
      });
      const result = await service.requestSelfServiceReset('a@b.com');
      expect(result).toEqual({ status: 'MFA_REQUIRED' });
    });

    it('should write ADMIN_PASSWORD_RESET_SELF_REQUESTED audit log for valid user', async () => {
      mockUsersService.findByIdentifier.mockResolvedValue({
        id: 'u1', userNo: 'ADM001', email: 'a@b.com',
        status: 'ACTIVE', firstLoginStatus: 'COMPLETED',
        mfaEnabledAt: new Date(), deletedAt: null,
      });
      await service.requestSelfServiceReset('a@b.com');
      expect(mockAuditLogsService.recordByActor).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ADMIN_PASSWORD_RESET_SELF_REQUESTED',
          actionDomain: 'IAM',
          primarySubjectType: 'ADMIN_USER',
          primarySubjectNo: 'ADM001',
          correlationId: expect.any(String),
        }),
        expect.objectContaining({
          actorType: 'ADMIN',
          actorNo: 'ADM001',
          actorDisplayName: 'ADM001',
          actorRolesAtTime: ['SELF'],
        }),
      );
    });

    it('should NOT write audit log when user not found', async () => {
      mockUsersService.findByIdentifier.mockResolvedValue(null);
      await service.requestSelfServiceReset('nobody@b.com');
      expect(mockAuditLogsService.recordByActor).not.toHaveBeenCalled();
    });
  });

  describe('initiateAdminReset', () => {
    it('should reject if actor = target', async () => {
      await expect(
        service.initiateAdminReset('u1', { ...mockAdminActor, userId: 'u1' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject if target is SUPER_ADMIN', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'u2', userNo: 'ADM002', email: 'b@b.com',
        status: 'ACTIVE', firstLoginStatus: 'COMPLETED',
        mfaEnabledAt: new Date(), deletedAt: null,
        userRoles: [{ role: { code: 'SUPER_ADMIN' } }],
      });
      await expect(
        service.initiateAdminReset('u2', mockAdminActor),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject if target status is not ACTIVE', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'u2', userNo: 'ADM002', email: 'b@b.com',
        status: 'SUSPENDED', firstLoginStatus: 'COMPLETED',
        mfaEnabledAt: new Date(), deletedAt: null,
        userRoles: [{ role: { code: 'COMPLIANCE_OFFICER' } }],
      });
      await expect(
        service.initiateAdminReset('u2', mockAdminActor),
      ).rejects.toThrow(ConflictException);
    });

    it('should create approval case and write ADMIN_PASSWORD_RESET_OFFICER_REQUESTED with onBehalfOfNo', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'u2', userNo: 'ADM002', email: 'b@b.com',
        status: 'ACTIVE', firstLoginStatus: 'COMPLETED',
        mfaEnabledAt: new Date(), deletedAt: null,
        userRoles: [{ role: { code: 'COMPLIANCE_OFFICER' } }],
      });

      const result = await service.initiateAdminReset('u2', mockAdminActor);
      expect(result.status).toBe('PENDING_APPROVAL');
      expect(result.approvalNo).toBe('APR001');
      expect(mockApprovalsService.createAndSubmit).toHaveBeenCalled();
      expect(mockAuditLogsService.recordByActor).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ADMIN_PASSWORD_RESET_OFFICER_REQUESTED',
          actionDomain: 'IAM',
          primarySubjectNo: 'ADM002',
          onBehalfOfNo: 'ADM002',
          correlationId: expect.any(String),
        }),
        expect.objectContaining({ onBehalfOfNo: 'ADM002' }),
      );
    });
  });

  describe('createResetTokenForSelf', () => {
    beforeEach(() => {
      mockPrisma.passwordResetToken.findFirst.mockResolvedValue(null);
      mockPrisma.passwordResetToken.create.mockResolvedValue({
        id: 'prt1', resetNo: 'PWR001', status: 'PENDING',
      });
    });

    it('should write ADMIN_PASSWORD_RESET_SELF_TOKEN_ISSUED audit log', async () => {
      await service.createResetTokenForSelf('u1', 'ADM001', 'a@b.com', 'trace-abc');
      expect(mockAuditLogsService.recordByActor).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ADMIN_PASSWORD_RESET_SELF_TOKEN_ISSUED',
          actionDomain: 'IAM',
          primarySubjectType: 'ADMIN_USER',
          primarySubjectNo: 'ADM001',
          correlationId: 'trace-abc',
          outcome: 'SUCCESS',
        }),
        expect.objectContaining({
          actorType: 'ADMIN',
          actorNo: 'ADM001',
          actorDisplayName: 'ADM001',
          actorRolesAtTime: ['SELF'],
        }),
      );
    });

    it('should write outcome=DENIED reasonCode=RATE_LIMITED when a recent token already exists, and still throw', async () => {
      mockPrisma.passwordResetToken.findFirst.mockResolvedValue({ id: 'existing' });

      await expect(
        service.createResetTokenForSelf('u1', 'ADM001', 'a@b.com', 'trace-abc'),
      ).rejects.toThrow();

      const call = mockAuditLogsService.recordByActor.mock.calls.find(
        (c: any[]) => c[0].outcome === 'DENIED',
      );
      expect(call).toBeDefined();
      expect(call[0].action).toBe('ADMIN_PASSWORD_RESET_SELF_TOKEN_ISSUED');
      expect(call[0].reasonCode).toBe('RATE_LIMITED');
      expect(call[0].correlationId).toBe('trace-abc');
    });
  });

  describe('第一批 · 密码重置两条路各自成链', () => {
    it('自助路径走 SELF_* 三码，不走 OFFICER_*', async () => {
      mockUsersService.findByIdentifier.mockResolvedValue({
        id: 'u1', userNo: 'ADM001', email: 'a@b.com',
        status: 'ACTIVE', firstLoginStatus: 'COMPLETED',
        mfaEnabledAt: new Date(), deletedAt: null,
      });
      await service.requestSelfServiceReset('a@b.com');

      mockPrisma.passwordResetToken.findFirst.mockResolvedValue(null);
      mockPrisma.passwordResetToken.create.mockResolvedValue({
        id: 'prt1', resetNo: 'PWR001', status: 'PENDING',
      });
      await service.createResetTokenForSelf('u1', 'ADM001', 'a@b.com', 'trace-self');

      mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'prt1', resetNo: 'PWR001', userId: 'u1',
        status: 'PENDING', expiresAt: new Date(Date.now() + 60000),
        requestSource: 'SELF', traceId: 'trace-self',
      });
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'u1', userNo: 'ADM001', status: 'ACTIVE' });
      mockUsersDomainService.resetPassword.mockResolvedValue({ id: 'u1', userNo: 'ADM001', status: 'ACTIVE' });
      mockPrisma.passwordResetToken.update.mockResolvedValue({});
      await service.consumeResetToken('valid-token', 'NewPassword123!');

      const actions = mockAuditLogsService.recordByActor.mock.calls.map((c: any[]) => c[0].action);
      expect(actions).toEqual(expect.arrayContaining([
        'ADMIN_PASSWORD_RESET_SELF_REQUESTED',
        'ADMIN_PASSWORD_RESET_SELF_TOKEN_ISSUED',
        'ADMIN_PASSWORD_RESET_SELF_COMPLETED',
      ]));
      expect(actions.filter((a: string) => a.includes('OFFICER'))).toEqual([]);
    });

    it('官员代操作走 OFFICER_* 两码，且带 onBehalfOfNo', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'u2', userNo: 'ADM002', email: 'b@b.com',
        status: 'ACTIVE', firstLoginStatus: 'COMPLETED',
        mfaEnabledAt: new Date(), deletedAt: null,
        userRoles: [{ role: { code: 'COMPLIANCE_OFFICER' } }],
      });
      // 第一次 approvalCase.findFirst 是 initiateAdminReset 里的 existingPending 检查。
      mockPrisma.approvalCase.findFirst.mockResolvedValueOnce(null);
      const requested = await service.initiateAdminReset('u2', mockAdminActor);

      // 跳过 executeAdminReset（异步审批事件驱动，非本用例焦点）——直接构造一条
      // 由 CISO 代请求出来的、traceId 与 REQUESTED 一致的 token，模拟"已获批并签发"。
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'prt2', resetNo: 'PWR002', userId: 'u2',
        status: 'PENDING', expiresAt: new Date(Date.now() + 60000),
        requestSource: 'CISO', traceId: requested.traceId,
      });
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'u2', userNo: 'ADM002', status: 'ACTIVE' });
      mockUsersDomainService.resetPassword.mockResolvedValue({ id: 'u2', userNo: 'ADM002', status: 'ACTIVE' });
      mockPrisma.passwordResetToken.update.mockResolvedValue({});
      // 第二次 approvalCase.findFirst 是 consumeResetToken 里 resolveOfficerApprovalRef 的查询。
      mockPrisma.approvalCase.findFirst.mockResolvedValueOnce({ id: 'apr-9', approvalNo: 'APR2608260099' });

      await service.consumeResetToken('admin-token', 'NewPassword123!');

      const applied = mockAuditLogsService.recordByActor.mock.calls
        .find((c: any[]) => c[0].action === 'ADMIN_PASSWORD_RESET_OFFICER_APPLIED');
      expect(applied).toBeDefined();
      expect(applied[0].onBehalfOfNo).toBe('ADM002');
      expect(applied[0].approvalNo).toBeTruthy();
      expect(applied[0].causationId).toBe('apr-9');
      expect(applied[0].correlationId).toBe(requested.traceId);
    });

    it('令牌过期时 outcome=DENIED + reasonCode=TOKEN_EXPIRED', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'prt1', resetNo: 'PWR001', userId: 'u1',
        status: 'PENDING', expiresAt: new Date(Date.now() - 60000),
        requestSource: 'SELF', traceId: 'trace-1',
      });
      mockUsersDomainService.findById.mockResolvedValue({ id: 'u1', userNo: 'ADM001' });

      await expect(
        service.consumeResetToken('expired-token', 'NewPassword123!'),
      ).rejects.toThrow();

      const call = mockAuditLogsService.recordByActor.mock.calls
        .find((c: any[]) => c[0].outcome === 'DENIED');
      expect(call).toBeDefined();
      expect(call[0].reasonCode).toBe('TOKEN_EXPIRED');
      expect(call[0].action).toBe('ADMIN_PASSWORD_RESET_SELF_COMPLETED');
      expect(call[0].primarySubjectNo).toBe('ADM001');
    });
  });

  describe('consumeResetToken', () => {
    it('should reset password and write ADMIN_PASSWORD_RESET_SELF_COMPLETED audit for self-service token', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'prt1', resetNo: 'PWR2605060001', userId: 'u1',
        status: 'PENDING', expiresAt: new Date(Date.now() + 60000),
        requestSource: 'SELF', traceId: 'trace-1',
      });
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'u1', userNo: 'ADM001', status: 'ACTIVE',
      });
      mockUsersDomainService.resetPassword.mockResolvedValue({
        id: 'u1', userNo: 'ADM001', status: 'ACTIVE',
      });
      mockPrisma.passwordResetToken.update.mockResolvedValue({});

      const result = await service.consumeResetToken('valid-token', 'NewPassword123!');
      expect(result).toEqual({ status: 'PASSWORD_RESET_COMPLETE' });
      expect(mockUsersDomainService.resetPassword).toHaveBeenCalled();
      expect(mockAuditLogsService.recordByActor).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ADMIN_PASSWORD_RESET_SELF_COMPLETED',
          primarySubjectNo: 'ADM001',
          correlationId: 'trace-1',
        }),
        expect.objectContaining({
          actorType: 'ADMIN',
          actorNo: 'ADM001',
          actorDisplayName: 'ADM001',
          actorRolesAtTime: ['SELF'],
        }),
      );
    });

    it('should write ADMIN_PASSWORD_RESET_OFFICER_APPLIED audit for admin-initiated token', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'prt2', resetNo: 'PWR002', userId: 'u2',
        status: 'PENDING', expiresAt: new Date(Date.now() + 60000),
        requestSource: 'CISO', traceId: 'trace-2',
      });
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'u2', userNo: 'ADM002', status: 'ACTIVE',
      });
      mockUsersDomainService.resetPassword.mockResolvedValue({
        id: 'u2', userNo: 'ADM002', status: 'ACTIVE',
      });
      mockPrisma.passwordResetToken.update.mockResolvedValue({});
      mockPrisma.approvalCase.findFirst.mockResolvedValue({ id: 'apr-2', approvalNo: 'APR002' });

      await service.consumeResetToken('admin-token', 'NewPassword123!');
      expect(mockAuditLogsService.recordByActor).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ADMIN_PASSWORD_RESET_OFFICER_APPLIED',
          primarySubjectNo: 'ADM002',
          correlationId: 'trace-2',
          onBehalfOfNo: 'ADM002',
          approvalNo: 'APR002',
          causationId: 'apr-2',
        }),
        expect.objectContaining({
          actorType: 'ADMIN',
          actorNo: 'ADM002',
          actorDisplayName: 'ADM002',
        }),
      );
    });

    it('should reject expired token', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'prt1', resetNo: 'PWR001', userId: 'u1',
        status: 'PENDING', expiresAt: new Date(Date.now() - 60000),
        requestSource: 'SELF', traceId: 'trace-1',
      });
      await expect(
        service.consumeResetToken('expired-token', 'NewPassword123!'),
      ).rejects.toThrow();
    });

    it('should reject already consumed token', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'prt1', resetNo: 'PWR001', userId: 'u1',
        status: 'CONSUMED', expiresAt: new Date(Date.now() + 60000),
        requestSource: 'SELF', traceId: 'trace-1',
      });
      await expect(
        service.consumeResetToken('used-token', 'NewPassword123!'),
      ).rejects.toThrow();
    });

    it('should reject if token not found', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue(null);
      await expect(
        service.consumeResetToken('bad-token', 'NewPassword123!'),
      ).rejects.toThrow();
    });
  });
});
