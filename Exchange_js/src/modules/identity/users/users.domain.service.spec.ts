import { Test, TestingModule } from '@nestjs/testing';
import { UsersDomainService } from './users.domain.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ConflictException, NotFoundException } from '@nestjs/common';

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
