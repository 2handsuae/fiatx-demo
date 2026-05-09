import { Injectable, ForbiddenException, Optional } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { AdminInvitationsService } from '../users/admin-invitations.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'crypto';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AccessControlService } from '../access-control/access-control.service';
import { getPrimaryRoleCode } from '../access-control/rbac.catalog';
import {
  AuditActions,
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditModules,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';

interface AuthRequestContext {
  requestId?: string;
  sourceIp?: string;
  sourcePlatform?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private adminInvitationsService: AdminInvitationsService,
    private jwtService: JwtService,
    private auditLogsService: AuditLogsService,
    @Optional() private accessControlService?: AccessControlService,
  ) {}

  private maskIdentifier(identifier: string) {
    const normalized = String(identifier || '').trim().toLowerCase();
    return createHash('sha256').update(normalized).digest('hex');
  }

  private buildLoginAuditContext(params: {
    traceId: string;
    userNo?: string | null;
    identifier?: string;
  }) {
    return {
      workflowType: AuditBusinessWorkflowTypes.ADMIN_LOGIN_ACCESS,
      traceId: params.traceId,
    };
  }

  async validateUser(
    identifier: string,
    pass: string,
    ctx: AuthRequestContext = {},
  ): Promise<any> {
    const authTraceId = randomUUID();
    const user = await this.usersService.findByIdentifier(identifier);
    if (!user) {
      await this.auditLogsService.recordByActor(
        {
          action: AuditActions.ADMIN_LOGIN_FAILED,
          entityType: AuditEntityTypes.AUTH,
          result: AuditResult.FAILED,
          reason: 'Admin login failed: account not found',
          metadata: {
            identifierHash: this.maskIdentifier(identifier),
          },
          ...this.buildLoginAuditContext({
            traceId: authTraceId,
            identifier,
          }),
          requestId: ctx.requestId,
          sourceIp: ctx.sourceIp,
          sourcePlatform: ctx.sourcePlatform || 'ADMIN_AUTH_API',
        },
        {
          actorType: 'ADMIN',
          actorId: 'UNKNOWN',
          actorRole: 'UNKNOWN',
        },
      );
      return null;
    }

    if (user.status === 'INACTIVE') {
      await this.auditLogsService.recordByActor(
        {
          action: AuditActions.ADMIN_LOGIN_FAILED,
          entityType: AuditEntityTypes.AUTH,
          entityId: user.id,
          entityNo: user.userNo,
          result: AuditResult.REJECTED,
          reason: 'Admin login rejected: account not activated',
          metadata: {
            identifierHash: this.maskIdentifier(identifier),
            accountStatus: user.status,
          },
          ...this.buildLoginAuditContext({
            traceId: authTraceId,
            userNo: user.userNo,
            identifier,
          }),
          requestId: ctx.requestId,
          sourceIp: ctx.sourceIp,
          sourcePlatform: ctx.sourcePlatform || 'ADMIN_AUTH_API',
        },
        {
          actorType: 'ADMIN',
          actorId: user.id,
          actorNo: user.userNo,
          actorRole: user.role,
        },
      );
      throw new ForbiddenException(
        'Account not activated. Please complete invitation setup first.',
      );
    }

    if (user.status === 'SUSPENDED') {
      await this.auditLogsService.recordByActor(
        {
          action: AuditActions.ADMIN_LOGIN_FAILED,
          entityType: AuditEntityTypes.AUTH,
          entityId: user.id,
          entityNo: user.userNo,
          result: AuditResult.REJECTED,
          reason: 'Admin login rejected: account suspended',
          metadata: {
            identifierHash: this.maskIdentifier(identifier),
            accountStatus: user.status,
          },
          ...this.buildLoginAuditContext({
            traceId: authTraceId,
            userNo: user.userNo,
            identifier,
          }),
          requestId: ctx.requestId,
          sourceIp: ctx.sourceIp,
          sourcePlatform: ctx.sourcePlatform || 'ADMIN_AUTH_API',
        },
        {
          actorType: 'ADMIN',
          actorId: user.id,
          actorNo: user.userNo,
          actorRole: user.role,
        },
      );
      throw new ForbiddenException('Account has been suspended');
    }

    if (
      user.status === 'LOCKED' &&
      user.lockedUntil &&
      user.lockedUntil > new Date()
    ) {
      await this.auditLogsService.recordByActor(
        {
          action: AuditActions.ACCOUNT_LOCKED,
          entityType: AuditEntityTypes.AUTH,
          entityId: user.id,
          entityNo: user.userNo,
          result: AuditResult.REJECTED,
          reason: 'Admin account locked',
          metadata: {
            lockedUntil: user.lockedUntil.toISOString(),
            identifierHash: this.maskIdentifier(identifier),
          },
          ...this.buildLoginAuditContext({
            traceId: authTraceId,
            userNo: user.userNo,
            identifier,
          }),
          requestId: ctx.requestId,
          sourceIp: ctx.sourceIp,
          sourcePlatform: ctx.sourcePlatform || 'ADMIN_AUTH_API',
        },
        {
          actorType: 'ADMIN',
          actorId: user.id,
          actorNo: user.userNo,
          actorRole: user.role,
        },
      );
      throw new ForbiddenException('Account is locked. Try again later.');
    } else if (
      user.status === 'LOCKED' &&
      user.lockedUntil &&
      user.lockedUntil <= new Date()
    ) {
      // Unlock automatically
      await this.usersService.update({
        where: { id: user.id },
        data: { status: 'ACTIVE', failedLoginAttempts: 0, lockedUntil: null },
      });
      await this.auditLogsService.recordByActor(
        {
          action: AuditActions.ACCOUNT_UNLOCKED,
          entityType: AuditEntityTypes.AUTH,
          entityId: user.id,
          entityNo: user.userNo,
          result: AuditResult.SUCCESS,
          ...this.buildLoginAuditContext({
            traceId: authTraceId,
            userNo: user.userNo,
            identifier,
          }),
          reason: 'Admin account auto unlocked after lock timeout',
          requestId: ctx.requestId,
          sourceIp: ctx.sourceIp,
          sourcePlatform: ctx.sourcePlatform || 'ADMIN_AUTH_API',
        },
        {
          actorType: 'ADMIN',
          actorId: user.id,
          actorNo: user.userNo,
          actorRole: user.role,
        },
      );
    }

    const isMatch = await bcrypt.compare(pass, user.password);
    if (isMatch) {
      await this.usersService.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: 0,
          lockedUntil: null,
          lastLoginAt: new Date(),
        },
      });
      await this.auditLogsService.recordByActor(
        {
          action: AuditActions.ADMIN_LOGIN_SUCCESS,
          entityType: AuditEntityTypes.AUTH,
          entityId: user.id,
          entityNo: user.userNo,
          result: AuditResult.SUCCESS,
          ...this.buildLoginAuditContext({
            traceId: authTraceId,
            userNo: user.userNo,
            identifier,
          }),
          requestId: ctx.requestId,
          sourceIp: ctx.sourceIp,
          sourcePlatform: ctx.sourcePlatform || 'ADMIN_AUTH_API',
        },
        {
          actorType: 'ADMIN',
          actorId: user.id,
          actorNo: user.userNo,
          actorRole: user.role,
        },
      );
      const { password: _, ...result } = user;
      return { ...result, authTraceId };
    } else {
      // Increment failed attempts
      const attempts = user.failedLoginAttempts + 1;
      const updateData: any = { failedLoginAttempts: attempts };

      if (attempts >= 5) {
        updateData.status = 'LOCKED';
        updateData.lockedUntil = new Date(Date.now() + 30 * 60 * 1000); // 30 min lock
      }

      await this.usersService.update({
        where: { id: user.id },
        data: updateData,
      });

      await this.auditLogsService.recordByActor(
        {
          action: AuditActions.ADMIN_LOGIN_FAILED,
          entityType: AuditEntityTypes.AUTH,
          entityId: user.id,
          entityNo: user.userNo,
          result: AuditResult.FAILED,
          reason:
            attempts >= 5
              ? 'Admin login failed and account locked'
              : 'Admin login failed: invalid password',
          metadata: {
            failedLoginAttempts: attempts,
            lockApplied: attempts >= 5,
          },
          ...this.buildLoginAuditContext({
            traceId: authTraceId,
            userNo: user.userNo,
            identifier,
          }),
          requestId: ctx.requestId,
          sourceIp: ctx.sourceIp,
          sourcePlatform: ctx.sourcePlatform || 'ADMIN_AUTH_API',
        },
        {
          actorType: 'ADMIN',
          actorId: user.id,
          actorNo: user.userNo,
          actorRole: user.role,
        },
      );

      if (attempts >= 5) {
        await this.auditLogsService.recordByActor(
          {
              action: AuditActions.ACCOUNT_LOCKED,
            entityType: AuditEntityTypes.AUTH,
            entityId: user.id,
            entityNo: user.userNo,
            result: AuditResult.REJECTED,
            reason: 'Admin account locked by failed login attempts',
            metadata: {
              failedLoginAttempts: attempts,
              lockedUntil: updateData.lockedUntil?.toISOString?.() || null,
            },
            ...this.buildLoginAuditContext({
              traceId: authTraceId,
              userNo: user.userNo,
              identifier,
            }),
            requestId: ctx.requestId,
            sourceIp: ctx.sourceIp,
            sourcePlatform: ctx.sourcePlatform || 'ADMIN_AUTH_API',
          },
          {
            actorType: 'ADMIN',
            actorId: user.id,
            actorNo: user.userNo,
            actorRole: user.role,
          },
        );
      }

      return null;
    }
  }

  async login(user: any) {
    // RBAC resolution: primary source is user_roles table (getUserRoleCodes).
    // user.role (legacy) is appended so older JWT tokens that predate the
    // roleCodes claim continue to work. Once all sessions are refreshed,
    // the user.role fallback here can be removed.
    const resolvedRoleCodes = this.accessControlService
      ? await this.accessControlService.getUserRoleCodes(user.id)
      : [];
    const roleCodes = Array.from(
      new Set(
        [...resolvedRoleCodes, String(user.role || '').trim().toUpperCase()].filter(
          Boolean,
        ),
      ),
    );
    const primaryRole = getPrimaryRoleCode(roleCodes) || user.role || 'ADMIN';

    // Branch 1: first login not yet completed — issue a scoped first-login token
    const firstLoginStatus = user.firstLoginStatus ?? 'COMPLETED';
    if (firstLoginStatus !== 'COMPLETED') {
      const firstLoginToken = this.jwtService.sign(
        {
          username: user.email,
          sub: user.id,
          userNo: user.userNo,
          role: primaryRole,
          scope: 'first_login',
          type: 'ADMIN',
        },
        { expiresIn: '15m' },
      );
      return { status: 'FIRST_LOGIN_REQUIRED', firstLoginToken };
    }

    // Branch 2: MFA enrolled — issue a scoped MFA session token
    if (user.mfaEnabledAt) {
      const mfaSessionToken = this.jwtService.sign(
        {
          username: user.email,
          sub: user.id,
          userNo: user.userNo,
          role: primaryRole,
          roleCodes,
          scope: 'mfa_session',
          type: 'ADMIN',
          loginTraceId: user.authTraceId,
        },
        { expiresIn: '15m' },
      );
      return { status: 'MFA_REQUIRED', mfaSessionToken };
    }

    // Branch 3: normal login — issue a full access token
    const payload = {
      username: user.email,
      sub: user.id,
      userNo: user.userNo,
      role: primaryRole,
      roleCodes,
      type: 'ADMIN',
    };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        userNo: user.userNo,
        email: user.email,
        role: primaryRole,
        roles: roleCodes,
        lastLoginAt: user.lastLoginAt,
      },
    };
  }

  async getAdminSession(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new ForbiddenException('Invalid admin session');
    }

    const [roles, permissions] = this.accessControlService
      ? await Promise.all([
          this.accessControlService.getUserRoleCodes(userId),
          this.accessControlService.getUserPermissionCodes(userId),
        ])
      : [[], []];

    return {
      id: user.id,
      userNo: user.userNo,
      email: user.email,
      status: user.status,
      lastLoginAt: user.lastLoginAt,
      roles,
      permissions,
    };
  }

  async getAdminInvitationPreview(token: string) {
    return this.adminInvitationsService.getInvitationPreview(token);
  }

  async acceptAdminInvitation(
    token: string,
    password: string,
    ctx: AuthRequestContext = {},
  ) {
    return this.adminInvitationsService.acceptInvitation(token, password, ctx);
  }
}
