// src/modules/trading/swap-fee-level/swap-fee-level.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { SwapFeeLevelTiersConfig, SWAP_FEE_ITEM_CODES } from './types/fee-level.types';

@Injectable()
export class SwapFeeLevelService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Level CRUD ──────────────────────────────────────────

  async findAll(params: {
    skip?: number;
    take?: number;
    where?: Prisma.SwapFeeLevelWhereInput;
    orderBy?: Prisma.SwapFeeLevelOrderByWithRelationInput;
  }) {
    const { skip, take, where, orderBy } = params;
    const [items, total] = await Promise.all([
      this.prisma.swapFeeLevel.findMany({
        skip,
        take,
        where,
        orderBy: orderBy ?? { levelCode: 'asc' },
        include: {
          fromAsset: { select: { code: true, type: true, currency: true } },
          toAsset: { select: { code: true, type: true, currency: true } },
        },
      }),
      this.prisma.swapFeeLevel.count({ where }),
    ]);
    return { items, total };
  }

  async findById(id: string) {
    const level = await this.prisma.swapFeeLevel.findUnique({
      where: { id },
      include: {
        fromAsset: { select: { code: true, type: true, currency: true, network: true } },
        toAsset: { select: { code: true, type: true, currency: true, network: true } },
      },
    });
    if (!level) throw new NotFoundException(`SwapFeeLevel not found: ${id}`);
    return level;
  }

  async findByLevelCode(levelCode: string) {
    const level = await this.prisma.swapFeeLevel.findUnique({
      where: { levelCode },
      include: {
        fromAsset: { select: { code: true, type: true, currency: true, network: true } },
        toAsset: { select: { code: true, type: true, currency: true, network: true } },
      },
    });
    if (!level) throw new NotFoundException(`SwapFeeLevel ${levelCode} not found`);
    return level;
  }

  async findActiveByPair(fromAssetId: string, toAssetId: string) {
    return this.prisma.swapFeeLevel.findMany({
      where: { fromAssetId, toAssetId, status: 'ACTIVE', enabled: true },
      orderBy: { levelCode: 'asc' },
    });
  }

  private computeHash(tiersJson: string): string {
    return createHash('sha256').update(tiersJson).digest('hex');
  }

  validateTiersJson(tiersJson: string): SwapFeeLevelTiersConfig {
    let parsed: SwapFeeLevelTiersConfig;
    try {
      parsed = JSON.parse(tiersJson);
    } catch {
      throw new BadRequestException('tiersJson is not valid JSON');
    }
    if (!parsed.tiers || !Array.isArray(parsed.tiers) || parsed.tiers.length === 0) {
      throw new BadRequestException('tiersJson.tiers must be a non-empty array');
    }
    for (const tier of parsed.tiers) {
      if (!tier.id || !tier.name) {
        throw new BadRequestException('Each tier must have id and name');
      }
      if (typeof tier.rateMarkupBps !== 'number' || tier.rateMarkupBps < 0) {
        throw new BadRequestException(`Tier ${tier.id} rateMarkupBps must be a non-negative number`);
      }
      // Swap tiers may be spread-only (no fee items). Validate codes only when present.
      if (tier.feeItems !== undefined && !Array.isArray(tier.feeItems)) {
        throw new BadRequestException(`Tier ${tier.id} feeItems must be an array`);
      }
      for (const item of tier.feeItems ?? []) {
        if (!(SWAP_FEE_ITEM_CODES as readonly string[]).includes(item.itemCode)) {
          throw new BadRequestException(`Invalid itemCode: ${item.itemCode}`);
        }
      }
    }
    return parsed;
  }

  async createLevel(
    dto: {
      levelCode: string;
      name: string;
      fromAssetId: string;
      toAssetId: string;
      isDefault: boolean;
      tiersJson: string;
      createdByUserId: string;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;

    if (dto.fromAssetId === dto.toAssetId) {
      throw new BadRequestException('fromAssetId and toAssetId must be different');
    }

    const fromAsset = await db.asset.findUnique({ where: { id: dto.fromAssetId } });
    if (!fromAsset) throw new NotFoundException(`Asset ${dto.fromAssetId} not found`);
    if (fromAsset.status !== 'ACTIVE') {
      throw new BadRequestException(`Asset ${dto.fromAssetId} is not ACTIVE`);
    }

    const toAsset = await db.asset.findUnique({ where: { id: dto.toAssetId } });
    if (!toAsset) throw new NotFoundException(`Asset ${dto.toAssetId} not found`);
    if (toAsset.status !== 'ACTIVE') {
      throw new BadRequestException(`Asset ${dto.toAssetId} is not ACTIVE`);
    }

    const existing = await db.swapFeeLevel.findUnique({ where: { levelCode: dto.levelCode } });
    if (existing) {
      throw new ConflictException(`levelCode ${dto.levelCode} already exists`);
    }

    this.validateTiersJson(dto.tiersJson);

    return db.swapFeeLevel.create({
      data: {
        levelCode: dto.levelCode,
        name: dto.name,
        fromAssetId: dto.fromAssetId,
        toAssetId: dto.toAssetId,
        isDefault: dto.isDefault,
        tiersJson: dto.tiersJson,
        configHash: this.computeHash(dto.tiersJson),
        status: 'PENDING_APPROVAL',
        createdByUserId: dto.createdByUserId,
      },
    });
  }

  async linkApprovalCase(levelCode: string, caseId: string, caseNo: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    await db.swapFeeLevel.update({
      where: { levelCode },
      data: { approvalCaseId: caseId, approvalCaseNo: caseNo },
    });
  }

  async activateLevel(levelCode: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    const level = await db.swapFeeLevel.findUnique({ where: { levelCode } });
    if (!level) throw new NotFoundException(`Level ${levelCode} not found`);
    if (level.status !== 'PENDING_APPROVAL') {
      throw new ConflictException(`Level ${levelCode} is ${level.status}, expected PENDING_APPROVAL`);
    }
    await db.swapFeeLevel.update({
      where: { levelCode },
      data: { status: 'ACTIVE', approvalCaseId: null, approvalCaseNo: null },
    });
  }

  async deleteRejectedLevel(levelCode: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    const level = await db.swapFeeLevel.findUnique({ where: { levelCode } });
    if (!level) throw new NotFoundException(`Level ${levelCode} not found`);
    if (level.status !== 'PENDING_APPROVAL') {
      throw new ConflictException(`Cannot delete level ${levelCode}: status is ${level.status}`);
    }
    await db.swapFeeLevel.delete({ where: { levelCode } });
  }

  async deleteById(id: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    await db.swapFeeLevel.delete({ where: { id } });
  }

  // ─── Change Request CRUD ─────────────────────────────────

  async generateNextRequestNo(): Promise<string> {
    const last = await this.prisma.swapFeeLevelChangeRequest.findFirst({
      orderBy: { requestNo: 'desc' },
      select: { requestNo: true },
    });
    if (!last || last.requestNo === 'TEMP') return 'SFLC-001';
    const num = parseInt(last.requestNo.replace('SFLC-', ''), 10);
    return `SFLC-${String(num + 1).padStart(3, '0')}`;
  }

  async createChangeRequest(
    dto: {
      levelId: string;
      levelCode: string;
      proposedTiersJson: string;
      changeReason: string;
      requestedByUserId: string;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;

    const pendingRequest = await db.swapFeeLevelChangeRequest.findFirst({
      where: { levelId: dto.levelId, status: 'PENDING_APPROVAL' },
    });
    if (pendingRequest) {
      throw new ConflictException(`Level ${dto.levelCode} already has a pending change request: ${pendingRequest.requestNo}`);
    }

    this.validateTiersJson(dto.proposedTiersJson);

    const level = await db.swapFeeLevel.findUnique({ where: { id: dto.levelId } });
    if (!level) throw new NotFoundException(`Level ${dto.levelId} not found`);

    for (let attempt = 0; attempt < 3; attempt++) {
      const requestNo = await this.generateNextRequestNo();
      try {
        return await db.swapFeeLevelChangeRequest.create({
          data: {
            requestNo,
            levelId: dto.levelId,
            levelCode: dto.levelCode,
            currentTiersJson: level.tiersJson,
            currentConfigHash: level.configHash,
            proposedTiersJson: dto.proposedTiersJson,
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
    throw new ConflictException('Failed to generate unique requestNo after 3 attempts');
  }

  async linkApprovalCaseToRequest(requestNo: string, caseId: string, caseNo: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    await db.swapFeeLevelChangeRequest.update({
      where: { requestNo },
      data: { approvalCaseId: caseId, approvalCaseNo: caseNo },
    });
  }

  async executeChange(requestNo: string, tx?: Prisma.TransactionClient) {
    const run = async (db: Prisma.TransactionClient | PrismaService) => {
      const request = await db.swapFeeLevelChangeRequest.findUnique({ where: { requestNo } });
      if (!request) throw new NotFoundException(`Change request ${requestNo} not found`);
      if (request.status !== 'PENDING_APPROVAL') {
        throw new ConflictException(`Request ${requestNo} is ${request.status}, expected PENDING_APPROVAL`);
      }

      const level = await db.swapFeeLevel.findUnique({ where: { id: request.levelId } });
      if (!level) throw new NotFoundException(`Level for request ${requestNo} not found`);
      if (level.status !== 'ACTIVE') {
        throw new ConflictException(`Level ${level.levelCode} is ${level.status}, must be ACTIVE to apply change`);
      }

      if (request.currentConfigHash !== level.configHash) {
        throw new ConflictException(
          `Conflict: level config changed since request was created (snapshot hash: ${request.currentConfigHash}, actual: ${level.configHash})`,
        );
      }

      const newHash = this.computeHash(request.proposedTiersJson);

      const updatedLevel = await db.swapFeeLevel.update({
        where: { id: level.id },
        data: { tiersJson: request.proposedTiersJson, configHash: newHash },
      });

      const updatedRequest = await db.swapFeeLevelChangeRequest.update({
        where: { requestNo },
        data: { status: 'APPROVED', executedAt: new Date() },
      });

      return { level: updatedLevel, request: updatedRequest };
    };

    if (tx) return run(tx);
    return this.prisma.$transaction(async (txn) => run(txn));
  }

  async rejectChangeRequest(requestNo: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    const request = await db.swapFeeLevelChangeRequest.findUnique({ where: { requestNo } });
    if (!request) throw new NotFoundException(`Change request ${requestNo} not found`);
    if (request.status !== 'PENDING_APPROVAL') {
      throw new ConflictException(`Request ${requestNo} is ${request.status}, expected PENDING_APPROVAL`);
    }
    await db.swapFeeLevelChangeRequest.update({
      where: { requestNo },
      data: { status: 'REJECTED' },
    });
  }

  async cancelChangeRequest(requestNo: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    const request = await db.swapFeeLevelChangeRequest.findUnique({ where: { requestNo } });
    if (!request) throw new NotFoundException(`Change request ${requestNo} not found`);
    if (request.status !== 'PENDING_APPROVAL') {
      throw new ConflictException(`Request ${requestNo} is ${request.status}, expected PENDING_APPROVAL`);
    }
    await db.swapFeeLevelChangeRequest.update({
      where: { requestNo },
      data: { status: 'CANCELLED' },
    });
  }

  async markRequestExecutionFailed(requestNo: string, reason: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    await db.swapFeeLevelChangeRequest.update({
      where: { requestNo },
      data: { status: 'FAILED', failureReason: reason },
    });
  }

  async findChangeRequestById(id: string) {
    const request = await this.prisma.swapFeeLevelChangeRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException(`Change request not found: ${id}`);
    return request;
  }
}
