import { Injectable, ForbiddenException, Optional } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { AdminInvitationsService } from '../users/admin-invitations.service';
import { AdminInviteWorkflowService } from '../users/admin-invite-workflow.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DomainEventNames } from '../../../common/events/domain-events.constants';
import { AccessControlService } from '../access-control/access-control.service';
import { getPrimaryRoleCode } from '../access-control/rbac.catalog';

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
    private adminInviteWorkflowService: AdminInviteWorkflowService,
    private jwtService: JwtService,
    private eventEmitter: EventEmitter2,
    @Optional() private accessControlService?: AccessControlService,
  ) {}

  async validateUser(
    identifier: string,
    pass: string,
    ctx: AuthRequestContext = {},
  ): Promise<any> {
    // 登录成功/失败流水归安全日志（本项目不做）——Task 9 起本方法不再直接写审计。
    // authTraceId 仍保留：login() 之后 MFA 分支要靠它把 mfa_session token 与本次
    // 登录串起来（见下方 return { ...result, authTraceId }），与审计无关。
    const authTraceId = randomUUID();
    const user = await this.usersService.findByIdentifier(identifier);
    if (!user) {
      return null;
    }

    if (user.status === 'INACTIVE') {
      throw new ForbiddenException(
        'Account not activated. Please complete invitation setup first.',
      );
    }

    if (user.status === 'SUSPENDED') {
      throw new ForbiddenException('Account has been suspended');
    }

    if (
      user.status === 'LOCKED' &&
      user.lockedUntil &&
      user.lockedUntil > new Date()
    ) {
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
      // 解锁这侧同样改变了访问能力，按与 ADMIN_LOGIN_CONSECUTIVE_FAILURE 相同的既有
      // 分工上收为业务审计（ADMIN_ACCOUNT_LOCK_RELEASED）：判定留在这里（只有这里知道
      // 锁是否已到期），emit 领域事件，由 MfaBindingWorkflowService（已经接住同一把锁
      // 的 APPLIED 事件）接住写——INHERIT 靠回查该 userNo 最近一条 APPLIED 事件本身的
      // correlationId，不是靠 User 表某一列（法一附属修缮，2026-09-01）。
      this.eventEmitter.emit(DomainEventNames.ADMIN_LOGIN_AUTO_UNLOCKED, {
        userId: user.id,
        userNo: user.userNo,
      });
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

      // Task 9：连续失败达阈值的锁定改变了访问能力，业主裁定按业务审计保留
      // （与限额自动拦截同性质）——但审计写入不留在这个领域服务层，emit 领域事件，
      // 由 MfaBindingWorkflowService（workflow 层）接住写 ADMIN_ACCOUNT_LOCK_APPLIED。
      // 触发判定（阈值命中）仍留在这里，只是"写"的动作上收，因为 actor/旅程/权限依据
      // 这类审计要素只有编排层才拿得到，域服务不该为了凑审计参数而攒这些知识。
      if (attempts >= 5) {
        this.eventEmitter.emit(DomainEventNames.ADMIN_LOGIN_CONSECUTIVE_FAILURE, {
          userId: user.id,
          userNo: user.userNo,
          failedLoginAttempts: attempts,
        });
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
    // Task 9：接受邀请审计（ADMIN_INVITE_ACCEPTED）已上收到 AdminInviteWorkflowService
    // （编排层）——它拿到 AdminInvitationsService 的结果/拒绝原因码后落审计，
    // 这里只是路由，不再直接调域服务。
    return this.adminInviteWorkflowService.acceptInvitation(token, password, ctx);
  }
}
