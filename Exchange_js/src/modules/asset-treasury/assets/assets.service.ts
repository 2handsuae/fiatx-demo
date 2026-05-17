import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { CreateAssetDto, AssetStatus, AssetType } from './dto/asset.dto';
import { Prisma } from '@prisma/client';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';

@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async create(data: CreateAssetDto) {
    this.logger.log(
      `Creating asset: ${data.type} ${data.code} ${data.network || ''}`,
    );

    const existing = await this.prisma.asset.findFirst({
      where: {
        type: data.type,
        code: data.code,
        network: data.network || null,
      },
    });

    if (existing) {
      this.logger.warn(
        `Failed to create asset: Asset combination already exists`,
      );
      throw new BadRequestException(
        'Asset with this type, code and network combination already exists',
      );
    }

    if (data.type === AssetType.CRYPTO && !data.network) {
      throw new BadRequestException('Network is required for CRYPTO assets');
    }

    const result = await this.prisma.asset.create({
      data: {
        assetNo: generateReferenceNo('AS'),
        type: data.type,
        code: data.code,
        network: data.network,
        decimals: data.decimals,
        description: data.description,
        status: AssetStatus.ACTIVE,
      },
    });

    await this.auditLogsService.recordSystem({

      action: AuditActions.ASSET_CONFIG_UPDATED,
      entityType: AuditEntityTypes.ASSET,
      entityId: result.id,
      entityNo: result.assetNo || undefined,
      result: AuditResult.SUCCESS,
      reason: 'Asset config created',
      sourcePlatform: 'ADMIN_API',
    });

    this.logger.log(`Asset created: ${result.id}`);
    return result;
  }

  async findAll(params: {
    skip?: number;
    take?: number;
    where?: Prisma.AssetWhereInput;
    orderBy?: Prisma.AssetOrderByWithRelationInput;
  }) {
    const { skip, take, where, orderBy } = params;
    const [items, total] = await Promise.all([
      this.prisma.asset.findMany({
        skip,
        take,
        where,
        orderBy,
      }),
      this.prisma.asset.count({ where }),
    ]);

    return { items, total };
  }

  async findOne(id: string) {
    const item = await this.prisma.asset.findUnique({
      where: { id },
    });
    if (!item) throw new NotFoundException('Asset not found');
    return item;
  }

  async changeStatus(id: string, status: AssetStatus) {
    this.logger.log(`Changing status of Asset ${id} to ${status}`);

    // Validate status transition if needed, currently only ACTIVE <-> DISABLED
    const before = await this.findOne(id);

    const result = await this.prisma.asset.update({
      where: { id },
      data: { status },
    });

    await this.auditLogsService.recordSystem({

      action: AuditActions.ASSET_CONFIG_UPDATED,
      entityType: AuditEntityTypes.ASSET,
      entityId: result.id,
      entityNo: result.assetNo || undefined,
      result: AuditResult.SUCCESS,
      reason: 'Asset status changed',
      sourcePlatform: 'ADMIN_API',
    });

    this.logger.log(`Status changed for Asset: ${id}`);
    return result;
  }

  async suspendAsset(
    assetId: string,
    reason: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; assetNo: string | null; status: string }> {
    const client = tx || this.prisma;
    const asset = await (client as any).asset.findUnique({
      where: { id: assetId },
      select: {
        id: true,
        assetNo: true,
        status: true,
        depositEnabled: true,
        withdrawalEnabled: true,
      },
    });
    if (!asset) throw new NotFoundException('Asset not found');

    if (asset.status === 'SUSPENDED') {
      return { id: asset.id, assetNo: asset.assetNo, status: asset.status };
    }

    if (asset.status !== 'ACTIVE') {
      throw new BadRequestException(
        `Cannot suspend asset in status: ${asset.status}`,
      );
    }

    const updated = await (client as any).asset.update({
      where: { id: assetId },
      data: {
        status: 'SUSPENDED',
        suspendedAt: new Date(),
        suspendReason: reason,
        preSuspendDepositEnabled: asset.depositEnabled,
        preSuspendWithdrawalEnabled: asset.withdrawalEnabled,
        depositEnabled: false,
        withdrawalEnabled: false,
      },
      select: { id: true, assetNo: true, status: true },
    });

    return updated;
  }

  async reactivateAsset(
    assetId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; assetNo: string | null; status: string }> {
    const client = tx || this.prisma;
    const asset = await (client as any).asset.findUnique({
      where: { id: assetId },
      select: {
        id: true,
        assetNo: true,
        status: true,
        preSuspendDepositEnabled: true,
        preSuspendWithdrawalEnabled: true,
      },
    });
    if (!asset) throw new NotFoundException('Asset not found');

    if (asset.status !== 'SUSPENDED') {
      throw new BadRequestException(
        `Cannot reactivate asset in status: ${asset.status}`,
      );
    }

    const updated = await (client as any).asset.update({
      where: { id: assetId },
      data: {
        status: 'ACTIVE',
        suspendedAt: null,
        suspendReason: null,
        depositEnabled: asset.preSuspendDepositEnabled ?? true,
        withdrawalEnabled: asset.preSuspendWithdrawalEnabled ?? true,
        preSuspendDepositEnabled: null,
        preSuspendWithdrawalEnabled: null,
      },
      select: { id: true, assetNo: true, status: true },
    });

    return updated;
  }

  // ─── L1 Pure Domain Methods ────────────────────────────────────────────

  async findByAssetNo(assetNo: string, tx?: Prisma.TransactionClient): Promise<any | null> {
    const db = tx ?? this.prisma;
    return db.asset.findFirst({ where: { assetNo } });
  }

  async activateAsset(assetNo: string, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const asset = await db.asset.findFirst({ where: { assetNo } });
    if (!asset) throw new NotFoundException(`Asset ${assetNo} not found`);
    if (asset.status !== 'PROVISIONING') {
      throw new ConflictException(
        `Cannot activate asset ${assetNo}: current status is ${asset.status}, expected PROVISIONING`,
      );
    }
    return db.asset.update({ where: { id: asset.id }, data: { status: 'ACTIVE' } });
  }

  async linkApprovalCase(assetNo: string, approvalCaseId: string, approvalCaseNo: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    await db.asset.updateMany({
      where: { assetNo },
      data: { approvalCaseId, approvalCaseNo },
    });
  }

  async updateProvisioningFields(
    assetNo: string,
    dto: {
      minDepositAmount?: number;
      maxDepositAmount?: number;
      minWithdrawAmount?: number;
      maxWithdrawAmount?: number;
      depositEnabled?: boolean;
      withdrawalEnabled?: boolean;
      description?: string;
      contractAddress?: string;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;
    const asset = await db.asset.findFirst({ where: { assetNo } });
    if (!asset) throw new NotFoundException(`Asset ${assetNo} not found`);
    if (asset.status !== 'PROVISIONING') {
      throw new ConflictException(
        `Cannot update provisioning fields for asset ${assetNo}: status is ${asset.status}`,
      );
    }

    const data: Record<string, unknown> = {};
    if (dto.minDepositAmount !== undefined) data.minDepositAmount = dto.minDepositAmount;
    if (dto.maxDepositAmount !== undefined) data.maxDepositAmount = dto.maxDepositAmount;
    if (dto.minWithdrawAmount !== undefined) data.minWithdrawAmount = dto.minWithdrawAmount;
    if (dto.maxWithdrawAmount !== undefined) data.maxWithdrawAmount = dto.maxWithdrawAmount;
    if (dto.depositEnabled !== undefined) data.depositEnabled = dto.depositEnabled;
    if (dto.withdrawalEnabled !== undefined) data.withdrawalEnabled = dto.withdrawalEnabled;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.contractAddress !== undefined) data.contractAddress = dto.contractAddress;

    if (Object.keys(data).length === 0) return asset;

    return db.asset.update({ where: { id: asset.id }, data });
  }
}
