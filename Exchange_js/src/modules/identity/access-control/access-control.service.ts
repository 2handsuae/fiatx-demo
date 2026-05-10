import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import {
  ACTION_BUCKET_CATALOG,

  HARD_MUTEX_ROLE_PAIRS,
  RBAC_PERMISSION_CODE_SET,
  RBAC_PERMISSION_DEFINITIONS,
  SOFT_WARNING_ROLE_GROUPS,
  buildPermCodeToGroups,
  getPrimaryRoleCode,
} from './rbac.catalog';

interface AdminActorContext {
  actorId: string;
  actorRole: string;
  actorNo?: string;
}

type InternalAuditContext = {
  workflowType?: string;
  traceId?: string;
};

@Injectable()
export class AccessControlService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private normalizeRoleCodes(roleCodes: string[]): string[] {
    return Array.from(
      new Set(
        (roleCodes || [])
          .map((code) => String(code || '').trim().toUpperCase())
          .filter(Boolean),
      ),
    ).sort();
  }

  private normalizeOptionalString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized.length ? normalized : null;
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

  private buildSoftWarnings(roleCodes: string[]): string[] {
    if (roleCodes.includes('SUPER_ADMIN')) {
      return [];
    }
    const set = new Set(roleCodes);
    return SOFT_WARNING_ROLE_GROUPS.filter((rule) =>
      rule.codes.every((code) => set.has(code)),
    ).map((rule) => rule.message);
  }

  private applyAuditContext<T extends Record<string, unknown>>(
    payload: T,
    auditContext?: InternalAuditContext,
  ): T {
    const workflowType = this.normalizeOptionalString(auditContext?.workflowType);
    const traceId = this.normalizeOptionalString(auditContext?.traceId);

    return {
      ...payload,
      workflowType: workflowType || undefined,
      traceId: traceId || undefined,
    } as T;
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

  async getUserPermissionCodes(userId: string): Promise<string[]> {
    const roleCodes = await this.getUserRoleCodes(userId);
    if (roleCodes.includes('SUPER_ADMIN')) {
      return RBAC_PERMISSION_DEFINITIONS.map((item) => item.code).sort();
    }

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

    const set = new Set<string>();
    for (const userRole of userRoles) {
      for (const rolePermission of userRole.role.rolePermissions || []) {
        set.add(rolePermission.permission.code);
      }
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
    auditContext?: InternalAuditContext,
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
    const warnings = this.buildSoftWarnings(afterRoleCodes);

    if (!auditContext?.workflowType) {
      await this.auditLogsService.recordByActor(
        this.applyAuditContext({
          action: AuditActions.USER_ROLE_BINDING_UPDATED,
          entityType: AuditEntityTypes.ACCESS_CONTROL,
          entityId: user.id,
          entityNo: user.userNo,
          metadata: {
            userId: user.id,
            userNo: user.userNo,
            userEmail: user.email,
            warnings,
          },
        }, auditContext),
        {
          actorType: 'ADMIN',
          actorId: actor.actorId,
          actorNo: actor.actorNo,
          actorRole: actor.actorRole,
        },
      );
    }

    return {
      userId: user.id,
      userNo: user.userNo,
      roles: afterRoleCodes,
      warnings,
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
        take: query.take || 50,
        skip: query.skip || 0,
        include: { role: { select: { code: true, name: true } } },
      }),
      (this.prisma as any).roleDefinitionModifyRequest.count({ where }),
    ]);

    return { items, total };
  }

  async getRoleDefinitionModifyRequest(id: string) {
    const request = await (this.prisma as any).roleDefinitionModifyRequest.findUnique({
      where: { id },
      include: { role: { select: { code: true, name: true, status: true } } },
    });
    if (!request) {
      throw new NotFoundException(`Role definition modify request not found: ${id}`);
    }
    return request;
  }

}
