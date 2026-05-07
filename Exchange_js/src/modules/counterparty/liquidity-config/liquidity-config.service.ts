import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  CreateLiquidityConfigDto,
  UpdateLiquidityConfigDto,
  LiquidityConfigStatus,
  RateSourceType,
} from './dto/liquidity-config.dto';
import { Prisma } from '@prisma/client';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';

@Injectable()
export class LiquidityConfigService {
  private readonly logger = new Logger(LiquidityConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async create(data: CreateLiquidityConfigDto) {
    this.logger.log(
      `Creating liquidity config for LP ${data.lpId}: ${data.fromAssetId} -> ${data.toAssetId}`,
    );

    if (data.rateSourceType !== RateSourceType.API) {
      throw new BadRequestException('Only API rate source is supported');
    }

    // Validate foreign keys
    const lp = await this.prisma.liquidityProvider.findUnique({
      where: { id: data.lpId },
    });
    if (!lp) throw new BadRequestException('Invalid Liquidity Provider ID');

    const fromAsset = await this.prisma.asset.findUnique({
      where: { id: data.fromAssetId },
    });
    if (!fromAsset) throw new BadRequestException('Invalid From Asset ID');

    const toAsset = await this.prisma.asset.findUnique({
      where: { id: data.toAssetId },
    });
    if (!toAsset) throw new BadRequestException('Invalid To Asset ID');

    if (data.feeAssetId) {
      const feeAsset = await this.prisma.asset.findUnique({
        where: { id: data.feeAssetId },
      });
      if (!feeAsset) throw new BadRequestException('Invalid Fee Asset ID');
    }

    const result = await this.prisma.liquidityConfiguration.create({
      data: {
        lpId: data.lpId,
        fromAssetId: data.fromAssetId,
        toAssetId: data.toAssetId,
        rateSourceType: data.rateSourceType,
        spreadPercent: data.spreadPercent,
        feePercent: data.feePercent,
        feeFixedAmount: data.feeFixedAmount,
        feeAssetId: data.feeAssetId,
        minFromAmount: data.minFromAmount,
        maxFromAmount: data.maxFromAmount,
        status: LiquidityConfigStatus.ACTIVE,
      },
    });

    await this.auditLogsService.recordSystem({

      action: AuditActions.LP_CONFIG_UPDATED,
      entityType: AuditEntityTypes.LIQUIDITY_CONFIG,
      entityId: result.id,
      result: AuditResult.SUCCESS,
      reason: 'Liquidity config created',
      sourcePlatform: 'ADMIN_API',
    });

    this.logger.log(`Liquidity config created: ${result.id}`);
    return result;
  }

  async findAll(params: {
    skip?: number;
    take?: number;
    where?: Prisma.LiquidityConfigurationWhereInput;
    orderBy?: Prisma.LiquidityConfigurationOrderByWithRelationInput;
  }) {
    const { skip, take, where, orderBy } = params;
    const [items, total] = await Promise.all([
      this.prisma.liquidityConfiguration.findMany({
        skip,
        take,
        where,
        orderBy,
        include: {
          lp: { select: { name: true } },
          fromAsset: { select: { code: true, type: true } },
          toAsset: { select: { code: true, type: true } },
        },
      }),
      this.prisma.liquidityConfiguration.count({ where }),
    ]);

    return { items, total };
  }

  async findOne(id: string) {
    const item = await this.prisma.liquidityConfiguration.findUnique({
      where: { id },
      include: {
        lp: true,
        fromAsset: true,
        toAsset: true,
        feeAsset: true,
      },
    });
    if (!item) throw new NotFoundException('Configuration not found');
    return item;
  }

  async update(id: string, data: UpdateLiquidityConfigDto) {
    this.logger.log(`Updating liquidity config ${id}`);

    // Check existence and status
    const config = await this.findOne(id);
    if (config.status !== LiquidityConfigStatus.INACTIVE) {
      throw new BadRequestException(
        'Only INACTIVE configurations can be updated',
      );
    }

    if (
      data.rateSourceType !== undefined &&
      data.rateSourceType !== RateSourceType.API
    ) {
      throw new BadRequestException('Only API rate source is supported');
    }

    if (data.feeAssetId) {
      const feeAsset = await this.prisma.asset.findUnique({
        where: { id: data.feeAssetId },
      });
      if (!feeAsset) throw new BadRequestException('Invalid Fee Asset ID');
    }

    const result = await this.prisma.liquidityConfiguration.update({
      where: { id },
      data: {
        rateSourceType: data.rateSourceType,
        spreadPercent: data.spreadPercent,
        feePercent: data.feePercent,
        feeFixedAmount: data.feeFixedAmount,
        feeAssetId: data.feeAssetId,
        minFromAmount: data.minFromAmount,
        maxFromAmount: data.maxFromAmount,
      },
    });

    await this.auditLogsService.recordSystem({

      action: AuditActions.LP_CONFIG_UPDATED,
      entityType: AuditEntityTypes.LIQUIDITY_CONFIG,
      entityId: result.id,
      result: AuditResult.SUCCESS,
      reason: 'Liquidity config updated',
      sourcePlatform: 'ADMIN_API',
    });

    this.logger.log(`Liquidity config updated: ${id}`);
    return result;
  }

  async remove(id: string) {
    this.logger.log(`Deleting liquidity config ${id}`);
    const before = await this.findOne(id); // Ensure exists
    const deleted = await this.prisma.liquidityConfiguration.delete({ where: { id } });
    await this.auditLogsService.recordSystem({

      action: AuditActions.LP_CONFIG_UPDATED,
      entityType: AuditEntityTypes.LIQUIDITY_CONFIG,
      entityId: id,
      result: AuditResult.SUCCESS,
      reason: 'Liquidity config deleted',
      sourcePlatform: 'ADMIN_API',
    });
    return deleted;
  }

  async changeStatus(id: string, status: LiquidityConfigStatus) {
    this.logger.log(`Changing status of config ${id} to ${status}`);
    const before = await this.findOne(id);
    const result = await this.prisma.liquidityConfiguration.update({
      where: { id },
      data: { status },
    });
    await this.auditLogsService.recordSystem({

      action: AuditActions.LP_CONFIG_UPDATED,
      entityType: AuditEntityTypes.LIQUIDITY_CONFIG,
      entityId: id,
      result: AuditResult.SUCCESS,
      reason: 'Liquidity config status changed',
      sourcePlatform: 'ADMIN_API',
    });
    return result;
  }

  async getAvailableConfigs(fromAssetId: string, toAssetId: string) {
    return this.prisma.liquidityConfiguration.findMany({
      where: {
        fromAssetId,
        toAssetId,
        status: LiquidityConfigStatus.ACTIVE,
        lp: { status: 'ACTIVE' }, // Ensure LP is also active
      },
      include: {
        lp: true,
      },
    });
  }

  async resolveActiveConfigForPair(fromAssetId: string, toAssetId: string) {
    const configs = await this.prisma.liquidityConfiguration.findMany({
      where: {
        fromAssetId,
        toAssetId,
        status: LiquidityConfigStatus.ACTIVE,
        lp: { status: 'ACTIVE' },
      },
      include: {
        lp: {
          select: { id: true, name: true, status: true },
        },
      },
    });

    if (configs.length === 0) {
      throw new BadRequestException(
        `No active liquidity configuration found for pair ${fromAssetId} -> ${toAssetId}`,
      );
    }

    if (configs.length > 1) {
      throw new BadRequestException(
        `Multiple active liquidity configurations found for pair ${fromAssetId} -> ${toAssetId}. Keep only one ACTIVE config.`,
      );
    }

    const config = configs[0];
    if (config.rateSourceType !== RateSourceType.API) {
      throw new BadRequestException(
        `Unsupported rate source type ${config.rateSourceType}. Only API is allowed.`,
      );
    }

    return config;
  }

  async getByLpId(lpId: string) {
    return this.prisma.liquidityConfiguration.findMany({
      where: { lpId },
      include: {
        fromAsset: true,
        toAsset: true,
      },
    });
  }
}
