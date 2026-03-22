import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminInvitationsService } from './admin-invitations.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../risk-engine/audit-logs/audit-logs.service';

describe('AdminInvitationsService', () => {
  let service: AdminInvitationsService;
  let prisma: any;
  let auditLogsService: any;

  beforeEach(() => {
    prisma = {
      user: {
        findFirst: jest.fn(),
      },
      adminUserInvitation: {
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn(async (callback: (tx: any) => unknown) =>
        callback({
          adminUserInvitation: {
            findUnique: prisma.adminUserInvitation.findUnique,
            update: jest.fn(),
            updateMany: jest.fn(),
          },
          user: {
            update: jest.fn(),
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
});
