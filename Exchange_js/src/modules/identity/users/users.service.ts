import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
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
}

const MAX_USER_NO_GENERATION_RETRIES = 10;
type UserRow = any;

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

  async findOne(email: string): Promise<UserRow | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findByIdentifier(identifier: string): Promise<UserRow | null> {
    const value = (identifier || '').trim();
    if (!value) return null;
    return this.prisma.user.findFirst({
      where: {
        OR: [{ email: value }, { userNo: value }],
      },
    });
  }

  async findById(id: string): Promise<UserRow | null> {
    return this.prisma.user.findUnique({ where: { id } });
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
      });

      roleBinding = await this.accessControlService.replaceUserRoles(
        createdUser.id,
        normalizedRoleCodes,
        input.actor,
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
      {
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
      },
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
      role: createdUser.role,
      roles: roleBinding.roles,
      warnings: roleBinding.warnings,
      inviteLink: invitation.inviteLink,
      inviteExpiresAt: invitation.inviteExpiresAt,
      inviteStatus: invitation.inviteStatus,
    };
  }

  async resendAdminInvitation(input: {
    userId: string;
    actor: {
      actorId: string;
      actorRole: string;
      actorNo?: string;
    };
  }) {
    return this.adminInvitationsService.resendInvitationForUser({
      userId: input.userId,
      actor: input.actor,
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
      where,
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
