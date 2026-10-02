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
import { randomUUID } from 'crypto';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditActions, AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import { AgreementsReadService } from '../agreements/agreements-read.service';

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
    private agreementsRead: AgreementsReadService,
  ) {}

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

    await this.auditLogsService.recordByActor({
      action: AuditActions.CUSTOMER_CREATED, actionDomain: 'CUSTOMER',
      primarySubjectType: AuditEntityTypes.CUSTOMER, primarySubjectNo: customer.customerNo,
      ownerCustomerNo: customer.customerNo,
      afterData: { email: customer.email, customerType: customer.customerType },
      requestId: `CUSTOMER_CREATED_${customer.customerNo}_${randomUUID()}`,
      sourcePlatform: 'CLIENT_API',
    } as any, { actorType: 'CUSTOMER', actorNo: customer.customerNo, actorDisplayName: customer.customerNo, actorRolesAtTime: ['CUSTOMER'] });

    // 战役丙波三：注册页的勾选即同意注册时刻的生效版（source=REGISTER）。顺序在 CUSTOMER_CREATED 之后——
    // 同意台账行与同意审计都以"客户已存在"为前提。注册时即使有在途版也只同意生效版，在途版登录后由弹窗引导。
    const effective = await this.agreementsRead.getCurrentEffective();
    await this.agreementsRead.recordConsent(
      { customerId: customer.id, customerNo: customer.customerNo },
      effective.versionKey,
      'ACCEPTED',
      'REGISTER',
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
      return null;
    }

    if (!customer.passwordHash) {
      // Customer exists but no password set (maybe only phone verified?)
      return null;
    }

    // Task 5：登录门只认关系是否终止。冻结/受限客户一律允许登录——他们要能看到
    // DISCLOSED 提示、能补材料；SANCTION 客户则必须与常人无异（tipping-off 铁律）。
    if (String(customer.lifecycle || '').toUpperCase() === 'OFFBOARDED') {
      throw new ForbiddenException({
        code: 'CUSTOMER_ACCOUNT_CLOSED',
        message: '账号已关闭，无法登录。',
      });
    }

    // Check lock status
    if (customer.lockedUntil && customer.lockedUntil > new Date()) {
      throw new ForbiddenException('Account is locked. Try again later.');
    } else if (customer.lockedUntil && customer.lockedUntil <= new Date()) {
      // Unlock automatically
      await this.prisma.customerMain.update({
        where: { id: customer.id },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
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
