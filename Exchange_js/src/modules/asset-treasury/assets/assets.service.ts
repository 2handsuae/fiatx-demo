import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { CreateAssetDto, AssetStatus, AssetType } from './dto/asset.dto';
import { Prisma } from '@prisma/client';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';

@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);

  constructor(private prisma: PrismaService) {}

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

    const result = await this.prisma.asset.update({
      where: { id },
      data: { status },
    });

    this.logger.log(`Status changed for Asset: ${id}`);
    return result;
  }
}
