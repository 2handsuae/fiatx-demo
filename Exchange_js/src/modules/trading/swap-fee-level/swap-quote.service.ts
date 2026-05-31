import { Injectable, Inject, Logger, NotFoundException, BadRequestException, forwardRef } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { PricingEngineService } from '../pricing-center/pricing-engine.service';
import {
  CalculatedFeeLine,
} from '../pricing-center/types/pricing.types';
import { SwapFeeLevelService } from './swap-fee-level.service';
import { SwapFeeLevelBindingService } from './swap-fee-level-binding.service';
import { SwapFeeLevelTiersConfig } from './types/fee-level.types';

const SWAP_QUOTE_TTL_SECONDS = 30;

interface ResolvedSwapQuote {
  feeLevelId: string;
  feeLevelCode: string;
  matchedTierId: string;
  matchedTierName: string;
  rateMarkupBps: number;
  fees: CalculatedFeeLine[];
  totals: Record<string, string>;
  totalFee: Prisma.Decimal;
}

@Injectable()
export class SwapQuoteService {
  private readonly logger = new Logger(SwapQuoteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly feeLevelService: SwapFeeLevelService,
    private readonly bindingService: SwapFeeLevelBindingService,
    @Inject(forwardRef(() => PricingEngineService))
    private readonly engineService: PricingEngineService,
  ) {}

  async resolveBestLevel(input: {
    fromAssetId: string;
    toAssetId: string;
    amount: Prisma.Decimal;
    customerId: string;
  }): Promise<ResolvedSwapQuote | null> {
    const allLevels = await this.feeLevelService.findActiveByPair(input.fromAssetId, input.toAssetId);
    if (allLevels.length === 0) return null;

    const boundLevelIds = await this.bindingService.findBoundLevelIds(input.customerId);
    const boundSet = new Set(boundLevelIds);

    const applicableLevels = allLevels.filter(
      (l) => l.isDefault || boundSet.has(l.id),
    );
    if (applicableLevels.length === 0) return null;

    const candidates: ResolvedSwapQuote[] = [];

    for (const level of applicableLevels) {
      const config: SwapFeeLevelTiersConfig = JSON.parse(level.tiersJson);
      const matchedTier = this.engineService.findMatchedSwapTier({
        amount: input.amount,
        tiers: config.tiers,
      });
      if (!matchedTier) continue;

      const { lines, totals } = this.engineService.calculateFeeLines(
        input.amount,
        matchedTier.feeItems,
      );

      const totalFee = lines.reduce(
        (sum, line) => sum.add(new Prisma.Decimal(line.amount)),
        new Prisma.Decimal(0),
      );

      candidates.push({
        feeLevelId: level.id,
        feeLevelCode: level.levelCode,
        matchedTierId: matchedTier.id,
        matchedTierName: matchedTier.name,
        rateMarkupBps: matchedTier.rateMarkupBps,
        fees: lines,
        totals,
        totalFee,
      });
    }

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => a.totalFee.comparedTo(b.totalFee));
    return candidates[0];
  }

  async createQuote(input: {
    ownerType: string;
    ownerId: string;
    ownerNo?: string;
    fromAssetId: string;
    fromAssetCode: string;
    toAssetId: string;
    toAssetCode: string;
    amount: Prisma.Decimal;
    customerId: string;
  }) {
    const resolved = await this.resolveBestLevel({
      fromAssetId: input.fromAssetId,
      toAssetId: input.toAssetId,
      amount: input.amount,
      customerId: input.customerId,
    });

    if (!resolved) {
      throw new BadRequestException('No applicable fee level found for this currency pair and amount');
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + SWAP_QUOTE_TTL_SECONDS * 1000);
    const quoteNo = `SQ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const quote = await this.prisma.swapQuote.create({
      data: {
        quoteNo,
        status: 'ACTIVE',
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        ownerNo: input.ownerNo || null,
        fromAssetId: input.fromAssetId,
        fromAssetCode: input.fromAssetCode,
        toAssetId: input.toAssetId,
        toAssetCode: input.toAssetCode,
        amountIn: input.amount,
        amountOut: new Prisma.Decimal(0),
        currencyIn: input.fromAssetCode,
        currencyOut: input.toAssetCode,
        rateDisplay: new Prisma.Decimal(0),
        rateAllIn: new Prisma.Decimal(0),
        marketRate: new Prisma.Decimal(0),
        spreadBps: resolved.rateMarkupBps,
        spreadPercent: new Prisma.Decimal(resolved.rateMarkupBps).div(100),
        fetchedAt: now,
        feeTotal: resolved.totalFee,
        feeCurrency: input.toAssetCode,
        feeBreakdown: JSON.stringify(resolved.fees),
        totalsJson: JSON.stringify(resolved.totals),
        policyRef: `LEVEL:${resolved.feeLevelCode}`,
        expiresAt,
        feeLevelId: resolved.feeLevelId,
        feeLevelCode: resolved.feeLevelCode,
      },
    });

    return quote;
  }

  async getActiveQuoteOrThrow(
    quoteId: string,
    ownerType: string,
    ownerId: string,
    now: Date,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;
    const quote = await db.swapQuote.findUnique({ where: { id: quoteId } });
    if (!quote) throw new NotFoundException(`Quote ${quoteId} not found`);
    if (quote.ownerType !== ownerType || quote.ownerId !== ownerId) {
      throw new BadRequestException('Quote does not belong to this owner');
    }
    if (quote.status !== 'ACTIVE') {
      throw new BadRequestException(`Quote is ${quote.status}, not ACTIVE`);
    }
    if (quote.expiresAt < now) {
      await db.swapQuote.update({
        where: { id: quoteId },
        data: { status: 'EXPIRED' },
      });
      throw new BadRequestException('Quote has expired');
    }
    return quote;
  }

  async consumeQuote(
    quoteId: string,
    ownerType: string,
    ownerId: string,
    amount: Prisma.Decimal,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;
    const now = new Date();
    const quote = await this.getActiveQuoteOrThrow(quoteId, ownerType, ownerId, now, db as any);

    if (!quote.amountIn.equals(amount)) {
      throw new BadRequestException(
        `Quote amount ${quote.amountIn} does not match input amount ${amount}`,
      );
    }

    return db.swapQuote.update({
      where: { id: quoteId },
      data: { status: 'USED', usedAt: now },
    });
  }

  async cancelQuote(
    quoteId: string,
    ownerType: string,
    ownerId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;
    const quote = await db.swapQuote.findUnique({ where: { id: quoteId } });
    if (!quote) throw new NotFoundException(`Quote ${quoteId} not found`);
    if (quote.ownerType !== ownerType || quote.ownerId !== ownerId) {
      throw new BadRequestException('Quote does not belong to this owner');
    }
    if (quote.status !== 'ACTIVE') {
      throw new BadRequestException(`Quote is ${quote.status}, cannot cancel`);
    }
    return db.swapQuote.update({
      where: { id: quoteId },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
  }
}
