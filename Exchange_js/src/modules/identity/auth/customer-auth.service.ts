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
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';

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
          entityType: AuditEntityTypes.AUTH,
          result: AuditResult.FAILED,
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
          actorId: 'UNKNOWN',
          actorRole: 'CUSTOMER',
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
        entityType: AuditEntityTypes.AUTH,
        entityId: customer.id,
        entityNo: customer.customerNo,
        result: AuditResult.SUCCESS,
        metadata: {
          customerType: customer.customerType,
        },
        requestId: ctx.requestId,
        sourceIp: ctx.sourceIp,
        sourcePlatform: ctx.sourcePlatform || 'CUSTOMER_AUTH_API',
      },
      {
        actorType: 'CUSTOMER',
        actorId: customer.id,
        actorNo: customer.customerNo,
        actorRole: 'CUSTOMER',
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
          entityType: AuditEntityTypes.AUTH,
          result: AuditResult.FAILED,
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
          actorId: 'UNKNOWN',
          actorRole: 'CUSTOMER',
        },
      );
      return null;
    }

    if (!customer.passwordHash) {
      // Customer exists but no password set (maybe only phone verified?)
      await this.auditLogsService.recordByActor(
        {
          action: AuditActions.CUSTOMER_LOGIN_FAILED,
          entityType: AuditEntityTypes.AUTH,
          entityId: customer.id,
          entityNo: customer.customerNo,
          result: AuditResult.FAILED,
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
          actorId: customer.id,
          actorNo: customer.customerNo,
          actorRole: 'CUSTOMER',
        },
      );
      return null;
    }

    if (String(customer.complianceStatus || 'CLEAR').toUpperCase() === 'FROZEN') {
      await this.auditLogsService.recordByActor(
        {
          action: AuditActions.CUSTOMER_LOGIN_FAILED,
          entityType: AuditEntityTypes.AUTH,
          entityId: customer.id,
          entityNo: customer.customerNo,
          result: AuditResult.REJECTED,
          reason: 'Customer login blocked: compliance hold frozen',
          metadata: {
            complianceStatus: customer.complianceStatus || null,
            complianceFreezeReason: customer.complianceFreezeReason || null,
            identifierHash: this.maskIdentifier(normalized),
          },
          requestId: ctx.requestId,
          sourceIp: ctx.sourceIp,
          sourcePlatform: ctx.sourcePlatform || 'CUSTOMER_AUTH_API',
        },
        {
          actorType: 'CUSTOMER',
          actorId: customer.id,
          actorNo: customer.customerNo,
          actorRole: 'CUSTOMER',
        },
      );
      throw new ForbiddenException({
        code: 'CUSTOMER_ACCOUNT_FROZEN',
        message: '账号已冻结，禁止登录。请联系 WhatsApp 客服处理。',
      });
    }

    // Check lock status
    if (customer.lockedUntil && customer.lockedUntil > new Date()) {
      await this.auditLogsService.recordByActor(
        {
          action: AuditActions.ACCOUNT_LOCKED,
          entityType: AuditEntityTypes.AUTH,
          entityId: customer.id,
          entityNo: customer.customerNo,
          result: AuditResult.REJECTED,
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
          actorId: customer.id,
          actorNo: customer.customerNo,
          actorRole: 'CUSTOMER',
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
          entityType: AuditEntityTypes.AUTH,
          entityId: customer.id,
          entityNo: customer.customerNo,
          result: AuditResult.SUCCESS,
          reason: 'Customer account auto unlocked after lock timeout',
          requestId: ctx.requestId,
          sourceIp: ctx.sourceIp,
          sourcePlatform: ctx.sourcePlatform || 'CUSTOMER_AUTH_API',
        },
        {
          actorType: 'CUSTOMER',
          actorId: customer.id,
          actorNo: customer.customerNo,
          actorRole: 'CUSTOMER',
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
          entityType: AuditEntityTypes.AUTH,
          entityId: customer.id,
          entityNo: customer.customerNo,
          result: AuditResult.SUCCESS,
          requestId: ctx.requestId,
          sourceIp: ctx.sourceIp,
          sourcePlatform: ctx.sourcePlatform || 'CUSTOMER_AUTH_API',
        },
        {
          actorType: 'CUSTOMER',
          actorId: customer.id,
          actorNo: customer.customerNo,
          actorRole: 'CUSTOMER',
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
          entityType: AuditEntityTypes.AUTH,
          entityId: customer.id,
          entityNo: customer.customerNo,
          result: AuditResult.FAILED,
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
          actorId: customer.id,
          actorNo: customer.customerNo,
          actorRole: 'CUSTOMER',
        },
      );

      if (attempts >= 5) {
        await this.auditLogsService.recordByActor(
          {
              action: AuditActions.ACCOUNT_LOCKED,
            entityType: AuditEntityTypes.AUTH,
            entityId: customer.id,
            entityNo: customer.customerNo,
            result: AuditResult.REJECTED,
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
            actorId: customer.id,
            actorNo: customer.customerNo,
            actorRole: 'CUSTOMER',
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
