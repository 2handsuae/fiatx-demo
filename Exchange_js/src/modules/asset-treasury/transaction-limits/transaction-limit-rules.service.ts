import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ALL_AMOUNT_FIELDS, GATE_SHAPES, GATE_TYPES, LIMIT_OPERATION_TYPES, LIMIT_PERIODS, LIMIT_TRADING_TIERS, GateType } from './constants/transaction-limit.constants';

export interface RuleShapeInput {
  gateType: GateType;
  operationType: string;
  assetId?: string | null;
  tradingTier?: string | null;
  period?: string | null;
  minAmount?: number | string | null;
  maxAmount?: number | string | null;
  defaultLimit?: number | string | null;
  cap?: number | string | null;
  threshold?: number | string | null;
}

@Injectable()
export class TransactionLimitRulesService {
  constructor(private readonly prisma: PrismaService) {}

  /** 行形状校验：维度必填/必空 + 金额字段至少一个且不许带别形状的字段 */
  validateShape(input: RuleShapeInput): void {
    if (!GATE_TYPES.includes(input.gateType)) throw new BadRequestException(`Invalid gateType: ${input.gateType}`);
    if (!LIMIT_OPERATION_TYPES.includes(input.operationType as any)) throw new BadRequestException(`Invalid operationType: ${input.operationType}`);
    const shape = GATE_SHAPES[input.gateType];
    for (const f of shape.required) {
      if (!(input as any)[f]) throw new BadRequestException(`${input.gateType} rule requires ${f}`);
    }
    for (const f of shape.forbidden) {
      if ((input as any)[f]) throw new BadRequestException(`${input.gateType} rule must not set ${f}`);
    }
    if (input.period && !LIMIT_PERIODS.includes(input.period as any)) throw new BadRequestException(`Invalid period: ${input.period}`);
    if (input.tradingTier && !LIMIT_TRADING_TIERS.includes(input.tradingTier as any)) throw new BadRequestException(`Invalid tradingTier: ${input.tradingTier}`);
    const amountSet = shape.amountFields.filter((f) => (input as any)[f] != null);
    if (amountSet.length === 0) throw new BadRequestException(`${input.gateType} rule requires at least one of: ${shape.amountFields.join(', ')}`);
    const alien = ALL_AMOUNT_FIELDS.filter(
      (f) => !shape.amountFields.includes(f) && (input as any)[f] != null,
    );
    if (alien.length) throw new BadRequestException(`${input.gateType} rule must not set: ${alien.join(', ')}`);
    for (const f of shape.amountFields) {
      const v = (input as any)[f];
      if (v != null && new Prisma.Decimal(v).lte(0)) throw new BadRequestException(`${f} must be > 0`);
    }
    if (input.minAmount != null && input.maxAmount != null && new Prisma.Decimal(input.minAmount).gte(new Prisma.Decimal(input.maxAmount))) {
      throw new BadRequestException('minAmount must be < maxAmount');
    }
  }

  /** SQLite 复合唯一对 NULL 不去重 → 服务层预检(含 PENDING_APPROVAL 占坑) */
  async assertUnique(input: RuleShapeInput): Promise<void> {
    const existing = await this.prisma.transactionLimitRule.findFirst({
      where: {
        gateType: input.gateType,
        operationType: input.operationType,
        assetId: input.assetId ?? null,
        tradingTier: input.tradingTier ?? null,
        period: input.period ?? null,
      },
    });
    if (existing) {
      throw new BadRequestException(`Rule already exists for this key (${existing.ruleNo}, status: ${existing.status})`);
    }
  }

  // ── 三查找(引擎/工作流消费,只认 ACTIVE) ──
  getSingleRule(operationType: string, assetId: string) {
    return this.prisma.transactionLimitRule.findFirst({
      where: { gateType: 'SINGLE', operationType, assetId, status: 'ACTIVE' },
    });
  }

  getCumulativeRules(operationType: string, tradingTier: string) {
    return this.prisma.transactionLimitRule.findMany({
      where: { gateType: 'CUMULATIVE', operationType, tradingTier, status: 'ACTIVE' },
    });
  }

  async getLargeApprovalThreshold(operationType: string): Promise<Prisma.Decimal | null> {
    const rule = await this.prisma.transactionLimitRule.findFirst({
      where: { gateType: 'LARGE_APPROVAL', operationType, status: 'ACTIVE' },
    });
    return rule?.threshold ? new Prisma.Decimal(rule.threshold) : null;
  }

  // ── admin 读面 ──
  findAll(gateType?: string) {
    return this.prisma.transactionLimitRule.findMany({
      where: gateType ? { gateType } : undefined,
      orderBy: [{ gateType: 'asc' }, { operationType: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async findByNo(ruleNo: string) {
    const rule = await this.prisma.transactionLimitRule.findUnique({ where: { ruleNo } });
    if (!rule) throw new NotFoundException(`Rule ${ruleNo} not found`);
    return rule;
  }

  // ── 工作流写面(仅供 workflow 调用;领域写入统一经此,守 validateShape 不变量,Rule 5) ──

  /** 以 PENDING_APPROVAL 落一条新规则(调用方须先 validateShape + assertUnique) */
  createPending(input: RuleShapeInput & { ruleNo: string }) {
    return this.prisma.transactionLimitRule.create({
      data: {
        ruleNo: input.ruleNo,
        gateType: input.gateType,
        operationType: input.operationType,
        assetId: input.assetId ?? null,
        tradingTier: input.tradingTier ?? null,
        period: input.period ?? null,
        minAmount: this.toDecimal(input.minAmount),
        maxAmount: this.toDecimal(input.maxAmount),
        defaultLimit: this.toDecimal(input.defaultLimit),
        cap: this.toDecimal(input.cap),
        threshold: this.toDecimal(input.threshold),
        status: 'PENDING_APPROVAL',
      },
    });
  }

  attachApprovalCase(ruleNo: string, approvalCaseId: string) {
    return this.prisma.transactionLimitRule.update({
      where: { ruleNo },
      data: { approvalCaseId },
    });
  }

  activate(ruleNo: string) {
    return this.prisma.transactionLimitRule.update({
      where: { ruleNo },
      data: { status: 'ACTIVE' },
    });
  }

  /** 物理删除一条 PENDING_APPROVAL 规则(创建被否决时) */
  deletePending(ruleNo: string) {
    return this.prisma.transactionLimitRule.delete({ where: { ruleNo } });
  }

  /** 变更生效:仅覆盖传入的金额字段(其余保持不变) */
  applyAmountChange(ruleNo: string, amounts: Record<string, number | string | null | undefined>) {
    const data: Prisma.TransactionLimitRuleUpdateInput = {};
    for (const f of ALL_AMOUNT_FIELDS) {
      if (f in amounts) (data as any)[f] = this.toDecimal(amounts[f]);
    }
    return this.prisma.transactionLimitRule.update({ where: { ruleNo }, data });
  }

  private toDecimal(v: number | string | null | undefined): Prisma.Decimal | null {
    return v == null ? null : new Prisma.Decimal(v);
  }
}
