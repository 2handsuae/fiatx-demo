import { ConflictException, NotFoundException } from '@nestjs/common';
import { UsersDomainService } from './users.domain.service';

describe('UsersDomainService — mfa-binding methods', () => {
  let service: UsersDomainService;
  let prisma: any;

  const baseUser = {
    id: 'u1',
    userNo: 'ADM-001',
    email: 'a@b.com',
    status: 'ACTIVE',
    role: 'CISO',
    firstLoginStatus: 'PENDING_IDENTITY_CONFIRM',
    mfaVerifyFailCount: 0,
    mfaVerifyLockedUntil: null,
  };

  beforeEach(() => {
    prisma = {
      user: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };
    service = new UsersDomainService(prisma);
  });

  describe('setFirstLoginStatus', () => {
    it('throws NotFoundException when user not found', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.setFirstLoginStatus('u1', 'MFA_BINDING')).rejects.toThrow(NotFoundException);
    });

    it('updates status when user exists', async () => {
      prisma.user.findFirst.mockResolvedValue(baseUser);
      prisma.user.update.mockResolvedValue({ ...baseUser, firstLoginStatus: 'MFA_BINDING' });
      await service.setFirstLoginStatus('u1', 'MFA_BINDING');
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ firstLoginStatus: 'MFA_BINDING' }) }),
      );
    });
  });

  describe('incrementMfaVerifyFail', () => {
    it('increments fail count and returns updated count', async () => {
      prisma.user.findFirst.mockResolvedValue({ ...baseUser, mfaVerifyFailCount: 2 });
      prisma.user.update.mockResolvedValue({ ...baseUser, mfaVerifyFailCount: 3 });
      const result = await service.incrementMfaVerifyFail('u1');
      expect(result.newCount).toBe(3);
      expect(result.locked).toBe(false);
    });

    it('sets mfaVerifyLockedUntil when count reaches 5', async () => {
      prisma.user.findFirst.mockResolvedValue({ ...baseUser, mfaVerifyFailCount: 4 });
      prisma.user.update.mockResolvedValue({ ...baseUser, mfaVerifyFailCount: 5, mfaVerifyLockedUntil: new Date() });
      const result = await service.incrementMfaVerifyFail('u1');
      expect(result.newCount).toBe(5);
      expect(result.locked).toBe(true);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ mfaVerifyLockedUntil: expect.any(Date) }),
        }),
      );
    });
  });

  describe('completeMfaBinding', () => {
    it('MFA_BINDING → COMPLETED：sets firstLoginStatus COMPLETED, mfaEnabledAt, securityAckAt, clears fail count', async () => {
      const user = { ...baseUser, firstLoginStatus: 'MFA_BINDING' };
      prisma.user.findFirst.mockResolvedValue(user);
      prisma.user.update.mockResolvedValue({ ...user, firstLoginStatus: 'COMPLETED' });
      await service.completeMfaBinding('u1');
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            firstLoginStatus: 'COMPLETED',
            mfaEnabledAt: expect.any(Date),
            securityAckAt: expect.any(Date),
            mfaVerifyFailCount: 0,
            mfaVerifyLockedUntil: null,
          }),
        }),
      );
    });

    it('非法跃迁被表挡下：PENDING_IDENTITY_CONFIRM 不能 BIND', async () => {
      prisma.user.findFirst.mockResolvedValue({ ...baseUser, firstLoginStatus: 'PENDING_IDENTITY_CONFIRM' });
      await expect(service.completeMfaBinding('u1')).rejects.toThrow(ConflictException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when user not found', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.completeMfaBinding('u1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('clearMfaVerifyFail', () => {
    it('resets failCount and lockedUntil', async () => {
      prisma.user.update.mockResolvedValue(baseUser);
      await service.clearMfaVerifyFail('u1');
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ mfaVerifyFailCount: 0, mfaVerifyLockedUntil: null }),
        }),
      );
    });
  });

  describe('resetMfa', () => {
    const boundUser = {
      ...baseUser,
      firstLoginStatus: 'COMPLETED',
      mfaEnabledAt: new Date(),
      mfaSecret: 'encrypted-secret',
    };

    it('COMPLETED → PENDING_IDENTITY_CONFIRM：clears MFA binding and rewinds first-login state', async () => {
      prisma.user.findFirst.mockResolvedValue(boundUser);
      prisma.user.update.mockResolvedValue(boundUser);
      const result = await service.resetMfa('u1');
      expect(result).toEqual({ id: 'u1', userNo: 'ADM-001', email: 'a@b.com', role: 'CISO' });
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            mfaSecret: null,
            mfaEnabledAt: null,
            firstLoginStatus: 'PENDING_IDENTITY_CONFIRM',
          }),
        }),
      );
    });

    it('非法跃迁被表挡下：firstLoginStatus 不是 COMPLETED 时不放行（即便 status/mfaEnabledAt 都满足前置检查）', async () => {
      prisma.user.findFirst.mockResolvedValue({ ...boundUser, firstLoginStatus: 'MFA_BINDING' });
      await expect(service.resetMfa('u1')).rejects.toThrow(ConflictException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});
