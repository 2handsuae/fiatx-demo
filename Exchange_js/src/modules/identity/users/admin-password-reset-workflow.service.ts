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
  AuditGovernanceActions,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';
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

  private toAuditActor(actor: ApprovalActorContext) {
    return {
      actorType: actor.actorType,
      actorId: actor.userId,
      actorNo: actor.userNo,
      actorRole: actor.role || actor.roleCodes[0] || 'UNKNOWN',
    };
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

    const traceId = randomUUID();

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.ADMIN_PASSWORD_RESET.SELF_RESET_REQUESTED,
        entityType: AuditEntityTypes.ADMIN_USER,
        entityId: user.id,
        entityNo: user.userNo,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_PASSWORD_RESET,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: { email: user.email, requestSource: 'SELF' },
        requestId: `SELF_RESET_REQUESTED_${user.userNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      {
        actorType: 'ADMIN',
        actorId: user.id,
        actorNo: user.userNo,
        actorRole: 'SELF',
      },
    );

    const mfaSessionToken = this.jwtService.sign(
      {
        sub: user.id,
        username: user.email,
        userNo: user.userNo,
        scope: 'password_reset_mfa',
        type: 'ADMIN',
        traceId,
      },
      { expiresIn: '5m' },
    );

    return { status: 'MFA_REQUIRED', mfaSessionToken };
  }

  // --- Phase 1: Admin-initiated path (approval required) ---

  async initiateAdminReset(targetUserId: string, actor: ApprovalActorContext) {
    const traceId = randomUUID();

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
        traceId,
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
        traceId,
      },
      actor,
    );

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.ADMIN_PASSWORD_RESET.RESET_REQUESTED,
        entityType: AuditEntityTypes.ADMIN_USER,
        entityId: targetUserId,
        entityNo: target.userNo,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_PASSWORD_RESET,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          targetEmail: target.email,
          approvalNo: approvalCase.approvalNo,
        },
        requestId: `ADMIN_PASSWORD_RESET_REQUESTED_${target.userNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return {
      approvalNo: approvalCase.approvalNo,
      traceId,
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
    try {
      const target = await this.prisma.user.findFirst({
        where: { id: event.entityRef, deletedAt: null },
        select: { id: true, userNo: true, email: true, status: true },
      });
      if (!target || target.status !== 'ACTIVE') {
        throw new Error('Target user is no longer active');
      }

      await this.createResetToken(
        target.id, target.userNo, target.email,
        'CISO',
        event.decisionByUserId || null,
        event.decisionByUserNo as string || null,
      );

      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.ADMIN_PASSWORD_RESET.RESET_EXECUTED,
        entityType: AuditEntityTypes.ADMIN_USER,
        entityId: event.entityRef,
        entityNo: target.userNo,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_PASSWORD_RESET,
        traceId: event.traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          approvalId: event.approvalId,
          approvalNo: event.approvalNo,
          resetByUserId: event.decisionByUserId,
          resetByUserNo: event.decisionByUserNo,
        },
        requestId: `ADMIN_PASSWORD_RESET_EXECUTED_${target.userNo}`,
        sourcePlatform: 'ADMIN_API',
      });

    } catch (error) {
      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.ADMIN_PASSWORD_RESET.RESET_FAILED,
        entityType: AuditEntityTypes.ADMIN_USER,
        entityId: event.entityRef,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_PASSWORD_RESET,
        traceId: event.traceId,
        result: AuditResult.FAILED,
        reason: error instanceof Error ? error.message : 'Password reset execution failed',
        metadata: { approvalId: event.approvalId },
        requestId: `ADMIN_PASSWORD_RESET_FAILED_${event.entityRef}`,
        sourcePlatform: 'ADMIN_API',
      });

      throw error;
    }
  }

  private async recordCancellation(event: ApprovalDecidedEvent) {
    await this.auditLogsService.recordSystem({
      action: AuditGovernanceActions.ADMIN_PASSWORD_RESET.RESET_CANCELLED,
      entityType: AuditEntityTypes.ADMIN_USER,
      entityId: event.entityRef,
      workflowType: AuditBusinessWorkflowTypes.ADMIN_PASSWORD_RESET,
      traceId: event.traceId,
      result: AuditResult.SUCCESS,
      metadata: {
        approvalId: event.approvalId,
        approvalNo: event.approvalNo,
        decision: event.decision,
      },
      requestId: `ADMIN_PASSWORD_RESET_CANCELLED_${event.entityRef}`,
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
          action: AuditGovernanceActions.ADMIN_PASSWORD_RESET.SELF_RESET_TOKEN_CREATED,
          entityType: AuditEntityTypes.ADMIN_USER,
          entityId: userId,
          entityNo: userNo,
          workflowType: AuditBusinessWorkflowTypes.ADMIN_PASSWORD_RESET,
          traceId,
          result: AuditResult.SUCCESS,
          metadata: { resetNo, requestSource: 'SELF' },
          requestId: `SELF_RESET_TOKEN_CREATED_${userNo}`,
          sourcePlatform: 'ADMIN_API',
        },
        {
          actorType: 'ADMIN',
          actorId: userId,
          actorNo: userNo,
          actorRole: 'SELF',
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

    const consumeAction = tokenRecord.requestSource === 'SELF'
      ? AuditGovernanceActions.ADMIN_PASSWORD_RESET.SELF_RESET_COMPLETED
      : AuditGovernanceActions.ADMIN_PASSWORD_RESET.RESET_CONSUMED;

    await this.auditLogsService.recordByActor(
      {
        action: consumeAction,
        entityType: AuditEntityTypes.ADMIN_USER,
        entityId: targetUser.id,
        entityNo: targetUser.userNo,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_PASSWORD_RESET,
        traceId: tokenRecord.traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          resetNo: tokenRecord.resetNo,
          requestSource: tokenRecord.requestSource,
        },
        requestId: `PASSWORD_RESET_CONSUMED_${targetUser.userNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      {
        actorType: 'ADMIN',
        actorId: targetUser.id,
        actorNo: targetUser.userNo,
        actorRole: 'SELF',
      },
    );

    return { status: 'PASSWORD_RESET_COMPLETE' };
  }
}
