import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { AccessControlService } from '../access-control/access-control.service';
import { getPrimaryRoleCode } from '../access-control/rbac.catalog';
import { AuditLogsService } from '../../risk-engine/audit-logs/audit-logs.service';
import {
  AuditActions,
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditModules,
} from '../../risk-engine/audit-logs/constants/audit-actions.constant';
import { AdminInvitationsService } from './admin-invitations.service';

interface CreateAdminUserInput {
  email: string;
  roleCodes: string[];
  actor: {
    actorId: string;
    actorRole: string;
    actorNo?: string;
  };
  auditContext?: InternalAuditContext;
}

const MAX_USER_NO_GENERATION_RETRIES = 10;
type UserRow = any;

type GovernedAdminMemberProvisioningBinding = {
  intent?: string;
  email: string;
  roleCodes: string[];
  [key: string]: unknown;
};

type GovernedExecutionActor = {
  actorType?: string;
  userId: string;
  userNo?: string;
  role?: string;
  roleCodes?: string[];
};

type MemberInvitationSummary = {
  inviteStatus: 'PENDING' | 'EXPIRED' | 'USED' | 'REVOKED';
  inviteExpiresAt: string;
};

type MemberDetail = {
  id: string;
  userNo: string;
  email: string;
  role: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
  roles: string[];
  latestInvitation: MemberInvitationSummary | null;
};

type InternalAuditContext = {
  workflowType?: string;
  workflowNo?: string;
  traceId?: string;
};

@Injectable()
export class UsersService {
  constructor(
    @Inject(PrismaService)
    private prisma: PrismaService & Record<string, any>,
    private accessControlService: AccessControlService,
    private auditLogsService: AuditLogsService,
    private adminInvitationsService: AdminInvitationsService,
  ) {}

  private normalizeEmail(email: string): string {
    return String(email || '').trim().toLowerCase();
  }

