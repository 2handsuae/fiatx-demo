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

@Injectable()
export class CustomerAuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async register(data: {
    email: string;
    password: string;
    customerType: 'INDIVIDUAL' | 'CORPORATE';
    companyName?: string;
    firstName?: string;
    lastName?: string;
  }) {
    // Check if email exists
    const existing = await this.prisma.customerMain.findUnique({
      where: { email: data.email },
    });

    if (existing) {
      throw new BadRequestException('Email already exists');
    }

    if (data.customerType === 'CORPORATE' && !data.companyName?.trim()) {
      throw new BadRequestException('companyName is required for corporate customer');
    }

    const passwordHash = await bcrypt.hash(data.password, 10);

    const customer = await this.prisma.customerMain.create({
      data: {
        customerNo: generateReferenceNo('CU'),
        email: data.email,
        passwordHash,
        customerType: data.customerType,
        companyName: data.customerType === 'CORPORATE' ? data.companyName?.trim() || null : null,
        onboardingStage: 'ENTITY_IDENTIFIED',
        firstName: data.firstName,
        lastName: data.lastName,
        passwordUpdatedAt: new Date(),
      },
    });

    const { passwordHash: _, ...result } = customer;
    return result;
  }

  async validateCustomer(email: string, pass: string): Promise<any> {
    const customer = await this.prisma.customerMain.findUnique({
      where: { email },
    });

    if (!customer) {
      return null;
    }

    if (!customer.passwordHash) {
      // Customer exists but no password set (maybe only phone verified?)
      return null;
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
