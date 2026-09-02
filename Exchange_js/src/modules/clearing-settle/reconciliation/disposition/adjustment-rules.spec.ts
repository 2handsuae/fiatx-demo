import { BadRequestException } from '@nestjs/common';
import { TB_ACCOUNT_CODES } from '../../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import {
  REASON_SPECS, assertReasonAllowed, resolvePostingLegs, requiresRelatedOrder, resolveReattributionLegs,
} from './adjustment-rules';

describe('resolvePostingLegs —— 四种组合，成因不参与计算', () => {
  it('客户账簿 · 减：借客户应付 / 贷客户托管', () => {
    expect(resolvePostingLegs('CLIENT', 'REDUCE')).toEqual({
      debitCode: TB_ACCOUNT_CODES.CLIENT_PAYABLE,
      creditCode: TB_ACCOUNT_CODES.CLIENT_ASSET,
    });
  });

  it('客户账簿 · 加：借客户托管 / 贷客户应付', () => {
    expect(resolvePostingLegs('CLIENT', 'INCREASE')).toEqual({
      debitCode: TB_ACCOUNT_CODES.CLIENT_ASSET,
      creditCode: TB_ACCOUNT_CODES.CLIENT_PAYABLE,
    });
  });

  it('公司账簿 · 减：借公司运营 / 贷公司资产', () => {
    expect(resolvePostingLegs('FIRM', 'REDUCE')).toEqual({
      debitCode: TB_ACCOUNT_CODES.FIRM_OPS,
      creditCode: TB_ACCOUNT_CODES.FIRM_ASSET,
    });
  });

  it('公司账簿 · 加：借公司资产 / 贷其他收入', () => {
    expect(resolvePostingLegs('FIRM', 'INCREASE')).toEqual({
      debitCode: TB_ACCOUNT_CODES.FIRM_ASSET,
      creditCode: TB_ACCOUNT_CODES.INCOME_OTHER,
    });
  });
});

describe('requiresRelatedOrder —— §4 边界线守卫', () => {
  it('客户账簿加钱必须有原单', () => {
    expect(requiresRelatedOrder('CLIENT', 'INCREASE')).toBe(true);
  });
  it('其余三种组合不强制', () => {
    expect(requiresRelatedOrder('CLIENT', 'REDUCE')).toBe(false);
    expect(requiresRelatedOrder('FIRM', 'INCREASE')).toBe(false);
    expect(requiresRelatedOrder('FIRM', 'REDUCE')).toBe(false);
  });
});

