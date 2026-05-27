import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { TRADING_TIERS, OPERATION_TYPES, LIMIT_PERIODS } from './constants/limit-policy.constants';

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

  async generateNextRequestNo(): Promise<string> {
    const last = await this.prisma.transactionLimitChangeRequest.findFirst({
      orderBy: { requestNo: 'desc' },
      select: { requestNo: true },
    });
    if (!last || last.requestNo === 'TEMP') return 'TLC-001';
    const num = parseInt(last.requestNo.replace('TLC-', ''), 10);
    return `TLC-${String(num + 1).padStart(3, '0')}`;
  }

  async findChangeRequestById(id: string) {
    const request = await this.prisma.transactionLimitChangeRequest.findUnique({
      where: { id },
    });
    if (!request) {
      throw new NotFoundException(`Transaction limit change request not found: ${id}`);
    }
    return request;
  }

  async getAvailableTradingTiers(): Promise<string[]> {
    const dbTiers = await this.prisma.transactionLimitPolicy.findMany({
      select: { tradingTier: true },
      distinct: ['tradingTier'],
    });
    const dbTierValues = dbTiers.map((r) => r.tradingTier);
    const allTiers = new Set([...TRADING_TIERS, ...dbTierValues]);
    return Array.from(allTiers).sort();
  }

  // ─── L1 Pure Domain Methods ───────────────────────────────────────────

  async createPolicy(
    dto: {
      tradingTier: string;
      operationType: string;
      period: string;
      limitAmount: Prisma.Decimal;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;

    if (!(TRADING_TIERS as readonly string[]).includes(dto.tradingTier)) {
      throw new BadRequestException(`Invalid tradingTier: ${dto.tradingTier}`);
    }
    if (!(OPERATION_TYPES as readonly string[]).includes(dto.operationType)) {
      throw new BadRequestException(`Invalid operationType: ${dto.operationType}`);
    }
    if (!(LIMIT_PERIODS as readonly string[]).includes(dto.period)) {
      throw new BadRequestException(`Invalid period: ${dto.period}`);
    }

    const existing = await db.transactionLimitPolicy.findFirst({
      where: { tradingTier: dto.tradingTier, operationType: dto.operationType, period: dto.period },
    });
    if (existing) {
      throw new ConflictException(
        `Policy already exists for [${dto.tradingTier}, ${dto.operationType}, ${dto.period}]`,
      );
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      const policyNo = await this.generateNextPolicyNo();
      try {
        return await db.transactionLimitPolicy.create({
          data: {
            policyNo,
            tradingTier: dto.tradingTier,
            operationType: dto.operationType,
            period: dto.period,
            limitAmount: dto.limitAmount,
            status: 'PENDING_APPROVAL',
          },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          if (attempt === 2) throw new ConflictException('Failed to generate unique policyNo after 3 attempts');
          continue;
        }
        throw e;
      }
    }
    // Unreachable: the loop always returns or throws
    throw new ConflictException('Failed to generate unique policyNo after 3 attempts');
  }

  async linkApprovalCaseToPolicy(policyNo: string, caseId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    await db.transactionLimitPolicy.update({
      where: { policyNo },
      data: { approvalCaseId: caseId },
    });
  }

  async activatePolicy(policyNo: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    const policy = await db.transactionLimitPolicy.findUnique({ where: { policyNo } });
    if (!policy) throw new NotFoundException(`Policy ${policyNo} not found`);
    if (policy.status !== 'PENDING_APPROVAL') {
      throw new ConflictException(`Policy ${policyNo} is ${policy.status}, expected PENDING_APPROVAL`);
    }
    await db.transactionLimitPolicy.update({
      where: { policyNo },
      data: { status: 'ACTIVE', approvalCaseId: null },
    });
  }

  async deleteRejectedPolicy(policyNo: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    const policy = await db.transactionLimitPolicy.findUnique({ where: { policyNo } });
    if (!policy) throw new NotFoundException(`Policy ${policyNo} not found`);
    if (policy.status !== 'PENDING_APPROVAL') {
      throw new ConflictException(`Cannot delete policy ${policyNo}: status is ${policy.status}`);
    }
    await db.transactionLimitPolicy.delete({ where: { policyNo } });
  }

  async createChangeRequest(
    dto: {
      policyId: string;
      policyNo: string;
      proposedAmount: Prisma.Decimal;
      changeReason: string;
      requestedByUserId: string;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;

    const pendingRequest = await db.transactionLimitChangeRequest.findFirst({
      where: { policyId: dto.policyId, status: 'PENDING_APPROVAL' },
    });
    if (pendingRequest) {
      throw new ConflictException(`Policy ${dto.policyNo} already has a pending change request`);
    }

    const policy = await db.transactionLimitPolicy.findUnique({ where: { id: dto.policyId } });
    if (!policy) throw new NotFoundException(`Policy ${dto.policyId} not found`);

    for (let attempt = 0; attempt < 3; attempt++) {
      const requestNo = await this.generateNextRequestNo();
      try {
        return await db.transactionLimitChangeRequest.create({
          data: {
            requestNo,
            policyId: dto.policyId,
            policyNo: dto.policyNo,
            currentAmount: policy.limitAmount,
            proposedAmount: dto.proposedAmount,
            changeReason: dto.changeReason,
            requestedByUserId: dto.requestedByUserId,
            status: 'PENDING_APPROVAL',
          },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          if (attempt === 2) throw new ConflictException('Failed to generate unique requestNo after 3 attempts');
          continue;
        }
        throw e;
      }
    }
  }

  async linkApprovalCaseToRequest(requestNo: string, caseId: string, caseNo: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    await db.transactionLimitChangeRequest.update({
      where: { requestNo },
      data: { approvalCaseId: caseId, approvalCaseNo: caseNo },
    });
  }

  async executeChange(requestNo: string, tx?: Prisma.TransactionClient) {
    const run = async (db: Prisma.TransactionClient | PrismaService) => {
      const request = await db.transactionLimitChangeRequest.findUnique({ where: { requestNo } });
      if (!request) throw new NotFoundException(`Change request ${requestNo} not found`);
      if (request.status !== 'PENDING_APPROVAL') {
        throw new ConflictException(`Request ${requestNo} is ${request.status}, expected PENDING_APPROVAL`);
      }

      const policy = await db.transactionLimitPolicy.findUnique({ where: { id: request.policyId } });
      if (!policy) throw new NotFoundException(`Policy for request ${requestNo} not found`);
      if (policy.status !== 'ACTIVE') {
        throw new ConflictException(`Policy ${policy.policyNo} is ${policy.status}, must be ACTIVE to apply change`);
      }

      if (request.currentAmount.toString() !== policy.limitAmount.toString()) {
        throw new ConflictException(
          `Conflict: policy limit changed since request was created (snapshot: ${request.currentAmount}, actual: ${policy.limitAmount})`,
        );
      }

      const updatedPolicy = await db.transactionLimitPolicy.update({
        where: { id: policy.id },
        data: { limitAmount: request.proposedAmount },
      });

      const updatedRequest = await db.transactionLimitChangeRequest.update({
        where: { requestNo },
        data: { status: 'EXECUTED', executedAt: new Date() },
      });

      return { policy: updatedPolicy, request: updatedRequest };
    };

    if (tx) {
      return run(tx);
    }
    return this.prisma.$transaction(async (txn) => run(txn));
  }

  async rejectChangeRequest(requestNo: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    const request = await db.transactionLimitChangeRequest.findUnique({ where: { requestNo } });
    if (!request) throw new NotFoundException(`Change request ${requestNo} not found`);
    if (request.status !== 'PENDING_APPROVAL') {
      throw new ConflictException(`Request ${requestNo} is ${request.status}, expected PENDING_APPROVAL`);
    }
    await db.transactionLimitChangeRequest.update({
      where: { requestNo },
      data: { status: 'REJECTED' },
    });
  }

  async cancelChangeRequest(requestNo: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    const request = await db.transactionLimitChangeRequest.findUnique({ where: { requestNo } });
    if (!request) throw new NotFoundException(`Change request ${requestNo} not found`);
    if (request.status !== 'PENDING_APPROVAL') {
      throw new ConflictException(`Request ${requestNo} is ${request.status}, expected PENDING_APPROVAL`);
    }
    await db.transactionLimitChangeRequest.update({
      where: { requestNo },
      data: { status: 'CANCELLED' },
    });
  }

  async markRequestExecutionFailed(requestNo: string, reason: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    const request = await db.transactionLimitChangeRequest.findUnique({ where: { requestNo } });
    if (!request) throw new NotFoundException(`Change request ${requestNo} not found`);
    if (!['PENDING_APPROVAL', 'APPROVED'].includes(request.status)) {
      throw new ConflictException(`Request ${requestNo} is ${request.status}, cannot mark as failed`);
    }
    await db.transactionLimitChangeRequest.update({
      where: { requestNo },
      data: { status: 'EXECUTION_FAILED', failureReason: reason },
    });
  }
}
