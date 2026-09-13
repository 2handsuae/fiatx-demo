// src/modules/trading/swap-fee-level/swap-fee-level.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { SwapFeeLevelTiersConfig, SWAP_FEE_ITEM_CODES } from './types/fee-level.types';
import { FeeLevelServiceBase } from '../shared/fee-level.base';

@Injectable()
export class SwapFeeLevelService extends FeeLevelServiceBase {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  protected levelDelegate(db: PrismaService | Prisma.TransactionClient): any {
    return db.swapFeeLevel;
  }

  protected changeRequestDelegate(db: PrismaService | Prisma.TransactionClient): any {
    return db.swapFeeLevelChangeRequest;
  }

  protected get requestNoPrefix(): string {
    return 'SFC';
  }

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
        changeRequests: { where: { status: 'PENDING_APPROVAL' }, take: 1, select: { requestNo: true, approvalCaseNo: true } },
      },
    });
    if (!level) throw new NotFoundException(`SwapFeeLevel ${levelCode} not found`);
    const { changeRequests, ...rest } = level;
    return { ...rest, pendingChangeRequest: changeRequests[0] ?? null };
  }

  async findActiveByPair(fromAssetId: string, toAssetId: string) {
    return this.prisma.swapFeeLevel.findMany({
      where: { fromAssetId, toAssetId, status: 'ACTIVE' },
      orderBy: { levelCode: 'asc' },
    });
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
      requiredTags?: string[];
      validFrom?: string;
      validTo?: string;
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
    this.validateAudienceFields(dto.isDefault, dto.requiredTags, dto.validFrom, dto.validTo);

    return db.swapFeeLevel.create({
      data: {
        levelCode: dto.levelCode,
        name: dto.name,
        fromAssetId: dto.fromAssetId,
        toAssetId: dto.toAssetId,
        isDefault: dto.isDefault,
        tiersJson: dto.tiersJson,
        configHash: this.computeHash(dto.tiersJson),
        requiredTagsJson: JSON.stringify(dto.requiredTags ?? []),
        validFrom: dto.validFrom ? new Date(dto.validFrom) : null,
        validTo: dto.validTo ? new Date(dto.validTo) : null,
        status: 'PENDING_APPROVAL',
        createdByUserId: dto.createdByUserId,
      },
    });
  }

  /** 退役守卫：该币对最后一个 ACTIVE 默认档不可退——报价会没有兜底档 */
  async assertNotLastActiveDefault(level: { id: string; levelCode: string; isDefault: boolean; fromAssetId: string; toAssetId: string }): Promise<void> {
    if (!level.isDefault) return;
    const others = await this.prisma.swapFeeLevel.count({
      where: { fromAssetId: level.fromAssetId, toAssetId: level.toAssetId, isDefault: true, status: 'ACTIVE', id: { not: level.id } },
    });
    if (others === 0) {
      throw new ConflictException({ code: 'LAST_ACTIVE_DEFAULT', message: `${level.levelCode} is the last active default level for this pair and cannot be retired` });
    }
  }
}
