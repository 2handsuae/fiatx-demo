import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  forwardRef,
} from '@nestjs/common';
import { Prisma, SwapQuote } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { PricingEngineService } from '../pricing-center/pricing-engine.service';
import { BinanceRateProvider } from '../pricing-center/providers/binance-rate.provider';
import {
  CalculatedFeeLine,
  FeeItem,
} from '../pricing-center/types/pricing.types';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';
import { SwapFeeLevelService } from './swap-fee-level.service';
import { SwapFeeLevelBindingService } from './swap-fee-level-binding.service';
import { SwapFeeLevelTiersConfig } from './types/fee-level.types';
import { AdminSwapQuoteQueryDto } from '../swap-transactions/dto/swap-quote.dto';

const SWAP_QUOTE_TTL_SECONDS = 30;
const QUOTE_NO_MAX_RETRIES = 5;

export interface ResolvedSwapLevel {
  feeLevelId: string;
  feeLevelCode: string;
  matchedTierId: string;
  matchedTierName: string;
  rateMarkupBps: number;
  feeItems: FeeItem[];
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
    @Inject(forwardRef(() => BinanceRateProvider))
    private readonly binanceRateProvider: BinanceRateProvider,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async resolveBestLevel(input: {
    fromAssetId: string;
    toAssetId: string;
    amount: Prisma.Decimal;
    customerId: string;
  }): Promise<ResolvedSwapLevel | null> {
    const allLevels = await this.feeLevelService.findActiveByPair(input.fromAssetId, input.toAssetId);
    if (allLevels.length === 0) return null;

    const boundLevelIds = await this.bindingService.findBoundLevelIds(input.customerId);
    const boundSet = new Set(boundLevelIds);

    const applicableLevels = allLevels.filter(
      (l) => l.isDefault || boundSet.has(l.id),
    );
    if (applicableLevels.length === 0) return null;

    // Swap fees are denominated in the to-asset; rounding follows its decimals.
    const toAsset = await this.prisma.asset.findUnique({
      where: { id: input.toAssetId },
      select: { currency: true, decimals: true },
    });
    if (!toAsset) return null;

    const candidates: ResolvedSwapLevel[] = [];

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
        toAsset.currency,
        toAsset.decimals,
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
        feeItems: matchedTier.feeItems,
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
    sourcePlatform?: string;
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

    const externalRate = await this.binanceRateProvider.fetchRate(
      input.fromAssetCode,
      input.toAssetCode,
    );

    const now = new Date();

    const toAsset = await this.prisma.asset.findUnique({
      where: { id: input.toAssetId },
      select: { decimals: true },
    });

    const pricingResult = this.engineService.buildSwapQuote({
      amount: input.amount,
      baseRate: externalRate.rate,
      markupBps: resolved.rateMarkupBps,
      roundingDp: 8,
      roundingMode: 'ROUND',
      quoteLockSeconds: SWAP_QUOTE_TTL_SECONDS,
      fees: resolved.feeItems,
      feeCurrency: input.toAssetCode,
      feeDecimals: toAsset?.decimals ?? 8,
      createdAt: now,
      pairId: `${input.fromAssetId}_${input.toAssetId}`,
      pairName: `${input.fromAssetCode}/${input.toAssetCode}`,
      tierId: resolved.matchedTierId,
      tierName: resolved.matchedTierName,
      baseProvider: 'BINANCE',
      policyCode: `LEVEL:${resolved.feeLevelCode}`,
      policyId: resolved.feeLevelId,
    });

    const marketRate = new Prisma.Decimal(pricingResult.fx.baseRate);
    const rateAllIn = new Prisma.Decimal(pricingResult.fx.quotedRate);
    const grossAmountOut = new Prisma.Decimal(pricingResult.grossAmountOut);
    const feeTotal = new Prisma.Decimal(pricingResult.feeTotal);
    const spreadPercent = new Prisma.Decimal(resolved.rateMarkupBps).div(100);

    const feeBreakdown = JSON.stringify([
      {
        policyRef: pricingResult.policyRef,
        matched: pricingResult.matched,
        fx: {
          ...pricingResult.fx,
          endpoint: 'api/v3/ticker/bookTicker',
          symbol: externalRate.symbol,
          bid: externalRate.bid,
          ask: externalRate.ask,
          sideUsed: externalRate.sideUsed,
          aedPegApplied: externalRate.aedPegApplied,
          aedPegRate: externalRate.aedPegRate,
          formula: externalRate.formula,
          effectiveBaseRate: externalRate.rate.toString(),
          fetchedAt: externalRate.fetchedAt.toISOString(),
        },
        fees: pricingResult.fees,
        totals: pricingResult.totals,
      },
    ]);

    const traceId = randomUUID();

    const created = await this.createWithUniqueNo({
      quoteType: 'FIRM',
      status: 'ACTIVE',
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      ownerNo: input.ownerNo || null,
      fromAssetId: input.fromAssetId,
      fromAssetCode: input.fromAssetCode,
      toAssetId: input.toAssetId,
      toAssetCode: input.toAssetCode,
      side: 'SELL_BASE',
      amountType: 'EXACT_IN',
      amountIn: input.amount,
      currencyIn: input.fromAssetCode,
      amountOut: grossAmountOut,
      currencyOut: input.toAssetCode,
      rateDisplay: rateAllIn,
      rateAllIn,
      marketRate,
      spreadPercent,
      spreadBps: resolved.rateMarkupBps,
      rateSource: 'BINANCE',
      fetchedAt: externalRate.fetchedAt,
      feeTotal,
      feeCurrency: pricingResult.feeCurrency || input.toAssetCode,
      feeBreakdown,
      totalsJson: JSON.stringify(pricingResult.totals),
      policyRef: JSON.stringify(pricingResult.policyRef),
      feeLevelId: resolved.feeLevelId,
      feeLevelCode: resolved.feeLevelCode,
      expiresAt: new Date(pricingResult.expiresAt),
      traceId,
    });

    const platform = input.sourcePlatform || (input.ownerType === 'CUSTOMER' ? 'CUSTOMER_API' : 'SYSTEM');

    await this.auditLogsService.recordByActor(
      {
        action: AuditActions.SWAP_QUOTE_CREATED,
        entityType: AuditEntityTypes.SWAP_QUOTE,
        entityId: created.id,
        entityNo: created.quoteNo || undefined,
        entityOwnerType: created.ownerType,
        entityOwnerId: created.ownerId,
        entityOwnerNo: created.ownerNo || undefined,
        result: AuditResult.SUCCESS,
        reason: 'Swap quote created',
        sourcePlatform: platform,
        traceId,
      },
      {
        actorType: input.ownerType === 'CUSTOMER' ? 'CUSTOMER' : input.ownerType === 'ADMIN' ? 'ADMIN' : 'SYSTEM',
        actorId: input.ownerId,
        actorNo: created.ownerNo || undefined,
        actorRole: input.ownerType === 'CUSTOMER' ? 'CUSTOMER' : input.ownerType === 'ADMIN' ? 'ADMIN' : 'SYSTEM',
      },
    );

    return created;
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
      await this.markExpired(quoteId, db);
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

    const updated = await db.swapQuote.update({
      where: { id: quoteId },
      data: { status: 'USED', usedAt: now },
    });

    await this.auditLogsService.recordByActor(
      {
        action: AuditActions.SWAP_QUOTE_USED,
        entityType: AuditEntityTypes.SWAP_QUOTE,
        entityId: updated.id,
        entityNo: updated.quoteNo || undefined,
        entityOwnerType: updated.ownerType,
        entityOwnerId: updated.ownerId,
        entityOwnerNo: updated.ownerNo || undefined,
        result: AuditResult.SUCCESS,
        reason: 'Swap quote consumed',
      },
      {
        actorType: ownerType === 'CUSTOMER' ? 'CUSTOMER' : ownerType === 'ADMIN' ? 'ADMIN' : 'SYSTEM',
        actorId: ownerId,
        actorNo: updated.ownerNo || undefined,
        actorRole: ownerType === 'CUSTOMER' ? 'CUSTOMER' : ownerType === 'ADMIN' ? 'ADMIN' : 'SYSTEM',
      },
      tx as any,
    );

    return updated;
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

    const updated = await db.swapQuote.update({
      where: { id: quoteId },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });

    await this.auditLogsService.recordByActor(
      {
        action: AuditActions.SWAP_QUOTE_CANCELLED,
        entityType: AuditEntityTypes.SWAP_QUOTE,
        entityId: updated.id,
        entityNo: updated.quoteNo || undefined,
        entityOwnerType: updated.ownerType,
        entityOwnerId: updated.ownerId,
        entityOwnerNo: updated.ownerNo || undefined,
        result: AuditResult.SUCCESS,
        reason: 'Swap quote cancelled',
      },
      {
        actorType: ownerType === 'CUSTOMER' ? 'CUSTOMER' : ownerType === 'ADMIN' ? 'ADMIN' : 'SYSTEM',
        actorId: ownerId,
        actorNo: updated.ownerNo || undefined,
        actorRole: ownerType === 'CUSTOMER' ? 'CUSTOMER' : ownerType === 'ADMIN' ? 'ADMIN' : 'SYSTEM',
      },
      tx as any,
    );

    return updated;
  }

