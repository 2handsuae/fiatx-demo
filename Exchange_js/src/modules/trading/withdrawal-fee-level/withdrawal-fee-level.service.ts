// src/modules/trading/withdrawal-fee-level/withdrawal-fee-level.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { FeeLevelTiersConfig, WITHDRAWAL_FEE_ITEM_CODES } from './types/fee-level.types';
import { FeeLevelServiceBase } from '../shared/fee-level.base';

@Injectable()
export class WithdrawalFeeLevelService extends FeeLevelServiceBase {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  protected levelDelegate(db: PrismaService | Prisma.TransactionClient): any {
    return db.withdrawalFeeLevel;
  }

  protected changeRequestDelegate(db: PrismaService | Prisma.TransactionClient): any {
    return db.withdrawalFeeLevelChangeRequest;
  }

  protected get requestNoPrefix(): string {
    return 'WFC';
  }

  // ─── Level CRUD ──────────────────────────────────────────

  async findAll(params: {
    skip?: number;
    take?: number;
    where?: Prisma.WithdrawalFeeLevelWhereInput;
    orderBy?: Prisma.WithdrawalFeeLevelOrderByWithRelationInput;
  }) {
    const { skip, take, where, orderBy } = params;
    const [items, total] = await Promise.all([
      this.prisma.withdrawalFeeLevel.findMany({
        skip,
        take,
        where,
        orderBy: orderBy ?? { levelCode: 'asc' },
        include: { asset: { select: { code: true, type: true, currency: true } } },
      }),
      this.prisma.withdrawalFeeLevel.count({ where }),
    ]);
    return { items, total };
  }

  async findById(id: string) {
    const level = await this.prisma.withdrawalFeeLevel.findUnique({
      where: { id },
      include: { asset: { select: { code: true, type: true, currency: true, network: true } } },
    });
    if (!level) throw new NotFoundException(`WithdrawalFeeLevel not found: ${id}`);
    return level;
  }

  async findByLevelCode(levelCode: string) {
    const level = await this.prisma.withdrawalFeeLevel.findUnique({
      where: { levelCode },
      include: {
        asset: { select: { code: true, type: true, currency: true, network: true } },
        changeRequests: { where: { status: 'PENDING_APPROVAL' }, take: 1, select: { requestNo: true, approvalCaseNo: true } },
      },
    });
    if (!level) throw new NotFoundException(`WithdrawalFeeLevel ${levelCode} not found`);
    const { changeRequests, ...rest } = level;
    return { ...rest, pendingChangeRequest: changeRequests[0] ?? null };
  }

  async findActiveByAsset(assetId: string) {
    return this.prisma.withdrawalFeeLevel.findMany({
      where: { assetId, status: 'ACTIVE' },
      orderBy: { levelCode: 'asc' },
    });
  }

  validateTiersJson(tiersJson: string): FeeLevelTiersConfig {
    let parsed: FeeLevelTiersConfig;
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
      if (!Array.isArray(tier.feeItems) || tier.feeItems.length === 0) {
        throw new BadRequestException(`Tier ${tier.id} must have at least one feeItem`);
      }
      for (const item of tier.feeItems) {
        if (!(WITHDRAWAL_FEE_ITEM_CODES as readonly string[]).includes(item.itemCode)) {
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
      assetId: string;
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

    const asset = await db.asset.findUnique({ where: { id: dto.assetId } });
    if (!asset) throw new NotFoundException(`Asset ${dto.assetId} not found`);
    if (asset.status !== 'ACTIVE') {
      throw new BadRequestException(`Asset ${dto.assetId} is not ACTIVE`);
    }

    const existing = await db.withdrawalFeeLevel.findUnique({ where: { levelCode: dto.levelCode } });
    if (existing) {
      throw new ConflictException(`levelCode ${dto.levelCode} already exists`);
    }

    this.validateTiersJson(dto.tiersJson);
    this.validateAudienceFields(dto.isDefault, dto.requiredTags, dto.validFrom, dto.validTo);

    return db.withdrawalFeeLevel.create({
      data: {
        levelCode: dto.levelCode,
        name: dto.name,
        assetId: dto.assetId,
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

  /** 退役守卫：该资产最后一个 ACTIVE 默认档不可退——报价会没有兜底档 */
  async assertNotLastActiveDefault(level: { id: string; levelCode: string; isDefault: boolean; assetId: string }): Promise<void> {
    if (!level.isDefault) return;
    const others = await this.prisma.withdrawalFeeLevel.count({
      where: { assetId: level.assetId, isDefault: true, status: 'ACTIVE', id: { not: level.id } },
    });
    if (others === 0) {
      throw new ConflictException({ code: 'LAST_ACTIVE_DEFAULT', message: `${level.levelCode} is the last active default level for this asset and cannot be retired` });
    }
  }
}
