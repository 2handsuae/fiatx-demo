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

const TOKEN_TTL_MS = 15 * 60 * 1000;
const RATE_LIMIT_MS = TOKEN_TTL_MS;
const MAX_TOKEN_RETRIES = 5;

@Injectable()
export class AdminPasswordResetWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly usersDomainService: UsersDomainService,
    private readonly jwtService: JwtService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
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

    const mfaSessionToken = this.jwtService.sign(
      {
        sub: user.id,
        username: user.email,
        userNo: user.userNo,
        scope: 'password_reset_mfa',
        type: 'ADMIN',
      },
      { expiresIn: '5m' },
    );

    return { status: 'MFA_REQUIRED', mfaSessionToken };
  }

  // --- Phase 1: CISO path ---

  async requestCisoReset(
    targetUserId: string,
    actor: { userId: string; userNo: string },
  ): Promise<{ resetNo: string; status: string }> {
    if (actor.userId === targetUserId) {
      throw new ForbiddenException('Cannot reset your own password via CISO path');
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
      throw new ForbiddenException('Cannot reset SUPER_ADMIN password via CISO path');
    }

    return this.createResetToken(
      target.id, target.userNo, target.email,
      'CISO', actor.userId, actor.userNo,
    );
  }

  // --- Public method for self-service after MFA verified ---

  async createResetTokenForSelf(
    userId: string,
    userNo: string,
    email: string,
  ): Promise<{ resetNo: string; status: string }> {
    return this.createResetToken(userId, userNo, email, 'SELF', null, null);
  }

  // --- Shared token creation ---

  private async createResetToken(
    userId: string,
    userNo: string,
    email: string,
    requestSource: string,
    requestedByUserId: string | null,
    requestedByUserNo: string | null,
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
    const traceId = randomUUID();
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

    // Audit: revoked tokens
    for (const old of pendingTokens) {
      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.ADMIN_CREDENTIAL_MGMT.PASSWORD_RESET_REVOKED,
        entityType: AuditEntityTypes.PASSWORD_RESET_TOKEN,
        entityId: old.id,
        entityNo: old.resetNo,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_CREDENTIAL_MGMT,
        traceId: old.traceId,
        result: AuditResult.SUCCESS,
        metadata: { supersededByResetNo: resetNo },
        entityOwnerNo: userNo,
      });
    }

    // TODO: Send email via notification service
    // await this.notificationService.sendPasswordResetEmail(email, plainToken, requestSource);

    // Audit: token requested
    const actorContext = requestSource === 'CISO'
      ? { actorType: 'ADMIN' as const, actorId: requestedByUserId!, actorNo: requestedByUserNo!, actorRole: 'CISO' }
      : { actorType: 'ADMIN' as const, actorId: userId, actorNo: userNo, actorRole: 'SELF' };

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.ADMIN_CREDENTIAL_MGMT.PASSWORD_RESET_REQUESTED,
        entityType: AuditEntityTypes.PASSWORD_RESET_TOKEN,
        entityId: tokenRecord.id,
        entityNo: resetNo,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_CREDENTIAL_MGMT,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          requestSource,
          ...(requestSource === 'CISO' ? { targetUserNo: userNo } : {}),
        },
        entityOwnerNo: userNo,
        sourcePlatform: 'ADMIN_API',
      },
      actorContext,
    );

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
      await this.recordFailure(tokenRecord, 'INVALID_OR_CONSUMED_TOKEN');
      throw new BadRequestException({
        code: 'INVALID_OR_EXPIRED_TOKEN',
        message: 'Invalid or expired reset token',
      });
    }
    if (tokenRecord.expiresAt <= new Date()) {
      await this.recordFailure(tokenRecord, 'TOKEN_EXPIRED');
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
      await this.recordFailure(tokenRecord, 'USER_NOT_ACTIVE');
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

    await this.auditLogsService.recordSystem({
      action: AuditGovernanceActions.ADMIN_CREDENTIAL_MGMT.PASSWORD_RESET_COMPLETED,
      entityType: AuditEntityTypes.PASSWORD_RESET_TOKEN,
      entityId: tokenRecord.id,
      entityNo: tokenRecord.resetNo,
      workflowType: AuditBusinessWorkflowTypes.ADMIN_CREDENTIAL_MGMT,
      traceId: tokenRecord.traceId,
      result: AuditResult.SUCCESS,
      metadata: { requestSource: tokenRecord.requestSource },
      entityOwnerNo: targetUser.userNo,
    });

    return { status: 'PASSWORD_RESET_COMPLETE' };
  }

  private async recordFailure(tokenRecord: any, reason: string): Promise<void> {
    if (!tokenRecord) return;
    try {
      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.ADMIN_CREDENTIAL_MGMT.PASSWORD_RESET_FAILED,
        entityType: AuditEntityTypes.PASSWORD_RESET_TOKEN,
        entityId: tokenRecord.id,
        entityNo: tokenRecord.resetNo,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_CREDENTIAL_MGMT,
        traceId: tokenRecord.traceId,
        result: AuditResult.FAILED,
        metadata: { reason, requestSource: tokenRecord.requestSource },
        entityOwnerNo: tokenRecord.userId,
      });
    } catch {
      // audit failure must not block error response
    }
  }
}
