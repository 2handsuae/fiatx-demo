import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { SwapTransactionQueryDto } from './dto/swap-transaction.dto';
import { Prisma } from '@prisma/client';
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
    private readonly pricingCenterService: PricingCenterService,
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
      grossAmountOut: resolved.grossAmountOut.toNumber(),
      netAmountOut: resolved.netAmountOut.toNumber(),
      feeTotal: resolved.feeTotal.toNumber(),
      feeCurrency: resolved.feeCurrency,
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
    const toAmount = new Prisma.Decimal(rateDetails.grossAmountOut);
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
    return item;
  }
}
