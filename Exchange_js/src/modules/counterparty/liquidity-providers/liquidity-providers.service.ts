import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  CreateLiquidityProviderDto,
  LiquidityProviderStatus,
} from './dto/liquidity-provider.dto';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';

@Injectable()
export class LiquidityProvidersService {
  private readonly logger = new Logger(LiquidityProvidersService.name);

  constructor(private prisma: PrismaService) {}

  async create(data: CreateLiquidityProviderDto) {
    this.logger.log(`Creating liquidity provider: ${data.email}`);

    // Check email uniqueness
    const existingEmail = await this.prisma.liquidityProvider.findUnique({
      where: { email: data.email },
    });
    if (existingEmail) {
      this.logger.warn(
        `Failed to create LP: Email ${data.email} already exists`,
      );
      throw new BadRequestException('Email already exists');
    }

    const id = `LP_${randomUUID()}`;

    const result = await this.prisma.liquidityProvider.create({
      data: {
        id,
        name: data.name,
        email: data.email,
        phone: data.phone,
        status: LiquidityProviderStatus.INACTIVE, // Default to INACTIVE
      },
    });
    this.logger.log(`Liquidity provider created: ${id}`);
    return result;
  }

  async findAll(params: {
    skip?: number;
    take?: number;
    where?: Prisma.LiquidityProviderWhereInput;
    orderBy?: Prisma.LiquidityProviderOrderByWithRelationInput;
  }) {
    const { skip, take, where, orderBy } = params;
    const [items, total] = await Promise.all([
      this.prisma.liquidityProvider.findMany({
        skip,
        take,
        where,
        orderBy,
      }),
      this.prisma.liquidityProvider.count({ where }),
    ]);

    return {
      items,
      total,
    };
  }

  async findOne(id: string) {
    const item = await this.prisma.liquidityProvider.findUnique({
      where: { id },
    });
    if (!item) return null;
    return item;
  }

  // Removed update general info method as per requirements

  async changeStatus(id: string, status: LiquidityProviderStatus) {
    this.logger.log(`Changing status of LP ${id} to ${status}`);
    const result = await this.prisma.liquidityProvider.update({
      where: { id },
      data: { status },
    });
    this.logger.log(`Status changed for LP: ${id}`);
    return result;
  }
}
