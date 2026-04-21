import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminInvitationsService } from './admin-invitations.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';

describe('AdminInvitationsService', () => {
  let service: AdminInvitationsService;
  let prisma: any;
  let auditLogsService: any;
  let txAdminInvitationCreate: jest.Mock;
  let txAdminInvitationUpdateMany: jest.Mock;
  let txAdminInvitationUpdate: jest.Mock;
  let txUserFindUnique: jest.Mock;
  let txUserUpdate: jest.Mock;

  beforeEach(() => {
    txAdminInvitationCreate = jest.fn();
    txAdminInvitationUpdateMany = jest.fn();
    txAdminInvitationUpdate = jest.fn();
    txUserFindUnique = jest.fn();
    txUserUpdate = jest.fn();

    prisma = {
      user: {
        findFirst: jest.fn(),
      },
      adminUserInvitation: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn(async (callback: (tx: any) => unknown) =>
        callback({
          adminUserInvitation: {
            findUnique: prisma.adminUserInvitation.findUnique,
            findFirst: prisma.adminUserInvitation.findFirst,
            create: txAdminInvitationCreate,
            update: txAdminInvitationUpdate,
            updateMany: txAdminInvitationUpdateMany,
          },
          user: {
            findUnique: txUserFindUnique,
            update: txUserUpdate,
          },
        }),
      ),
    };

    auditLogsService = {
      recordByActor: jest.fn().mockResolvedValue(undefined),
    };

    service = new AdminInvitationsService(
      prisma as PrismaService,
      {
        get: jest.fn().mockReturnValue('http://localhost:3001'),
      } as unknown as ConfigService,
      auditLogsService as AuditLogsService,
    );
  });

  it('returns a fresh pending invitation link when resending for an inactive admin user', async () => {
    const expiresAt = new Date('2026-04-02T00:00:00.000Z');

    prisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      userNo: 'ADM2603220001',
      email: 'inactive-admin@fiatx.com',
      status: 'INACTIVE',
    });
    txUserFindUnique.mockResolvedValue({
      status: 'INACTIVE',
      deletedAt: null,
    });
    txAdminInvitationCreate.mockResolvedValue({
      id: 'invite-2',
      expiresAt,
    });

    const result = await service.resendInvitationForUser({
      userId: 'user-1',
      actor: {
        actorId: 'admin-1',
        actorRole: 'SUPER_ADMIN',
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        userId: 'user-1',
        userNo: 'ADM2603220001',
        email: 'inactive-admin@fiatx.com',
        status: 'INACTIVE',
        inviteExpiresAt: expiresAt.toISOString(),
        inviteStatus: 'PENDING',
      }),
    );
    expect(result.inviteLink).toMatch(
      /^http:\/\/localhost:3001\/admin\/activate\?token=/,
    );
    expect(txAdminInvitationUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-1',
        }),
      }),
    );
  });

  it('records resend invitation under the inherited provisioning trace when auditContext is provided', async () => {
    const expiresAt = new Date('2026-04-02T00:00:00.000Z');

    prisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      userNo: 'ADM2603220001',
      email: 'inactive-admin@fiatx.com',
      status: 'INACTIVE',
    });
    txUserFindUnique.mockResolvedValue({
      status: 'INACTIVE',
      deletedAt: null,
    });
    txAdminInvitationCreate.mockResolvedValue({
      id: 'invite-2',
      expiresAt,
    });

    await service.resendInvitationForUser({
      userId: 'user-1',
      actor: {
        actorId: 'admin-1',
        actorRole: 'SUPER_ADMIN',
        actorNo: 'ADMIN-001',
      },
      auditContext: {
        workflowType: 'ADMIN_MEMBER_PROVISIONING',
        workflowNo: 'CT2604010001',
        traceId: 'trace-provision-1',
      },
    } as any);

    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ADMIN_INVITATION_RESENT',
        workflowType: 'ADMIN_MEMBER_PROVISIONING',
        traceId: 'trace-provision-1',
      }),
      expect.any(Object),
    );
  });

  it('derives resend invitation audit context from the latest invitation chain when input auditContext is missing', async () => {
    const expiresAt = new Date('2026-04-02T00:00:00.000Z');

    prisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      userNo: 'ADM2603220001',
      email: 'inactive-admin@fiatx.com',
      status: 'INACTIVE',
    });
    prisma.adminUserInvitation.findFirst.mockResolvedValue({
      workflowType: 'ADMIN_MEMBER_PROVISIONING',
      workflowNo: 'CT2604010001',
      traceId: 'trace-provision-1',
    });
    txUserFindUnique.mockResolvedValue({
      status: 'INACTIVE',
      deletedAt: null,
    });
    txAdminInvitationCreate.mockResolvedValue({
      id: 'invite-2',
      expiresAt,
      workflowType: 'ADMIN_MEMBER_PROVISIONING',
      workflowNo: 'CT2604010001',
      traceId: 'trace-provision-1',
    });

    await service.resendInvitationForUser({
      userId: 'user-1',
      actor: {
        actorId: 'admin-1',
        actorRole: 'SUPER_ADMIN',
        actorNo: 'ADMIN-001',
      },
    } as any);

    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ADMIN_INVITATION_RESENT',
        workflowType: 'ADMIN_MEMBER_PROVISIONING',
        traceId: 'trace-provision-1',
      }),
      expect.any(Object),
    );
  });

  it('blocks invitation resend for deleted admin users', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(
      service.resendInvitationForUser({
        userId: 'user-deleted',
        actor: {
          actorId: 'admin-1',
          actorRole: 'SUPER_ADMIN',
        },
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('blocks invitation preview for deleted admin users', async () => {
    prisma.adminUserInvitation.findUnique.mockResolvedValue({
      id: 'invite-1',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      consumedAt: null,
      user: {
        id: 'user-1',
        userNo: 'ADM2603220001',
        email: 'deleted-admin@fiatx.com',
        status: 'INACTIVE',
        deletedAt: new Date(),
      },
    });

    await expect(service.getInvitationPreview('token-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('blocks invitation accept for deleted admin users and records audit failure', async () => {
    prisma.adminUserInvitation.findUnique.mockResolvedValue({
      id: 'invite-1',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      consumedAt: null,
      user: {
        id: 'user-1',
        userNo: 'ADM2603220001',
        email: 'deleted-admin@fiatx.com',
        role: 'OPS',
        status: 'INACTIVE',
        deletedAt: new Date(),
      },
    });

    await expect(service.acceptInvitation('token-1', '123456')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: expect.any(String),
        reason: 'Invitation link is no longer valid',
      }),
      expect.objectContaining({
        actorId: 'UNKNOWN',
      }),
    );
  });

  it('records invitation accept success under the inherited provisioning trace when auditContext is provided', async () => {
    prisma.adminUserInvitation.findUnique.mockResolvedValue({
      id: 'invite-1',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      consumedAt: null,
      user: {
        id: 'user-1',
        userNo: 'ADM2603220001',
        email: 'inactive-admin@fiatx.com',
        role: 'OPS',
        status: 'INACTIVE',
        deletedAt: null,
      },
    });
    txUserUpdate.mockResolvedValue({
      id: 'user-1',
      userNo: 'ADM2603220001',
      email: 'inactive-admin@fiatx.com',
      role: 'OPS',
      status: 'ACTIVE',
    });
    txAdminInvitationUpdate.mockResolvedValue(undefined);
    txAdminInvitationUpdateMany.mockResolvedValue({ count: 0 });

    await service.acceptInvitation('token-1', '123456', {
      requestId: 'req-1',
      sourcePlatform: 'ADMIN_INVITATION_API',
      auditContext: {
        workflowType: 'ADMIN_MEMBER_PROVISIONING',
        workflowNo: 'CT2604010001',
        traceId: 'trace-provision-1',
      },
    } as any);

    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ADMIN_INVITATION_ACCEPTED',
        workflowType: 'ADMIN_MEMBER_PROVISIONING',
        traceId: 'trace-provision-1',
      }),
      expect.any(Object),
    );
  });

  it('derives invitation accept audit context from the invitation chain when request auditContext is missing', async () => {
    prisma.adminUserInvitation.findUnique.mockResolvedValue({
      id: 'invite-1',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      consumedAt: null,
      workflowType: 'ADMIN_MEMBER_PROVISIONING',
      workflowNo: 'CT2604010001',
      traceId: 'trace-provision-1',
      user: {
        id: 'user-1',
        userNo: 'ADM2603220001',
        email: 'inactive-admin@fiatx.com',
        role: 'OPS',
        status: 'INACTIVE',
        deletedAt: null,
      },
    });
    txUserUpdate.mockResolvedValue({
      id: 'user-1',
      userNo: 'ADM2603220001',
      email: 'inactive-admin@fiatx.com',
      role: 'OPS',
      status: 'ACTIVE',
    });
    txAdminInvitationUpdate.mockResolvedValue(undefined);
    txAdminInvitationUpdateMany.mockResolvedValue({ count: 0 });

    await service.acceptInvitation('token-1', '123456', {
      requestId: 'req-1',
      sourcePlatform: 'ADMIN_INVITATION_API',
    } as any);

    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ADMIN_INVITATION_ACCEPTED',
        workflowType: 'ADMIN_MEMBER_PROVISIONING',
        traceId: 'trace-provision-1',
      }),
      expect.any(Object),
    );
  });

  it('records invitation accept failure under the inherited provisioning trace when auditContext is provided', async () => {
    prisma.adminUserInvitation.findUnique.mockResolvedValue({
      id: 'invite-1',
      expiresAt: new Date(Date.now() - 60_000),
      revokedAt: null,
      consumedAt: null,
      user: {
        id: 'user-1',
        userNo: 'ADM2603220001',
        email: 'inactive-admin@fiatx.com',
        role: 'OPS',
        status: 'INACTIVE',
        deletedAt: null,
      },
    });

    await expect(
      service.acceptInvitation('token-1', '123456', {
        requestId: 'req-2',
        sourcePlatform: 'ADMIN_INVITATION_API',
        auditContext: {
          workflowType: 'ADMIN_MEMBER_PROVISIONING',
          workflowNo: 'CT2604010001',
          traceId: 'trace-provision-1',
        },
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ADMIN_INVITATION_ACCEPT_FAILED',
        workflowType: 'ADMIN_MEMBER_PROVISIONING',
        traceId: 'trace-provision-1',
      }),
      expect.any(Object),
    );
  });

  it('derives invitation accept failure audit context from the invitation chain when request auditContext is missing', async () => {
    prisma.adminUserInvitation.findUnique.mockResolvedValue({
      id: 'invite-1',
      expiresAt: new Date(Date.now() - 60_000),
      revokedAt: null,
      consumedAt: null,
      workflowType: 'ADMIN_MEMBER_PROVISIONING',
      workflowNo: 'CT2604010001',
      traceId: 'trace-provision-1',
      user: {
        id: 'user-1',
        userNo: 'ADM2603220001',
        email: 'inactive-admin@fiatx.com',
        role: 'OPS',
        status: 'INACTIVE',
        deletedAt: null,
      },
    });

    await expect(
      service.acceptInvitation('token-1', '123456', {
        requestId: 'req-3',
        sourcePlatform: 'ADMIN_INVITATION_API',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ADMIN_INVITATION_ACCEPT_FAILED',
        workflowType: 'ADMIN_MEMBER_PROVISIONING',
        traceId: 'trace-provision-1',
      }),
      expect.any(Object),
    );
  });
});
