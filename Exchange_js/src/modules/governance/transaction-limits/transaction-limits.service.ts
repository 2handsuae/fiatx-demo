import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';

@Injectable()
export class TransactionLimitsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(params: {
    skip?: number;
    take?: number;
    where?: Prisma.TransactionLimitPolicyWhereInput;
    orderBy?: Prisma.TransactionLimitPolicyOrderByWithRelationInput;
  }) {
    const { skip, take, where, orderBy } = params;
    const [items, total] = await Promise.all([
      this.prisma.transactionLimitPolicy.findMany({
        skip,
        take,
        where,
        orderBy: orderBy ?? { policyNo: 'asc' },
      }),
      this.prisma.transactionLimitPolicy.count({ where }),
    ]);
    return { items, total };
  }

  async findByPolicyNo(policyNo: string) {
    const policy = await this.prisma.transactionLimitPolicy.findUnique({
      where: { policyNo },
    });
    if (!policy) {
      throw new NotFoundException(`Transaction limit policy ${policyNo} not found`);
    }
    return policy;
  }

  async updateLimitAmount(policyNo: string, newAmount: Prisma.Decimal) {
    return this.prisma.transactionLimitPolicy.update({
      where: { policyNo },
      data: { limitAmount: newAmount, status: 'ACTIVE' },
    });
  }

  async setStatus(policyNo: string, status: string) {
    return this.prisma.transactionLimitPolicy.update({
      where: { policyNo },
      data: { status },
    });
  }

  async findByTradingTier(tradingTier: string) {
    return this.prisma.transactionLimitPolicy.findMany({
      where: { tradingTier, status: 'ACTIVE' },
      orderBy: { operationType: 'asc' },
    });
  }
}
