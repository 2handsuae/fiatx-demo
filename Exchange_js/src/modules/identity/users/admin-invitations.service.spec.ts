import { BadRequestException, HttpException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminInvitationsService } from './admin-invitations.service';
import { PrismaService } from '../../../core/prisma/prisma.service';

describe('AdminInvitationsService', () => {
  let service: AdminInvitationsService;
  let prisma: any;
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

    service = new AdminInvitationsService(prisma as PrismaService, {
      get: jest.fn().mockReturnValue('http://localhost:3001'),
    } as unknown as ConfigService);
  });

  it('第一批 · V1 域打点上收：admin-invitations.service.ts 不再直接写审计', () => {
    const src = require('fs').readFileSync(`${__dirname}/admin-invitations.service.ts`, 'utf8');
    expect(src).not.toMatch(/recordByActor|recordSystem/);
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

  it('resend 时新邀请记录的 workflowType/traceId 继承自该用户上一条邀请记录（correlationId 传播，不是审计）', async () => {
    const expiresAt = new Date('2026-04-02T00:00:00.000Z');

    prisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      userNo: 'ADM2603220001',
      email: 'inactive-admin@fiatx.com',
      status: 'INACTIVE',
    });
    prisma.adminUserInvitation.findFirst.mockResolvedValue({
      workflowType: 'ADMIN_INVITE',
      traceId: 'trace-invite-1',
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
    } as any);

    // 这不是审计断言——createInvitationRecord 把继承来的 workflowType/traceId
    // 写回新邀请记录自己的列，供未来 ADMIN_INVITE_EXPIRED/ADMIN_INVITE_ACCEPTED
    // 之类的 INHERIT 读回。这条传播链路与"域服务不再自己写审计"无关，本任务不碰。
    expect(txAdminInvitationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workflowType: 'ADMIN_INVITE',
          traceId: 'trace-invite-1',
        }),
      }),
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

  it('blocks invitation accept for deleted admin users with a structured reasonCode=ACCOUNT_DELETED exception', async () => {
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

    // Task 9：域服务不再自己写审计，拒绝改为抛带 reasonCode 的结构化异常——
    // 编排层（AdminInviteWorkflowService）捕获后落 outcome=DENIED。
    await expect(
      service.acceptInvitation('token-1', '123456'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        reasonCode: 'ACCOUNT_DELETED',
        message: 'Invitation link is no longer valid',
      }),
    });
  });

  it('第一批 · acceptInvitation 只返回结果（含 fromStatus/correlationId），不再自己写审计', async () => {
    prisma.adminUserInvitation.findUnique.mockResolvedValue({
      id: 'invite-1',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      consumedAt: null,
      // ADMIN_INVITE_ACCEPTED 是 INHERIT：调用方从这里的返回值读 correlationId——
      // executeInviteDispatch 建邀请记录时写入的那份（原样来自 initiateInvite 铸造的值）。
      traceId: 'trace-invite-1',
      user: {
        id: 'user-1',
        userNo: 'ADM-001',
        email: 'new@fiatx.com',
        role: 'OPS',
        status: 'INVITE_SENT',
        deletedAt: null,
      },
    });
    txUserUpdate.mockResolvedValue({
      id: 'user-1',
      userNo: 'ADM-001',
      email: 'new@fiatx.com',
      role: 'OPS',
      status: 'ACTIVE',
    });
    txAdminInvitationUpdate.mockResolvedValue(undefined);
    txAdminInvitationUpdateMany.mockResolvedValue({ count: 0 });

    const result = await service.acceptInvitation('token-1', '123456');

    expect(result).toEqual(
      expect.objectContaining({
        userId: 'user-1',
        userNo: 'ADM-001',
        email: 'new@fiatx.com',
        role: 'OPS',
        status: 'ACTIVE',
        fromStatus: 'INVITE_SENT',
        correlationId: 'trace-invite-1',
      }),
    );
    expect(txAdminInvitationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'invite-1' },
        data: expect.objectContaining({ consumedAt: expect.any(Date) }),
      }),
    );
  });

  it('邀请记录本身没有 traceId 时 correlationId 原样为 undefined（不 ?? randomUUID() 兜底冒充 INHERIT）', async () => {
    prisma.adminUserInvitation.findUnique.mockResolvedValue({
      id: 'invite-1',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      consumedAt: null,
      traceId: null,
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

    const result = await service.acceptInvitation('token-1', '123456');

    expect(result.correlationId).toBeUndefined();
  });

  it('blocks invitation accept for an expired invitation with reasonCode=INVITATION_EXPIRED', async () => {
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
      service.acceptInvitation('token-1', '123456'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ reasonCode: 'INVITATION_EXPIRED' }),
    });
  });

  it('blocks invitation accept for an unknown token with reasonCode=INVITATION_NOT_FOUND', async () => {
    prisma.adminUserInvitation.findUnique.mockResolvedValue(null);

    await expect(
      service.acceptInvitation('bogus-token', '123456'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ reasonCode: 'INVITATION_NOT_FOUND' }),
    });
  });

  it('blocks invitation accept with a too-short password before touching the DB, reasonCode=PASSWORD_TOO_SHORT', async () => {
    await expect(
      service.acceptInvitation('token-1', '123'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ reasonCode: 'PASSWORD_TOO_SHORT' }),
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
