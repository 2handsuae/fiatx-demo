import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { TransactionLimitRulesService } from './transaction-limit-rules.service';
import { PrismaService } from '../../../core/prisma/prisma.service';

describe('TransactionLimitRulesService', () => {
  let service: TransactionLimitRulesService;
  const prisma = {
    transactionLimitRule: { findFirst: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  } as any;

  beforeEach(async () => {
    jest.resetAllMocks();
    const mod = await Test.createTestingModule({
      providers: [TransactionLimitRulesService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(TransactionLimitRulesService);
  });

  it('validateShape rejects SINGLE row with tradingTier set', () => {
    expect(() =>
      service.validateShape({ gateType: 'SINGLE', operationType: 'WITHDRAWAL', assetId: 'a1', tradingTier: 'BASIC' } as any),
    ).toThrow(BadRequestException);
  });

  it('validateShape rejects SINGLE with neither minAmount nor maxAmount', () => {
    expect(() =>
      service.validateShape({ gateType: 'SINGLE', operationType: 'WITHDRAWAL', assetId: 'a1' } as any),
    ).toThrow(BadRequestException);
  });

  it('validateShape accepts a well-formed CUMULATIVE row', () => {
    expect(() =>
      service.validateShape({ gateType: 'CUMULATIVE', operationType: 'SWAP', tradingTier: 'BASIC', period: 'DAILY', defaultLimit: 100000, cap: 200000 } as any),
    ).not.toThrow();
  });

  it('getSingleRule queries ACTIVE row by op+asset', async () => {
    prisma.transactionLimitRule.findFirst.mockResolvedValue({ id: 'r1' });
    const r = await service.getSingleRule('WITHDRAWAL', 'asset-1');
    expect(prisma.transactionLimitRule.findFirst).toHaveBeenCalledWith({
      where: { gateType: 'SINGLE', operationType: 'WITHDRAWAL', assetId: 'asset-1', status: 'ACTIVE' },
    });
    expect(r).toEqual({ id: 'r1' });
  });

  it('getLargeApprovalThreshold returns null when no rule', async () => {
    prisma.transactionLimitRule.findFirst.mockResolvedValue(null);
    expect(await service.getLargeApprovalThreshold('WITHDRAWAL')).toBeNull();
  });

  it('assertUnique throws when a same-key row exists', async () => {
    prisma.transactionLimitRule.findFirst.mockResolvedValue({ ruleNo: 'TLR-001', status: 'ACTIVE' });
    await expect(
      service.assertUnique({ gateType: 'LARGE_APPROVAL', operationType: 'WITHDRAWAL' } as any),
    ).rejects.toThrow(BadRequestException);
  });
});
