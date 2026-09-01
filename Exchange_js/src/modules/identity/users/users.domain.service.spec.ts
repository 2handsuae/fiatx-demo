import { Test, TestingModule } from '@nestjs/testing';
import { UsersDomainService } from './users.domain.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  assertFirstLoginTransition,
  assertUserTransition,
  FirstLoginAction,
  UserStatusAction,
} from './constants/user-status-transitions.constant';

describe('管理员状态迁移表（Task 9 · 法二）', () => {
  it('非法跃迁被表挡下：ACTIVE 不能 REACTIVATE / SUSPENDED 不能 LOCK', () => {
    expect(() => assertUserTransition('ACTIVE', UserStatusAction.REACTIVATE)).toThrow(/Invalid transition/);
    expect(() => assertUserTransition('SUSPENDED', UserStatusAction.LOCK)).toThrow(/Invalid transition/);
  });
  it('合法边照走：全部现役边', () => {
    expect(assertUserTransition('PENDING_INVITE_APPROVAL', UserStatusAction.INVITE_APPROVE)).toBe('INVITE_SENT');
    expect(assertUserTransition('INVITE_SENT', UserStatusAction.ACCEPT)).toBe('ACTIVE');
    expect(assertUserTransition('ACTIVE', UserStatusAction.SUSPEND)).toBe('SUSPENDED');
    expect(assertUserTransition('SUSPENDED', UserStatusAction.REACTIVATE)).toBe('ACTIVE');
    expect(assertUserTransition('ACTIVE', UserStatusAction.LOCK)).toBe('LOCKED');
    expect(assertUserTransition('LOCKED', UserStatusAction.UNLOCK)).toBe('ACTIVE');
  });
  it('首登三边 + 重置回环', () => {
    expect(assertFirstLoginTransition('PENDING_IDENTITY_CONFIRM', FirstLoginAction.CONFIRM)).toBe('MFA_BINDING');
    expect(assertFirstLoginTransition('MFA_BINDING', FirstLoginAction.BIND)).toBe('COMPLETED');
    expect(assertFirstLoginTransition('COMPLETED', FirstLoginAction.RESET)).toBe('PENDING_IDENTITY_CONFIRM');
    expect(() => assertFirstLoginTransition('COMPLETED', FirstLoginAction.BIND)).toThrow(/Invalid transition/);
  });
  it('INACTIVE 不进表：任何动作都被挡下（全仓零写入方，随重铺自然消亡）', () => {
    expect(() => assertUserTransition('INACTIVE', UserStatusAction.ACCEPT)).toThrow(/Invalid transition/);
    expect(() => assertUserTransition('INACTIVE', UserStatusAction.SUSPEND)).toThrow(/Invalid transition/);
  });
});

describe('UsersDomainService.applyUserTransition', () => {
  let service: UsersDomainService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersDomainService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(UsersDomainService);
  });

  it('合法边：写目标态 + 透传 extra，返回 fromStatus/toStatus', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u1', status: 'LOCKED' });
    prisma.user.update.mockResolvedValue({ id: 'u1', status: 'ACTIVE' });

    const result = await service.applyUserTransition('u1', UserStatusAction.UNLOCK, {
      failedLoginAttempts: 0,
      lockedUntil: null,
    });

    expect(result).toEqual({ fromStatus: 'LOCKED', toStatus: 'ACTIVE' });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { status: 'ACTIVE', failedLoginAttempts: 0, lockedUntil: null },
    });
  });

  it('非法边：表挡下，不写库', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u1', status: 'ACTIVE' });
    await expect(service.applyUserTransition('u1', UserStatusAction.REACTIVATE)).rejects.toThrow(ConflictException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when user not found', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(service.applyUserTransition('u1', UserStatusAction.SUSPEND)).rejects.toThrow(NotFoundException);
  });
});

describe('UsersDomainService.resetPassword', () => {
  let service: UsersDomainService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersDomainService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(UsersDomainService);
  });

  it('should update password and clear lock state for ACTIVE user', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'u1', userNo: 'ADM001', status: 'ACTIVE',
      firstLoginStatus: 'COMPLETED', deletedAt: null,
    });
    prisma.user.update.mockResolvedValue({
      id: 'u1', userNo: 'ADM001', status: 'ACTIVE',
    });

    const result = await service.resetPassword('u1', 'newHashedPassword');
    expect(result).toEqual({ id: 'u1', userNo: 'ADM001', status: 'ACTIVE' });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: {
        password: 'newHashedPassword',
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
      select: { id: true, userNo: true, status: true },
    });
  });

  it('should throw NotFoundException if user not found', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(service.resetPassword('u1', 'hash')).rejects.toThrow(NotFoundException);
  });

  it('should throw ConflictException if user status is not ACTIVE', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'u1', status: 'SUSPENDED', firstLoginStatus: 'COMPLETED',
    });
    await expect(service.resetPassword('u1', 'hash')).rejects.toThrow(ConflictException);
  });

  it('should throw ConflictException if firstLoginStatus is not COMPLETED', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'u1', status: 'ACTIVE', firstLoginStatus: 'MFA_BINDING',
    });
    await expect(service.resetPassword('u1', 'hash')).rejects.toThrow(ConflictException);
  });
});
