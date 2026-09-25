import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  ACTION_BUCKET_CATALOG,

  HARD_MUTEX_ROLE_PAIRS,
  RBAC_PERMISSION_CODE_SET,
  RBAC_PERMISSION_DEFINITIONS,
  buildPermCodeToGroups,
  getPrimaryRoleCode,
} from './rbac.catalog';

interface AdminActorContext {
  actorId: string;
  actorRole: string;
  actorNo?: string;
}

@Injectable()
export class AccessControlService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeRoleCodes(roleCodes: string[]): string[] {
    return Array.from(
      new Set(
        (roleCodes || [])
          .map((code) => String(code || '').trim().toUpperCase())
          .filter(Boolean),
      ),
    ).sort();
  }

  validateHardMutex(roleCodes: string[]) {
    if (roleCodes.includes('SUPER_ADMIN')) {
      return;
    }
    const set = new Set(roleCodes);
    for (const [left, right] of HARD_MUTEX_ROLE_PAIRS) {
      if (set.has(left) && set.has(right)) {
        throw new BadRequestException(`Role ${left} and ${right} cannot be assigned to one user.`);
      }
    }
  }

  async listRoles() {
    const roles = await (this.prisma as any).role.findMany({
      where: {
        status: { in: ['ACTIVE', 'PENDING_APPROVAL'] },
      },
      orderBy: { code: 'asc' },
      include: {
        rolePermissions: {
          include: {
            permission: true,
          },
        },
        userRoles: {
          include: {
            user: {
              select: {
                id: true,
                userNo: true,
                email: true,
                status: true,
                deletedAt: true,
              },
            },
          },
        },
      },
    });

    return roles.map((role: any) => ({
      id: role.id,
      code: role.code,
      name: role.name,
      description: role.description,
      status: role.status,
      permissions: (role.rolePermissions || [])
        .map((item: any) => ({
          code: item.permission.code,
          method: item.permission.method,
          path: item.permission.path,
          name: item.permission.name,
          description: item.permission.description,
        }))
        .sort((a: any, b: any) => a.code.localeCompare(b.code)),
      members: (role.userRoles || [])
        .map((ur: any) => ur.user)
        .filter((u: any) => u && u.deletedAt === null)
        .map((u: any) => ({
          id: u.id,
          userNo: u.userNo,
          email: u.email,
          status: u.status,
        })),
    }));
  }

  async listPermissions() {
    return (this.prisma as any).permission.findMany({
      orderBy: { code: 'asc' },
    });
  }

  async listCatalogPermissions() {
    return RBAC_PERMISSION_DEFINITIONS.map((item) => ({
      code: item.code,
      method: item.method,
      path: item.path,
      name: item.name,
      description: item.description,
    }));
  }

  getActionBucketCatalog() {
    return {
      domains: ACTION_BUCKET_CATALOG,
      permCodeToGroups: buildPermCodeToGroups(),
    };
  }

  listPermissionGroups() {
    const groupMap = new Map<string, { code: string; permissionCount: number }>();

    for (const perm of RBAC_PERMISSION_DEFINITIONS) {
      for (const group of perm.groups) {
        const existing = groupMap.get(group);
        if (existing) {
          existing.permissionCount++;
        } else {
          groupMap.set(group, { code: group, permissionCount: 1 });
        }
      }
    }

    return Array.from(groupMap.values()).sort((a, b) => a.code.localeCompare(b.code));
  }

  async getUserRoleCodes(userId: string): Promise<string[]> {
    const userRoles = await (this.prisma as any).userRole.findMany({
      where: {
        userId,
        role: { status: 'ACTIVE' },
      },
      include: { role: true },
      orderBy: { role: { code: 'asc' } },
    });

    return userRoles.map((item: any) => item.role.code);
  }

  async getUserRoles(userId: string) {
    const userRoles = await (this.prisma as any).userRole.findMany({
      where: {
        userId,
        role: { status: 'ACTIVE' },
      },
      include: { role: true },
      orderBy: { role: { code: 'asc' } },
    });

    return userRoles.map((item: any) => ({
      code: item.role.code,
      name: item.role.name,
      description: item.role.description,
      status: item.role.status,
    }));
  }

  private async getActiveRolePermissions(userId: string): Promise<Array<{ code: string }>> {
    const userRoles = await (this.prisma as any).userRole.findMany({
      where: {
        userId,
        role: { status: 'ACTIVE' },
      },
      include: {
        role: {
          include: {
            rolePermissions: {
              include: {
                permission: true,
              },
            },
          },
        },
      },
    });

    const permissions: Array<{ code: string }> = [];
    for (const userRole of userRoles) {
      for (const rolePermission of userRole.role.rolePermissions || []) {
        permissions.push(rolePermission.permission);
      }
    }
    return permissions;
  }

  async getUserPermissionCodes(userId: string): Promise<string[]> {
    const roleCodes = await this.getUserRoleCodes(userId);
    if (roleCodes.includes('SUPER_ADMIN')) {
      return RBAC_PERMISSION_DEFINITIONS.map((item) => item.code).sort();
    }

    const permissions = await this.getActiveRolePermissions(userId);

    const set = new Set<string>();
    for (const permission of permissions) {
      set.add(permission.code);
    }

    return Array.from(set).sort();
  }

  async hasPermission(userId: string, permissionCode: string): Promise<boolean> {
    const roleCodes = await this.getUserRoleCodes(userId);
    if (roleCodes.includes('SUPER_ADMIN')) {
      return true;
    }

    const permissionCodes = await this.getUserPermissionCodes(userId);
    return permissionCodes.includes(permissionCode);
  }

  isManagedPermission(permissionCode: string): boolean {
    return RBAC_PERMISSION_CODE_SET.has(permissionCode);
  }

  async replaceUserRoles(
    userId: string,
    roleCodes: string[],
    actor: AdminActorContext,
  ) {
    const normalizedRoleCodes = this.normalizeRoleCodes(roleCodes);
    if (normalizedRoleCodes.length === 0) {
      throw new BadRequestException('At least one active role code is required');
    }
    this.validateHardMutex(normalizedRoleCodes);

    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        deletedAt: null,
      },
      select: { id: true, userNo: true, email: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const roles = normalizedRoleCodes.length
      ? await (this.prisma as any).role.findMany({
          where: {
            code: { in: normalizedRoleCodes },
            status: 'ACTIVE',
          },
          select: {
            id: true,
            code: true,
          },
        })
      : [];

    const foundCodes = new Set(roles.map((role: any) => role.code));
    const missingCodes = normalizedRoleCodes.filter((code) => !foundCodes.has(code));
    if (missingCodes.length > 0) {
      throw new BadRequestException(`Unknown/Inactive role codes: ${missingCodes.join(', ')}`);
    }

    const beforeRoleCodes = await this.getUserRoleCodes(userId);
    const primaryRoleCode = getPrimaryRoleCode(normalizedRoleCodes);

    await (this.prisma as any).$transaction(async (tx: any) => {
      await tx.userRole.deleteMany({
        where: { userId },
      });

      if (roles.length > 0) {
        await tx.userRole.createMany({
          data: roles.map((role: any) => ({
            userId,
            roleId: role.id,
          })),
        });
      }

      await tx.user.update({
        where: { id: userId },
        data: {
          role: primaryRoleCode || normalizedRoleCodes[0],
        },
      });
    });

    const afterRoleCodes = await this.getUserRoleCodes(userId);

    // Task 9：审计上收——本方法只返回结果，不再自己写审计。这条自身写入在删除前
    // 已实证是死分支：本方法仅有的两个真实调用方（admin-invite-workflow.service.ts
    // 的 initiateInvite、admin-role-binding-change-workflow.service.ts 的
    // executeRoleChange）都会显式传 workflowType，旧的 !auditContext?.workflowType
    // 分支从未真正触发过；两条真实路径各自已经写了 ADMIN_INVITE_REQUESTED /
    // ADMIN_ROLE_CHANGE_APPLIED，覆盖了这次角色变更。

    return {
      userId: user.id,
      userNo: user.userNo,
      roles: afterRoleCodes,
    };
  }

  /* ── Role Definition Modify Requests ── */

  async listRoleDefinitionModifyRequests(query: {
    roleId?: string;
    status?: string;
    take?: number;
    skip?: number;
  }) {
    const where: any = {};
    if (query.roleId) where.roleId = query.roleId;
    if (query.status) where.status = query.status;

    const [items, total] = await Promise.all([
      (this.prisma as any).roleDefinitionModifyRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        // @Query() 无 DTO，query.take/skip 经真实 HTTP 到手时是字符串——显式转数字，
        // 否则字符串直传 Prisma 的 take/skip 会被拒绝（此前零前端消费，这条从未被
        // 真实探测过）。
        take: Number(query.take) || 50,
        skip: Number(query.skip) || 0,
        include: { role: { select: { code: true, name: true } } },
      }),
      (this.prisma as any).roleDefinitionModifyRequest.count({ where }),
    ]);

    // 提交人对外识别用业务键（铁律⑥）：requestedByUserId 是裸 User.id，无 Prisma 关系
    // 可 include（对照 AdminRoleChangeRequest.targetUserId 有 @relation，这张表当初没建），
    // 手动查一次批量解析成 userNo，不新增 schema 关系。
    const requestedByIds: string[] = [
      ...new Set<string>(items.map((i: any) => i.requestedByUserId).filter(Boolean)),
    ];
    const requestedByUsers = requestedByIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: requestedByIds } },
          select: { id: true, userNo: true, email: true },
        })
      : [];
    const requestedByMap = new Map(requestedByUsers.map((u) => [u.id, u]));
    const itemsWithSubmitter = items.map((i: any) => ({
      ...i,
      requestedBy: requestedByMap.get(i.requestedByUserId) ?? null,
    }));

    return { items: itemsWithSubmitter, total };
  }

  async getRoleDefinitionModifyRequest(requestNo: string) {
    const request = await (this.prisma as any).roleDefinitionModifyRequest.findUnique({
      where: { requestNo },
      include: { role: { select: { code: true, name: true, status: true } } },
    });
    if (!request) {
      throw new NotFoundException(`Role definition modify request not found: ${requestNo}`);
    }
    return request;
  }

}
