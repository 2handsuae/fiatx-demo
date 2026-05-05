import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { getPrimaryRoleCode } from '../access-control/rbac.catalog';

const MAX_USER_NO_RETRIES = 10;

export interface CreateProvisionalUserInput {
  email: string;
  roleCodes: string[];
}

export interface ProvisionalUser {
  id: string;
  userNo: string;
  email: string;
  status: string;
  role: string;
}

@Injectable()
export class UsersDomainService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeEmail(email: string): string {
    return String(email || '').trim().toLowerCase();
  }

  private isUniqueConstraintOn(error: unknown, field: string): boolean {
    const e = error as { code?: string; meta?: { target?: string[] | string } };
    if (e?.code !== 'P2002') return false;
    const t = e.meta?.target;
    return Array.isArray(t) ? t.includes(field) : typeof t === 'string' && t.includes(field);
  }

  async createProvisionalUser(
    input: CreateProvisionalUserInput,
    tx?: Prisma.TransactionClient,
  ): Promise<ProvisionalUser> {
    const client = tx || this.prisma;
    const email = this.normalizeEmail(input.email);

    const existing = await client.user.findFirst({
      where: { email, deletedAt: null },
      select: { id: true },
    });
    if (existing) throw new ConflictException('Email already exists');

    const primaryRoleCode = getPrimaryRoleCode(input.roleCodes) || input.roleCodes[0];
    const temporaryPassword = randomBytes(24).toString('hex');
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);

    for (let i = 0; i < MAX_USER_NO_RETRIES; i++) {
      const userNo = generateReferenceNo('ADM');
      try {
        const user = await client.user.create({
          data: {
            userNo,
            email,
            password: passwordHash,
            role: primaryRoleCode,
            status: 'PENDING_INVITE_APPROVAL',
          },
        });
        return {
          id: user.id,
          userNo: user.userNo,
          email: user.email,
          status: user.status,
          role: user.role,
        };
      } catch (err) {
        if (this.isUniqueConstraintOn(err, 'userNo')) continue;
        if (this.isUniqueConstraintOn(err, 'email'))
          throw new ConflictException('Email already exists');
        throw err;
      }
    }

    throw new InternalServerErrorException(
      `Failed to generate unique userNo after ${MAX_USER_NO_RETRIES} attempts`,
    );
  }

  async updateStatus(
    userId: string,
    newStatus: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx || this.prisma;
    const user = await client.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!user) throw new NotFoundException('User not found');

    await client.user.update({
      where: { id: userId },
      data: { status: newStatus },
    });
  }

  async physicalDelete(userId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx || this.prisma;
    await client.user.delete({ where: { id: userId } }).catch(() => undefined);
  }

  async findById(userId: string): Promise<ProvisionalUser | null> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, userNo: true, email: true, status: true, role: true },
    });
    if (!user) return null;
    return {
      id: user.id,
      userNo: user.userNo,
      email: user.email,
      status: user.status,
      role: user.role,
    };
  }

  async suspendUser(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; userNo: string; status: string }> {
    const client = tx || this.prisma;
    const user = await client.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, userNo: true, status: true, userRoles: { select: { role: { select: { code: true } } } } },
    });
    if (!user) throw new NotFoundException('User not found');

    const roleCodes = user.userRoles.map((ur: any) => ur.role.code);
    if (roleCodes.includes('SUPER_ADMIN')) {
      throw new ConflictException('SUPER_ADMIN account cannot be suspended');
    }

    if (user.status === 'SUSPENDED') {
      return { id: user.id, userNo: user.userNo, status: user.status };
    }

    if (user.status !== 'ACTIVE' && user.status !== 'INACTIVE' && user.status !== 'INVITE_SENT' && user.status !== 'PENDING_INVITE_APPROVAL') {
      throw new ConflictException(`Cannot suspend user in status: ${user.status}`);
    }

    const updated = await client.user.update({
      where: { id: userId },
      data: { status: 'SUSPENDED', suspendedAt: new Date() },
      select: { id: true, userNo: true, status: true },
    });

    return updated;
  }
}
