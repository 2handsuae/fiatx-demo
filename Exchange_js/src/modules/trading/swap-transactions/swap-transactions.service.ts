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
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SwapEvents } from './constants/swap-events.constant';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { AuditLogsService } from '../../risk-engine/audit-logs/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
  buildStateTransitionAction,
} from '../../risk-engine/audit-logs/constants/audit-actions.constant';
import { AuditTriggerType } from '../../risk-engine/audit-logs/dto/audit-log.dto';
import { PricingCenterService } from '../pricing-center/pricing-center.service';

interface SwapMatchedInfo {
  pairId: string;
  pairName: string;
  tierId: string;
  tierName: string;
}

interface SwapPricingSourceInfo {
  provider: 'BINANCE';
  endpoint: 'api/v3/ticker/bookTicker';
  symbol: string;
  bid: string;
  ask: string;
  sideUsed: 'BID' | 'INVERSE_ASK';
  aedPegApplied: boolean;
  aedPegRate: string;
  formula: string;
  effectiveBaseRate: string;
  fetchedAt: string;
}

export interface SwapExecutableRateResult {
  fromAssetId: string;
  toAssetId: string;
  fromAssetCode: string;
  toAssetCode: string;
  fromAssetDecimals: number;
  toAssetDecimals: number;
  marketRate: number;
  spreadPercent: number;
  executableRate: number;
  spreadBps: number;
  rateSource: string;
  fetchedAt: string;
  quoteLockSeconds: number;
  pairId: string;
  pairName: string;
  tierId: string;
  tierName: string;
  matched: SwapMatchedInfo;
  pricingSource: SwapPricingSourceInfo;
  feeBreakdown: any[];
  feeTotals: Record<string, string>;
  policyRef: {
    policyCode: string;
    policyId: string;
    business: 'SWAP';
    channel: 'ONLINE';
  };
}

export interface SwapQuoteComputationResult extends SwapExecutableRateResult {
  fromAmount: number;
  toAmount: number;
  exchangeRate: number;
  amountOut: number;
  createdAt: string;
  expiresAt: string;
}

@Injectable()
export class SwapTransactionsService {
  private readonly logger = new Logger(SwapTransactionsService.name);
  private readonly auditLogsService: AuditLogsService;

  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
    private pricingCenterService: PricingCenterService,
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

  async getExecutableRate(
    fromAssetId: string,
    toAssetId: string,
    options: {
      amount: number | string | Prisma.Decimal;
      ownerType?: string;
      ownerId?: string;
    },
  ): Promise<SwapExecutableRateResult> {
    const { fromAsset, toAsset } = await this.getSwapAssetsOrThrow(
      fromAssetId,
      toAssetId,
    );

    const amount = new Prisma.Decimal(options.amount);
    if (amount.lte(0)) {
      throw new BadRequestException('amount must be greater than 0');
    }

    const resolved = await this.pricingCenterService.resolveSwapQuoteForExecution({
      fromAssetId,
      toAssetId,
      amount,
    });
    const spreadPercent = new Prisma.Decimal(resolved.markupBps).div(100);

    return {
      fromAssetId: fromAsset.id,
      toAssetId: toAsset.id,
      fromAssetCode: fromAsset.code,
      toAssetCode: toAsset.code,
      fromAssetDecimals: resolved.fromAssetDecimals,
      toAssetDecimals: resolved.toAssetDecimals,
      marketRate: resolved.baseRate.toNumber(),
      spreadPercent: spreadPercent.toNumber(),
      executableRate: resolved.quotedRate.toNumber(),
      spreadBps: resolved.markupBps,
      rateSource: resolved.baseProvider,
      fetchedAt: resolved.fetchedAt.toISOString(),
      quoteLockSeconds: resolved.quoteLockSeconds,
      pairId: resolved.pairId,
      pairName: resolved.pairName,
      tierId: resolved.tierId,
      tierName: resolved.tierName,
      matched: {
        pairId: resolved.pairId,
        pairName: resolved.pairName,
        tierId: resolved.tierId,
        tierName: resolved.tierName,
      },
      pricingSource: resolved.pricingSource,
      feeBreakdown: resolved.fees,
      feeTotals: resolved.totals,
      policyRef: resolved.policyRef,
    };
  }

  async preview(dto: {
    fromAssetId: string;
    fromAmount: number;
    toAssetId: string;
    ownerType?: string;
    ownerId?: string;
  }): Promise<SwapQuoteComputationResult> {
    const rateDetails = await this.getExecutableRate(
      dto.fromAssetId,
      dto.toAssetId,
      {
        amount: dto.fromAmount,
        ownerType: dto.ownerType,
        ownerId: dto.ownerId,
      },
    );
    const fromAmount = new Prisma.Decimal(dto.fromAmount);
    const executableRate = new Prisma.Decimal(rateDetails.executableRate);
    const toAmount = fromAmount.mul(executableRate);
    const createdAt = new Date();
    const expiresAt = new Date(
      createdAt.getTime() + rateDetails.quoteLockSeconds * 1000,
    );

    return {
      fromAssetId: rateDetails.fromAssetId,
      fromAssetCode: rateDetails.fromAssetCode,
      fromAssetDecimals: rateDetails.fromAssetDecimals,
      fromAmount: fromAmount.toNumber(),
      toAssetId: rateDetails.toAssetId,
      toAssetCode: rateDetails.toAssetCode,
      toAssetDecimals: rateDetails.toAssetDecimals,
      toAmount: toAmount.toNumber(),
      amountOut: toAmount.toNumber(),
      exchangeRate: executableRate.toNumber(),
      executableRate: executableRate.toNumber(),
      marketRate: rateDetails.marketRate,
      spreadPercent: rateDetails.spreadPercent,
      spreadBps: rateDetails.spreadBps,
      rateSource: rateDetails.rateSource,
      fetchedAt: rateDetails.fetchedAt,
      quoteLockSeconds: rateDetails.quoteLockSeconds,
      pairId: rateDetails.pairId,
      pairName: rateDetails.pairName,
      tierId: rateDetails.tierId,
      tierName: rateDetails.tierName,
      matched: rateDetails.matched,
      pricingSource: rateDetails.pricingSource,
      feeBreakdown: rateDetails.feeBreakdown,
      feeTotals: rateDetails.feeTotals,
      policyRef: rateDetails.policyRef,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
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
