import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../core/prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditGovernanceActions,
  AuditModules,
} from '../../audit-logging/constants/audit-actions.constant';
import {
  AuditResult,
} from '../../audit-logging/dto/audit-log.dto';

const INVITATION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_TOKEN_GENERATION_RETRIES = 5;

type AdminActor = {
  actorId: string;
  actorRole: string;
  actorNo?: string;
};

type IssueInvitationOptions = {
  userId: string;
  actor: AdminActor;
  action: string;
  auditContext?: InternalAuditContext;
};

type RequestContext = {
  requestId?: string;
  sourceIp?: string;
  sourcePlatform?: string;
  auditContext?: InternalAuditContext;
};

type InternalAuditContext = {
  workflowType?: string;
  traceId?: string;
};

@Injectable()
export class AdminInvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private normalizeToken(token: string): string {
    return String(token || '').trim();
  }

  private normalizeOptionalString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized.length ? normalized : null;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private maskToken(token: string): string {
    return this.hashToken(token).slice(0, 16);
  }

  private resolveAdminUrl(): string {
    const configured =
      this.configService.get<string>('ADMIN_URL') ||
      process.env.ADMIN_URL ||
      'http://localhost:3001';
    return configured.replace(/\/+$/, '');
  }

  private buildInviteLink(token: string): string {
    return `${this.resolveAdminUrl()}/admin/activate?token=${encodeURIComponent(token)}`;
  }

  private buildExpiresAt(): Date {
    return new Date(Date.now() + INVITATION_TTL_MS);
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

  private resolvePersistableAuditContext(
    auditContext?: InternalAuditContext,
  ): InternalAuditContext | undefined {
    const workflowType = this.normalizeOptionalString(auditContext?.workflowType);
    const traceId = this.normalizeOptionalString(auditContext?.traceId);

    if (!workflowType && !traceId) {
      return undefined;
    }

    return {
      workflowType: workflowType || undefined,
      traceId: traceId || undefined,
    };
  }

  private async findLatestInvitationAuditContext(
    userId: string,
  ): Promise<InternalAuditContext | undefined> {
    const latest = await (this.prisma as any).adminUserInvitation.findFirst?.({
      where: {
        userId,
        OR: [
          { workflowType: { not: null } },
          { traceId: { not: null } },
        ],
      },
      orderBy: [{ createdAt: 'desc' }],
      select: {
        workflowType: true,
        traceId: true,
      },
    });

    return this.resolvePersistableAuditContext(latest || undefined);
  }

  private async findInvitationAuditContextByTokenHash(
    tokenHash: string,
  ): Promise<InternalAuditContext | undefined> {
    const invitation = await (this.prisma as any).adminUserInvitation.findUnique?.({
      where: { tokenHash },
      select: {
        workflowType: true,
        traceId: true,
      },
    });

    return this.resolvePersistableAuditContext(invitation || undefined);
  }

  private assertPassword(password: string): void {
    if (String(password || '').length < 6) {
      throw new BadRequestException('Password must be at least 6 characters');
    }
  }

  private assertInvitationUsable(invitation: any, now: Date): void {
    if (invitation.user?.deletedAt) {
      throw new BadRequestException('Invitation link is no longer valid');
    }
    if (invitation.revokedAt) {
      throw new BadRequestException('Invitation link is no longer valid');
    }
    if (invitation.consumedAt) {
      throw new BadRequestException('Invitation link already used');
    }
    if (invitation.expiresAt <= now) {
      throw new BadRequestException('Invitation link has expired');
    }
    if (invitation.user?.status === 'ACTIVE') {
      throw new BadRequestException('Account already activated');
    }
  }

  private async createInvitationRecord(
    tx: any,
    userId: string,
    createdByUserId?: string,
    auditContext?: InternalAuditContext,
  ): Promise<{ invitation: any; token: string }> {
    const now = new Date();
    const expiresAt = this.buildExpiresAt();
    const persistedContext = this.resolvePersistableAuditContext(auditContext);

    await tx.adminUserInvitation.updateMany({
      where: {
        userId,
        consumedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { revokedAt: now },
    });

    for (let i = 0; i < MAX_TOKEN_GENERATION_RETRIES; i += 1) {
      const token = randomBytes(24).toString('hex');
      const tokenHash = this.hashToken(token);
      try {
        const invitation = await tx.adminUserInvitation.create({
          data: {
            userId,
            token,
            tokenHash,
            expiresAt,
            createdByUserId: createdByUserId || null,
            workflowType: persistedContext?.workflowType || null,
            traceId: persistedContext?.traceId || null,
          },
        });
        return { invitation, token };
      } catch (error: any) {
        if (error?.code === 'P2002') {
          continue;
        }
        throw error;
      }
    }

    throw new InternalServerErrorException(
      `Failed to generate invitation token after ${MAX_TOKEN_GENERATION_RETRIES} retries`,
    );
  }

  private async issueInvitation(
    options: IssueInvitationOptions,
  ): Promise<{
    userId: string;
    userNo: string;
    email: string;
    status: string;
    inviteLink: string;
    inviteExpiresAt: string;
    inviteStatus: 'PENDING';
  }> {
    const user = await this.prisma.user.findFirst({
      where: {
        id: options.userId,
        deletedAt: null,
      },
      select: { id: true, userNo: true, email: true, status: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.status !== 'INACTIVE' && user.status !== 'INVITE_SENT') {
      throw new BadRequestException('Invitation can only be resent for INACTIVE or INVITE_SENT users');
    }

    const effectiveAuditContext =
      this.resolvePersistableAuditContext(options.auditContext) ||
      (await this.findLatestInvitationAuditContext(user.id));

    const issued = await this.prisma.$transaction(async (tx) => {
      const currentUser = await tx.user.findUnique({
        where: { id: user.id },
        select: { status: true, deletedAt: true },
      });
      if (!currentUser || currentUser.deletedAt || (currentUser.status !== 'INACTIVE' && currentUser.status !== 'INVITE_SENT')) {
        throw new BadRequestException('Invitation can only be resent for INACTIVE or INVITE_SENT users');
      }

      const { invitation, token } = await this.createInvitationRecord(
        tx as any,
        user.id,
        options.actor.actorId,
        effectiveAuditContext,
      );
      return { invitation, token };
    });

    const workflowOwnsAudit =
      effectiveAuditContext?.workflowType === AuditBusinessWorkflowTypes.ADMIN_INVITE;
    if (!workflowOwnsAudit) {
      await this.auditLogsService.recordByActor(
        this.applyAuditContext({
          action: options.action,
          entityType: AuditEntityTypes.ACCESS_CONTROL,
          entityId: user.id,
          entityNo: user.userNo,
          metadata: {
            userId: user.id,
            userNo: user.userNo,
            userEmail: user.email,
            inviteExpiresAt: issued.invitation.expiresAt.toISOString(),
          },
        }, effectiveAuditContext),
        {
          actorType: 'ADMIN',
          actorId: options.actor.actorId,
          actorNo: options.actor.actorNo,
          actorRole: options.actor.actorRole,
        },
      );
    }

    return {
      userId: user.id,
      userNo: user.userNo,
      email: user.email,
      status: user.status,
      inviteLink: this.buildInviteLink(issued.token),
      inviteExpiresAt: issued.invitation.expiresAt.toISOString(),
      inviteStatus: 'PENDING',
    };
  }

  async createInvitationForUser(input: {
    userId: string;
    actor: AdminActor;
    auditContext?: InternalAuditContext;
  }): Promise<{
    userId: string;
    userNo: string;
    email: string;
    status: string;
    inviteLink: string;
    inviteExpiresAt: string;
    inviteStatus: 'PENDING';
  }> {
    return this.issueInvitation({
      userId: input.userId,
      actor: input.actor,
      action: AuditActions.ADMIN_INVITATION_CREATED,
      auditContext: input.auditContext,
    });
  }

  async resendInvitationForUser(input: {
    userId: string;
    actor: AdminActor;
    auditContext?: InternalAuditContext;
  }): Promise<{
    userId: string;
    userNo: string;
    email: string;
    status: string;
    inviteLink: string;
    inviteExpiresAt: string;
    inviteStatus: 'PENDING';
  }> {
    return this.issueInvitation({
      userId: input.userId,
      actor: input.actor,
      action: AuditActions.ADMIN_INVITATION_RESENT,
      auditContext: input.auditContext,
    });
  }

  async getInvitationPreview(token: string): Promise<{
    email: string;
    userNo: string;
    expiresAt: string;
    status: 'PENDING';
  }> {
    const normalizedToken = this.normalizeToken(token);
    if (!normalizedToken) {
      throw new BadRequestException('Invitation token is required');
    }

    const invitation = await (this.prisma as any).adminUserInvitation.findUnique({
      where: { tokenHash: this.hashToken(normalizedToken) },
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
    });

    if (!invitation || !invitation.user) {
      throw new NotFoundException('Invitation not found');
    }

    this.assertInvitationUsable(invitation, new Date());

    return {
      email: invitation.user.email,
      userNo: invitation.user.userNo,
      expiresAt: invitation.expiresAt.toISOString(),
      status: 'PENDING',
    };
  }

  async acceptInvitation(
    token: string,
    password: string,
    ctx: RequestContext = {},
  ): Promise<{ userId: string; userNo: string; email: string; status: string }> {
    const normalizedToken = this.normalizeToken(token);
    if (!normalizedToken) {
      throw new BadRequestException('Invitation token is required');
    }
    this.assertPassword(password);

    const tokenHash = this.hashToken(normalizedToken);
    const now = new Date();
    const effectiveAuditContext =
      this.resolvePersistableAuditContext(ctx.auditContext) ||
      (await this.findInvitationAuditContextByTokenHash(tokenHash));

    try {
      const accepted = await this.prisma.$transaction(async (tx) => {
        const invitation = await (tx as any).adminUserInvitation.findUnique({
          where: { tokenHash },
          include: {
            user: {
              select: {
                id: true,
                userNo: true,
                email: true,
                role: true,
                status: true,
                deletedAt: true,
              },
            },
          },
        });

        if (!invitation || !invitation.user) {
          throw new NotFoundException('Invitation not found');
        }

        this.assertInvitationUsable(invitation, now);

        const passwordHash = await bcrypt.hash(password, 10);
        const updatedUser = await tx.user.update({
          where: { id: invitation.user.id },
          data: {
            password: passwordHash,
            status: 'ACTIVE',
            failedLoginAttempts: 0,
            lockedUntil: null,
          },
          select: {
            id: true,
            userNo: true,
            email: true,
            role: true,
            status: true,
          },
        });

        await (tx as any).adminUserInvitation.update({
          where: { id: invitation.id },
          data: { consumedAt: now },
        });

        await (tx as any).adminUserInvitation.updateMany({
          where: {
            userId: updatedUser.id,
            id: { not: invitation.id },
            consumedAt: null,
            revokedAt: null,
            expiresAt: { gt: now },
          },
          data: { revokedAt: now },
        });

        return updatedUser;
      });

      const isAdminInviteFlow =
        effectiveAuditContext?.workflowType === AuditBusinessWorkflowTypes.ADMIN_INVITE;
      await this.auditLogsService.recordByActor(
        this.applyAuditContext({
          action: isAdminInviteFlow
            ? AuditGovernanceActions.ADMIN_INVITE.ACCOUNT_ACTIVATED
            : AuditActions.ADMIN_INVITATION_ACCEPTED,
          entityType: AuditEntityTypes.AUTH,
          entityId: accepted.id,
          entityNo: accepted.userNo,
          result: AuditResult.SUCCESS,
          requestId: ctx.requestId,
          sourceIp: ctx.sourceIp,
          sourcePlatform: ctx.sourcePlatform || 'ADMIN_INVITATION_API',
        }, effectiveAuditContext),
        {
          actorType: 'ADMIN',
          actorId: accepted.id,
          actorNo: accepted.userNo,
          actorRole: accepted.role || 'ADMIN',
        },
      );

      return {
        userId: accepted.id,
        userNo: accepted.userNo,
        email: accepted.email,
        status: accepted.status,
      };
    } catch (error: any) {
      await this.auditLogsService.recordByActor(
        this.applyAuditContext({
          action: AuditActions.ADMIN_INVITATION_ACCEPT_FAILED,
          entityType: AuditEntityTypes.AUTH,
          result: AuditResult.FAILED,
          reason: error?.message || 'Admin invitation accept failed',
          metadata: {
            tokenHashPrefix: this.maskToken(normalizedToken),
          },
          requestId: ctx.requestId,
          sourceIp: ctx.sourceIp,
          sourcePlatform: ctx.sourcePlatform || 'ADMIN_INVITATION_API',
        }, effectiveAuditContext),
        {
          actorType: 'ADMIN',
          actorId: 'UNKNOWN',
          actorRole: 'UNKNOWN',
        },
      );
      throw error;
    }
  }
}
