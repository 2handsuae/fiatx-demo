import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  SwapTransactionQueryDto,
  SwapTransactionStatus,
} from './dto/swap-transaction.dto';
import { Prisma } from '@prisma/client';
import axios from 'axios';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SwapEvents } from './constants/swap-events.constant';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { CustomerSwapRatesService } from '../../identity/customer-swap-rates/customer-swap-rates.service';
import { AuditLogsService } from '../../risk-engine/audit-logs/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
  buildStateTransitionAction,
} from '../../risk-engine/audit-logs/constants/audit-actions.constant';
import { AuditTriggerType } from '../../risk-engine/audit-logs/dto/audit-log.dto';

export interface SwapExecutableRateResult {
  fromAssetId: string;
  toAssetId: string;
  fromAssetCode: string;
  toAssetCode: string;
  marketRate: number;
  spreadPercent: number;
  executableRate: number;
  rateSource: 'BINANCE';
  fetchedAt: string;
}

@Injectable()
export class SwapTransactionsService {
  private readonly logger = new Logger(SwapTransactionsService.name);
  private readonly AED_USD_RATE = 3.6725;
  private readonly auditLogsService: AuditLogsService;

  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
    private customerSwapRatesService: CustomerSwapRatesService,
  ) {
    this.auditLogsService = new AuditLogsService(prisma);
  }

  private resolveActor(operatorId: string) {
    if (operatorId === 'SYSTEM') {
      return { actorType: 'SYSTEM', actorId: 'SYSTEM', actorRole: 'SYSTEM' };
    }
    return { actorType: 'ADMIN', actorId: operatorId, actorRole: 'ADMIN' };
  }

  async create(dto: {
    ownerType: string;
    ownerId: string;
    fromAssetId: string;
    fromAmount: number;
    toAssetId: string;
    toAmount: number;
    exchangeRate: number;
  }) {
    const swapNo = generateReferenceNo('SWP');

    // Fetch related entities to populate denormalized fields
    const fromAsset = await (this.prisma as any).asset.findUnique({ where: { id: dto.fromAssetId } });
    const toAsset = await (this.prisma as any).asset.findUnique({ where: { id: dto.toAssetId } });
    
    let ownerNo = null;
    if (dto.ownerType === 'CUSTOMER') {
        const customer = await (this.prisma as any).customerMain.findUnique({ where: { id: dto.ownerId } });
        if (customer) ownerNo = customer.customerNo;
    }

    const swap = await (this.prisma as any).swapTransaction.create({
      data: {
        swapNo,
        ownerType: dto.ownerType,
        ownerId: dto.ownerId,
        ownerNo,
        status: SwapTransactionStatus.PENDING_COMPLIANCE,
        fromAssetId: dto.fromAssetId,
        fromAssetCode: fromAsset?.code,
        fromAmount: new Prisma.Decimal(dto.fromAmount),
        toAssetId: dto.toAssetId,
        toAssetCode: toAsset?.code,
        toAmount: new Prisma.Decimal(dto.toAmount),
        exchangeRate: new Prisma.Decimal(dto.exchangeRate),
        statusHistory: JSON.stringify([{
            status: SwapTransactionStatus.PENDING_COMPLIANCE,
            timestamp: new Date().toISOString(),
            operator: 'SYSTEM',
            note: 'Swap created'
        }]),
      },
    });

    this.logger.log(`Swap created: ${swap.id} (${swap.swapNo})`);
    await this.auditLogsService.recordSystem({
      triggerType: AuditTriggerType.DATA_CREATE,
      action: AuditActions.SWAP_CREATED,
      module: AuditModules.SWAP_TRANSACTIONS,
      entityType: AuditEntityTypes.SWAP_TRANSACTION,
      entityId: swap.id,
      entityNo: swap.swapNo || undefined,
      entityOwnerType: swap.ownerType,
      entityOwnerId: swap.ownerId,
      afterData: {
        status: swap.status,
        fromAssetId: swap.fromAssetId,
        toAssetId: swap.toAssetId,
        fromAmount: swap.fromAmount?.toString?.(),
        toAmount: swap.toAmount?.toString?.(),
      },
      sourcePlatform: 'SYSTEM',
    });
    this.eventEmitter.emit(SwapEvents.EVT_SWAP_CREATED, { swapId: swap.id });

    return swap;
  }

  async updateStatus(
    id: string,
    newStatus: SwapTransactionStatus,
    operatorId: string = 'SYSTEM',
    reason?: string,
  ) {
    const swap = await this.findOne(id);
    const oldStatus = swap.status as SwapTransactionStatus;

    if (oldStatus === newStatus) return swap;

    const updatedSwap = await this.prisma.$transaction(async (tx) => {
        // Parse existing history
        let history: any[] = [];
        try {
            if (swap.statusHistory) {
                history = JSON.parse(swap.statusHistory);
            }
        } catch (e) {
            // ignore parse error
        }

        // Add new entry
        history.push({
            status: newStatus,
            timestamp: new Date().toISOString(),
            operator: operatorId,
            note: reason || `Status changed from ${oldStatus} to ${newStatus}`
        });

      const updated = await (tx as any).swapTransaction.update({
        where: { id },
        data: {
          status: newStatus,
          statusHistory: JSON.stringify(history),
          completedAt:
            newStatus === SwapTransactionStatus.SUCCESS ? new Date() : null,
        },
      });

      await this.auditLogsService.recordByActor(
        {
          triggerType: AuditTriggerType.STATE_TRANSITION,
          action: buildStateTransitionAction('SWAP', oldStatus, newStatus),
          module: AuditModules.SWAP_TRANSACTIONS,
          entityType: AuditEntityTypes.SWAP_TRANSACTION,
          entityId: updated.id,
          entityNo: updated.swapNo || undefined,
          entityOwnerType: updated.ownerType,
          entityOwnerId: updated.ownerId,
          statusFrom: oldStatus,
          statusTo: newStatus,
          reason,
          beforeData: { status: oldStatus },
          afterData: { status: newStatus },
          sourcePlatform: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN_API',
        },
        this.resolveActor(operatorId),
        tx as Prisma.TransactionClient,
      );

      return updated;
    });

    this.logger.log(`Swap ${id} status changed: ${oldStatus} -> ${newStatus}`);

    // Emit Specific Events
    if (newStatus === SwapTransactionStatus.SUCCESS) {
      this.eventEmitter.emit(SwapEvents.EVT_SWAP_SUCCESS, {
        swapId: id,
        oldStatus,
      });
    } else if (newStatus === SwapTransactionStatus.REJECTED) {
      this.eventEmitter.emit(SwapEvents.EVT_SWAP_REJECTED, {
        swapId: id,
        oldStatus,
        reason,
      });
    }

    return updatedSwap;
  }

  async fetchMarketRate(
    fromCode: string,
    toCode: string,
  ): Promise<Prisma.Decimal> {
    // 1. Map USD/AED to USDT for Binance
    const getBinanceCode = (code: string) => {
      if (code === 'USD' || code === 'AED') return 'USDT';
      return code;
    };

    const bFrom = getBinanceCode(fromCode);
    const bTo = getBinanceCode(toCode);

    let rate: Prisma.Decimal | null = null;

    if (fromCode === toCode) {
      rate = new Prisma.Decimal(1);
    } else if (bFrom === bTo) {
      // For cases like AED to USDT or USD to USDT, they map to the same Binance code
      rate = new Prisma.Decimal(1);
    } else {
      const pair = `${bFrom}${bTo}`;
      const reversePair = `${bTo}${bFrom}`;

      // Try forward direction
      try {
        const response = await axios.get(
          `https://api.binance.com/api/v3/ticker/price?symbol=${pair}`,
        );
        rate = new Prisma.Decimal(response.data.price);
        this.logger.log(`[Rate Query] Success: ${pair} = ${rate.toString()}`);
      } catch (e) {
        this.logger.warn(
          `[Rate Query] Forward pair ${pair} failed, trying inverse...`,
        );
        // Try inverse direction
        try {
          const response = await axios.get(
            `https://api.binance.com/api/v3/ticker/price?symbol=${reversePair}`,
          );
          const revRate = new Prisma.Decimal(response.data.price);
          rate = new Prisma.Decimal(1).div(revRate);
          this.logger.log(
            `[Rate Query] Success (Inverse): ${reversePair} = ${revRate.toString()}, converted to ${pair} = ${rate.toString()}`,
          );
        } catch (e2) {
          this.logger.error(
            `[Rate Query] Both ${pair} and ${reversePair} failed.`,
          );
        }
      }
    }

    if (!rate) {
      throw new BadRequestException(
        `Market rate not available for ${fromCode}/${toCode} in either direction`,
      );
    }

    // 2. Apply AED Bridge
    const aedUsdRate = new Prisma.Decimal(this.AED_USD_RATE);
    if (fromCode === 'AED') {
      rate = rate.div(aedUsdRate);
    }
    if (toCode === 'AED') {
      rate = rate.mul(aedUsdRate);
    }

    return rate;
  }

  private async getSwapAssetsOrThrow(fromAssetId: string, toAssetId: string) {
    const [fromAsset, toAsset] = await Promise.all([
      (this.prisma as any).asset.findUnique({
        where: { id: fromAssetId },
      }),
      (this.prisma as any).asset.findUnique({
        where: { id: toAssetId },
      }),
    ]);

    if (!fromAsset || !toAsset) {
      throw new NotFoundException('Asset not found');
    }

    if (fromAsset.type === 'FIAT' && toAsset.type === 'FIAT') {
      throw new BadRequestException('Fiat to Fiat swap is not supported');
    }

    return { fromAsset, toAsset };
  }

  async getExecutableRate(fromAssetId: string, toAssetId: string): Promise<SwapExecutableRateResult> {
    const { fromAsset, toAsset } = await this.getSwapAssetsOrThrow(
      fromAssetId,
      toAssetId,
    );

    const config = await this.customerSwapRatesService.resolveActiveRateForPair(
      fromAsset.id,
      toAsset.id,
    );

    const marketRate = await this.fetchMarketRate(fromAsset.code, toAsset.code);
    const spreadPercent = new Prisma.Decimal(config.spreadPercent || 0);
    const spreadMultiplier = new Prisma.Decimal(1).add(
      spreadPercent.div(100),
    );
    const executableRate = marketRate.mul(spreadMultiplier);

    return {
      fromAssetId: fromAsset.id,
      toAssetId: toAsset.id,
      fromAssetCode: fromAsset.code,
      toAssetCode: toAsset.code,
      marketRate: marketRate.toNumber(),
      spreadPercent: spreadPercent.toNumber(),
      executableRate: executableRate.toNumber(),
      rateSource: 'BINANCE',
      fetchedAt: new Date().toISOString(),
    };
  }

  async preview(dto: {
    fromAssetId: string;
    fromAmount: number;
    toAssetId: string;
  }) {
    const rateDetails = await this.getExecutableRate(
      dto.fromAssetId,
      dto.toAssetId,
    );
    const fromAmount = new Prisma.Decimal(dto.fromAmount);
    const executableRate = new Prisma.Decimal(rateDetails.executableRate);
    const toAmount = fromAmount.mul(executableRate);

    return {
      fromAssetId: rateDetails.fromAssetId,
      fromAssetCode: rateDetails.fromAssetCode,
      fromAmount: fromAmount.toNumber(),
      toAssetId: rateDetails.toAssetId,
      toAssetCode: rateDetails.toAssetCode,
      toAmount: toAmount.toNumber(),
      exchangeRate: executableRate.toNumber(),
      marketRate: rateDetails.marketRate,
      spreadPercent: rateDetails.spreadPercent,
      rateSource: rateDetails.rateSource,
      fetchedAt: rateDetails.fetchedAt,
    };
  }

  async findAll(query: SwapTransactionQueryDto) {
    const {
      skip,
      take,
      swapNo,
      ownerId,
      ownerType,
      status,
      startDate,
      endDate,
    } = query;
    const where: any = {};

    if (swapNo) where.swapNo = { contains: swapNo };
    if (ownerId) where.ownerId = ownerId;
    if (ownerType) where.ownerType = ownerType;
    if (status) where.status = status;

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [items, total] = await Promise.all([
      (this.prisma as any).swapTransaction.findMany({
        skip: skip ? Number(skip) : 0,
        take: take ? Number(take) : 20,
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          fromAsset: true,
          toAsset: true,
          customer: true,
        },
      }),
      (this.prisma as any).swapTransaction.count({ where }),
    ]);

    return { items, total };
  }

  async findOne(id: string) {
    const item = await (this.prisma as any).swapTransaction.findUnique({
      where: { id },
      include: {
        fromAsset: true,
        toAsset: true,
        customer: true,
        auditLogs: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!item) throw new NotFoundException('Swap transaction not found');
    return item;
  }
}
