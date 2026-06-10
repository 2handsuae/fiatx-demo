import { Injectable, Inject, Logger, NotFoundException, BadRequestException, forwardRef } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { PricingEngineService } from '../pricing-center/pricing-engine.service';
import {
  CalculatedFeeLine,
  WITHDRAW_QUOTE_TTL_SECONDS,
} from '../pricing-center/types/pricing.types';
import { WithdrawalFeeLevelService } from './withdrawal-fee-level.service';
import { WithdrawalFeeLevelBindingService } from './withdrawal-fee-level-binding.service';
import { FeeLevelTiersConfig } from './types/fee-level.types';

interface ResolvedQuote {
  feeLevelId: string;
  feeLevelCode: string;
  matchedTierId: string;
  matchedTierName: string;
  fees: CalculatedFeeLine[];
  totals: Record<string, string>;
  totalFee: Prisma.Decimal;
}

@Injectable()
export class WithdrawQuoteService {
  private readonly logger = new Logger(WithdrawQuoteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly feeLevelService: WithdrawalFeeLevelService,
    private readonly bindingService: WithdrawalFeeLevelBindingService,
    @Inject(forwardRef(() => PricingEngineService))
    private readonly engineService: PricingEngineService,
  ) {}

  async resolveBestLevel(input: {
    assetId: string;
    amount: Prisma.Decimal;
    customerId: string;
  }): Promise<ResolvedQuote | null> {
    const allLevels = await this.feeLevelService.findActiveByAsset(input.assetId);
    if (allLevels.length === 0) return null;

    const boundLevelIds = await this.bindingService.findBoundLevelIds(input.customerId);
    const boundSet = new Set(boundLevelIds);

    const applicableLevels = allLevels.filter(
      (l) => l.isDefault || boundSet.has(l.id),
    );
    if (applicableLevels.length === 0) return null;

    // Withdrawal fees are denominated in the asset; rounding follows its decimals.
    const asset = await this.prisma.asset.findUnique({
      where: { id: input.assetId },
      select: { currency: true, decimals: true },
    });
    if (!asset) return null;

    const candidates: ResolvedQuote[] = [];

    for (const level of applicableLevels) {
      const config: FeeLevelTiersConfig = JSON.parse(level.tiersJson);
      const matchedTier = this.engineService.findMatchedWithdrawalTier({
        amount: input.amount,
        tiers: config.tiers,
      });
      if (!matchedTier) continue;

      const { lines, totals } = this.engineService.calculateFeeLines(
        input.amount,
        matchedTier.feeItems,
        asset.currency,
        asset.decimals,
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
    assetId: string;
    assetCode: string;
    amount: Prisma.Decimal;
    customerId: string;
  }) {
    const resolved = await this.resolveBestLevel({
      assetId: input.assetId,
      amount: input.amount,
      customerId: input.customerId,
    });

    if (!resolved) {
      throw new BadRequestException('No applicable fee level found for this asset and amount');
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + WITHDRAW_QUOTE_TTL_SECONDS * 1000);
    const quoteNo = `WQ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const quote = await this.prisma.withdrawPricingQuote.create({
      data: {
        quoteNo,
        status: 'ACTIVE',
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        ownerNo: input.ownerNo || null,
        assetId: input.assetId,
        assetCode: input.assetCode,
        amount: input.amount,
        segment: 'DEFAULT',
        riskTier: 'STANDARD',
        matchedAssetId: input.assetId,
        matchedTierId: resolved.matchedTierId,
        matchedTierName: resolved.matchedTierName,
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
    const quote = await db.withdrawPricingQuote.findUnique({ where: { id: quoteId } });
    if (!quote) throw new NotFoundException(`Quote ${quoteId} not found`);
    if (quote.ownerType !== ownerType || quote.ownerId !== ownerId) {
      throw new BadRequestException('Quote does not belong to this owner');
    }
    if (quote.status !== 'ACTIVE') {
      throw new BadRequestException(`Quote is ${quote.status}, not ACTIVE`);
    }
    if (quote.expiresAt < now) {
      await db.withdrawPricingQuote.update({
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
    withdrawAmount: Prisma.Decimal,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;
    const now = new Date();
    const quote = await this.getActiveQuoteOrThrow(quoteId, ownerType, ownerId, now, db as any);

    if (!quote.amount.equals(withdrawAmount)) {
      throw new BadRequestException(
        `Quote amount ${quote.amount} does not match withdraw amount ${withdrawAmount}`,
      );
    }

    return db.withdrawPricingQuote.update({
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
    const quote = await db.withdrawPricingQuote.findUnique({ where: { id: quoteId } });
    if (!quote) throw new NotFoundException(`Quote ${quoteId} not found`);
    if (quote.ownerType !== ownerType || quote.ownerId !== ownerId) {
      throw new BadRequestException('Quote does not belong to this owner');
    }
    if (quote.status !== 'ACTIVE') {
      throw new BadRequestException(`Quote is ${quote.status}, cannot cancel`);
    }
    return db.withdrawPricingQuote.update({
      where: { id: quoteId },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
  }
}
