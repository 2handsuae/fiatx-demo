import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';
import { AdminInvitationsService } from './admin-invitations.service';
import { ConfigService } from '@nestjs/config';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: any;
  let adminInvitationsService: any;
  const fixedNow = new Date('2026-04-01T00:00:00.000Z').getTime();

  const buildMemberRow = () => ({
    id: 'user-1',
    userNo: 'ADM2602190001',
    email: 'inactive-admin@fiatx.com',
    role: 'CISO',
    status: 'INACTIVE',
    createdAt: new Date('2026-02-19T08:00:00.000Z'),
    updatedAt: new Date('2026-02-19T08:00:00.000Z'),
    lastLoginAt: null,
    userRoles: [
      { role: { code: 'CISO' } },
      { role: { code: 'TECH_OFFICER' } },
    ],
  });

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      adminUserInvitation: {
        findFirst: jest.fn(),
      },
      passwordResetToken: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    adminInvitationsService = {
      createInvitationForUser: jest.fn(),
      resendInvitationForUser: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: AdminInvitationsService,
          useValue: adminInvitationsService,
        },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(null) } },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should resend admin invitation', async () => {
    adminInvitationsService.resendInvitationForUser.mockResolvedValue({
      userId: 'user-1',
      userNo: 'ADM2602190001',
      email: 'new-admin@fiatx.com',
      status: 'INACTIVE',
      inviteLink: 'http://localhost:3001/admin/activate?token=next',
      inviteExpiresAt: '2026-02-20T01:00:00.000Z',
      inviteStatus: 'PENDING',
    });

    const result = await service.resendAdminInvitation({
      userId: 'user-1',
      actor: {
        actorId: 'admin-1',
        actorRole: 'SUPER_ADMIN',
        actorNo: 'ADMIN-001',
      },
    });

    expect(adminInvitationsService.resendInvitationForUser).toHaveBeenCalledWith({
      userId: 'user-1',
      actor: {
        actorId: 'admin-1',
        actorRole: 'SUPER_ADMIN',
        actorNo: 'ADMIN-001',
      },
    });
    expect(result.inviteStatus).toBe('PENDING');
    expect(result.inviteLink).toBe('http://localhost:3001/admin/activate?token=next');
  });

  it('getMemberDetail returns invitation summary for inactive admin users', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(fixedNow);
    prisma.user.findFirst.mockResolvedValue(buildMemberRow());
    prisma.adminUserInvitation.findFirst.mockResolvedValue({
      expiresAt: new Date('2026-04-02T00:00:00.000Z'),
      consumedAt: null,
      revokedAt: null,
    });

    await expect(service.getMemberDetail('user-1')).resolves.toMatchObject({
      id: 'user-1',
      userNo: 'ADM2602190001',
      email: 'inactive-admin@fiatx.com',
      role: 'CISO',
      status: 'INACTIVE',
      createdAt: new Date('2026-02-19T08:00:00.000Z'),
      updatedAt: new Date('2026-02-19T08:00:00.000Z'),
      lastLoginAt: null,
      roles: ['CISO', 'TECH_OFFICER'],
      latestInvitation: expect.objectContaining({
        inviteStatus: 'PENDING',
        inviteExpiresAt: '2026-04-02T00:00:00.000Z',
      }),
    });

    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'user-1',
        deletedAt: null,
      },
      include: {
        userRoles: {
          include: {
            role: {
              select: {
                code: true,
                name: true,
              },
            },
          },
        },
      },
    });
    expect(prisma.adminUserInvitation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1' },
        orderBy: { createdAt: 'desc' },
        select: expect.objectContaining({
          expiresAt: true,
          consumedAt: true,
          revokedAt: true,
        }),
      }),
    );
  });

  it.each([
    [
      'REVOKED',
      {
        expiresAt: new Date('2026-04-02T00:00:00.000Z'),
        consumedAt: new Date('2026-04-01T00:00:00.000Z'),
        revokedAt: new Date('2026-04-02T00:00:00.000Z'),
      },
    ],
    [
      'USED',
      {
        expiresAt: new Date('2026-04-02T00:00:00.000Z'),
        consumedAt: new Date('2026-04-01T00:00:00.000Z'),
        revokedAt: null,
      },
    ],
    [
      'EXPIRED',
      {
        expiresAt: new Date('2026-03-20T00:00:00.000Z'),
        consumedAt: null,
        revokedAt: null,
      },
    ],
    [
      'PENDING',
      {
        expiresAt: new Date('2026-04-02T00:00:00.000Z'),
        consumedAt: null,
        revokedAt: null,
      },
    ],
  ])(
    'getMemberDetail maps latest invitation status to %s with the expected priority',
    async (expectedStatus, invitation) => {
      jest.spyOn(Date, 'now').mockReturnValue(fixedNow);
      prisma.user.findFirst.mockResolvedValue(buildMemberRow());
      prisma.adminUserInvitation.findFirst.mockResolvedValue(invitation);

      await expect(service.getMemberDetail('user-1')).resolves.toMatchObject({
        id: 'user-1',
        latestInvitation: {
          inviteStatus: expectedStatus,
          inviteExpiresAt: invitation.expiresAt.toISOString(),
        },
      });
    },
  );

  it('getMemberDetail returns latestInvitation null when no invitation exists', async () => {
    prisma.user.findFirst.mockResolvedValue(buildMemberRow());
    prisma.adminUserInvitation.findFirst.mockResolvedValue(null);

    await expect(service.getMemberDetail('user-1')).resolves.toMatchObject({
      id: 'user-1',
      latestInvitation: null,
    });
  });

  it('getMemberDetail throws NotFoundException when member does not exist', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(service.getMemberDetail('missing-user')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.adminUserInvitation.findFirst).not.toHaveBeenCalled();
  });

  it('should only list active users in member directory queries', async () => {
    prisma.user.findMany.mockResolvedValue([{ id: 'user-1', userNo: 'ADM2602190001' }]);

    const result = await service.findAll({
      take: 10,
      orderBy: { createdAt: 'desc' },
    });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 10,
        where: expect.objectContaining({
          deletedAt: null,
        }),
      }),
    );
    expect(result).toEqual([{ id: 'user-1', userNo: 'ADM2602190001' }]);
  });

  it('should only resolve undeleted users by id', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    const result = await service.findById('user-deleted');

    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'user-deleted',
        deletedAt: null,
      },
    });
    expect(result).toBeNull();
  });
});
