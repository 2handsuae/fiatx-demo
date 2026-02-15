import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  CreateCustomerSwapRateDto,
  CustomerSwapRateStatus,
  UpdateCustomerSwapRateDto,
} from './dto/customer-swap-rate.dto';

@Injectable()
export class CustomerSwapRatesService {
  private readonly logger = new Logger(CustomerSwapRatesService.name);

  constructor(private prisma: PrismaService) {}

  async create(data: CreateCustomerSwapRateDto) {
    this.logger.log(
      `Creating customer swap rate config: ${data.fromAssetId} -> ${data.toAssetId}`,
    );

    if (data.fromAssetId === data.toAssetId) {
      throw new BadRequestException('From Asset and To Asset cannot be the same');
    }

    const [fromAsset, toAsset, existing] = await Promise.all([
      this.prisma.asset.findUnique({ where: { id: data.fromAssetId } }),
      this.prisma.asset.findUnique({ where: { id: data.toAssetId } }),
      this.prisma.customerSwapRateConfiguration.findUnique({
        where: {
          fromAssetId_toAssetId: {
            fromAssetId: data.fromAssetId,
            toAssetId: data.toAssetId,
          },
        },
      }),
    ]);

    if (!fromAsset) throw new BadRequestException('Invalid From Asset ID');
    if (!toAsset) throw new BadRequestException('Invalid To Asset ID');
    if (existing) {
      throw new BadRequestException(
        `Rate config already exists for pair ${data.fromAssetId} -> ${data.toAssetId}`,
      );
    }

    return this.prisma.customerSwapRateConfiguration.create({
      data: {
        fromAssetId: data.fromAssetId,
        toAssetId: data.toAssetId,
        spreadPercent: data.spreadPercent,
        status: CustomerSwapRateStatus.ACTIVE,
      },
      include: {
        fromAsset: { select: { code: true, type: true } },
        toAsset: { select: { code: true, type: true } },
      },
    });
  }

  async findAll(params: {
    skip?: number;
    take?: number;
    where?: Prisma.CustomerSwapRateConfigurationWhereInput;
    orderBy?: Prisma.CustomerSwapRateConfigurationOrderByWithRelationInput;
  }) {
    const { skip, take, where, orderBy } = params;
    const [items, total] = await Promise.all([
      this.prisma.customerSwapRateConfiguration.findMany({
        skip,
        take,
        where,
        orderBy,
        include: {
          fromAsset: { select: { code: true, type: true } },
          toAsset: { select: { code: true, type: true } },
        },
      }),
      this.prisma.customerSwapRateConfiguration.count({ where }),
    ]);

    return { items, total };
  }

  async findOne(id: string) {
    const item = await this.prisma.customerSwapRateConfiguration.findUnique({
      where: { id },
      include: {
        fromAsset: true,
        toAsset: true,
      },
    });

    if (!item) throw new NotFoundException('Customer swap rate config not found');
    return item;
  }

  async update(id: string, data: UpdateCustomerSwapRateDto) {
    await this.findOne(id);

    return this.prisma.customerSwapRateConfiguration.update({
      where: { id },
      data: {
        spreadPercent: data.spreadPercent,
      },
      include: {
        fromAsset: { select: { code: true, type: true } },
        toAsset: { select: { code: true, type: true } },
      },
    });
  }

  async changeStatus(id: string, status: CustomerSwapRateStatus) {
    await this.findOne(id);
    return this.prisma.customerSwapRateConfiguration.update({
      where: { id },
      data: { status },
    });
  }

  async resolveActiveRateForPair(fromAssetId: string, toAssetId: string) {
    const configs = await this.prisma.customerSwapRateConfiguration.findMany({
      where: {
        fromAssetId,
        toAssetId,
        status: CustomerSwapRateStatus.ACTIVE,
      },
      include: {
        fromAsset: { select: { code: true, type: true } },
        toAsset: { select: { code: true, type: true } },
      },
    });

    if (configs.length === 0) {
      throw new BadRequestException(
        `No active customer swap rate config found for pair ${fromAssetId} -> ${toAssetId}`,
      );
    }

    if (configs.length > 1) {
      throw new BadRequestException(
        `Multiple active customer swap rate configs found for pair ${fromAssetId} -> ${toAssetId}`,
      );
    }

    return configs[0];
  }
}