  private normalizeOptionalString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized.length ? normalized : null;
  }

  private normalizeRoleCodes(roleCodes: string[]): string[] {
    const seen = new Set<string>();
    const normalized: string[] = [];
    for (const rawCode of roleCodes || []) {
      const code = String(rawCode || '').trim().toUpperCase();
      if (!code || seen.has(code)) {
        continue;
      }
      seen.add(code);
      normalized.push(code);
    }
    return normalized;
  }

  private toAdminActor(actor: GovernedExecutionActor | CreateAdminUserInput['actor']) {
    if ('actorId' in actor) {
      return {
        actorId: actor.actorId,
        actorNo: actor.actorNo ?? actor.actorId,
        actorRole: actor.actorRole,
      };
    }

    return {
      actorId: actor.userId,
      actorNo: actor.userNo || actor.userId,
      actorRole: actor.role || actor.roleCodes?.[0] || 'UNKNOWN',
    };
  }

  private sameRoleCodes(left: string[], right: string[]): boolean {
    const normalizedLeft = [...this.normalizeRoleCodes(left)].sort();
    const normalizedRight = [...this.normalizeRoleCodes(right)].sort();
    return (
      normalizedLeft.length === normalizedRight.length &&
      normalizedLeft.every((code, index) => code === normalizedRight[index])
    );
  }

  private activeUserWhere(where?: Record<string, unknown>) {
    return {
      ...(where || {}),
      deletedAt: null,
    };
  }

  private isRecoverableProvisioningError(error: unknown): boolean {
    if (!(error instanceof ConflictException)) {
      return false;
    }

    const message = this.normalizeOptionalString(error.message)?.toLowerCase() || '';
    return message.includes('email already exists');
  }

  private applyAuditContext<T extends Record<string, unknown>>(
    payload: T,
    auditContext?: InternalAuditContext,
  ): T {
    const workflowType = this.normalizeOptionalString(auditContext?.workflowType);
    const workflowNo = this.normalizeOptionalString(auditContext?.workflowNo);
    const traceId = this.normalizeOptionalString(auditContext?.traceId);

    return {
      ...payload,
      workflowType: workflowType || undefined,
      workflowNo: workflowNo || undefined,
      traceId: traceId || undefined,
    } as T;
  }

  private buildProvisioningAuditContext(
    binding: GovernedAdminMemberProvisioningBinding,
  ): InternalAuditContext | undefined {
    const workflowNo = this.normalizeOptionalString(binding.ticketNo);
    const traceId = this.normalizeOptionalString(binding.traceId);

    if (!workflowNo && !traceId) {
      return undefined;
    }

    return {
      workflowType: AuditBusinessWorkflowTypes.ADMIN_MEMBER_PROVISIONING,
      workflowNo: workflowNo || undefined,
      traceId: traceId || undefined,
    };
  }

  private isUniqueConstraintOn(error: unknown, fieldName: string): boolean {
    const maybe = error as {
      code?: string;
      meta?: { target?: string[] | string };
    };

    if (maybe?.code !== 'P2002') {
      return false;
    }

    const target = maybe.meta?.target;
    if (Array.isArray(target)) {
      return target.includes(fieldName);
    }

    return typeof target === 'string' ? target.includes(fieldName) : false;
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

  async findOne(email: string): Promise<UserRow | null> {
    return this.prisma.user.findFirst({
      where: this.activeUserWhere({
        email: this.normalizeEmail(email),
      }),
    });
  }

  async findByIdentifier(identifier: string): Promise<UserRow | null> {
    const value = (identifier || '').trim();
    if (!value) return null;
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
        expiresAt: true,
        consumedAt: true,
        revokedAt: true,
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
      createdAt: member.createdAt,
      updatedAt: member.updatedAt,
      lastLoginAt: member.lastLoginAt,
      roles,
      latestInvitation: latestInvitation
        ? {
            inviteStatus: this.mapInvitationStatus(latestInvitation),
            inviteExpiresAt: latestInvitation.expiresAt.toISOString(),
          }
        : null,
    };
  }

  async createAdminUser(input: CreateAdminUserInput) {
    const normalizedEmail = this.normalizeEmail(input.email);
    if (!normalizedEmail) {
      throw new BadRequestException('email is required');
    }

    const normalizedRoleCodes = this.normalizeRoleCodes(input.roleCodes || []);
    if (normalizedRoleCodes.length === 0) {
      throw new BadRequestException('At least one role code is required');
    }
    const primaryRoleCode = getPrimaryRoleCode(normalizedRoleCodes) || normalizedRoleCodes[0];

    const existing = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('Email already exists');
    }

    const temporaryPassword = randomBytes(24).toString('hex');
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    let createdUser: UserRow | null = null;

    for (let i = 0; i < MAX_USER_NO_GENERATION_RETRIES; i += 1) {
      const userNo = generateReferenceNo('ADM');
      try {
        createdUser = await this.prisma.user.create({
          data: {
            userNo,
            email: normalizedEmail,
            password: passwordHash,
            role: primaryRoleCode,
            status: 'INACTIVE',
          },
        });
        break;
      } catch (error) {
        if (this.isUniqueConstraintOn(error, 'userNo')) {
          continue;
        }
        if (this.isUniqueConstraintOn(error, 'email')) {
          throw new ConflictException('Email already exists');
        }
        throw error;
      }
    }

    if (!createdUser) {
      throw new InternalServerErrorException(
        `Failed to generate unique userNo after ${MAX_USER_NO_GENERATION_RETRIES} attempts`,
      );
    }

    let invitation: {
      inviteLink: string;
      inviteExpiresAt: string;
      inviteStatus: 'PENDING';
    } | null = null;
    let roleBinding: { roles: string[]; warnings: string[] } | null = null;
    try {
      invitation = await this.adminInvitationsService.createInvitationForUser({
        userId: createdUser.id,
        actor: input.actor,
        auditContext: input.auditContext,
      });

      roleBinding = await this.accessControlService.replaceUserRoles(
        createdUser.id,
        normalizedRoleCodes,
        input.actor,
        input.auditContext,
      );
    } catch (error) {
      await this.prisma.user
        .delete({
          where: { id: createdUser.id },
        })
        .catch(() => undefined);
      throw error;
    }

    if (!invitation || !roleBinding) {
      throw new InternalServerErrorException('Failed to create user invitation');
    }

    await this.auditLogsService.recordByActor(
      this.applyAuditContext({
        action: AuditActions.USER_CREATED,
        module: AuditModules.ACCESS_CONTROL,
        entityType: AuditEntityTypes.ACCESS_CONTROL,
        entityId: createdUser.id,
        entityNo: createdUser.userNo,
        afterData: {
          email: createdUser.email,
          status: createdUser.status,
          role: createdUser.role,
          roles: roleBinding.roles,
        },
        metadata: {
          userId: createdUser.id,
          userNo: createdUser.userNo,
          userEmail: createdUser.email,
          warnings: roleBinding.warnings,
          initialPasswordPolicy: 'INVITATION_ACTIVATION_REQUIRED',
          inviteStatus: invitation.inviteStatus,
          inviteExpiresAt: invitation.inviteExpiresAt,
        },
      }, input.auditContext),
      {
        actorType: 'ADMIN',
        actorId: input.actor.actorId,
        actorNo: input.actor.actorNo,
        actorRole: input.actor.actorRole,
      },
    );

    return {
      id: createdUser.id,
      userNo: createdUser.userNo,
      email: createdUser.email,
      status: createdUser.status,
      roles: roleBinding.roles,
      inviteLink: invitation.inviteLink,
      inviteExpiresAt: invitation.inviteExpiresAt,
      inviteStatus: invitation.inviteStatus,
    };
  }

  async executeAdminMemberProvisioning(
    binding: GovernedAdminMemberProvisioningBinding,
    actor: GovernedExecutionActor,
  ) {
    const normalizedRoleCodes = this.normalizeRoleCodes(binding.roleCodes);
    const adminActor = this.toAdminActor(actor);
    const auditContext = this.buildProvisioningAuditContext(binding);

    try {
      return await this.createAdminUser({
        email: binding.email,
        roleCodes: normalizedRoleCodes,
        actor: adminActor,
        auditContext,
      });
    } catch (error) {
      if (!this.isRecoverableProvisioningError(error)) {
        throw error;
      }

      const existingUser = await this.prisma.user.findFirst({
        where: this.activeUserWhere({
          email: this.normalizeEmail(binding.email),
        }),
        select: {
          id: true,
          userNo: true,
          email: true,
          status: true,
        },
      });

      if (!existingUser || existingUser.status !== 'INACTIVE') {
        throw error;
      }

      const existingRoleCodes = await this.accessControlService.getUserRoleCodes(existingUser.id);
      if (!this.sameRoleCodes(existingRoleCodes, normalizedRoleCodes)) {
        throw error;
      }

      const invitation = await this.adminInvitationsService.resendInvitationForUser({
        userId: existingUser.id,
        actor: adminActor,
        auditContext,
      });

      return {
        id: existingUser.id,
        userNo: existingUser.userNo,
        email: existingUser.email,
        status: existingUser.status,
        roles: normalizedRoleCodes,
        inviteLink: invitation.inviteLink,
        inviteExpiresAt: invitation.inviteExpiresAt,
        inviteStatus: invitation.inviteStatus,
      };
    }
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
