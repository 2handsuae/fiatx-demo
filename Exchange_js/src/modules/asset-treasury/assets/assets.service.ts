import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';

@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);

  constructor(
    private readonly prisma: PrismaService,
  ) {}

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

  async findOne(idOrAssetNo: string) {
    // Try assetNo lookup first if the value matches the assetNo prefix pattern
    if (idOrAssetNo.startsWith('AS')) {
      const item = await this.prisma.asset.findFirst({
        where: { assetNo: idOrAssetNo },
      });
      if (item) return item;
    }

    const item = await this.prisma.asset.findUnique({
      where: { id: idOrAssetNo },
    });
    if (!item) throw new NotFoundException('Asset not found');
    return item;
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

  async createAsset(
    dto: {
      currency: string;
      name?: string;
      type: string;
      network?: string;
      decimals?: number;
      description?: string;
      contractAddress?: string;
      minDepositAmount?: number;
      maxDepositAmount?: number;
      minWithdrawAmount?: number;
      maxWithdrawAmount?: number;
      depositEnabled?: boolean;
      withdrawalEnabled?: boolean;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;

    // Uniqueness check
    const existing = await db.asset.findFirst({
      where: { type: dto.type, currency: dto.currency, network: dto.network ?? null },
    });
    if (existing) {
      throw new ConflictException(
        `Asset already exists: type=${dto.type} currency=${dto.currency} network=${dto.network || 'N/A'}`,
      );
    }

    const code = dto.network ? `${dto.currency}-${dto.network}` : dto.currency;

    // P2002 retry for assetNo generation
    for (let attempt = 0; attempt < 3; attempt++) {
      const assetNo = generateReferenceNo('AS');
      try {
        const data: any = {
          assetNo,
          type: dto.type,
          currency: dto.currency,
          code,
          network: dto.network,
          description: dto.description,
          contractAddress: dto.contractAddress,
          minDepositAmount: dto.minDepositAmount,
          maxDepositAmount: dto.maxDepositAmount,
          minWithdrawAmount: dto.minWithdrawAmount,
          maxWithdrawAmount: dto.maxWithdrawAmount,
          depositEnabled: dto.depositEnabled,
          withdrawalEnabled: dto.withdrawalEnabled,
          status: 'PROVISIONING',
        };
        if (dto.decimals !== undefined) data.decimals = dto.decimals;
        return await db.asset.create({ data });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          if (attempt === 2) throw new ConflictException('Failed to generate unique assetNo after 3 attempts');
          continue;
        }
        throw e;
      }
    }
  }
}
