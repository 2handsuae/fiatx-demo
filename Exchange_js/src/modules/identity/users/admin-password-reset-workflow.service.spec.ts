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

    it('should write SELF_RESET_REQUESTED audit log for valid user', async () => {
      mockUsersService.findByIdentifier.mockResolvedValue({
        id: 'u1', userNo: 'ADM001', email: 'a@b.com',
        status: 'ACTIVE', firstLoginStatus: 'COMPLETED',
        mfaEnabledAt: new Date(), deletedAt: null,
      });
      await service.requestSelfServiceReset('a@b.com');
      expect(mockAuditLogsService.recordByActor).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'SELF_RESET_REQUESTED',
          entityType: 'ADMIN_USER',
          entityId: 'u1',
          entityNo: 'ADM001',
          workflowType: 'ADMIN_PASSWORD_RESET',
          traceId: expect.any(String),
        }),
        expect.objectContaining({
          actorType: 'ADMIN',
          actorId: 'u1',
          actorNo: 'ADM001',
          actorRole: 'SELF',
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

    it('should create approval case for valid admin reset request', async () => {
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
      expect(mockAuditLogsService.recordByActor).toHaveBeenCalled();
    });
  });

  describe('createResetTokenForSelf', () => {
    beforeEach(() => {
      mockPrisma.passwordResetToken.findFirst.mockResolvedValue(null);
      mockPrisma.passwordResetToken.create.mockResolvedValue({
        id: 'prt1', resetNo: 'PWR001', status: 'PENDING',
      });
    });

    it('should write SELF_RESET_TOKEN_CREATED audit log', async () => {
      await service.createResetTokenForSelf('u1', 'ADM001', 'a@b.com', 'trace-abc');
      expect(mockAuditLogsService.recordByActor).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'SELF_RESET_TOKEN_CREATED',
          entityType: 'ADMIN_USER',
          entityId: 'u1',
          entityNo: 'ADM001',
          workflowType: 'ADMIN_PASSWORD_RESET',
          traceId: 'trace-abc',
        }),
        expect.objectContaining({
          actorType: 'ADMIN',
          actorId: 'u1',
          actorNo: 'ADM001',
          actorRole: 'SELF',
        }),
      );
    });
  });

  describe('consumeResetToken', () => {
    it('should reset password and write SELF_RESET_COMPLETED audit for self-service token', async () => {
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
          action: 'SELF_RESET_COMPLETED',
          entityId: 'u1',
          entityNo: 'ADM001',
          traceId: 'trace-1',
        }),
        expect.objectContaining({
          actorType: 'ADMIN',
          actorId: 'u1',
          actorNo: 'ADM001',
          actorRole: 'SELF',
        }),
      );
    });

    it('should write RESET_CONSUMED audit for admin-initiated token', async () => {
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

      await service.consumeResetToken('admin-token', 'NewPassword123!');
      expect(mockAuditLogsService.recordByActor).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'RESET_CONSUMED',
          entityId: 'u2',
          entityNo: 'ADM002',
          traceId: 'trace-2',
        }),
        expect.objectContaining({
          actorType: 'ADMIN',
          actorId: 'u2',
          actorNo: 'ADM002',
          actorRole: 'SELF',
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
