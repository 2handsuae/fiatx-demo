import { NotFoundException } from '@nestjs/common';
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

  describe('completeFirstLogin', () => {
    it('sets firstLoginStatus COMPLETED, securityAckAt, clears failCount', async () => {
      prisma.user.findFirst.mockResolvedValue(baseUser);
      prisma.user.update.mockResolvedValue({ ...baseUser, firstLoginStatus: 'COMPLETED' });
      await service.completeFirstLogin('u1');
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            firstLoginStatus: 'COMPLETED',
            securityAckAt: expect.any(Date),
            mfaVerifyFailCount: 0,
            mfaVerifyLockedUntil: null,
          }),
        }),
      );
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
});
