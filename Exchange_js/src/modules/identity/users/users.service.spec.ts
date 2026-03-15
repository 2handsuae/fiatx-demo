import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AccessControlService } from '../access-control/access-control.service';
import { AuditLogsService } from '../../risk-engine/audit-logs/audit-logs.service';
import { ConflictException } from '@nestjs/common';
import { AdminInvitationsService } from './admin-invitations.service';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: any;
  let accessControlService: any;
  let auditLogsService: any;
  let adminInvitationsService: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    accessControlService = {
      replaceUserRoles: jest.fn(),
    };

    auditLogsService = {
      recordByActor: jest.fn(),
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
          provide: AccessControlService,
          useValue: accessControlService,
        },
        {
          provide: AuditLogsService,
          useValue: auditLogsService,
        },
        {
          provide: AdminInvitationsService,
          useValue: adminInvitationsService,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create admin user and bind roles', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 'user-1',
      userNo: 'ADM2602190001',
      email: 'new-admin@fiatx.com',
      role: 'CISO',
      status: 'INACTIVE',
    });
    adminInvitationsService.createInvitationForUser.mockResolvedValue({
      inviteLink: 'http://localhost:3001/admin/activate?token=abc',
      inviteExpiresAt: '2026-02-20T00:00:00.000Z',
      inviteStatus: 'PENDING',
    });
    accessControlService.replaceUserRoles.mockResolvedValue({
      userId: 'user-1',
      userNo: 'ADM2602190001',
      roles: ['CISO'],
      warnings: [],
    });
    auditLogsService.recordByActor.mockResolvedValue({});

    const result = await service.createAdminUser({
      email: 'new-admin@fiatx.com',
      roleCodes: ['CISO'],
      actor: {
        actorId: 'admin-1',
        actorRole: 'SUPER_ADMIN',
        actorNo: 'ADMIN-001',
      },
    });

    expect(prisma.user.create).toHaveBeenCalledTimes(1);
    const createdPayload = prisma.user.create.mock.calls[0][0];
    expect(createdPayload.data.email).toBe('new-admin@fiatx.com');
    expect(createdPayload.data.role).toBe('CISO');
    expect(createdPayload.data.status).toBe('INACTIVE');
    expect(createdPayload.data.password).not.toBe('123456');
    expect(createdPayload.data.password).toBeDefined();

    expect(adminInvitationsService.createInvitationForUser).toHaveBeenCalledWith({
      userId: 'user-1',
      actor: {
        actorId: 'admin-1',
        actorRole: 'SUPER_ADMIN',
        actorNo: 'ADMIN-001',
      },
    });

    expect(accessControlService.replaceUserRoles).toHaveBeenCalledWith(
      'user-1',
      ['CISO'],
      {
        actorId: 'admin-1',
        actorRole: 'SUPER_ADMIN',
        actorNo: 'ADMIN-001',
      },
    );
    expect(auditLogsService.recordByActor).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      id: 'user-1',
      userNo: 'ADM2602190001',
      email: 'new-admin@fiatx.com',
      roles: ['CISO'],
      inviteStatus: 'PENDING',
    });
  });

  it('should throw conflict when email already exists', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });

    await expect(
      service.createAdminUser({
        email: 'existing@fiatx.com',
        roleCodes: ['CISO'],
        actor: {
          actorId: 'admin-1',
          actorRole: 'SUPER_ADMIN',
          actorNo: 'ADMIN-001',
        },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
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
  });

  it('should persist the highest-priority compatibility role for multi-role users', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 'user-2',
      userNo: 'ADM2602190002',
      email: 'dual-role@fiatx.com',
      role: 'CISO',
      status: 'INACTIVE',
    });
    adminInvitationsService.createInvitationForUser.mockResolvedValue({
      inviteLink: 'http://localhost:3001/admin/activate?token=dual',
      inviteExpiresAt: '2026-02-20T00:00:00.000Z',
      inviteStatus: 'PENDING',
    });
    accessControlService.replaceUserRoles.mockResolvedValue({
      userId: 'user-2',
      userNo: 'ADM2602190002',
      roles: ['RI', 'CISO'],
      warnings: [],
    });
    auditLogsService.recordByActor.mockResolvedValue({});

    await service.createAdminUser({
      email: 'dual-role@fiatx.com',
      roleCodes: ['RI', 'CISO'],
      actor: {
        actorId: 'admin-1',
        actorRole: 'SUPER_ADMIN',
        actorNo: 'ADMIN-001',
      },
    });

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: 'CISO',
        }),
      }),
    );
  });
});
