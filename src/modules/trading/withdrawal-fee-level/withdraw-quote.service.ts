import { Injectable, Inject, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { PricingEngineService } from '../pricing-center/pricing-engine.service';
import {
  CalculatedFeeLine,
  WITHDRAW_QUOTE_TTL_SECONDS,
} from '../pricing-center/types/pricing.types';
import { WithdrawalFeeLevelService } from './withdrawal-fee-level.service';
import { FeeLevelTiersConfig } from './types/fee-level.types';
import { CustomerTagService } from '../../identity/customer-tags/customer-tag.service';
import { matchesAudience } from '../shared/fee-audience.util';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditOutcome } from '../../audit-logging/dto/audit-log.dto';

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
    private readonly customerTagService: CustomerTagService,
    private readonly engineService: PricingEngineService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async resolveBestLevel(input: {
    assetId: string;
    amount: Prisma.Decimal;
    customerId: string;
  }): Promise<ResolvedQuote | null> {
    const allLevels = await this.feeLevelService.findActiveByAsset(input.assetId);
    if (allLevels.length === 0) return null;

    const now = new Date();
    const tags = await this.customerTagService.effectiveTags(input.customerId, now);
    const applicableLevels = allLevels.filter(
      (l) => l.isDefault || matchesAudience(
        { requiredTagsJson: l.requiredTagsJson, validFrom: l.validFrom, validTo: l.validTo },
        tags, now,
      ),
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
    sourcePlatform?: string;
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
    const quoteNo = generateReferenceNo('WQT');

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

    const platform = input.sourcePlatform || (input.ownerType === 'CUSTOMER' ? 'CUSTOMER_API' : 'SYSTEM');

    await this.auditLogsService.recordByActor(
      {
        action: AuditActions.WITHDRAW_QUOTE_CREATED,
        actionDomain: 'WITHDRAW',
        primarySubjectType: AuditEntityTypes.WITHDRAW_QUOTE,
        primarySubjectNo: quote.quoteNo || undefined,
        ownerCustomerNo: quote.ownerNo || undefined,
        subjects: quote.quoteNo ? [
          { subjectType: AuditEntityTypes.WITHDRAW_QUOTE, subjectNo: quote.quoteNo, subjectRole: 'PRIMARY' as any },
          ...(quote.ownerNo ? [{ subjectType: 'CUSTOMER', subjectNo: quote.ownerNo, subjectRole: 'OWNER' as any }] : []),
        ] : undefined,
        requestId: `WITHDRAW_QUOTE_CREATED_${quote.quoteNo}_${randomUUID()}`,
        outcome: AuditOutcome.SUCCESS,
        reason: 'Withdrawal quote created',
        sourcePlatform: platform,
      },
      {
        actorType: input.ownerType === 'CUSTOMER' ? 'CUSTOMER' : input.ownerType === 'ADMIN' ? 'ADMIN' : 'SYSTEM',
        actorNo: quote.ownerNo || 'UNKNOWN',
        actorDisplayName: quote.ownerNo || 'UNKNOWN',
        actorRolesAtTime: [input.ownerType === 'CUSTOMER' ? 'CUSTOMER' : input.ownerType === 'ADMIN' ? 'ADMIN' : 'SYSTEM'],
      },
    );

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

    const updated = await db.withdrawPricingQuote.update({
      where: { id: quoteId },
      data: { status: 'USED', usedAt: now },
    });

    // 与 swap 侧同律：方法收到的 tx 按原样传给 recordByActor 第三参（未传时为 undefined）。
    await this.auditLogsService.recordByActor(
      {
        action: AuditActions.WITHDRAW_QUOTE_USED,
        actionDomain: 'WITHDRAW',
        primarySubjectType: AuditEntityTypes.WITHDRAW_QUOTE,
        primarySubjectNo: updated.quoteNo || undefined,
        ownerCustomerNo: updated.ownerNo || undefined,
        subjects: updated.quoteNo ? [
          { subjectType: AuditEntityTypes.WITHDRAW_QUOTE, subjectNo: updated.quoteNo, subjectRole: 'PRIMARY' as any },
          ...(updated.ownerNo ? [{ subjectType: 'CUSTOMER', subjectNo: updated.ownerNo, subjectRole: 'OWNER' as any }] : []),
        ] : undefined,
        requestId: `WITHDRAW_QUOTE_USED_${updated.quoteNo}_${randomUUID()}`,
        outcome: AuditOutcome.SUCCESS,
        reason: 'Withdrawal quote used',
      },
      {
        actorType: ownerType === 'CUSTOMER' ? 'CUSTOMER' : ownerType === 'ADMIN' ? 'ADMIN' : 'SYSTEM',
        actorNo: updated.ownerNo || 'UNKNOWN',
        actorDisplayName: updated.ownerNo || 'UNKNOWN',
        actorRolesAtTime: [ownerType === 'CUSTOMER' ? 'CUSTOMER' : ownerType === 'ADMIN' ? 'ADMIN' : 'SYSTEM'],
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
    const quote = await db.withdrawPricingQuote.findUnique({ where: { id: quoteId } });
    if (!quote) throw new NotFoundException(`Quote ${quoteId} not found`);
    if (quote.ownerType !== ownerType || quote.ownerId !== ownerId) {
      throw new BadRequestException('Quote does not belong to this owner');
    }
    if (quote.status !== 'ACTIVE') {
      throw new BadRequestException(`Quote is ${quote.status}, cannot cancel`);
    }
    const updated = await db.withdrawPricingQuote.update({
      where: { id: quoteId },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });

    await this.auditLogsService.recordByActor(
      {
        action: AuditActions.WITHDRAW_QUOTE_CANCELLED,
        actionDomain: 'WITHDRAW',
        primarySubjectType: AuditEntityTypes.WITHDRAW_QUOTE,
        primarySubjectNo: updated.quoteNo || undefined,
        ownerCustomerNo: updated.ownerNo || undefined,
        subjects: updated.quoteNo ? [
          { subjectType: AuditEntityTypes.WITHDRAW_QUOTE, subjectNo: updated.quoteNo, subjectRole: 'PRIMARY' as any },
          ...(updated.ownerNo ? [{ subjectType: 'CUSTOMER', subjectNo: updated.ownerNo, subjectRole: 'OWNER' as any }] : []),
        ] : undefined,
        requestId: `WITHDRAW_QUOTE_CANCELLED_${updated.quoteNo}_${randomUUID()}`,
        outcome: AuditOutcome.SUCCESS,
        reason: 'Withdrawal quote cancelled',
      },
      {
        actorType: ownerType === 'CUSTOMER' ? 'CUSTOMER' : ownerType === 'ADMIN' ? 'ADMIN' : 'SYSTEM',
        actorNo: updated.ownerNo || 'UNKNOWN',
        actorDisplayName: updated.ownerNo || 'UNKNOWN',
        actorRolesAtTime: [ownerType === 'CUSTOMER' ? 'CUSTOMER' : ownerType === 'ADMIN' ? 'ADMIN' : 'SYSTEM'],
      },
      tx as any,
    );

    return updated;
  }
}
