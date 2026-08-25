import { NotFoundException } from '@nestjs/common';
import { AccessControlService } from './access-control.service';
import { PrismaService } from '../../../core/prisma/prisma.service';

describe('AccessControlService', () => {
  let service: AccessControlService;
  let prisma: any;

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

    service = new AccessControlService(prisma as PrismaService);
  });

  it('第一批 · V1 域打点上收：access-control.service.ts 不再直接写审计', () => {
    const src = require('fs').readFileSync(`${__dirname}/access-control.service.ts`, 'utf8');
    expect(src).not.toMatch(/recordByActor|recordSystem/);
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
