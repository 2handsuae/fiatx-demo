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

  async reactivateUser(
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
      throw new ConflictException('SUPER_ADMIN account cannot be reactivated via this workflow');
    }

    if (user.status !== 'SUSPENDED') {
      throw new ConflictException(`Cannot reactivate user in status: ${user.status}`);
    }

    const updated = await client.user.update({
      where: { id: userId },
      data: { status: 'ACTIVE', suspendedAt: null },
      select: { id: true, userNo: true, status: true },
    });

    return updated;
  }

  async resetPassword(
    userId: string,
    newPasswordHash: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; userNo: string; status: string }> {
    const client = tx || this.prisma;
    const user = await client.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, userNo: true, status: true, firstLoginStatus: true },
    });
    if (!user) throw new NotFoundException('User not found');

    if (user.status !== 'ACTIVE') {
      throw new ConflictException(`Cannot reset password for user in status: ${user.status}`);
    }
    if (user.firstLoginStatus !== 'COMPLETED') {
      throw new ConflictException('Cannot reset password before first login is completed');
    }

    const updated = await client.user.update({
      where: { id: userId },
      data: {
        password: newPasswordHash,
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
      select: { id: true, userNo: true, status: true },
    });

    return updated;
  }

  async setFirstLoginStatus(
    userId: string,
    status: string,
    tx?: Prisma.TransactionClient,
    traceId?: string,
  ): Promise<void> {
    const client = tx || this.prisma;
    const user = await client.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');
    await client.user.update({
      where: { id: userId },
      data: {
        firstLoginStatus: status,
        ...(traceId ? { firstLoginTraceId: traceId } : {}),
      },
    });
  }

  async storeMfaSecret(
    userId: string,
    encryptedSecret: string,
    traceId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx || this.prisma;
    await client.user.update({
      where: { id: userId },
      data: { mfaSecret: encryptedSecret, firstLoginTraceId: traceId },
    });
  }

  async completeMfaBinding(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx || this.prisma;
    await client.user.update({
      where: { id: userId },
      data: {
        firstLoginStatus: 'COMPLETED',
        mfaEnabledAt: new Date(),
        securityAckAt: new Date(),
        mfaVerifyFailCount: 0,
        mfaVerifyLockedUntil: null,
      },
    });
  }

  async incrementMfaVerifyFail(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ newCount: number; locked: boolean }> {
    const client = tx || this.prisma;
    const user = await client.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, mfaVerifyFailCount: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const newCount = (user.mfaVerifyFailCount ?? 0) + 1;
    const locked = newCount >= 5;
    await client.user.update({
      where: { id: userId },
      data: {
        mfaVerifyFailCount: newCount,
        ...(locked ? { mfaVerifyLockedUntil: new Date(Date.now() + 15 * 60 * 1000) } : {}),
      },
    });
    return { newCount, locked };
  }

  async completeFirstLogin(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx || this.prisma;
    await client.user.update({
      where: { id: userId },
      data: {
        firstLoginStatus: 'COMPLETED',
        securityAckAt: new Date(),
        mfaVerifyFailCount: 0,
        mfaVerifyLockedUntil: null,
      },
    });
  }

  async clearMfaVerifyFail(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx || this.prisma;
    await client.user.update({
      where: { id: userId },
      data: { mfaVerifyFailCount: 0, mfaVerifyLockedUntil: null },
    });
  }

  async resetMfa(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; userNo: string; email: string; role: string }> {
    const client = tx || this.prisma;
    const user = await client.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, userNo: true, email: true, role: true, status: true, mfaEnabledAt: true, mfaSecret: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.status !== 'ACTIVE') {
      throw new ConflictException('Cannot reset MFA for a non-active user');
    }
    if (!user.mfaEnabledAt && !user.mfaSecret) {
      throw new ConflictException('User has no MFA binding to reset');
    }

    await client.user.update({
      where: { id: userId },
      data: {
        mfaSecret: null,
        mfaEnabledAt: null,
        mfaVerifyFailCount: 0,
        mfaVerifyLockedUntil: null,
        firstLoginStatus: 'PENDING_IDENTITY_CONFIRM',
        firstLoginTraceId: null,
        securityAckAt: null,
      },
    });

    return { id: user.id, userNo: user.userNo, email: user.email, role: user.role };
  }

  async findFirstLoginState(userId: string): Promise<{
    id: string;
    userNo: string;
    email: string;
    role: string;
    status: string;
    firstLoginStatus: string;
    firstLoginTraceId: string | null;
    mfaSecret: string | null;
    mfaEnabledAt: Date | null;
    mfaVerifyFailCount: number;
    mfaVerifyLockedUntil: Date | null;
  } | null> {
    return this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        userNo: true,
        email: true,
        role: true,
        status: true,
        firstLoginStatus: true,
        firstLoginTraceId: true,
        mfaSecret: true,
        mfaEnabledAt: true,
        mfaVerifyFailCount: true,
        mfaVerifyLockedUntil: true,
      },
    });
  }
}
