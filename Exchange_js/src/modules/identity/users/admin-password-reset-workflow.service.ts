import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';

/**
 * Local TooManyRequestsException -- @nestjs/common does not ship one.
 */
class TooManyRequestsException extends HttpException {
  constructor(response: string | Record<string, any> = 'Too Many Requests') {
    super(response, HttpStatus.TOO_MANY_REQUESTS);
  }
}
import { JwtService } from '@nestjs/jwt';
import { OnEvent } from '@nestjs/event-emitter';
import { createHash, randomBytes, randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { UsersService } from './users.service';
import { UsersDomainService } from './users.domain.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditCategory, AuditOutcome } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';
import {
  ApprovalActionTypes,
  ApprovalActorContext,
} from '../../governance/approvals/constants/approval.constants';

const TOKEN_TTL_MS = 15 * 60 * 1000;
const RATE_LIMIT_MS = TOKEN_TTL_MS;
const MAX_TOKEN_RETRIES = 5;
const SECONDARY_EVENT = 'workflow.admin-password-reset.decided';

@Injectable()
export class AdminPasswordResetWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly usersDomainService: UsersDomainService,
    private readonly jwtService: JwtService,
    private readonly auditLogsService: AuditLogsService,
    private readonly approvalsService: ApprovalsService,
  ) {}

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private toAuditActor(
    actor: ApprovalActorContext,
    onBehalfOf?: { type: string; no: string },
  ) {
    return {
      actorType: actor.actorType,
      actorNo: actor.userNo || 'UNKNOWN',

      actorDisplayName: actor.userNo || 'UNKNOWN',
      actorRolesAtTime: [actor.role || actor.roleCodes[0] || 'UNKNOWN'],
      ...(onBehalfOf ? { onBehalfOfType: onBehalfOf.type, onBehalfOfNo: onBehalfOf.no } : {}),
    };
  }

  /**
   * consume 时刻（OFFICER_APPLIED）与限流拒绝（TOKEN_EXPIRED 分支）都要按同一份
   * requestSource 分流规则挑码、且官员路径都要补 onBehalfOfNo/approvalNo/causationId——
   * 抽成一个共享方法，避免两处各写一份、后续漏改其中一处导致行为分叉。
   */
  private async resolveOfficerApprovalRef(
    traceId: string,
  ): Promise<{ approvalId: string; approvalNo: string } | null> {
    const approvalCase = await this.prisma.approvalCase.findFirst({
      where: { actionType: ApprovalActionTypes.ADMIN_PASSWORD_RESET, traceId },
      select: { id: true, approvalNo: true },
    });
    if (!approvalCase) return null;
    return { approvalId: approvalCase.id, approvalNo: approvalCase.approvalNo };
  }

  /**
   * 密码重置两条路各自成链的落点：requestSource==='SELF' 走 SELF_COMPLETED，
   * 否则（CISO 等官员代操作）走 OFFICER_APPLIED——绝不合并成一条，CISO 代客重置是
   * 特权操作，必须能单独统计和告警。outcome 由调用方决定（SUCCESS 或 DENIED）。
   */
  private async recordConsumeOutcome(
    tokenRecord: { userId: string; traceId: string; requestSource: string; resetNo: string },
    targetUserNo: string,
    outcome: AuditOutcome,
    reasonCode?: string,
  ): Promise<void> {
    const isOfficer = tokenRecord.requestSource !== 'SELF';
    const action = isOfficer
      ? 'ADMIN_PASSWORD_RESET_OFFICER_APPLIED'
      : 'ADMIN_PASSWORD_RESET_SELF_COMPLETED';
    const officerRef = isOfficer ? await this.resolveOfficerApprovalRef(tokenRecord.traceId) : null;

    await this.auditLogsService.recordByActor(
      {
        action,
        actionDomain: 'IAM',
        category: AuditCategory.GOVERNANCE,
        primarySubjectType: AuditEntityTypes.ADMIN_USER,
        primarySubjectNo: targetUserNo,
        // INHERIT：tokenRecord.traceId 就是 REQUESTED 铸造、经 JWT（SELF）或
        // ApprovalCase.traceId（OFFICER，见 executeAdminReset）原样传播过来的那个值。
        correlationId: tokenRecord.traceId,
        outcome,
        ...(reasonCode ? { reasonCode } : {}),
        ...(isOfficer
          ? {
              onBehalfOfNo: targetUserNo,
              approvalNo: officerRef?.approvalNo,
              causationId: officerRef?.approvalId,
            }
          : {}),
        metadata: {
          resetNo: tokenRecord.resetNo,
          requestSource: tokenRecord.requestSource,
        },
        requestId: randomUUID(),
        sourcePlatform: 'ADMIN_API',
      },
      {
        actorType: 'ADMIN',
        actorNo: targetUserNo,
        actorDisplayName: targetUserNo,
        actorRolesAtTime: ['SELF'],
        ...(isOfficer
          ? { onBehalfOfType: AuditEntityTypes.ADMIN_USER, onBehalfOfNo: targetUserNo }
          : {}),
      },
    );
  }

  // --- Phase 1: Self-service path ---

  async requestSelfServiceReset(email: string): Promise<{ status: string; mfaSessionToken?: string }> {
    const user = await this.usersService.findByIdentifier(email);

    // Anti-enumeration: same response shape whether user exists or not
    if (
      !user ||
      user.status !== 'ACTIVE' ||
      user.firstLoginStatus !== 'COMPLETED' ||
      !user.mfaEnabledAt
    ) {
      return { status: 'MFA_REQUIRED' };
    }

    // START：本次自助重置旅程的 correlationId，经 JWT 带到 verify-mfa/consume 两步。
    const correlationId = randomUUID();

    await this.auditLogsService.recordByActor(
      {
        action: 'ADMIN_PASSWORD_RESET_SELF_REQUESTED',
        actionDomain: 'IAM',
        category: AuditCategory.GOVERNANCE,
        primarySubjectType: AuditEntityTypes.ADMIN_USER,
        primarySubjectNo: user.userNo,
        correlationId,
        outcome: AuditOutcome.SUCCESS,
        metadata: { email: user.email, requestSource: 'SELF' },
        requestId: randomUUID(),
        sourcePlatform: 'ADMIN_API',
      },
      {
        actorType: 'ADMIN',
        actorNo: user.userNo,
        actorDisplayName: user.userNo,
        actorRolesAtTime: ['SELF'],
      },
    );

    const mfaSessionToken = this.jwtService.sign(
      {
        sub: user.id,
        username: user.email,
        userNo: user.userNo,
        scope: 'password_reset_mfa',
        type: 'ADMIN',
        traceId: correlationId,
      },
      { expiresIn: '5m' },
    );

    return { status: 'MFA_REQUIRED', mfaSessionToken };
  }

  // --- Phase 1: Admin-initiated path (approval required) ---

  async initiateAdminReset(targetUserId: string, actor: ApprovalActorContext) {
    // START：本次官员代操作重置旅程的 correlationId，同事务写进 ApprovalCase.traceId。
    const correlationId = randomUUID();

    if (actor.userId === targetUserId) {
      throw new ForbiddenException('Cannot reset your own password via admin path');
    }

    const target = await this.prisma.user.findFirst({
      where: { id: targetUserId, deletedAt: null },
      select: {
        id: true, userNo: true, email: true, status: true,
        firstLoginStatus: true, mfaEnabledAt: true,
        userRoles: { select: { role: { select: { code: true } } } },
      },
    });
    if (!target) throw new BadRequestException('Target user not found');
    if (target.status !== 'ACTIVE') {
      throw new ConflictException(`Cannot reset password for user in status: ${target.status}`);
    }
    if (target.firstLoginStatus !== 'COMPLETED') {
      throw new ConflictException('Target user has not completed first login');
    }
    if (!target.mfaEnabledAt) {
      throw new ConflictException('Target user has not enabled MFA');
    }

    const roleCodes = target.userRoles.map((ur: any) => ur.role.code);
    if (roleCodes.includes('SUPER_ADMIN')) {
      throw new ForbiddenException('Cannot reset SUPER_ADMIN password via admin path');
    }

    const existingPending = await this.prisma.approvalCase.findFirst({
      where: {
        actionType: ApprovalActionTypes.ADMIN_PASSWORD_RESET,
        entityRef: targetUserId,
        status: 'PENDING',
      },
    });
    if (existingPending) {
      throw new ConflictException(
        `A pending password reset approval already exists: ${existingPending.approvalNo}`,
      );
    }

    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.ADMIN_PASSWORD_RESET,
        entityRef: targetUserId,
        traceId: correlationId,
        objectSnapshot: {
          targetUserId,
          targetUserNo: target.userNo,
          targetEmail: target.email,
          targetStatus: target.status,
          targetRoles: roleCodes,
        },
      },
      {
        reason: `Admin password reset request for ${target.email}`,
        traceId: correlationId,
      },
      actor,
    );

    await this.auditLogsService.recordByActor(
      {
        action: 'ADMIN_PASSWORD_RESET_OFFICER_REQUESTED',
        actionDomain: 'IAM',
        category: AuditCategory.GOVERNANCE,
        primarySubjectType: AuditEntityTypes.ADMIN_USER,
        primarySubjectNo: target.userNo,
        correlationId,
        onBehalfOfNo: target.userNo,
        outcome: AuditOutcome.SUCCESS,
        metadata: {
          targetEmail: target.email,
          approvalNo: approvalCase.approvalNo,
        },
        requestId: randomUUID(),
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor, { type: AuditEntityTypes.ADMIN_USER, no: target.userNo }),
    );

    return {
      approvalNo: approvalCase.approvalNo,
      traceId: correlationId,
      targetUserNo: target.userNo,
      status: 'PENDING_APPROVAL',
    };
  }

  // --- Public method for self-service after MFA verified ---

  async createResetTokenForSelf(
    userId: string,
    userNo: string,
    email: string,
    traceId?: string,
  ): Promise<{ resetNo: string; status: string }> {
    return this.createResetToken(userId, userNo, email, 'SELF', null, null, traceId);
  }

  // --- Approval event handler ---

  @OnEvent(SECONDARY_EVENT, { async: true })
  async handleApprovalDecided(event: ApprovalDecidedEvent) {
    switch (event.decision) {
      case 'APPROVED':
        return this.executeAdminReset(event);
      case 'DECLINED':
      case 'CANCELLED':
      case 'EXPIRED':
        return this.recordCancellation(event);
    }
  }

  private async executeAdminReset(event: ApprovalDecidedEvent) {
    const target = await this.prisma.user.findFirst({
      where: { id: event.entityRef, deletedAt: null },
      select: { id: true, userNo: true, email: true, status: true },
    });

    try {
      if (!target || target.status !== 'ACTIVE') {
        throw new Error('Target user is no longer active');
      }

      await this.createResetToken(
        target.id, target.userNo, target.email,
        'CISO',
        event.decisionByUserId || null,
        event.decisionByUserNo as string || null,
        // INHERIT 链路关键一环：把 initiateAdminReset 铸造的 correlationId（经
        // ApprovalCase.traceId 传播到 event.traceId）继续传给 token，consume 时才能
        // 从 tokenRecord.traceId 读回与 REQUESTED 同一个值——原代码这里漏传，token
        // 会另铸一个随机 traceId，断链。
        event.traceId,
      );

      // 无 SUCCESS 写入：官员路径只在 REQUESTED/APPLIED 两端留痕（词表 6 码没有为
      // "token 已签发"这一中间步单独声明码）——批准决定本身已由横切审批码
      // APPROVAL_GRANTED 记录，真正的"变更被施加"记在 consumeResetToken 里
      // （目标用户拿着 token 改密码那一刻）。

    } catch (error) {
      // 词表没给这个中间失败单独开码，复用 OFFICER_APPLIED + outcome=FAILED——与
      // Task 6 角色变更"同码不同 outcome"同一原则。走到这里 token 从未创建成功，
      // consumeResetToken 永远不会被调用，不会与这条记录重复。
      await this.auditLogsService.recordSystem({
        action: 'ADMIN_PASSWORD_RESET_OFFICER_APPLIED',
        actionDomain: 'IAM',
        category: AuditCategory.GOVERNANCE,
        primarySubjectType: AuditEntityTypes.ADMIN_USER,
        primarySubjectNo: target?.userNo ?? event.entityRef,
        correlationId: event.traceId,
        causationId: event.approvalId,
        outcome: AuditOutcome.FAILED,
        onBehalfOfNo: target?.userNo ?? event.entityRef,
        approvalNo: event.approvalNo,
        reason: error instanceof Error ? error.message : 'Password reset execution failed',
        metadata: { approvalId: event.approvalId },
        requestId: randomUUID(),
        sourcePlatform: 'ADMIN_API',
      });

      throw error;
    }
  }

  private async recordCancellation(event: ApprovalDecidedEvent) {
    const target = await this.usersDomainService.findById(event.entityRef);

    await this.auditLogsService.recordSystem({
      action: 'ADMIN_PASSWORD_RESET_CANCELLED',
      actionDomain: 'IAM',
      category: AuditCategory.GOVERNANCE,
      primarySubjectType: AuditEntityTypes.ADMIN_USER,
      primarySubjectNo: target?.userNo ?? event.entityRef,
      correlationId: event.traceId,
      causationId: event.approvalId,
      outcome: AuditOutcome.SUCCESS,
      reason: event.decisionReason || `Password reset request ${event.decision.toLowerCase()}`,
      metadata: {
        approvalId: event.approvalId,
        approvalNo: event.approvalNo,
        decision: event.decision,
      },
      requestId: randomUUID(),
      sourcePlatform: 'ADMIN_API',
    });
  }

  // --- Shared token creation ---

  private async createResetToken(
    userId: string,
    userNo: string,
    email: string,
    requestSource: string,
    requestedByUserId: string | null,
    requestedByUserNo: string | null,
    externalTraceId?: string,
  ): Promise<{ resetNo: string; status: string }> {
    // Rate limit: one request per userId per 15 minutes
    const cutoff = new Date(Date.now() - RATE_LIMIT_MS);
    const recent = await this.prisma.passwordResetToken.findFirst({
      where: { userId, createdAt: { gt: cutoff } },
      select: { id: true },
    });
    if (recent) {
      if (requestSource === 'SELF') {
        // SELF_TOKEN_ISSUED 被限流拒绝——INHERIT 读 externalTraceId（REQUESTED 铸造、
        // 经 JWT 带过来的那个值）。官员路径没有"token 已签发"专属码（见
        // executeAdminReset 顶部注释），限流命中就只让异常照常抛出，不额外记这一条。
        await this.auditLogsService.recordByActor(
          {
            action: 'ADMIN_PASSWORD_RESET_SELF_TOKEN_ISSUED',
            actionDomain: 'IAM',
            category: AuditCategory.GOVERNANCE,
            primarySubjectType: AuditEntityTypes.ADMIN_USER,
            primarySubjectNo: userNo,
            correlationId: externalTraceId,
            outcome: AuditOutcome.DENIED,
            reasonCode: 'RATE_LIMITED',
            requestId: randomUUID(),
            sourcePlatform: 'ADMIN_API',
          },
          {
            actorType: 'ADMIN',
            actorNo: userNo,
            actorDisplayName: userNo,
            actorRolesAtTime: ['SELF'],
          },
        );
      }
      throw new TooManyRequestsException(
        'A password reset was already requested recently. Please wait before trying again.',
      );
    }

    // Revoke existing PENDING tokens (defensive -- normally rate limit prevents reaching here)
    const pendingTokens = await this.prisma.passwordResetToken.findMany({
      where: { userId, status: 'PENDING' },
      select: { id: true, resetNo: true, traceId: true },
    });
    if (pendingTokens.length > 0) {
      await this.prisma.passwordResetToken.updateMany({
        where: { userId, status: 'PENDING' },
        data: { status: 'REVOKED' },
      });
    }

    // Generate token
    const traceId = externalTraceId || randomUUID();
    const plainToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(plainToken);

    // Create with resetNo retry (unique constraint collision)
    let resetNo = '';
    let tokenRecord: any;
    for (let i = 0; i < MAX_TOKEN_RETRIES; i++) {
      resetNo = generateReferenceNo('PWR');
      try {
        tokenRecord = await this.prisma.passwordResetToken.create({
          data: {
            resetNo,
            userId,
            tokenHash,
            token: plainToken,
            status: 'PENDING',
            requestSource,
            requestedByUserId,
            requestedByUserNo,
            expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
            traceId,
          },
        });
        break;
      } catch (err: any) {
        if (err?.code === 'P2002' && i < MAX_TOKEN_RETRIES - 1) continue;
        throw err;
      }
    }

    if (requestSource === 'SELF') {
      await this.auditLogsService.recordByActor(
        {
          action: 'ADMIN_PASSWORD_RESET_SELF_TOKEN_ISSUED',
          actionDomain: 'IAM',
          category: AuditCategory.GOVERNANCE,
          primarySubjectType: AuditEntityTypes.ADMIN_USER,
          primarySubjectNo: userNo,
          correlationId: traceId,
          outcome: AuditOutcome.SUCCESS,
          metadata: { resetNo, requestSource: 'SELF' },
          requestId: randomUUID(),
          sourcePlatform: 'ADMIN_API',
        },
        {
          actorType: 'ADMIN',
          actorNo: userNo,
          actorDisplayName: userNo,
          actorRolesAtTime: ['SELF'],
        },
      );
    }

    // TODO: Send email via notification service
    // await this.notificationService.sendPasswordResetEmail(email, plainToken, requestSource);

    return { resetNo, status: 'RESET_EMAIL_SENT' };
  }

  // --- Phase 2: Consume token ---

  async consumeResetToken(
    plainToken: string,
    newPassword: string,
  ): Promise<{ status: string }> {
    const tokenHash = this.hashToken(plainToken);
    const tokenRecord = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });

    if (!tokenRecord || tokenRecord.status !== 'PENDING') {
      throw new BadRequestException({
        code: 'INVALID_OR_EXPIRED_TOKEN',
        message: 'Invalid or expired reset token',
      });
    }
    if (tokenRecord.expiresAt <= new Date()) {
      // 找得到 tokenRecord 就能定位是哪次旅程被拒——按 requestSource 分流记一条
      // DENIED，不让这次真实发生过的尝试从审计里静默消失。整段（含 findById 查
      // primarySubjectNo）包在 try/catch 里：审计侧任何问题都不能替换掉即将抛出的
      // "令牌过期"这个真实原因。
      try {
        const subjectUser = await this.usersDomainService.findById(tokenRecord.userId);
        await this.recordConsumeOutcome(
          tokenRecord,
          subjectUser?.userNo ?? tokenRecord.userId,
          AuditOutcome.DENIED,
          'TOKEN_EXPIRED',
        );
      } catch {
        // best-effort，见上方注释。
      }
      throw new BadRequestException({
        code: 'INVALID_OR_EXPIRED_TOKEN',
        message: 'Invalid or expired reset token',
      });
    }

    const targetUser = await this.prisma.user.findFirst({
      where: { id: tokenRecord.userId, deletedAt: null },
      select: { id: true, userNo: true, status: true },
    });
    if (!targetUser || targetUser.status !== 'ACTIVE') {
      throw new BadRequestException({
        code: 'INVALID_OR_EXPIRED_TOKEN',
        message: 'Invalid or expired reset token',
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await this.prisma.$transaction(async (tx: any) => {
      await this.usersDomainService.resetPassword(targetUser.id, passwordHash, tx);
      await tx.passwordResetToken.update({
        where: { id: tokenRecord.id },
        data: { status: 'CONSUMED', consumedAt: new Date() },
      });
    });

    await this.recordConsumeOutcome(tokenRecord, targetUser.userNo, AuditOutcome.SUCCESS);

    return { status: 'PASSWORD_RESET_COMPLETE' };
  }
}