describe('assertReasonAllowed —— 成因 × 账簿 × 方向 合法组合写死', () => {
  it('充值金额更正在客户账簿上双向都合法', () => {
    expect(() => assertReasonAllowed('DEPOSIT_AMOUNT_CORRECTION', 'CLIENT', 'REDUCE')).not.toThrow();
    expect(() => assertReasonAllowed('DEPOSIT_AMOUNT_CORRECTION', 'CLIENT', 'INCREASE')).not.toThrow();
  });

  it('重复入账撤销只能减', () => {
    expect(() => assertReasonAllowed('DEPOSIT_DUPLICATE_REVERSAL', 'CLIENT', 'REDUCE')).not.toThrow();
    expect(() => assertReasonAllowed('DEPOSIT_DUPLICATE_REVERSAL', 'CLIENT', 'INCREASE')).toThrow(BadRequestException);
  });

  it('银行利息只能落公司账簿、只能加', () => {
    expect(() => assertReasonAllowed('BANK_INTEREST', 'FIRM', 'INCREASE')).not.toThrow();
    expect(() => assertReasonAllowed('BANK_INTEREST', 'CLIENT', 'INCREASE')).toThrow(BadRequestException);
    expect(() => assertReasonAllowed('BANK_INTEREST', 'FIRM', 'REDUCE')).toThrow(BadRequestException);
  });

  it('银行费用只能落公司账簿、只能减', () => {
    expect(() => assertReasonAllowed('BANK_CHARGE', 'FIRM', 'REDUCE')).not.toThrow();
    expect(() => assertReasonAllowed('BANK_CHARGE', 'CLIENT', 'REDUCE')).toThrow(BadRequestException);
    expect(() => assertReasonAllowed('BANK_CHARGE', 'FIRM', 'INCREASE')).toThrow(BadRequestException);
  });

  it('充值撤销只能减', () => {
    expect(() => assertReasonAllowed('DEPOSIT_SIGNAL_VOID', 'CLIENT', 'REDUCE')).not.toThrow();
    expect(() => assertReasonAllowed('DEPOSIT_SIGNAL_VOID', 'CLIENT', 'INCREASE')).toThrow(BadRequestException);
  });

  it('提现金额更正只能加', () => {
    expect(() => assertReasonAllowed('WITHDRAW_AMOUNT_CORRECTION', 'CLIENT', 'INCREASE')).not.toThrow();
    expect(() => assertReasonAllowed('WITHDRAW_AMOUNT_CORRECTION', 'CLIENT', 'REDUCE')).toThrow(BadRequestException);
  });

  it('提现撤销退回只能加', () => {
    expect(() => assertReasonAllowed('WITHDRAW_VOID_REFUND', 'CLIENT', 'INCREASE')).not.toThrow();
    expect(() => assertReasonAllowed('WITHDRAW_VOID_REFUND', 'CLIENT', 'REDUCE')).toThrow(BadRequestException);
    expect(() => assertReasonAllowed('WITHDRAW_VOID_REFUND', 'FIRM', 'INCREASE')).toThrow(BadRequestException);
  });

  it('客户侧成因不能落公司账簿', () => {
    expect(() => assertReasonAllowed('WITHDRAW_VOID_REFUND', 'FIRM', 'INCREASE')).toThrow(BadRequestException);
  });

  it('成因清单恰好八个（含第四族改记），且无兜底档', () => {
    const codes = Object.keys(REASON_SPECS).sort();
    expect(codes).toEqual([
      'BANK_CHARGE', 'BANK_INTEREST',
      'CUSTOMER_REATTRIBUTION',
      'DEPOSIT_AMOUNT_CORRECTION', 'DEPOSIT_DUPLICATE_REVERSAL', 'DEPOSIT_SIGNAL_VOID',
      'WITHDRAW_AMOUNT_CORRECTION', 'WITHDRAW_VOID_REFUND',
    ]);
  });

  it('公司账簿成因没有客户口径词（客户看不到公司侧调账）', () => {
    expect(REASON_SPECS.BANK_INTEREST.customerLabel).toBeNull();
    expect(REASON_SPECS.BANK_CHARGE.customerLabel).toBeNull();
    expect(REASON_SPECS.DEPOSIT_DUPLICATE_REVERSAL.customerLabel).toBe('重复入账撤销');
  });
});

describe('第四族 REATTRIBUTE（spec §6）', () => {
  it('族划分覆盖全部 8 码、无遗漏无重叠', () => {
    const byFamily: Record<string, string[]> = {};
    for (const [code, spec] of Object.entries(REASON_SPECS)) {
      (byFamily[(spec as any).family] ??= []).push(code);
    }
    expect(byFamily.CORRECT!.sort()).toEqual(['DEPOSIT_AMOUNT_CORRECTION', 'WITHDRAW_AMOUNT_CORRECTION']);
    expect(byFamily.REVERSE!.sort()).toEqual(['DEPOSIT_DUPLICATE_REVERSAL', 'DEPOSIT_SIGNAL_VOID', 'WITHDRAW_VOID_REFUND']);
    expect(byFamily.RECORD!.sort()).toEqual(['BANK_CHARGE', 'BANK_INTEREST']);
    expect(byFamily.REATTRIBUTE).toEqual(['CUSTOMER_REATTRIBUTION']);
  });
  it('改记分录：借错记方应付 / 贷正主方应付——资产腿不动（第五种组合）', () => {
    expect(resolveReattributionLegs()).toEqual({
      debitCode: TB_ACCOUNT_CODES.CLIENT_PAYABLE,
      creditCode: TB_ACCOUNT_CODES.CLIENT_PAYABLE,
    });
  });
  it('改记不走 book×direction 语义：assertReasonAllowed 对它任何方向都拒', () => {
    expect(() => assertReasonAllowed('CUSTOMER_REATTRIBUTION' as any, 'CLIENT', 'REDUCE')).toThrow();
  });
});
