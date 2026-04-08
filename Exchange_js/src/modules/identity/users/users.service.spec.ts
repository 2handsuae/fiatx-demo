import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AccessControlService } from '../access-control/access-control.service';
import { AuditLogsService } from '../../risk-engine/audit-logs/audit-logs.service';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { AdminInvitationsService } from './admin-invitations.service';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: any;
  let accessControlService: any;
  let auditLogsService: any;
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
    };

    accessControlService = {
      replaceUserRoles: jest.fn(),
      getUserRoleCodes: jest.fn(),
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

  afterEach(() => {
    jest.restoreAllMocks();
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
      undefined,
    );
    expect(auditLogsService.recordByActor).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      id: 'user-1',
      userNo: 'ADM2602190001',
      email: 'new-admin@fiatx.com',
      roles: ['CISO'],
      inviteStatus: 'PENDING',
    });
    expect(result).not.toHaveProperty('role');
    expect(result).not.toHaveProperty('warnings');
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

    await expect(service.getMemberDetail('user-1')).resolves.toEqual({
      id: 'user-1',
      userNo: 'ADM2602190001',
      email: 'inactive-admin@fiatx.com',
      role: 'CISO',
      status: 'INACTIVE',
      createdAt: new Date('2026-02-19T08:00:00.000Z'),
      updatedAt: new Date('2026-02-19T08:00:00.000Z'),
      lastLoginAt: null,
      roles: ['CISO', 'TECH_OFFICER'],
      latestInvitation: {
        inviteStatus: 'PENDING',
        inviteExpiresAt: '2026-04-02T00:00:00.000Z',
      },
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
    expect(prisma.adminUserInvitation.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        expiresAt: true,
        consumedAt: true,
        revokedAt: true,
      },
    });
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

  it('should execute governed admin member provisioning via createAdminUser', async () => {
    const binding = {
      intent: 'ADMIN_MEMBER_PROVISIONING',
      email: 'new-admin@fiatx.com',
      roleCodes: ['CISO', 'TECH_OFFICER'],
    };
    const executionResult = {
      id: 'user-1',
      userNo: 'ADM2602190001',
      email: 'new-admin@fiatx.com',
      status: 'INACTIVE',
      roles: ['CISO', 'TECH_OFFICER'],
      inviteStatus: 'PENDING',
      inviteExpiresAt: '2026-02-20T00:00:00.000Z',
      inviteLink: 'http://localhost:3001/admin/activate?token=abc',
    };
    const createAdminUserSpy = jest
      .spyOn(service, 'createAdminUser')
      .mockResolvedValue(executionResult as never);

    const result = await service.executeAdminMemberProvisioning(binding, {
      actorType: 'ADMIN',
      userId: 'admin-1',
      userNo: 'ADMIN-001',
      role: 'SUPER_ADMIN',
      roleCodes: ['SUPER_ADMIN'],
    });

    expect(createAdminUserSpy).toHaveBeenCalledWith({
      email: 'new-admin@fiatx.com',
      roleCodes: ['CISO', 'TECH_OFFICER'],
      actor: {
        actorId: 'admin-1',
        actorNo: 'ADMIN-001',
        actorRole: 'SUPER_ADMIN',
      },
    });
    expect(result).toEqual(executionResult);
  });

  it('uses one provisioning trace for invitation creation, role binding, and user created audit', async () => {
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
      roles: ['CISO', 'TECH_OFFICER'],
      warnings: [],
    });
    auditLogsService.recordByActor.mockResolvedValue({});

    await service.executeAdminMemberProvisioning(
      {
        intent: 'ADMIN_MEMBER_PROVISIONING',
        email: 'new-admin@fiatx.com',
        roleCodes: ['CISO', 'TECH_OFFICER'],
        ticketNo: 'CT2604010001',
        traceId: 'trace-provision-1',
      },
      {
        actorType: 'ADMIN',
        userId: 'admin-1',
        userNo: 'ADMIN-001',
        role: 'SUPER_ADMIN',
        roleCodes: ['SUPER_ADMIN'],
      },
    );

    expect(adminInvitationsService.createInvitationForUser).toHaveBeenCalledWith({
      userId: 'user-1',
      actor: {
        actorId: 'admin-1',
        actorNo: 'ADMIN-001',
        actorRole: 'SUPER_ADMIN',
      },
      auditContext: {
        workflowType: 'ADMIN_MEMBER_PROVISIONING',
        traceId: 'trace-provision-1',
      },
    });
    expect(accessControlService.replaceUserRoles).toHaveBeenCalledWith(
      'user-1',
      ['CISO', 'TECH_OFFICER'],
      {
        actorId: 'admin-1',
        actorRole: 'SUPER_ADMIN',
        actorNo: 'ADMIN-001',
      },
      {
        workflowType: 'ADMIN_MEMBER_PROVISIONING',
        traceId: 'trace-provision-1',
      },
    );
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'USER_CREATED',
        workflowType: 'ADMIN_MEMBER_PROVISIONING',
        traceId: 'trace-provision-1',
      }),
      expect.any(Object),
    );
  });

  it('should recover governed admin member provisioning only for duplicate-create conflicts', async () => {
    const executionError = new ConflictException('Email already exists');
    jest.spyOn(service, 'createAdminUser').mockRejectedValue(executionError as never);
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      userNo: 'ADM2602190001',
      email: 'new-admin@fiatx.com',
      status: 'INACTIVE',
    });
    accessControlService.getUserRoleCodes.mockResolvedValue(['TECH_OFFICER', 'CISO']);
    adminInvitationsService.resendInvitationForUser.mockResolvedValue({
      userId: 'user-1',
      userNo: 'ADM2602190001',
      email: 'new-admin@fiatx.com',
      status: 'INACTIVE',
      inviteLink: 'http://localhost:3001/admin/activate?token=recovered',
      inviteExpiresAt: '2026-02-20T01:00:00.000Z',
      inviteStatus: 'PENDING',
    });

    const result = await service.executeAdminMemberProvisioning(
      {
        intent: 'ADMIN_MEMBER_PROVISIONING',
        email: 'new-admin@fiatx.com',
        roleCodes: ['CISO', 'TECH_OFFICER'],
        ticketNo: 'CT2604010001',
        traceId: 'trace-provision-1',
      },
      {
        actorType: 'ADMIN',
        userId: 'admin-1',
        userNo: 'ADMIN-001',
        role: 'SUPER_ADMIN',
        roleCodes: ['SUPER_ADMIN'],
      },
    );

    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: {
        email: 'new-admin@fiatx.com',
        deletedAt: null,
      },
      select: {
        id: true,
        userNo: true,
        email: true,
        status: true,
      },
    });
    expect(accessControlService.getUserRoleCodes).toHaveBeenCalledWith('user-1');
    expect(adminInvitationsService.resendInvitationForUser).toHaveBeenCalledWith({
      userId: 'user-1',
      actor: {
        actorId: 'admin-1',
        actorNo: 'ADMIN-001',
        actorRole: 'SUPER_ADMIN',
      },
      auditContext: {
        workflowType: 'ADMIN_MEMBER_PROVISIONING',
        traceId: 'trace-provision-1',
      },
    });
    expect(result).toEqual({
      id: 'user-1',
      userNo: 'ADM2602190001',
      email: 'new-admin@fiatx.com',
      status: 'INACTIVE',
      roles: ['CISO', 'TECH_OFFICER'],
      inviteLink: 'http://localhost:3001/admin/activate?token=recovered',
      inviteExpiresAt: '2026-02-20T01:00:00.000Z',
      inviteStatus: 'PENDING',
    });
  });

  it('does not recover governed admin member provisioning for non-idempotent errors even when state matches', async () => {
    const executionError = new Error('audit write failed after user creation');
    jest.spyOn(service, 'createAdminUser').mockRejectedValue(executionError as never);
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      userNo: 'ADM2602190001',
      email: 'new-admin@fiatx.com',
      status: 'INACTIVE',
    });
    accessControlService.getUserRoleCodes.mockResolvedValue(['TECH_OFFICER', 'CISO']);

    await expect(
      service.executeAdminMemberProvisioning(
        {
          intent: 'ADMIN_MEMBER_PROVISIONING',
          email: 'new-admin@fiatx.com',
          roleCodes: ['CISO', 'TECH_OFFICER'],
          ticketNo: 'CT2604010001',
          traceId: 'trace-provision-1',
        },
        {
          actorType: 'ADMIN',
          userId: 'admin-1',
          userNo: 'ADMIN-001',
          role: 'SUPER_ADMIN',
          roleCodes: ['SUPER_ADMIN'],
        },
      ),
    ).rejects.toBe(executionError);

    expect(accessControlService.getUserRoleCodes).not.toHaveBeenCalled();
    expect(adminInvitationsService.resendInvitationForUser).not.toHaveBeenCalled();
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
      roles: ['SENIOR_MANAGEMENT_OFFICER', 'CISO'],
      warnings: [],
    });
    auditLogsService.recordByActor.mockResolvedValue({});

    await service.createAdminUser({
      email: 'dual-role@fiatx.com',
      roleCodes: ['SENIOR_MANAGEMENT_OFFICER', 'CISO'],
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
