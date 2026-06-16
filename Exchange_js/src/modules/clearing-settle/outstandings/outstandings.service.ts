import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import {
  OutstandingDirection,
  OutstandingQueryDto,
} from './dto/outstanding.dto';

interface SwapSuccessPayload {
  id: string;
  swapNo: string | null;
  ownerType: string;
  ownerId: string;
  ownerNo?: string | null;
  status: string;
  traceId?: string | null;
  fromAssetId: string;
  fromAssetCurrency: string | null;
  fromAmount: Prisma.Decimal;
  toAssetId: string;
  toAssetCurrency: string | null;
  toAmount: Prisma.Decimal;
  netToAmount?: Prisma.Decimal | null;
}

@Injectable()
export class OutstandingsService {
  private static readonly MAX_NO_GENERATION_RETRIES = 10;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private async resolveOwnerNo(
    tx: Prisma.TransactionClient,
    swap: SwapSuccessPayload,
  ): Promise<string | null> {
    if (swap.ownerNo) return swap.ownerNo;
    if (swap.ownerType !== 'CUSTOMER') return null;

    const owner = await (tx as any).customerMain.findUnique({
      where: { id: swap.ownerId },
      select: { customerNo: true },
    });
    return owner?.customerNo || null;
  }

  private async resolveAssetCurrency(
    tx: Prisma.TransactionClient,
    assetId: string,
    assetCurrency?: string | null,
  ): Promise<string | null> {
    if (assetCurrency && assetCurrency.trim()) {
      return assetCurrency;
    }

    const asset = await (tx as any).asset.findUnique({
      where: { id: assetId },
      select: { currency: true },
    });
    return asset?.currency || null;
  }

  private isOutstandingNoUniqueConflict(error: unknown): boolean {
    const maybeError = error as {
      code?: string;
      meta?: { target?: string[] | string };
    };
    if (maybeError?.code !== 'P2002') return false;

    const target = maybeError.meta?.target;
    if (Array.isArray(target)) return target.includes('outstandingNo');
    if (typeof target === 'string') return target.includes('outstandingNo');
    return false;
  }

  private async createOutstandingWithUniqueNo(
    tx: Prisma.TransactionClient,
    data: Omit<Prisma.OutstandingUncheckedCreateInput, 'outstandingNo'>,
  ) {
    for (
      let attempt = 1;
      attempt <= OutstandingsService.MAX_NO_GENERATION_RETRIES;
      attempt += 1
    ) {
      const outstandingNo = generateReferenceNo('OTS');
      try {
        return await (tx as any).outstanding.create({
          data: {
            ...data,
            outstandingNo,
          },
        });
      } catch (error) {
        if (this.isOutstandingNoUniqueConflict(error)) {
          continue;
        }
        throw error;
      }
    }

    throw new InternalServerErrorException(
      `Failed to generate unique outstandingNo after ${OutstandingsService.MAX_NO_GENERATION_RETRIES} attempts`,
    );
  }

