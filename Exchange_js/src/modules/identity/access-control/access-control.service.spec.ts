import { NotFoundException } from '@nestjs/common';
import { AccessControlService } from './access-control.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';

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
});
