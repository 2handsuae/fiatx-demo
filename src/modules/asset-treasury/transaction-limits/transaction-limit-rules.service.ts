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

  // ── 三查找(引擎/工作流消费) ──
  getSingleRule(operationType: string, assetId: string) {
    return this.prisma.transactionLimitRule.findFirst({
      where: { gateType: 'SINGLE', operationType, assetId },
    });
  }

  getCumulativeRules(operationType: string, tradingTier: string) {
    return this.prisma.transactionLimitRule.findMany({
      where: { gateType: 'CUMULATIVE', operationType, tradingTier },
    });
  }

  async getLargeApprovalThreshold(operationType: string): Promise<Prisma.Decimal | null> {
    const rule = await this.prisma.transactionLimitRule.findFirst({
      where: { gateType: 'LARGE_APPROVAL', operationType },
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

  /** 提单挂号:approvalCaseNo 非空即"变更中"(规则无生命周期,不建不删,只改) */
  attachApprovalCase(ruleNo: string, approvalCaseNo: string) {
    return this.prisma.transactionLimitRule.update({
      where: { ruleNo },
      data: { approvalCaseNo },
    });
  }

  /** 裁决落地(批准/否决/取消后)清挂号 */
  clearApprovalCase(ruleNo: string) {
    return this.prisma.transactionLimitRule.update({
      where: { ruleNo },
      data: { approvalCaseNo: null },
    });
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
