import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Optional,
} from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { AccessControlService } from './access-control.service';
import {
  REQUIRE_PERMISSIONS_KEY,
} from './require-permissions.decorator';
import { buildPermissionCode } from './permission-code.util';

@Injectable()
export class AdminPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Optional()
    private readonly accessControlService?: AccessControlService,
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
      throw new ForbiddenException(
        `Access denied. Missing permission: ${missing.join(', ')}`,
      );
    }

    return true;
  }
}
