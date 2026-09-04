// src/modules/trading/withdrawal-fee-level/withdrawal-fee-level.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { FeeLevelTiersConfig, WITHDRAWAL_FEE_ITEM_CODES } from './types/fee-level.types';
import { isValidTag } from '../../identity/customer-tags/constants/customer-tag.constant';
import {
  assertFeeLevelTransition,
  FeeLevelAction,
  assertFeeChangeRequestTransition,
  FeeChangeRequestAction,
} from '../shared/fee-level-transitions.constant';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';

@Injectable()
export class WithdrawalFeeLevelService {
  constructor(private readonly prisma: PrismaService) {}

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

  private computeHash(tiersJson: string): string {
    return createHash('sha256').update(tiersJson).digest('hex');
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

  validateAudienceFields(
    isDefault: boolean,
    requiredTags?: string[],
    validFrom?: string,
    validTo?: string,
  ): void {
    if (isDefault && (requiredTags?.length ?? 0) > 0) {
      throw new BadRequestException('默认级(isDefault)不可再设 requiredTags —— 二者语义冲突');
    }
    if ((requiredTags?.length ?? 0) > 1) {
      throw new BadRequestException('单个费率等级只能要求至多一个标签（或全体）');
    }
    for (const tag of requiredTags ?? []) {
      if (!isValidTag(tag)) {
        throw new BadRequestException(`Invalid requiredTags entry: ${tag}`);
      }
    }
    if (validFrom && validTo && new Date(validFrom) > new Date(validTo)) {
      throw new BadRequestException('validFrom must not be after validTo');
    }
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

  async linkApprovalCase(levelCode: string, caseId: string, caseNo: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    await db.withdrawalFeeLevel.update({
      where: { levelCode },
      data: { approvalCaseId: caseId, approvalCaseNo: caseNo },
    });
  }

  async activateLevel(levelCode: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    const level = await db.withdrawalFeeLevel.findUnique({ where: { levelCode } });
    if (!level) throw new NotFoundException(`Level ${levelCode} not found`);
    const to = assertFeeLevelTransition(level.status, FeeLevelAction.APPROVE);
    await db.withdrawalFeeLevel.update({
      where: { levelCode },
      data: { status: to, approvalCaseId: null, approvalCaseNo: null },
    });
  }

  async declineLevel(levelCode: string, tx?: Prisma.TransactionClient): Promise<void> {
    await this.moveLevel(levelCode, FeeLevelAction.DECLINE, tx);
  }

  async cancelLevel(levelCode: string, tx?: Prisma.TransactionClient): Promise<void> {
    await this.moveLevel(levelCode, FeeLevelAction.CANCEL, tx);
  }

  async retireLevel(levelCode: string, tx?: Prisma.TransactionClient): Promise<void> {
    await this.moveLevel(levelCode, FeeLevelAction.RETIRE, tx);
  }

  private async moveLevel(levelCode: string, action: FeeLevelAction, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    const level = await db.withdrawalFeeLevel.findUnique({ where: { levelCode } });
    if (!level) throw new NotFoundException(`Level ${levelCode} not found`);
    const to = assertFeeLevelTransition(level.status, action);
    await db.withdrawalFeeLevel.update({ where: { levelCode }, data: { status: to, approvalCaseId: null, approvalCaseNo: null } });
  }

  async clearApprovalCase(levelCode: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    await db.withdrawalFeeLevel.update({ where: { levelCode }, data: { approvalCaseId: null, approvalCaseNo: null } });
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

  async deleteById(id: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    await db.withdrawalFeeLevel.delete({ where: { id } });
  }

  // ─── Change Request CRUD ─────────────────────────────────

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

    const pendingRequest = await db.withdrawalFeeLevelChangeRequest.findFirst({
      where: { levelId: dto.levelId, status: 'PENDING_APPROVAL' },
    });
    if (pendingRequest) {
      throw new ConflictException(`Level ${dto.levelCode} already has a pending change request: ${pendingRequest.requestNo}`);
    }

    this.validateTiersJson(dto.proposedTiersJson);

    const level = await db.withdrawalFeeLevel.findUnique({ where: { id: dto.levelId } });
    if (!level) throw new NotFoundException(`Level ${dto.levelId} not found`);

    for (let attempt = 0; attempt < 3; attempt++) {
      const requestNo = generateReferenceNo('WFC');
      try {
        return await db.withdrawalFeeLevelChangeRequest.create({
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
    await db.withdrawalFeeLevelChangeRequest.update({
      where: { requestNo },
      data: { approvalCaseId: caseId, approvalCaseNo: caseNo },
    });
  }

  async executeChange(requestNo: string, tx?: Prisma.TransactionClient) {
    const run = async (db: Prisma.TransactionClient | PrismaService) => {
      const request = await db.withdrawalFeeLevelChangeRequest.findUnique({ where: { requestNo } });
      if (!request) throw new NotFoundException(`Change request ${requestNo} not found`);
      const to = assertFeeChangeRequestTransition(request.status, FeeChangeRequestAction.APPROVE);

      const level = await db.withdrawalFeeLevel.findUnique({ where: { id: request.levelId } });
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

      const updatedLevel = await db.withdrawalFeeLevel.update({
        where: { id: level.id },
        data: { tiersJson: request.proposedTiersJson, configHash: newHash },
      });

      const updatedRequest = await db.withdrawalFeeLevelChangeRequest.update({
        where: { requestNo },
        data: { status: to, executedAt: new Date() },
      });

      return { level: updatedLevel, request: updatedRequest };
    };

    if (tx) return run(tx);
    return this.prisma.$transaction(async (txn) => run(txn));
  }

  async rejectChangeRequest(requestNo: string, tx?: Prisma.TransactionClient): Promise<void> {
    await this.moveChangeRequest(requestNo, FeeChangeRequestAction.DECLINE, tx);
  }

  async cancelChangeRequest(requestNo: string, tx?: Prisma.TransactionClient): Promise<void> {
    await this.moveChangeRequest(requestNo, FeeChangeRequestAction.CANCEL, tx);
  }

  async expireChangeRequest(requestNo: string, tx?: Prisma.TransactionClient): Promise<void> {
    await this.moveChangeRequest(requestNo, FeeChangeRequestAction.EXPIRE, tx);
  }

  private async moveChangeRequest(requestNo: string, action: FeeChangeRequestAction, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    const request = await db.withdrawalFeeLevelChangeRequest.findUnique({ where: { requestNo } });
    if (!request) throw new NotFoundException(`Change request ${requestNo} not found`);
    const to = assertFeeChangeRequestTransition(request.status, action);
    await db.withdrawalFeeLevelChangeRequest.update({ where: { requestNo }, data: { status: to } });
  }

  async findChangeRequestById(id: string) {
    const request = await this.prisma.withdrawalFeeLevelChangeRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException(`Change request not found: ${id}`);
    return request;
  }
}
