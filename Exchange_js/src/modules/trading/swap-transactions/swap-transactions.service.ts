import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { SwapTransactionQueryDto } from './dto/swap-transaction.dto';
import { Prisma } from '@prisma/client';
import { SwapQuoteService } from '../swap-fee-level/swap-quote.service';
import { BinanceRateProvider } from '../pricing-center/providers/binance-rate.provider';

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
  fromAssetCurrency: string;
  toAssetCurrency: string;
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
  grossAmountOut: number;
  netAmountOut: number;
  feeTotal: number;
  feeCurrency: string | null;
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly swapQuoteService: SwapQuoteService,
    private readonly binanceRateProvider: BinanceRateProvider,
  ) {}

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

    const resolved = await this.swapQuoteService.resolveBestLevel({
      fromAssetId,
      toAssetId,
      amount,
      customerId: options.ownerId || '',
    });

    if (!resolved) {
      throw new BadRequestException('No applicable fee level found for this currency pair and amount');
    }

    const rateResult = await this.binanceRateProvider.fetchRate(
      fromAsset.currency,
      toAsset.currency,
    );

    const marketRate = rateResult.rate;
    // Spread is the platform margin: customer receives a worse-than-market rate.
    const markupMultiplier = new Prisma.Decimal(1).sub(
      new Prisma.Decimal(resolved.rateMarkupBps).div(10000),
    );
    const executableRate = marketRate.mul(markupMultiplier);
    const grossAmountOut = amount.mul(executableRate);
    const netAmountOut = grossAmountOut.minus(resolved.totalFee);
    const spreadPercent = new Prisma.Decimal(resolved.rateMarkupBps).div(100);

    return {
      fromAssetId: fromAsset.id,
      toAssetId: toAsset.id,
      fromAssetCurrency: fromAsset.currency,
      toAssetCurrency: toAsset.currency,
      fromAssetDecimals: fromAsset.decimals,
      toAssetDecimals: toAsset.decimals,
      marketRate: marketRate.toNumber(),
      spreadPercent: spreadPercent.toNumber(),
      executableRate: executableRate.toNumber(),
      spreadBps: resolved.rateMarkupBps,
      rateSource: 'BINANCE',
      fetchedAt: rateResult.fetchedAt.toISOString(),
      quoteLockSeconds: 30,
      pairId: resolved.feeLevelCode,
      pairName: resolved.feeLevelCode,
      tierId: resolved.matchedTierId,
      tierName: resolved.matchedTierName,
      matched: {
        pairId: resolved.feeLevelCode,
        pairName: resolved.feeLevelCode,
        tierId: resolved.matchedTierId,
        tierName: resolved.matchedTierName,
      },
      pricingSource: {
        provider: 'BINANCE' as const,
        endpoint: 'api/v3/ticker/bookTicker' as const,
        symbol: rateResult.symbol,
        bid: rateResult.bid,
        ask: rateResult.ask,
        sideUsed: rateResult.sideUsed,
        aedPegApplied: rateResult.aedPegApplied,
        aedPegRate: rateResult.aedPegRate,
        formula: rateResult.formula,
        effectiveBaseRate: rateResult.rate.toString(),
        fetchedAt: rateResult.fetchedAt.toISOString(),
      },
      feeBreakdown: resolved.fees,
      feeTotals: resolved.totals,
      grossAmountOut: grossAmountOut.toNumber(),
      netAmountOut: netAmountOut.toNumber(),
      feeTotal: resolved.totalFee.toNumber(),
      feeCurrency: Object.keys(resolved.totals).find((k) => !['amountIn', 'amountOutGross', 'amountOutNet', 'feeTotal', 'feeCurrency'].includes(k)) || null,
      policyRef: {
        policyCode: `LEVEL:${resolved.feeLevelCode}`,
        policyId: resolved.feeLevelId,
        business: 'SWAP' as const,
        channel: 'ONLINE' as const,
      },
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
    const toAmount = new Prisma.Decimal(rateDetails.grossAmountOut);
    const createdAt = new Date();
    const expiresAt = new Date(
      createdAt.getTime() + rateDetails.quoteLockSeconds * 1000,
    );

    return {
      fromAssetId: rateDetails.fromAssetId,
      fromAssetCurrency: rateDetails.fromAssetCurrency,
      fromAssetDecimals: rateDetails.fromAssetDecimals,
      fromAmount: fromAmount.toNumber(),
      toAssetId: rateDetails.toAssetId,
      toAssetCurrency: rateDetails.toAssetCurrency,
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
      grossAmountOut: rateDetails.grossAmountOut,
      netAmountOut: rateDetails.netAmountOut,
      feeTotal: rateDetails.feeTotal,
      feeCurrency: rateDetails.feeCurrency,
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

  async findByNoInternal(swapNo: string, tx?: Prisma.TransactionClient) {
    const client: any = tx ?? this.prisma;
    return client.swapTransaction.findUniqueOrThrow({
      where: { swapNo },
      include: { fromAsset: true, toAsset: true },
    });
  }

  async markStatus(swapId: string, status: string, tx: Prisma.TransactionClient) {
    let statusHistory: any[] = [];
    try {
      const current = await (tx as any).swapTransaction.findUnique({ where: { id: swapId }, select: { statusHistory: true } });
      if (current?.statusHistory) {
        statusHistory = JSON.parse(current.statusHistory);
        if (!Array.isArray(statusHistory)) statusHistory = [];
      }
    } catch {
      statusHistory = [];
    }
    statusHistory.push({
      status,
      timestamp: new Date().toISOString(),
      operator: 'SYSTEM',
      note: `Swap settlement status → ${status}`,
    });
    return (tx as any).swapTransaction.update({
      where: { id: swapId },
      data: {
        status,
        completedAt: status === 'SUCCESS' ? new Date() : undefined,
        statusHistory: JSON.stringify(statusHistory),
      },
    });
  }

  async findOne(id: string) {
    const item = await (this.prisma as any).swapTransaction.findUnique({
      where: { id },
      include: {
        fromAsset: true,
        toAsset: true,
        customer: true,
      },
    });
    if (!item) throw new NotFoundException('Swap transaction not found');

    // Real-time model: the swap's InternalFund legs are hung directly on the
    // swap via swapTransactionId. Surface them (ordered by legSeq then attempt)
    // so the detail page can list + link through to each fund order, including
    // failed-attempt history rows.
    const internalFunds = await (this.prisma as any).internalFund.findMany({
      where: { swapTransactionId: item.id },
      orderBy: [{ legSeq: 'asc' }, { attempt: 'asc' }],
      select: {
        id: true,
        internalFundNo: true,
        legSeq: true,
        attempt: true,
        status: true,
        amount: true,
        asset: { select: { currency: true, decimals: true } },
        fromWallet: { select: { walletRole: true } },
        toWallet: { select: { walletRole: true } },
      },
    });

    return { ...item, internalFunds };
  }

  /** Active leg per legSeq = the row with the MAX attempt for that legSeq. */
  async activeLegsBySeq(swapId: string, tx?: Prisma.TransactionClient) {
    const client: any = tx ?? this.prisma;
    const rows = await client.internalFund.findMany({
      where: { swapTransactionId: swapId },
      orderBy: [{ legSeq: 'asc' }, { attempt: 'desc' }],
    });
    const seen = new Set<number>();
    const active: any[] = [];
    for (const r of rows) {
      const seq = r.legSeq ?? 0;
      if (!seen.has(seq)) { seen.add(seq); active.push(r); }
    }
    return active; // one row per legSeq (max attempt)
  }

  /**
   * Recompute the operator-facing projections from the active legs and persist them.
   * currentStage = role of the lowest-legSeq active leg that is NOT yet CLEAR (null if all CLEAR);
   * needsReview = any active leg is NEEDS_REVIEW. stageOf maps a legSeq → a display stage string.
   */
  async recomputeProjections(
    swapId: string,
    stageOf: (legSeq: number) => string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const active = await this.activeLegsBySeq(swapId, tx);
    const needsReview = active.some((l) => l.status === 'NEEDS_REVIEW');
    const working = active
      .filter((l) => l.status !== 'CLEAR')
      .sort((a, b) => (a.legSeq ?? 0) - (b.legSeq ?? 0))[0];
    const currentStage = working ? stageOf(working.legSeq) : null;
    await (tx as any).swapTransaction.update({
      where: { id: swapId },
      data: { currentStage, needsReview },
    });
  }

  async create(
    input: {
      swapNo: string;
      quoteId: string;
      quoteNo: string | null;
      ownerType: string;
      ownerId: string;
      ownerNo: string | null;
      fromAssetId: string;
      fromAssetCode: string | null;
      fromAmount: Prisma.Decimal;
      toAssetId: string;
      toAssetCode: string | null;
      toAmount: Prisma.Decimal;
      netToAmount: Prisma.Decimal;
      feeAmount: Prisma.Decimal;
      feeCurrency: string | null;
      feeBreakdown: string | null;
      spreadAmount: Prisma.Decimal;
      exchangeRate: Prisma.Decimal;
      tbFromTransferId?: string | null;
      tbToTransferId?: string | null;
      tbFeeTransferId?: string | null;
      tbSpreadTransferId?: string | null;
      traceId: string;
    },
    tx: Prisma.TransactionClient,
  ) {
    return tx.swapTransaction.create({
      data: {
        swapNo: input.swapNo,
        quoteId: input.quoteId,
        quoteNo: input.quoteNo,
        quoteSnapshotRef: input.quoteId,
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        ownerNo: input.ownerNo,
        status: 'PROCESSING',
        fromAssetId: input.fromAssetId,
        fromAssetCode: input.fromAssetCode,
        fromAmount: input.fromAmount,
        toAssetId: input.toAssetId,
        toAssetCode: input.toAssetCode,
        toAmount: input.toAmount,
        netToAmount: input.netToAmount,
        feeAmount: input.feeAmount,
        feeCurrency: input.feeCurrency,
        feeBreakdown: input.feeBreakdown,
        spreadAmount: input.spreadAmount,
        exchangeRate: input.exchangeRate,
        tbFromTransferId: input.tbFromTransferId ?? null,
        tbToTransferId: input.tbToTransferId ?? null,
        tbFeeTransferId: input.tbFeeTransferId ?? null,
        tbSpreadTransferId: input.tbSpreadTransferId ?? null,
        traceId: input.traceId,
        completedAt: null,
        statusHistory: JSON.stringify([
          {
            status: 'PROCESSING',
            timestamp: new Date().toISOString(),
            operator: input.ownerId,
            source: 'CUSTOMER',
            note: 'Swap created; processing (legs pending)',
          },
        ]),
      },
      include: { fromAsset: true, toAsset: true },
    });
  }
}
