import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { User, Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { AccessControlService } from '../access-control/access-control.service';
import { AuditLogsService } from '../../risk-engine/audit-logs/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
} from '../../risk-engine/audit-logs/constants/audit-actions.constant';

interface CreateAdminUserInput {
  email: string;
  roleCodes: string[];
  actor: {
    actorId: string;
    actorRole: string;
    actorNo?: string;
  };
}

const INITIAL_ADMIN_PASSWORD = '123456';
const MAX_USER_NO_GENERATION_RETRIES = 10;

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private accessControlService: AccessControlService,
    private auditLogsService: AuditLogsService,
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

  async findOne(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findByIdentifier(identifier: string): Promise<User | null> {
    const value = (identifier || '').trim();
    if (!value) return null;
    return this.prisma.user.findFirst({
      where: {
        OR: [{ email: value }, { userNo: value }],
      },
    });
  }

  async findById(id: string): Promise<User | null> {
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

    const existing = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('Email already exists');
    }

    const passwordHash = await bcrypt.hash(INITIAL_ADMIN_PASSWORD, 10);
    let createdUser: User | null = null;

    for (let i = 0; i < MAX_USER_NO_GENERATION_RETRIES; i += 1) {
      const userNo = generateReferenceNo('ADM');
      try {
        createdUser = await this.prisma.user.create({
          data: {
            userNo,
            email: normalizedEmail,
            password: passwordHash,
            role: normalizedRoleCodes[0],
            status: 'ACTIVE',
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

    let roleBinding: { roles: string[]; warnings: string[] };
    try {
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
          initialPasswordPolicy: 'FIXED_123456',
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
    };
  }

  async findAll(params: {
    skip?: number;
    take?: number;
    cursor?: Prisma.UserWhereUniqueInput;
    where?: Prisma.UserWhereInput;
    orderBy?: Prisma.UserOrderByWithRelationInput;
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
    where: Prisma.UserWhereUniqueInput;
    data: Prisma.UserUpdateInput;
  }): Promise<User> {
    const { where, data } = params;
    return this.prisma.user.update({
      data,
      where,
    });
  }
}
