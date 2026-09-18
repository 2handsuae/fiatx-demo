import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Optional,
} from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AccessControlService } from './access-control.service';
import {
  REQUIRE_PERMISSIONS_KEY,
} from './require-permissions.decorator';
import { buildPermissionCode } from './permission-code.util';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import { AuditCategory, AuditOutcome } from '../../audit-logging/dto/audit-log.dto';

@Injectable()
export class AdminPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Optional()
    private readonly accessControlService?: AccessControlService,
    @Optional()
    private readonly auditLogsService?: AuditLogsService,
    @Optional()
    private readonly prisma?: PrismaService,
  ) {}

  private resolvePathMetadata(target: any): string {
    const raw = Reflect.getMetadata(PATH_METADATA, target);
    if (Array.isArray(raw)) {
      return String(raw[0] || '');
    }
    return String(raw || '');
  }

  private buildRequestPermissionCode(context: ExecutionContext, method: string): string {
    const controllerPath = this.resolvePathMetadata(context.getClass());
    const methodPath = this.resolvePathMetadata(context.getHandler());

    const parts = [controllerPath, methodPath]
      .map((part) => String(part || '').trim())
      .filter(Boolean)
      .map((part) => part.replace(/^\/+|\/+$/g, ''));

    const joinedPath = `/${parts.join('/')}`.replace(/\/+/g, '/');
    return buildPermissionCode(method, joinedPath);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      return true;
    }

    if (user?.scope === 'first_login' || user?.scope === 'mfa_session') {
      throw new ForbiddenException('Restricted token cannot access this endpoint');
    }

    if (!this.accessControlService) {
      return true;
    }

    if (user.type !== 'ADMIN') {
      return true;
    }

    const userId = String(user.userId || '').trim();
    if (!userId) {
      throw new ForbiddenException('Admin token missing userId');
    }

    const roleCodes = await this.accessControlService.getUserRoleCodes(userId);
    request.user.roleCodes = roleCodes;

    if (roleCodes.includes('SUPER_ADMIN')) {
      return true;
    }

    const explicitPermissions = this.reflector.getAllAndOverride<string[]>(
      REQUIRE_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    const requiredPermissions =
      explicitPermissions && explicitPermissions.length > 0
        ? explicitPermissions
        : [this.buildRequestPermissionCode(context, request.method || 'GET')];

    for (const permissionCode of requiredPermissions) {
      if (!this.accessControlService.isManagedPermission(permissionCode)) {
        await this.recordDenied(request, [permissionCode], 'PERMISSION_NOT_IN_CATALOG');
        throw new ForbiddenException(
          `Access denied. Permission ${permissionCode} is not allowed in RBAC catalog.`,
        );
      }
    }

    const permissionCodes = await this.accessControlService.getUserPermissionCodes(userId);
    request.user.permissionCodes = permissionCodes;
    const permissionSet = new Set(permissionCodes);

    const missing = requiredPermissions.filter((code) => !permissionSet.has(code));
    if (missing.length > 0) {
      await this.recordDenied(request, missing, 'MISSING_PERMISSION');
      throw new ForbiddenException(
        `Access denied. Missing permission: ${missing.join(', ')}`,
      );
    }

    return true;
  }

  /**
   * userNo 兜底：常规 ADMIN 登录签发的 JWT 都带 userNo（auth.service.ts login /
   * mfa-binding-workflow.service.ts 两条签发路径皆含），这里只防万一（例如手工签发
   * 的旧 token）——actorNo 落库必须是 ADM 业务号，UUID 三年后没人认得出是谁。
   */
  private async resolveActorNo(request: any): Promise<string> {
    const userNo = String(request.user?.userNo || '').trim();
    if (userNo) {
      return userNo;
    }
    const userId = String(request.user?.userId || '').trim();
    if (userId && this.prisma) {
      const user = await this.prisma.user.findFirst({
        where: { id: userId },
        select: { userNo: true },
      });
      if (user?.userNo) {
        return user.userNo;
      }
    }
    return userId || 'UNKNOWN';
  }

  /**
   * ADMIN_ACCESS_DENIED 的唯一写入点——两个 deny 分支（缺权限 / 权限码不在 catalog）
   * 各调一次。留痕失败即流程失败（法一纪律3）：这里刻意不包 catch，写失败让守卫抛
   * 500 而不是悄悄放行成一句 403——「默默拦下被禁止的动作」不许发生。
   */
  private async recordDenied(
    request: any,
    requiredPermissions: string[],
    reasonCode: string,
  ): Promise<void> {
    if (!this.auditLogsService) return;
    const actorNo = await this.resolveActorNo(request);
    await this.auditLogsService.recordByActor(
      {
        action: 'ADMIN_ACCESS_DENIED',
        actionDomain: 'IAM',
        category: AuditCategory.GOVERNANCE,
        primarySubjectType: AuditEntityTypes.ACCESS_CONTROL,
        primarySubjectNo: requiredPermissions.join(','),
        outcome: AuditOutcome.DENIED,
        reasonCode,
        reason: `Missing permission: ${requiredPermissions.join(', ')}`,
        requestId: `ADMIN_ACCESS_DENIED_${requiredPermissions[0]}_${randomUUID()}`,
        sourcePlatform: 'ADMIN_API',
        sourceIp: request.ip,
      },
      {
        actorType: 'ADMIN',
        actorNo,
        actorDisplayName: actorNo,
        actorRolesAtTime: request.user?.roleCodes ?? [],
      },
    );
  }
}
