import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SwapQuote } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { SwapTransactionsService } from './swap-transactions.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import {
  AdminSwapQuoteQueryDto,
  CreateSwapQuoteDto,
  SwapAmountType,
  SwapQuoteStatus,
  SwapQuoteType,
  SwapSide,
} from './dto/swap-quote.dto';
import { AuditLogsService } from '../../risk-engine/audit-logs/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
} from '../../risk-engine/audit-logs/constants/audit-actions.constant';
import { AuditResult, AuditTriggerType } from '../../risk-engine/audit-logs/dto/audit-log.dto';

@Injectable()
export class SwapQuotesService {
  private static readonly MAX_NO_GENERATION_RETRIES = 10;
  private readonly auditLogsService: AuditLogsService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly swapTransactionsService: SwapTransactionsService,
  ) {
    this.auditLogsService = new AuditLogsService(prisma);
  }

  private buildQuoteActor(
    ownerType: string,
    ownerId: string,
    ownerNo?: string | null,
  ) {
    if (ownerType === 'CUSTOMER') {
      return {
        actorType: 'CUSTOMER',
        actorId: ownerId,
        actorNo: ownerNo || undefined,
        actorRole: 'CUSTOMER',
      };
    }

    return {
      actorType: 'SYSTEM',
      actorId: ownerId || 'SYSTEM',
      actorRole: ownerType || 'SYSTEM',
    };
  }

  private toResponse(quote: SwapQuote) {
    let feeBreakdown: any[] = [];
    if (quote.feeBreakdown) {
      try {
        feeBreakdown = JSON.parse(quote.feeBreakdown);
      } catch {
        feeBreakdown = [];
      }
    }

    const firstSnapshot =
      Array.isArray(feeBreakdown) && feeBreakdown.length > 0
        ? feeBreakdown[0]
        : null;

    const matched =
      firstSnapshot && typeof firstSnapshot === 'object'
        ? (firstSnapshot as any).matched || null
        : null;

    const fx =
      firstSnapshot && typeof firstSnapshot === 'object'
        ? (firstSnapshot as any).fx || null
        : null;
    const pricingSource =
      fx && typeof fx === 'object'
        ? {
            provider: quote.rateSource || 'BINANCE',
            endpoint: fx.endpoint || 'api/v3/ticker/bookTicker',
            symbol: fx.symbol || null,
            bid: fx.bid || null,
            ask: fx.ask || null,
            sideUsed: fx.sideUsed || null,
            aedPegApplied: Boolean(fx.aedPegApplied),
            aedPegRate: fx.aedPegRate || null,
            formula: fx.formula || null,
            effectiveBaseRate:
              fx.effectiveBaseRate || fx.baseRate || quote.marketRate.toString(),
            fetchedAt:
              fx.fetchedAt ||
              (quote.fetchedAt ? new Date(quote.fetchedAt).toISOString() : null),
          }
        : null;

    return {
      quoteId: quote.id,
      quoteNo: quote.quoteNo,
      quoteType: quote.quoteType,
      status: quote.status,
      ownerNo: quote.ownerNo,
      createdAt: quote.createdAt,
      expiresAt: quote.expiresAt,
      usedAt: quote.usedAt,
      baseCurrency: quote.fromAssetCode,
      quoteCurrency: quote.toAssetCode,
      side: quote.side,
      amountType: quote.amountType,
      amountIn: new Prisma.Decimal(quote.amountIn).toNumber(),
      currencyIn: quote.currencyIn,
      amountOut: new Prisma.Decimal(quote.amountOut).toNumber(),
      currencyOut: quote.currencyOut,
      rateDisplay: new Prisma.Decimal(quote.rateDisplay).toNumber(),
      rateAllIn: new Prisma.Decimal(quote.rateAllIn).toNumber(),
      marketRate: new Prisma.Decimal(quote.marketRate).toNumber(),
      spreadPercent: new Prisma.Decimal(quote.spreadPercent).toNumber(),
      spreadBps: quote.spreadBps,
      rateSource: quote.rateSource,
      fetchedAt: quote.fetchedAt,
      feeTotal: new Prisma.Decimal(quote.feeTotal).toNumber(),
      feeCurrency: quote.feeCurrency,
      feeBreakdown,
      matched,
      pricingSource,
    };
  }

  private async markExpired(
    client: PrismaService | Prisma.TransactionClient,
    quoteId: string,
    now: Date,
  ) {
    await (client as any).swapQuote.updateMany({
      where: {
        id: quoteId,
        status: SwapQuoteStatus.ACTIVE,
      },
      data: {
        status: SwapQuoteStatus.EXPIRED,
        updatedAt: now,
      },
    });
  }

  private isQuoteNoUniqueConflict(error: unknown): boolean {
    const maybeError = error as {
      code?: string;
      meta?: { target?: string[] | string };
    };
    if (maybeError?.code !== 'P2002') return false;

    const target = maybeError.meta?.target;
    if (Array.isArray(target)) return target.includes('quoteNo');
    if (typeof target === 'string') return target.includes('quoteNo');
    return false;
  }

  private async createQuoteWithUniqueNo(
    data: Omit<Prisma.SwapQuoteUncheckedCreateInput, 'quoteNo'>,
  ): Promise<SwapQuote> {
    for (
      let attempt = 1;
      attempt <= SwapQuotesService.MAX_NO_GENERATION_RETRIES;
      attempt += 1
    ) {
      const quoteNo = generateReferenceNo('QUO');
      try {
        return await this.prisma.swapQuote.create({
          data: {
            ...data,
            quoteNo,
          },
        });
      } catch (error) {
        if (this.isQuoteNoUniqueConflict(error)) {
          continue;
        }
        throw error;
      }
    }

    throw new InternalServerErrorException(
      `Failed to generate unique quoteNo after ${SwapQuotesService.MAX_NO_GENERATION_RETRIES} attempts`,
    );
  }

  async createFirmQuote(
    ownerType: string,
    ownerId: string,
    dto: CreateSwapQuoteDto,
  ) {
    const fromAmount = new Prisma.Decimal(dto.fromAmount);
    if (fromAmount.lte(0)) {
      throw new BadRequestException('fromAmount must be greater than 0');
    }

    const rate = await this.swapTransactionsService.getExecutableRate(
      dto.fromAssetId,
      dto.toAssetId,
      {
        amount: dto.fromAmount,
        ownerType,
        ownerId,
      },
    );

    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + rate.quoteLockSeconds * 1000,
    );
    const rateAllIn = new Prisma.Decimal(rate.executableRate);
    const marketRate = new Prisma.Decimal(rate.marketRate);
    const spreadPercent = new Prisma.Decimal(rate.spreadPercent);
    const amountOut = fromAmount.mul(rateAllIn);
    const spreadBps = rate.spreadBps;

    const feeTotal = new Prisma.Decimal(
      rate.feeTotals?.[rate.toAssetCode] || '0',
    );

    const feeBreakdown = JSON.stringify([
      {
        policyRef: rate.policyRef,
        matched:
          rate.matched || {
            pairId: rate.pairId,
            pairName: rate.pairName,
            tierId: rate.tierId,
            tierName: rate.tierName,
          },
        fx: {
          baseProvider: rate.rateSource,
          baseRate: marketRate.toString(),
          quotedRate: rateAllIn.toString(),
          markupBps: spreadBps,
          endpoint: rate.pricingSource?.endpoint || 'api/v3/ticker/bookTicker',
          symbol: rate.pricingSource?.symbol || null,
          bid: rate.pricingSource?.bid || null,
          ask: rate.pricingSource?.ask || null,
          sideUsed: rate.pricingSource?.sideUsed || null,
          aedPegApplied: Boolean(rate.pricingSource?.aedPegApplied),
          aedPegRate: rate.pricingSource?.aedPegRate || null,
          formula: rate.pricingSource?.formula || null,
          effectiveBaseRate:
            rate.pricingSource?.effectiveBaseRate || marketRate.toString(),
          fetchedAt: rate.pricingSource?.fetchedAt || rate.fetchedAt,
        },
        fees: rate.feeBreakdown || [],
        totals: rate.feeTotals || {},
      },
    ]);

    let ownerNo: string | null = null;
    if (ownerType === 'CUSTOMER') {
      const owner = await (this.prisma as any).customerMain.findUnique({
        where: { id: ownerId },
        select: { customerNo: true },
      });
      ownerNo = owner?.customerNo || null;
    }

    const created = await this.createQuoteWithUniqueNo({
      quoteType: SwapQuoteType.FIRM,
      status: SwapQuoteStatus.ACTIVE,
      ownerType,
      ownerId,
      ownerNo,
      fromAssetId: rate.fromAssetId,
      fromAssetCode: rate.fromAssetCode,
      toAssetId: rate.toAssetId,
      toAssetCode: rate.toAssetCode,
      side: SwapSide.SELL_BASE,
      amountType: SwapAmountType.EXACT_IN,
      amountIn: fromAmount,
      currencyIn: rate.fromAssetCode,
      amountOut,
      currencyOut: rate.toAssetCode,
      rateDisplay: rateAllIn,
      rateAllIn,
      marketRate,
      spreadPercent,
      spreadBps,
      rateSource: rate.rateSource,
      fetchedAt: new Date(rate.fetchedAt),
      feeTotal,
      feeCurrency: rate.toAssetCode,
      feeBreakdown,
      expiresAt,
    });

    await this.auditLogsService.recordByActor(
      {
        triggerType: AuditTriggerType.DATA_CREATE,
        action: AuditActions.SWAP_QUOTE_CREATED,
        module: AuditModules.SWAP_QUOTES,
        entityType: AuditEntityTypes.SWAP_QUOTE,
        entityId: created.id,
        entityNo: created.quoteNo || undefined,
        entityOwnerType: created.ownerType,
        entityOwnerId: created.ownerId,
        entityOwnerNo: created.ownerNo || undefined,
        result: AuditResult.SUCCESS,
        reason: 'Swap quote created',
        afterData: {
          status: created.status,
          fromAssetId: created.fromAssetId,
          toAssetId: created.toAssetId,
          amountIn: created.amountIn.toString(),
          amountOut: created.amountOut.toString(),
          expiresAt: created.expiresAt,
        },
        sourcePlatform: ownerType === 'CUSTOMER' ? 'CUSTOMER_API' : 'SYSTEM',
      },
      this.buildQuoteActor(ownerType, ownerId, created.ownerNo),
    );

    return this.toResponse(created);
  }

  async getActiveQuoteOrThrow(
    quoteId: string,
    ownerType: string,
    ownerId: string,
    now: Date = new Date(),
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.prisma;
    const quote = await (client as any).swapQuote.findUnique({
      where: { id: quoteId },
    });

    if (!quote) {
      throw new BadRequestException('Quote not found');
    }

    if (quote.ownerType !== ownerType || quote.ownerId !== ownerId) {
      throw new ForbiddenException('Quote owner mismatch');
    }

    if (quote.status !== SwapQuoteStatus.ACTIVE) {
      throw new BadRequestException('Quote is not active');
    }

    if (quote.expiresAt.getTime() <= now.getTime()) {
      await this.markExpired(client as any, quoteId, now);
      throw new BadRequestException('Quote expired');
    }

    return quote as SwapQuote;
  }

  async consumeQuoteForSwap(
    tx: Prisma.TransactionClient,
    quoteId: string,
    ownerType: string,
    ownerId: string,
    now: Date = new Date(),
  ) {
    await this.getActiveQuoteOrThrow(quoteId, ownerType, ownerId, now, tx);

    const consumed = await (tx as any).swapQuote.updateMany({
      where: {
        id: quoteId,
        ownerType,
        ownerId,
        status: SwapQuoteStatus.ACTIVE,
        expiresAt: { gt: now },
        usedAt: null,
        cancelledAt: null,
      },
      data: {
        status: SwapQuoteStatus.USED,
        usedAt: now,
      },
    });

    if (consumed.count !== 1) {
      throw new BadRequestException('Quote is not active');
    }

    const updated = await (tx as any).swapQuote.findUnique({
      where: { id: quoteId },
    }) as SwapQuote;

    await this.auditLogsService.recordByActor(
      {
        triggerType: AuditTriggerType.DATA_UPDATE,
        action: AuditActions.SWAP_QUOTE_USED,
        module: AuditModules.SWAP_QUOTES,
        entityType: AuditEntityTypes.SWAP_QUOTE,
        entityId: updated.id,
        entityNo: updated.quoteNo || undefined,
        entityOwnerType: updated.ownerType,
        entityOwnerId: updated.ownerId,
        entityOwnerNo: updated.ownerNo || undefined,
        result: AuditResult.SUCCESS,
        reason: 'Swap quote consumed',
        statusFrom: SwapQuoteStatus.ACTIVE,
        statusTo: SwapQuoteStatus.USED,
        beforeData: { status: SwapQuoteStatus.ACTIVE },
        afterData: { status: SwapQuoteStatus.USED, usedAt: updated.usedAt },
        sourcePlatform: ownerType === 'CUSTOMER' ? 'CUSTOMER_API' : 'SYSTEM',
      },
      this.buildQuoteActor(ownerType, ownerId, updated.ownerNo),
      tx,
    );

    return updated;
  }

  async cancelQuote(
    quoteId: string,
    ownerType: string,
    ownerId: string,
    now: Date = new Date(),
  ) {
    const quote = await this.prisma.swapQuote.findUnique({
      where: { id: quoteId },
    });

    if (!quote) {
      throw new BadRequestException('Quote not found');
    }

    if (quote.ownerType !== ownerType || quote.ownerId !== ownerId) {
      throw new ForbiddenException('Quote owner mismatch');
    }

    if (quote.status !== SwapQuoteStatus.ACTIVE) {
      throw new BadRequestException('Quote is not active');
    }

    if (quote.expiresAt.getTime() <= now.getTime()) {
      await this.markExpired(this.prisma, quoteId, now);
      throw new BadRequestException('Quote expired');
    }

    const cancelled = await this.prisma.swapQuote.update({
      where: { id: quoteId },
      data: {
        status: SwapQuoteStatus.CANCELLED,
        cancelledAt: now,
      },
    });

    await this.auditLogsService.recordByActor(
      {
        triggerType: AuditTriggerType.DATA_UPDATE,
        action: AuditActions.SWAP_QUOTE_CANCELLED,
        module: AuditModules.SWAP_QUOTES,
        entityType: AuditEntityTypes.SWAP_QUOTE,
        entityId: cancelled.id,
        entityNo: cancelled.quoteNo || undefined,
        entityOwnerType: cancelled.ownerType,
        entityOwnerId: cancelled.ownerId,
        entityOwnerNo: cancelled.ownerNo || undefined,
        result: AuditResult.SUCCESS,
        reason: 'Swap quote cancelled',
        statusFrom: SwapQuoteStatus.ACTIVE,
        statusTo: SwapQuoteStatus.CANCELLED,
        beforeData: { status: SwapQuoteStatus.ACTIVE },
        afterData: { status: SwapQuoteStatus.CANCELLED, cancelledAt: cancelled.cancelledAt },
        sourcePlatform: ownerType === 'CUSTOMER' ? 'CUSTOMER_API' : 'SYSTEM',
      },
      this.buildQuoteActor(ownerType, ownerId, cancelled.ownerNo),
    );

    return this.toResponse(cancelled);
  }

  async findAllForAdmin(query: AdminSwapQuoteQueryDto) {
    const {
      skip,
      take,
      status,
      ownerId,
      quoteNo,
      ownerNo,
      swapNo,
      fromAssetId,
      toAssetId,
      startDate,
      endDate,
    } = query;

    const where: Prisma.SwapQuoteWhereInput = {};

    if (status) where.status = status;
    if (ownerId) where.ownerId = ownerId;
    if (quoteNo) where.quoteNo = { contains: quoteNo };
    if (ownerNo) where.ownerNo = { contains: ownerNo };
    if (fromAssetId) where.fromAssetId = fromAssetId;
    if (toAssetId) where.toAssetId = toAssetId;
    if (swapNo) {
      where.swapTransaction = {
        is: {
          swapNo: { contains: swapNo },
        },
      };
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [items, total] = await Promise.all([
      this.prisma.swapQuote.findMany({
        skip: skip ?? 0,
        take: take ?? 20,
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          fromAsset: true,
          toAsset: true,
          swapTransaction: true,
        },
      }),
      this.prisma.swapQuote.count({ where }),
    ]);

    return { items, total };
  }

  async findOneForAdmin(id: string) {
    const item = await this.prisma.swapQuote.findUnique({
      where: { id },
      include: {
        fromAsset: true,
        toAsset: true,
        swapTransaction: true,
      },
    });

    if (!item) {
      throw new NotFoundException('Swap quote not found');
    }

    return item;
  }
}
