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

  it('第一批 · V1 域打点上收：replaceUserRoles 成功路径不触碰审计协作者（构造函数只收 prisma 一个依赖——若源码里偷偷调用 this.xxx.recordByActor/recordSystem，这里会因 undefined 属性访问直接抛错）', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'user-1', userNo: 'ADM2501010099', email: 'ops@fiatx.com' });
    prisma.role.findMany.mockResolvedValue([{ id: 'role-1', code: 'OPS_VIEWER' }]);
    prisma.userRole.findMany.mockResolvedValue([{ role: { code: 'OPS_VIEWER' } }]);

    const result = await service.replaceUserRoles(
      'user-1',
      ['OPS_VIEWER'],
      { actorId: 'admin-1', actorRole: 'SUPER_ADMIN', actorNo: 'ADMIN-001' },
    );

    expect(result).toEqual({ userId: 'user-1', userNo: 'ADM2501010099', roles: ['OPS_VIEWER'] });
    expect(prisma.$transaction).toHaveBeenCalled();
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

  it('T4：getUserPermissionGroups 绑了含 INCIDENT_WRITE 权限码的角色 → 返回数组含该组名', async () => {
    prisma.userRole.findMany.mockResolvedValue([
      {
        role: {
          code: 'INCIDENT_HANDLER',
          rolePermissions: [
            { permission: { code: 'api.post.admin_incidents' } },
          ],
        },
      },
    ]);

    const groups = await service.getUserPermissionGroups('user-1');

    expect(groups).toContain('INCIDENT_WRITE');
  });

  it('T4：getUserPermissionGroups 无角色 → 返回空数组', async () => {
    prisma.userRole.findMany.mockResolvedValue([]);

    const groups = await service.getUserPermissionGroups('user-2');

    expect(groups).toEqual([]);
  });

  it('T4：getUserPermissionGroups 与 getUserPermissionCodes 同源——同一 mock 数据下各自返回正确形状', async () => {
    prisma.userRole.findMany.mockResolvedValue([
      {
        role: {
          code: 'INCIDENT_HANDLER',
          rolePermissions: [
            { permission: { code: 'api.post.admin_incidents' } },
          ],
        },
      },
    ]);

    const codes = await service.getUserPermissionCodes('user-1');
    const groups = await service.getUserPermissionGroups('user-1');

    expect(codes).toEqual(['api.post.admin_incidents']);
    expect(groups).toEqual(['INCIDENT_WRITE']);
  });
});