  async findAllForAdmin(query: AdminSwapQuoteQueryDto) {
    const where: Prisma.SwapQuoteWhereInput = {};

    if (query.status) where.status = query.status;
    if (query.quoteNo) where.quoteNo = { contains: query.quoteNo };
    if (query.ownerNo) where.ownerNo = { contains: query.ownerNo };
    if (query.ownerId) where.ownerId = query.ownerId;
    if (query.fromAssetId) where.fromAssetId = query.fromAssetId;
    if (query.toAssetId) where.toAssetId = query.toAssetId;

    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) (where.createdAt as any).gte = new Date(query.startDate);
      if (query.endDate) (where.createdAt as any).lte = new Date(query.endDate);
    }

    if (query.swapNo) {
      where.swapTransaction = { swapNo: { contains: query.swapNo } };
    }

    const [items, total] = await Promise.all([
      this.prisma.swapQuote.findMany({
        where,
        skip: query.skip || 0,
        take: query.take || 20,
        orderBy: { createdAt: 'desc' },
        include: { fromAsset: true, toAsset: true },
      }),
      this.prisma.swapQuote.count({ where }),
    ]);

    return { items, total };
  }

  async findOneForAdmin(id: string) {
    const quote = await this.prisma.swapQuote.findUnique({
      where: { id },
      include: {
        fromAsset: true,
        toAsset: true,
        swapTransaction: true,
      },
    });
    if (!quote) throw new NotFoundException(`SwapQuote ${id} not found`);
    return quote;
  }

  async resolveOwnerNo(ownerType: string, ownerId: string): Promise<string | null> {
    if (ownerType === 'CUSTOMER') {
      const customer = await (this.prisma as any).customerMain.findUnique({
        where: { id: ownerId },
        select: { customerNo: true },
      });
      return customer?.customerNo || null;
    }

    if (ownerType === 'ADMIN') {
      const admin = await (this.prisma as any).user.findUnique({
        where: { id: ownerId },
        select: { userNo: true },
      });
      return admin?.userNo || null;
    }

    return null;
  }

  private async markExpired(quoteId: string, db: Prisma.TransactionClient | PrismaService) {
    await db.swapQuote.update({
      where: { id: quoteId },
      data: { status: 'EXPIRED' },
    });
  }

  private isUniqueConstraintError(error: unknown): boolean {
    const maybeError = error as { code?: string; meta?: { target?: string[] | string } };
    if (maybeError?.code !== 'P2002') return false;
    const target = maybeError.meta?.target;
    if (Array.isArray(target)) return target.includes('quoteNo');
    if (typeof target === 'string') return target.includes('quoteNo');
    return false;
  }

  private async createWithUniqueNo(
    data: Omit<Prisma.SwapQuoteUncheckedCreateInput, 'quoteNo'>,
  ): Promise<SwapQuote> {
    for (let attempt = 1; attempt <= QUOTE_NO_MAX_RETRIES; attempt += 1) {
      const quoteNo = generateReferenceNo('QUO');
      try {
        return await this.prisma.swapQuote.create({
          data: { ...data, quoteNo },
        });
      } catch (error) {
        if (this.isUniqueConstraintError(error)) {
          continue;
        }
        throw error;
      }
    }
    throw new InternalServerErrorException(
      `Failed to generate unique quoteNo after ${QUOTE_NO_MAX_RETRIES} attempts`,
    );
  }
}