  async createForSwapSuccess(
    tx: Prisma.TransactionClient,
    swap: SwapSuccessPayload,
  ) {
    if (swap.status !== 'SUCCESS') {
      throw new BadRequestException(
        'Outstanding can only be created when swap status is SUCCESS',
      );
    }

    const ownerNo = await this.resolveOwnerNo(tx, swap);

    const fromAssetCurrency = await this.resolveAssetCurrency(
      tx,
      swap.fromAssetId,
      swap.fromAssetCurrency,
    );
    const toAssetCurrency = await this.resolveAssetCurrency(
      tx,
      swap.toAssetId,
      swap.toAssetCurrency,
    );

    const rows = [
      {
        direction: OutstandingDirection.OUT,
        assetId: swap.fromAssetId,
        assetCurrency: fromAssetCurrency,
        amount: new Prisma.Decimal(swap.fromAmount),
      },
      {
        direction: OutstandingDirection.IN,
        assetId: swap.toAssetId,
        assetCurrency: toAssetCurrency,
        amount: new Prisma.Decimal(swap.netToAmount ?? swap.toAmount),
      },
    ];

    for (const row of rows) {
      const existing = await (tx as any).outstanding.findUnique({
        where: {
          sourceType_sourceId_direction: {
            sourceType: 'SWAP',
            sourceId: swap.id,
            direction: row.direction,
          },
        },
        select: { id: true },
      });

      if (existing) {
        await (tx as any).outstanding.update({
          where: { id: existing.id },
          data: {
            sourceNo: swap.swapNo,
            ownerType: swap.ownerType,
            ownerId: swap.ownerId,
            ownerNo,
            assetId: row.assetId,
            assetCode: row.assetCurrency,
            amount: row.amount,
            status: 'OPEN',
            swapTransactionId: swap.id,
            lockedAt: null,
            closedAt: null,
            closedByInternalFundId: null,
          },
        });
        continue;
      }

      const created = await this.createOutstandingWithUniqueNo(tx, {
        sourceType: 'SWAP',
        sourceId: swap.id,
        sourceNo: swap.swapNo,
        ownerType: swap.ownerType,
        ownerId: swap.ownerId,
        ownerNo,
        direction: row.direction,
        assetId: row.assetId,
        assetCode: row.assetCurrency,
        amount: row.amount,
        status: 'OPEN',
        swapTransactionId: swap.id,
        lockedAt: null,
        closedAt: null,
        closedByInternalFundId: null,
        originTraceId: swap.traceId ?? null,
      });

      await this.auditLogsService.recordSystem({
        action: AuditActions.CREATED,
        entityType: AuditEntityTypes.OUTSTANDING,
        entityId: created.id,
        entityNo: created.outstandingNo,
        workflowType: 'SWAP',
        reason: `Outstanding ${row.direction} ${row.assetCurrency} ${row.amount} created from ${swap.swapNo}`,
        sourcePlatform: 'SYSTEM',
        traceId: swap.traceId ?? undefined,
      }, tx as any);
    }

    return (tx as any).outstanding.findMany({
      where: {
        sourceType: 'SWAP',
        sourceId: swap.id,
      },
      orderBy: { direction: 'asc' },
    });
  }

  async findAllForAdmin(query: OutstandingQueryDto) {
    const {
      skip = 0,
      take = 20,
      status,
      direction,
      sourceType,
      sourceId,
      sourceNo,
      ownerId,
      ownerNo,
      outstandingNo,
      assetId,
      startDate,
      endDate,
    } = query;

    const where: any = {};
    if (status) where.status = status;
    if (direction) where.direction = direction;
    if (sourceType) where.sourceType = sourceType;
    if (outstandingNo) where.outstandingNo = { contains: outstandingNo };
    if (sourceId) where.sourceId = { contains: sourceId };
    if (sourceNo) where.sourceNo = { contains: sourceNo };
    if (ownerId) where.ownerId = ownerId;
    if (ownerNo) where.ownerNo = { contains: ownerNo };
    if (assetId) where.assetId = assetId;

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [items, total] = await Promise.all([
      (this.prisma as any).outstanding.findMany({
        where,
        skip: Number(skip),
        take: Number(take),
        orderBy: { createdAt: 'desc' },
        include: {
          asset: true,
          swapTransaction: {
            select: {
              id: true,
              swapNo: true,
              quoteNo: true,
              status: true,
              quoteId: true,
              createdAt: true,
            },
          },
        },
      }),
      (this.prisma as any).outstanding.count({ where }),
    ]);

    return { items, total };
  }

  async findOneForAdmin(id: string) {
    const item = await (this.prisma as any).outstanding.findUnique({
      where: { id },
      include: {
        asset: true,
        swapTransaction: {
          include: {
            fromAsset: true,
            toAsset: true,
            quote: true,
          },
        },
        settlementBatch: { select: { batchNo: true, settlementType: true, status: true } },
        settledByTransfer: { select: { internalTxNo: true, pathLabel: true, status: true } },
        closedByInternalFund: { select: { internalFundNo: true, status: true } },
      },
    });

    if (!item) {
      throw new NotFoundException('Outstanding not found');
    }

    return item;
  }
}
