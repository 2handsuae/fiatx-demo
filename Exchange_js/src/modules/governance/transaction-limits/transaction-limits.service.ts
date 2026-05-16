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

  async updateLimitAmount(policyNo: string, newAmount: Prisma.Decimal, tx?: any) {
    const db = tx ?? this.prisma;
    return db.transactionLimitPolicy.update({
      where: { policyNo },
      data: { limitAmount: newAmount, status: 'ACTIVE' },
    });
  }

  async setStatus(policyNo: string, status: string, tx?: any) {
    const db = tx ?? this.prisma;
    return db.transactionLimitPolicy.update({
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

  async generateNextPolicyNo(): Promise<string> {
    const last = await this.prisma.transactionLimitPolicy.findFirst({
      orderBy: { policyNo: 'desc' },
      select: { policyNo: true },
    });
    if (!last) return 'TLP-001';
    const num = parseInt(last.policyNo.replace('TLP-', ''), 10);
    return `TLP-${String(num + 1).padStart(3, '0')}`;
  }

  async create(
    data: {
      policyNo: string;
      tradingTier: string;
      operationType: string;
      period: string;
      limitAmount: Prisma.Decimal;
      status: string;
    },
    tx?: any,
  ) {
    const db = tx ?? this.prisma;
    return db.transactionLimitPolicy.create({ data });
  }

  async deleteById(id: string, tx?: any) {
    const db = tx ?? this.prisma;
    return db.transactionLimitPolicy.delete({ where: { id } });
  }

  async findById(id: string) {
    const policy = await this.prisma.transactionLimitPolicy.findUnique({
      where: { id },
    });
    if (!policy) {
      throw new NotFoundException(`Transaction limit policy not found: ${id}`);
    }
    return policy;
  }
}
