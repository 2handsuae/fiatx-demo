import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { createHash } from 'crypto';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditOutcome } from '../../audit-logging/dto/audit-log.dto';

interface AuthRequestContext {
  requestId?: string;
  sourceIp?: string;
  sourcePlatform?: string;
}

@Injectable()
export class CustomerAuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private auditLogsService: AuditLogsService,
  ) {}

  private maskIdentifier(identifier: string) {
    const normalized = String(identifier || '').trim().toLowerCase();
    return createHash('sha256').update(normalized).digest('hex');
  }

  async register(
    data: {
      email: string;
      password: string;
      customerType: 'INDIVIDUAL';
      firstName?: string;
      lastName?: string;
    },
    ctx: AuthRequestContext = {},
  ) {
    const existing = await this.prisma.customerMain.findUnique({
      where: { email: data.email },
    });

    if (existing) {
      await this.auditLogsService.recordByActor(
        {
          action: AuditActions.CUSTOMER_REGISTER_FAILED,
          primarySubjectType: AuditEntityTypes.AUTH,
          outcome: AuditOutcome.FAILED,
          reason: 'Customer registration failed: email already exists',
          metadata: {
            identifierHash: this.maskIdentifier(data.email),
          },
          requestId: ctx.requestId,
          sourceIp: ctx.sourceIp,
          sourcePlatform: ctx.sourcePlatform || 'CUSTOMER_AUTH_API',
        },
        {
          actorType: 'CUSTOMER',
          actorNo: 'UNKNOWN',
          actorDisplayName: 'UNKNOWN',
          actorRolesAtTime: ['CUSTOMER'],
        },
      );
      throw new BadRequestException('Email already exists');
    }

    const passwordHash = await bcrypt.hash(data.password, 10);

    const customer = await this.prisma.customerMain.create({
      data: {
        customerNo: generateReferenceNo('CU'),
        email: data.email,
        passwordHash,
        customerType: 'INDIVIDUAL',
        companyName: null,
        firstName: data.firstName,
        lastName: data.lastName,
        passwordUpdatedAt: new Date(),
      },
    });

    await this.auditLogsService.recordByActor(
      {
        action: AuditActions.CUSTOMER_REGISTERED,
        primarySubjectType: AuditEntityTypes.AUTH,
        primarySubjectNo: customer.customerNo,
        outcome: AuditOutcome.SUCCESS,
        metadata: {
          customerType: customer.customerType,
        },
        requestId: ctx.requestId,
        sourceIp: ctx.sourceIp,
        sourcePlatform: ctx.sourcePlatform || 'CUSTOMER_AUTH_API',
      },
      {
        actorType: 'CUSTOMER',
        actorNo: customer.customerNo,
        actorDisplayName: customer.customerNo,
        actorRolesAtTime: ['CUSTOMER'],
      },
    );

    const { passwordHash: _, ...result } = customer;
    return result;
  }

  async validateCustomer(
    identifier: string,
    pass: string,
    ctx: AuthRequestContext = {},
  ): Promise<any> {
    const normalized = (identifier || '').trim();
    if (!normalized) return null;

    const customer = await this.prisma.customerMain.findFirst({
      where: {
        OR: [{ email: normalized }, { phone: normalized }],
      },
    });

    if (!customer) {
      await this.auditLogsService.recordByActor(
        {
          action: AuditActions.CUSTOMER_LOGIN_FAILED,
          primarySubjectType: AuditEntityTypes.AUTH,
          outcome: AuditOutcome.FAILED,
          reason: 'Customer login failed: account not found',
          metadata: {
            identifierHash: this.maskIdentifier(normalized),
          },
          requestId: ctx.requestId,
          sourceIp: ctx.sourceIp,
          sourcePlatform: ctx.sourcePlatform || 'CUSTOMER_AUTH_API',
        },
        {
          actorType: 'CUSTOMER',
          actorNo: 'UNKNOWN',
          actorDisplayName: 'UNKNOWN',
          actorRolesAtTime: ['CUSTOMER'],
        },
      );
      return null;
    }

    if (!customer.passwordHash) {
      // Customer exists but no password set (maybe only phone verified?)
      await this.auditLogsService.recordByActor(
        {
          action: AuditActions.CUSTOMER_LOGIN_FAILED,
          primarySubjectType: AuditEntityTypes.AUTH,
          primarySubjectNo: customer.customerNo,
          outcome: AuditOutcome.FAILED,
          reason: 'Customer login failed: password not initialized',
          metadata: {
            identifierHash: this.maskIdentifier(normalized),
          },
          requestId: ctx.requestId,
          sourceIp: ctx.sourceIp,
          sourcePlatform: ctx.sourcePlatform || 'CUSTOMER_AUTH_API',
        },
        {
          actorType: 'CUSTOMER',
          actorNo: customer.customerNo,
          actorDisplayName: customer.customerNo,
          actorRolesAtTime: ['CUSTOMER'],
        },
      );
      return null;
    }

    // Task 5：登录门只认关系是否终止。冻结/受限客户一律允许登录——他们要能看到
    // DISCLOSED 提示、能补材料；SANCTION 客户则必须与常人无异（tipping-off 铁律）。
    if (String(customer.lifecycle || '').toUpperCase() === 'OFFBOARDED') {
      await this.auditLogsService.recordByActor(
        {
          action: AuditActions.CUSTOMER_LOGIN_FAILED,
          primarySubjectType: AuditEntityTypes.AUTH,
          primarySubjectNo: customer.customerNo,
          outcome: AuditOutcome.DENIED,
          reason: 'Customer login blocked: relationship offboarded',
          metadata: {
            lifecycle: customer.lifecycle || null,
            identifierHash: this.maskIdentifier(normalized),
          },
          requestId: ctx.requestId,
          sourceIp: ctx.sourceIp,
          sourcePlatform: ctx.sourcePlatform || 'CUSTOMER_AUTH_API',
        },
        {
          actorType: 'CUSTOMER',
          actorNo: customer.customerNo,
          actorDisplayName: customer.customerNo,
          actorRolesAtTime: ['CUSTOMER'],
        },
      );
      throw new ForbiddenException({
        code: 'CUSTOMER_ACCOUNT_CLOSED',
        message: '账号已关闭，无法登录。',
      });
    }

    // Check lock status
    if (customer.lockedUntil && customer.lockedUntil > new Date()) {
      await this.auditLogsService.recordByActor(
        {
          action: AuditActions.ACCOUNT_LOCKED,
          primarySubjectType: AuditEntityTypes.AUTH,
          primarySubjectNo: customer.customerNo,
          outcome: AuditOutcome.DENIED,
          reason: 'Customer account locked',
          metadata: {
            lockedUntil: customer.lockedUntil.toISOString(),
            identifierHash: this.maskIdentifier(normalized),
          },
          requestId: ctx.requestId,
          sourceIp: ctx.sourceIp,
          sourcePlatform: ctx.sourcePlatform || 'CUSTOMER_AUTH_API',
        },
        {
          actorType: 'CUSTOMER',
          actorNo: customer.customerNo,
          actorDisplayName: customer.customerNo,
          actorRolesAtTime: ['CUSTOMER'],
        },
      );
      throw new ForbiddenException('Account is locked. Try again later.');
    } else if (customer.lockedUntil && customer.lockedUntil <= new Date()) {
      // Unlock automatically
      await this.prisma.customerMain.update({
        where: { id: customer.id },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
      await this.auditLogsService.recordByActor(
        {
          action: AuditActions.ACCOUNT_UNLOCKED,
          primarySubjectType: AuditEntityTypes.AUTH,
          primarySubjectNo: customer.customerNo,
          outcome: AuditOutcome.SUCCESS,
          reason: 'Customer account auto unlocked after lock timeout',
          requestId: ctx.requestId,
          sourceIp: ctx.sourceIp,
          sourcePlatform: ctx.sourcePlatform || 'CUSTOMER_AUTH_API',
        },
        {
          actorType: 'CUSTOMER',
          actorNo: customer.customerNo,
          actorDisplayName: customer.customerNo,
          actorRolesAtTime: ['CUSTOMER'],
        },
      );
    }

    const isMatch = await bcrypt.compare(pass, customer.passwordHash);

    if (isMatch) {
      await this.prisma.customerMain.update({
        where: { id: customer.id },
        data: {
          failedLoginCount: 0,
          lockedUntil: null,
          lastLoginAt: new Date(),
        },
      });
      await this.auditLogsService.recordByActor(
        {
          action: AuditActions.CUSTOMER_LOGIN_SUCCESS,
          primarySubjectType: AuditEntityTypes.AUTH,
          primarySubjectNo: customer.customerNo,
          outcome: AuditOutcome.SUCCESS,
          requestId: ctx.requestId,
          sourceIp: ctx.sourceIp,
          sourcePlatform: ctx.sourcePlatform || 'CUSTOMER_AUTH_API',
        },
        {
          actorType: 'CUSTOMER',
          actorNo: customer.customerNo,
          actorDisplayName: customer.customerNo,
          actorRolesAtTime: ['CUSTOMER'],
        },
      );
      const { passwordHash, ...result } = customer;
      return result;
    } else {
      // Increment failed attempts
      const attempts = customer.failedLoginCount + 1;
      const updateData: any = { failedLoginCount: attempts };

      if (attempts >= 5) {
        updateData.lockedUntil = new Date(Date.now() + 30 * 60 * 1000); // 30 min lock
      }

      await this.prisma.customerMain.update({
        where: { id: customer.id },
        data: updateData,
      });

      await this.auditLogsService.recordByActor(
        {
          action: AuditActions.CUSTOMER_LOGIN_FAILED,
          primarySubjectType: AuditEntityTypes.AUTH,
          primarySubjectNo: customer.customerNo,
          outcome: AuditOutcome.FAILED,
          reason:
            attempts >= 5
              ? 'Customer login failed and account locked'
              : 'Customer login failed: invalid password',
          metadata: {
            failedLoginAttempts: attempts,
            lockApplied: attempts >= 5,
          },
          requestId: ctx.requestId,
          sourceIp: ctx.sourceIp,
          sourcePlatform: ctx.sourcePlatform || 'CUSTOMER_AUTH_API',
        },
        {
          actorType: 'CUSTOMER',
          actorNo: customer.customerNo,
          actorDisplayName: customer.customerNo,
          actorRolesAtTime: ['CUSTOMER'],
        },
      );

      if (attempts >= 5) {
        await this.auditLogsService.recordByActor(
          {
              action: AuditActions.ACCOUNT_LOCKED,
            primarySubjectType: AuditEntityTypes.AUTH,
            primarySubjectNo: customer.customerNo,
            outcome: AuditOutcome.DENIED,
            reason: 'Customer account locked by failed login attempts',
            metadata: {
              failedLoginAttempts: attempts,
              lockedUntil: updateData.lockedUntil?.toISOString?.() || null,
            },
            requestId: ctx.requestId,
            sourceIp: ctx.sourceIp,
            sourcePlatform: ctx.sourcePlatform || 'CUSTOMER_AUTH_API',
          },
          {
            actorType: 'CUSTOMER',
            actorNo: customer.customerNo,
            actorDisplayName: customer.customerNo,
            actorRolesAtTime: ['CUSTOMER'],
          },
        );
      }

      return null;
    }
  }

  async login(customer: any) {
    const payload = {
      username: customer.email,
      sub: customer.id,
      role: 'CUSTOMER',
      type: 'CUSTOMER',
      userNo: customer.customerNo,
    };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: customer.id,
        email: customer.email,
        firstName: customer.firstName,
        lastName: customer.lastName,
      },
    };
  }
}
