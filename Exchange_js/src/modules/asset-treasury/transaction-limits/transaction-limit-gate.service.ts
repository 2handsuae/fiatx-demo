import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditGovernanceActions, AuditEntityTypes, AuditBusinessWorkflowTypes } from '../../audit-logging/constants/audit-actions.constant';
import { BinanceRateProvider } from '../../trading/pricing-center/providers/binance-rate.provider';
import { TransactionLimitRulesService } from './transaction-limit-rules.service';
import { dubaiWindowStart } from './dubai-window.util';

const WITHDRAW_COUNTED_EXCLUDE = ['FAILED', 'REJECTED', 'CANCELLED', 'RETURNED'];
const SWAP_COUNTED_EXCLUDE = ['FAILED', 'REVERSED'];

export interface GateInput {
  operationType: 'WITHDRAWAL' | 'SWAP';
  customerId: string;
  assetId: string;
  amount: Prisma.Decimal;
}

export interface GateValuation {
  grossAedValue: Prisma.Decimal | null;
  aedRate: Prisma.Decimal | null;
  rateFetchedAt: Date | null;
  rateFetchFailed: boolean;
}

@Injectable()
export class TransactionLimitGateService {
  private readonly logger = new Logger(TransactionLimitGateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rules: TransactionLimitRulesService,
    private readonly binanceRateProvider: BinanceRateProvider,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async evaluate(input: GateInput): Promise<GateValuation> {
    const asset = await this.prisma.asset.findUnique({ where: { id: input.assetId } });
    if (!asset) throw new BadRequestException('Asset not found');

    const single = await this.rules.getSingleRule(input.operationType, input.assetId);
    if (single?.minAmount && input.amount.lt(new Prisma.Decimal(single.minAmount))) {
      await this.reject(input, single.ruleNo, 'TRANSACTION_LIMIT_BELOW_MIN', {
        minAmount: single.minAmount.toString(), assetCode: asset.code,
      });
    }
    if (single?.maxAmount && input.amount.gt(new Prisma.Decimal(single.maxAmount))) {
      await this.reject(input, single.ruleNo, 'TRANSACTION_LIMIT_ABOVE_MAX', {
        maxAmount: single.maxAmount.toString(), assetCode: asset.code,
      });
    }

    const valuation = await this.valuate(asset.currency, input.amount);

    const customer = await this.prisma.customerMain.findUnique({ where: { id: input.customerId } });
    const tier = customer?.tradingTier || 'BASIC';
    const cumRules = await this.rules.getCumulativeRules(input.operationType, tier);
    if (cumRules.length > 0 && valuation.rateFetchFailed) {
      await this.reject(input, cumRules[0].ruleNo, 'TRANSACTION_LIMIT_UNPRICEABLE', {});
    }
    for (const rule of cumRules) {
      const windowStart = dubaiWindowStart(rule.period as 'DAILY' | 'MONTHLY', new Date());
      const used = await this.sumUsage(input.operationType, input.customerId, windowStart);
      const projected = used.add(valuation.grossAedValue!);
      if (projected.gt(new Prisma.Decimal(rule.defaultLimit!))) {
        await this.reject(input, rule.ruleNo, 'TRANSACTION_LIMIT_CUMULATIVE_EXCEEDED', {
          period: rule.period ?? undefined, limitAed: rule.defaultLimit!.toString(),
          usedAed: used.toString(), remainingAed: Prisma.Decimal.max(new Prisma.Decimal(rule.defaultLimit!).sub(used), new Prisma.Decimal(0)).toString(),
        });
      }
    }

    return valuation;
  }

  private async valuate(currency: string, amount: Prisma.Decimal): Promise<GateValuation> {
    try {
      const r = await this.binanceRateProvider.fetchRate(currency, 'AED');
      return { grossAedValue: amount.mul(r.rate), aedRate: r.rate, rateFetchedAt: r.fetchedAt, rateFetchFailed: false };
    } catch (err) {
      this.logger.warn(`AED valuation failed for ${currency}: ${(err as Error).message}`);
      return { grossAedValue: null, aedRate: null, rateFetchedAt: null, rateFetchFailed: true };
    }
  }

  private async sumUsage(operationType: string, customerId: string, windowStart: Date): Promise<Prisma.Decimal> {
    if (operationType === 'WITHDRAWAL') {
      const agg = await this.prisma.withdrawTransaction.aggregate({
        _sum: { grossAedValue: true },
        where: { ownerId: customerId, createdAt: { gte: windowStart }, status: { notIn: WITHDRAW_COUNTED_EXCLUDE } },
      });
      return new Prisma.Decimal(agg._sum.grossAedValue || 0);
    }
    const agg = await this.prisma.swapTransaction.aggregate({
      _sum: { grossAedValue: true },
      where: { ownerId: customerId, createdAt: { gte: windowStart }, status: { notIn: SWAP_COUNTED_EXCLUDE } },
    });
    return new Prisma.Decimal(agg._sum.grossAedValue || 0);
  }

  private async reject(input: GateInput, ruleNo: string, code: string, context: Record<string, string | undefined>): Promise<never> {
    await this.auditLogsService.recordSystem({
      action: AuditGovernanceActions.TRANSACTION_LIMIT_REJECTED,
      entityType: AuditEntityTypes.TRANSACTION_LIMIT_POLICY,
      entityId: ruleNo,
      entityNo: ruleNo,
      entityOwnerType: 'CUSTOMER',
      entityOwnerId: input.customerId,
      workflowType: AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CHANGE,
      metadata: { code, operationType: input.operationType, amount: input.amount.toString(), ...context },
    });
    throw new BadRequestException({ code, ruleNo, ...context });
  }
}
