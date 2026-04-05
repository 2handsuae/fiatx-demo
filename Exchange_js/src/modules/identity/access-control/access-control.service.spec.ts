import { NotFoundException } from '@nestjs/common';
import { AccessControlService } from './access-control.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../risk-engine/audit-logs/audit-logs.service';

describe('AccessControlService', () => {
  let service: AccessControlService;
  let prisma: any;
  let auditLogsService: any;

  beforeEach(() => {
    prisma = {
      user: {
        findFirst: jest.fn(),
      },
      userRole: {
        findMany: jest.fn(),
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      role: {
        findMany: jest.fn(),
      },
      $transaction: jest.fn(async (callback: (tx: any) => unknown) =>
        callback({
          userRole: prisma.userRole,
          user: {
            update: jest.fn(),
          },
        }),
      ),
    };

    auditLogsService = {
      recordByActor: jest.fn().mockResolvedValue(undefined),
    };

    service = new AccessControlService(
      prisma as PrismaService,
      auditLogsService as AuditLogsService,
    );
  });

  it('rejects role replacement for deleted admin users', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(
      service.replaceUserRoles(
        'deleted-user',
        ['OPS'],
        {
          actorId: 'admin-1',
          actorRole: 'SUPER_ADMIN',
          actorNo: 'ADMIN-001',
        },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('executes governed role binding changes via replaceUserRoles', async () => {
    const replaceUserRolesSpy = jest.spyOn(service, 'replaceUserRoles').mockResolvedValue({
      userId: 'user-123',
      userNo: 'USR-123',
      roles: ['OPS', 'DPO'],
      warnings: [],
    });

    const result = await service.executeGovernedRoleBindingChange(
      {
        intent: 'ADMIN_ROLE_BINDING_CHANGE',
        targetUserId: 'user-123',
        roleCodes: ['OPS', 'DPO'],
      },
      {
        actorType: 'ADMIN',
        userId: 'admin-1',
        userNo: 'ADMIN-001',
        role: 'SUPER_ADMIN',
        roleCodes: ['SUPER_ADMIN'],
      },
    );

    expect(replaceUserRolesSpy).toHaveBeenCalledWith(
      'user-123',
      ['OPS', 'DPO'],
      {
        actorId: 'admin-1',
        actorNo: 'ADMIN-001',
        actorRole: 'SUPER_ADMIN',
      },
      undefined,
    );
    expect(result).toEqual({
      userId: 'user-123',
      userNo: 'USR-123',
      roles: ['OPS', 'DPO'],
      warnings: [],
    });
  });

  it('passes the upstream workflow trace into governed role binding execution', async () => {
    const replaceUserRolesSpy = jest.spyOn(service, 'replaceUserRoles').mockResolvedValue({
      userId: 'user-123',
      userNo: 'USR-123',
      roles: ['OPS', 'DPO'],
      warnings: [],
    });

    await service.executeGovernedRoleBindingChange(
      {
        intent: 'ADMIN_ROLE_BINDING_CHANGE',
        targetUserId: 'user-123',
        roleCodes: ['OPS', 'DPO'],
        ticketNo: 'CT2604010002',
        traceId: 'trace-role-binding-1',
      },
      {
        actorType: 'ADMIN',
        userId: 'admin-1',
        userNo: 'ADMIN-001',
        role: 'SUPER_ADMIN',
        roleCodes: ['SUPER_ADMIN'],
      },
    );

    expect(replaceUserRolesSpy).toHaveBeenCalledWith(
      'user-123',
      ['OPS', 'DPO'],
      {
        actorId: 'admin-1',
        actorNo: 'ADMIN-001',
        actorRole: 'SUPER_ADMIN',
      },
      {
        workflowType: 'ADMIN_ROLE_BINDING_CHANGE',
        workflowNo: 'CT2604010002',
        traceId: 'trace-role-binding-1',
      },
    );
  });

  it('does not recover governed role binding change for non-idempotent errors even when roles already match', async () => {
    const executionError = new Error('audit write failed after role replacement');
    jest.spyOn(service, 'replaceUserRoles').mockRejectedValue(executionError as never);
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-123',
      userNo: 'USR-123',
      email: 'target@fiatx.com',
    });
    jest.spyOn(service, 'getUserRoleCodes').mockResolvedValue(['OPS', 'DPO']);

    await expect(
      service.executeGovernedRoleBindingChange(
        {
          intent: 'ADMIN_ROLE_BINDING_CHANGE',
          targetUserId: 'user-123',
          roleCodes: ['OPS', 'DPO'],
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

    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });
});
