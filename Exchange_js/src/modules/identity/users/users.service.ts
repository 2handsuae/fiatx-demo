import {
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AdminInvitationsService } from './admin-invitations.service';

type UserRow = any;

type MemberInvitationSummary = {
  inviteStatus: 'PENDING' | 'EXPIRED' | 'USED' | 'REVOKED';
  inviteExpiresAt: string;
  inviteLink: string | null;
};

type MemberPasswordResetSummary = {
  resetStatus: 'PENDING' | 'EXPIRED' | 'CONSUMED' | 'REVOKED';
  resetExpiresAt: string;
  resetLink: string | null;
};

type MemberDetail = {
  id: string;
  userNo: string;
  email: string;
  role: string;
  status: string;
  firstLoginStatus: string | null;
  mfaEnabledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
  roles: string[];
  latestInvitation: MemberInvitationSummary | null;
  latestPasswordReset: MemberPasswordResetSummary | null;
};

type InternalAuditContext = {
  workflowType?: string;
  traceId?: string;
};

@Injectable()
export class UsersService {
  constructor(
    @Inject(PrismaService)
    private prisma: PrismaService & Record<string, any>,
    private adminInvitationsService: AdminInvitationsService,
    private configService: ConfigService,
  ) {}

  private buildInviteLink(token: string): string {
    const adminUrl = (
      this.configService.get<string>('ADMIN_URL') ||
      process.env.ADMIN_URL ||
      'http://localhost:3001'
    ).replace(/\/+$/, '');
    return `${adminUrl}/admin/activate?token=${encodeURIComponent(token)}`;
  }

  private buildResetLink(token: string): string {
    const adminUrl = (
      this.configService.get<string>('ADMIN_URL') ||
      process.env.ADMIN_URL ||
      'http://localhost:3001'
    ).replace(/\/+$/, '');
    return `${adminUrl}/admin/reset-password?token=${encodeURIComponent(token)}`;
  }

  private activeUserWhere(where?: Record<string, unknown>) {
    return {
      ...(where || {}),
      deletedAt: null,
    };
  }

  private mapInvitationStatus(invitation: {
    expiresAt: Date;
    consumedAt: Date | null;
    revokedAt: Date | null;
  }): MemberInvitationSummary['inviteStatus'] {
    if (invitation.revokedAt) {
      return 'REVOKED';
    }
    if (invitation.consumedAt) {
      return 'USED';
    }
    if (invitation.expiresAt.getTime() <= Date.now()) {
      return 'EXPIRED';
    }
    return 'PENDING';
  }

  private mapResetStatus(record: {
    expiresAt: Date;
    consumedAt: Date | null;
    status: string;
  }): MemberPasswordResetSummary['resetStatus'] {
    if (record.status === 'REVOKED') return 'REVOKED';
    if (record.status === 'CONSUMED' || record.consumedAt) return 'CONSUMED';
    if (record.expiresAt.getTime() <= Date.now()) return 'EXPIRED';
    return 'PENDING';
  }

  async findOne(email: string): Promise<UserRow | null> {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    return this.prisma.user.findFirst({
      where: this.activeUserWhere({
        email: normalizedEmail,
      }),
    });
  }

  async findByIdentifier(identifier: string): Promise<UserRow | null> {
    const value = (identifier || '').trim();
    if (!value) return null;
    // No select clause: all columns are returned, including password (for bcrypt
    // comparison in validateUser), firstLoginStatus, and mfaEnabledAt (required
    // by login() to branch on first-login / MFA flows).
    return this.prisma.user.findFirst({
      where: this.activeUserWhere({
        OR: [{ email: value }, { userNo: value }],
      }),
    });
  }

  async findById(id: string): Promise<UserRow | null> {
    return this.prisma.user.findFirst({
      where: this.activeUserWhere({ id }),
    });
  }

  async getMemberDetail(id: string): Promise<MemberDetail> {
    const member = await this.prisma.user.findFirst({
      where: this.activeUserWhere({ id }),
      include: {
        userRoles: {
          include: {
            role: {
              select: {
                code: true,
                name: true,
              },
            },
          },
        },
      },
    });

    if (!member) {
      throw new NotFoundException('User not found');
    }

    const latestInvitation = await this.prisma.adminUserInvitation.findFirst({
      where: {
        userId: member.id,
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        token: true,
        expiresAt: true,
        consumedAt: true,
        revokedAt: true,
      },
    });

    const latestPasswordReset = await this.prisma.passwordResetToken.findFirst({
      where: { userId: member.id },
      orderBy: { createdAt: 'desc' },
      select: {
        token: true,
        expiresAt: true,
        consumedAt: true,
        status: true,
      },
    });

    const roles = (member.userRoles || [])
      .map((item: any) => item.role?.code)
      .filter(Boolean);

    return {
      id: member.id,
      userNo: member.userNo,
      email: member.email,
      role: member.role,
      status: member.status,
      firstLoginStatus: (member as any).firstLoginStatus ?? null,
      mfaEnabledAt: (member as any).mfaEnabledAt ?? null,
      createdAt: member.createdAt,
      updatedAt: member.updatedAt,
      lastLoginAt: member.lastLoginAt,
      roles,
      latestInvitation: latestInvitation
        ? {
            inviteStatus: this.mapInvitationStatus(latestInvitation),
            inviteExpiresAt: latestInvitation.expiresAt.toISOString(),
            inviteLink:
              this.mapInvitationStatus(latestInvitation) === 'PENDING' && latestInvitation.token
                ? this.buildInviteLink(latestInvitation.token)
                : null,
          }
        : null,
      latestPasswordReset: latestPasswordReset
        ? {
            resetStatus: this.mapResetStatus(latestPasswordReset),
            resetExpiresAt: latestPasswordReset.expiresAt.toISOString(),
            resetLink:
              this.mapResetStatus(latestPasswordReset) === 'PENDING' && latestPasswordReset.token
                ? this.buildResetLink(latestPasswordReset.token)
                : null,
          }
        : null,
    };
  }

  async resendAdminInvitation(input: {
    userId: string;
    actor: {
      actorId: string;
      actorRole: string;
      actorNo?: string;
    };
    auditContext?: InternalAuditContext;
  }) {
    return this.adminInvitationsService.resendInvitationForUser({
      userId: input.userId,
      actor: input.actor,
      auditContext: input.auditContext,
    });
  }

  async findAll(params: {
    skip?: number;
    take?: number;
    cursor?: any;
    where?: any;
    orderBy?: any;
  }): Promise<any[]> {
    const { skip, take, cursor, where, orderBy } = params;
    return this.prisma.user.findMany({
      skip,
      take,
      cursor,
      where: this.activeUserWhere(where),
      orderBy,
      include: {
        userRoles: {
          include: {
            role: {
              select: {
                code: true,
                name: true,
              },
            },
          },
        },
      },
    });
  }

  async update(params: {
    where: any;
    data: any;
  }): Promise<UserRow> {
    const { where, data } = params;
    return this.prisma.user.update({
      data,
      where,
    });
  }
}
