import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TransactionLimitGateService } from './transaction-limit-gate.service';
import { TransactionLimitRulesService } from './transaction-limit-rules.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { BinanceRateProvider } from '../../trading/pricing-center/providers/binance-rate.provider';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';

const D = (v: string | number) => new Prisma.Decimal(v);

describe('TransactionLimitGateService', () => {
  let gate: TransactionLimitGateService;
  const rules = { getSingleRule: jest.fn(), getCumulativeRules: jest.fn() } as any;
  const prisma = {
    asset: { findUnique: jest.fn() },
    customerMain: { findUnique: jest.fn() },
    withdrawTransaction: { aggregate: jest.fn() },
    swapTransaction: { aggregate: jest.fn() },
  } as any;
  const rate = { fetchRate: jest.fn() } as any;
  const audit = { recordSystem: jest.fn().mockResolvedValue(undefined) } as any;

  beforeEach(async () => {
    jest.resetAllMocks();
    audit.recordSystem.mockResolvedValue(undefined);
    prisma.asset.findUnique.mockResolvedValue({ id: 'a1', code: 'BTC', currency: 'BTC' });
    prisma.customerMain.findUnique.mockResolvedValue({ id: 'c1', customerNo: 'C-1', tradingTier: 'BASIC' });
    rate.fetchRate.mockResolvedValue({ rate: D(100), fetchedAt: new Date() }); // 1 unit = 100 AED
    rules.getSingleRule.mockResolvedValue(null);
    rules.getCumulativeRules.mockResolvedValue([]);
    prisma.withdrawTransaction.aggregate.mockResolvedValue({ _sum: { grossAedValue: null } });
    prisma.swapTransaction.aggregate.mockResolvedValue({ _sum: { grossAedValue: null } });
    const mod = await Test.createTestingModule({
      providers: [
        TransactionLimitGateService,
        { provide: TransactionLimitRulesService, useValue: rules },
        { provide: PrismaService, useValue: prisma },
        { provide: BinanceRateProvider, useValue: rate },
        { provide: AuditLogsService, useValue: audit },
      ],
    }).compile();
    gate = mod.get(TransactionLimitGateService);
  });

  const input = { operationType: 'WITHDRAWAL' as const, customerId: 'c1', assetId: 'a1', amount: D('1') };

  it('A: 低于 minAmount → BELOW_MIN 拒绝并审计', async () => {
    rules.getSingleRule.mockResolvedValue({ ruleNo: 'TLR-1', minAmount: D('2'), maxAmount: null });
    await expect(gate.evaluate(input)).rejects.toThrow(BadRequestException);
    expect(audit.recordSystem).toHaveBeenCalledWith(expect.objectContaining({ action: 'TRANSACTION_LIMIT_REJECTED' }));
  });

  it('A: 等于 minAmount → 放行（边界含等号）', async () => {
    rules.getSingleRule.mockResolvedValue({ ruleNo: 'TLR-1', minAmount: D('1'), maxAmount: D('5') });
    await expect(gate.evaluate(input)).resolves.toBeDefined();
  });

  it('A: 高于 maxAmount → ABOVE_MAX 拒绝', async () => {
    rules.getSingleRule.mockResolvedValue({ ruleNo: 'TLR-1', minAmount: null, maxAmount: D('0.5') });
    await expect(gate.evaluate(input)).rejects.toThrow(BadRequestException);
  });

  it('B: 用量+本笔 > defaultLimit → CUMULATIVE 拒绝', async () => {
    rules.getCumulativeRules.mockResolvedValue([{ ruleNo: 'TLR-2', period: 'DAILY', defaultLimit: D('150') }]);
    prisma.withdrawTransaction.aggregate.mockResolvedValue({ _sum: { grossAedValue: D('100') } });
    await expect(gate.evaluate(input)).rejects.toThrow(BadRequestException);
  });

  it('B: 用量+本笔 == defaultLimit → 放行（边界含等号）', async () => {
    rules.getCumulativeRules.mockResolvedValue([{ ruleNo: 'TLR-2', period: 'DAILY', defaultLimit: D('200') }]);
    prisma.withdrawTransaction.aggregate.mockResolvedValue({ _sum: { grossAedValue: D('100') } });
    await expect(gate.evaluate(input)).resolves.toBeDefined();
  });

  it('B: 有 CUMULATIVE 规则但汇率失败 → fail-closed 拒绝', async () => {
    rules.getCumulativeRules.mockResolvedValue([{ ruleNo: 'TLR-2', period: 'DAILY', defaultLimit: D('200') }]);
    rate.fetchRate.mockRejectedValue(new Error('binance down'));
    await expect(gate.evaluate(input)).rejects.toThrow(BadRequestException);
  });

  it('无任何规则 + 汇率失败 → 放行但 rateFetchFailed=true（无 B 规则不 fail-closed）', async () => {
    rate.fetchRate.mockRejectedValue(new Error('binance down'));
    const r = await gate.evaluate(input);
    expect(r.rateFetchFailed).toBe(true);
    expect(r.grossAedValue).toBeNull();
  });

  it('SWAP 用量查 swapTransaction 聚合、排除 FAILED/REVERSED', async () => {
    rules.getCumulativeRules.mockResolvedValue([{ ruleNo: 'TLR-3', period: 'DAILY', defaultLimit: D('1000') }]);
    await gate.evaluate({ ...input, operationType: 'SWAP' });
    expect(prisma.swapTransaction.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: { notIn: ['FAILED', 'REVERSED'] } }) }),
    );
  });
});
