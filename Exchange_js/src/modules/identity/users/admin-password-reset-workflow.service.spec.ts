import { Test, TestingModule } from '@nestjs/testing';
import { AdminPasswordResetWorkflowService } from './admin-password-reset-workflow.service';
import { UsersDomainService } from './users.domain.service';
import { UsersService } from './users.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { JwtService } from '@nestjs/jwt';
import { ConflictException, ForbiddenException } from '@nestjs/common';

const mockAuditLogsService = {
  recordByActor: jest.fn().mockResolvedValue({}),
  recordSystem: jest.fn().mockResolvedValue({}),
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

describe('AdminPasswordResetWorkflowService', () => {
  let service: AdminPasswordResetWorkflowService;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Reset findMany to return empty array by default
    mockPrisma.passwordResetToken.findMany.mockResolvedValue([]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminPasswordResetWorkflowService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: UsersService, useValue: mockUsersService },
        { provide: UsersDomainService, useValue: mockUsersDomainService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: AuditLogsService, useValue: mockAuditLogsService },
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
        expect.objectContaining({ scope: 'password_reset_mfa' }),
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
  });

  describe('requestCisoReset', () => {
    it('should reject if actor = target', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'u1', userNo: 'ADM001', email: 'a@b.com',
        status: 'ACTIVE', firstLoginStatus: 'COMPLETED',
        mfaEnabledAt: new Date(), deletedAt: null,
        userRoles: [{ role: { code: 'COMPLIANCE_OFFICER' } }],
      });
      await expect(
        service.requestCisoReset('u1', { userId: 'u1', userNo: 'ADM001' }),
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
        service.requestCisoReset('u2', { userId: 'u1', userNo: 'ADM001' }),
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
        service.requestCisoReset('u2', { userId: 'u1', userNo: 'ADM001' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should create reset token for valid CISO request', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'u2', userNo: 'ADM002', email: 'b@b.com',
        status: 'ACTIVE', firstLoginStatus: 'COMPLETED',
        mfaEnabledAt: new Date(), deletedAt: null,
        userRoles: [{ role: { code: 'COMPLIANCE_OFFICER' } }],
      });
      mockPrisma.passwordResetToken.findFirst.mockResolvedValue(null); // no rate limit
      mockPrisma.passwordResetToken.create.mockResolvedValue({
        id: 'prt1', resetNo: 'PWR2605060001',
      });

      const result = await service.requestCisoReset('u2', { userId: 'u1', userNo: 'ADM001' });
      expect(result.status).toBe('RESET_EMAIL_SENT');
      expect(result.resetNo).toBeDefined();
      expect(mockAuditLogsService.recordByActor).toHaveBeenCalled();
    });
  });

  describe('consumeResetToken', () => {
    it('should reset password and mark token CONSUMED on valid token', async () => {
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
      expect(mockAuditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PASSWORD_RESET_COMPLETED' }),
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
