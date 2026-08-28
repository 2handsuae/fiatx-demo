// 调账规则（spec §3/§4/§5）——纯函数，无 IO。
// 关键认知：借贷科目**只由（账簿 × 方向）决定**，成因不参与计算。成因只用于
// 留痕、客户文案、闸门。故没有 shape/bearer 这类字段（初稿有，已删，见 spec §0）。
import { BadRequestException } from '@nestjs/common';
import { TB_ACCOUNT_CODES } from '../../../accounting/tigerbeetle/constants/tb-account-codes.constant';

export type Book = 'CLIENT' | 'FIRM';
export type Direction = 'REDUCE' | 'INCREASE';

export type ReasonCode =
  | 'DEPOSIT_AMOUNT_CORRECTION'
  | 'DEPOSIT_DUPLICATE_REVERSAL'
  | 'DEPOSIT_SIGNAL_VOID'
  | 'WITHDRAW_AMOUNT_CORRECTION'
  | 'WITHDRAW_VOID_REFUND'
  | 'BANK_INTEREST'
  | 'BANK_CHARGE';

/**
 * 成因清单（业主 2026-08-28 确认）。**无兜底档**——兜底档一开，说不清的全往里塞，
 * 久了变垃圾桶、审计价值归零。遇到新成因显式加一条。
 * customerLabel = 客户口径词；公司账簿成因为 null（客户看不到公司侧调账）。
 */
export const REASON_SPECS: Record<ReasonCode, {
  book: Book; directions: Direction[];
  /** 客户口径词——公司账簿成因为 null（客户看不到公司侧调账）。 */
  customerLabel: string | null;
  /** 内部口径词（审批页、管理台、审计摘要用）。**七个成因都必须有**——
   *  末站发现审批页对公司侧两个成因回落成裸枚举「成因：BANK_CHARGE」，而客户侧
   *  五个都是中文，同一屏半英半中。`customerLabel` 的 null 是刻意的（客户不可见），
   *  不该被借用来当内部展示词，故另立此列。 */
  internalLabel: string;
}> = {
  DEPOSIT_AMOUNT_CORRECTION:  { book: 'CLIENT', directions: ['REDUCE', 'INCREASE'], customerLabel: '充值金额更正', internalLabel: '充值金额更正' },
  DEPOSIT_DUPLICATE_REVERSAL: { book: 'CLIENT', directions: ['REDUCE'],             customerLabel: '重复入账撤销', internalLabel: '重复入账撤销' },
  DEPOSIT_SIGNAL_VOID:        { book: 'CLIENT', directions: ['REDUCE'],             customerLabel: '充值撤销',     internalLabel: '充值撤销' },
  WITHDRAW_AMOUNT_CORRECTION: { book: 'CLIENT', directions: ['INCREASE'],           customerLabel: '提现金额更正', internalLabel: '提现金额更正' },
  WITHDRAW_VOID_REFUND:       { book: 'CLIENT', directions: ['INCREASE'],           customerLabel: '提现撤销退回', internalLabel: '提现撤销退回' },
  BANK_INTEREST:              { book: 'FIRM',   directions: ['INCREASE'],           customerLabel: null,           internalLabel: '银行利息' },
  BANK_CHARGE:                { book: 'FIRM',   directions: ['REDUCE'],             customerLabel: null,           internalLabel: '银行杂费' },
};

export function assertReasonAllowed(reasonCode: ReasonCode, book: Book, direction: Direction): void {
  const spec = REASON_SPECS[reasonCode];
  if (!spec) throw new BadRequestException(`未知成因码：${reasonCode}`);
  if (spec.book !== book) {
    throw new BadRequestException(`成因 ${reasonCode} 只能用于 ${spec.book} 账簿，本案在 ${book} 账簿`);
  }
  if (!spec.directions.includes(direction)) {
    throw new BadRequestException(`成因 ${reasonCode} 不允许方向 ${direction}`);
  }
}

export function resolvePostingLegs(book: Book, direction: Direction): { debitCode: number; creditCode: number } {
  if (book === 'CLIENT') {
    return direction === 'REDUCE'
      ? { debitCode: TB_ACCOUNT_CODES.CLIENT_PAYABLE, creditCode: TB_ACCOUNT_CODES.CLIENT_ASSET }
      : { debitCode: TB_ACCOUNT_CODES.CLIENT_ASSET,   creditCode: TB_ACCOUNT_CODES.CLIENT_PAYABLE };
  }
  return direction === 'REDUCE'
    ? { debitCode: TB_ACCOUNT_CODES.FIRM_OPS,   creditCode: TB_ACCOUNT_CODES.FIRM_ASSET }
    : { debitCode: TB_ACCOUNT_CODES.FIRM_ASSET, creditCode: TB_ACCOUNT_CODES.INCOME_OTHER };
}

/**
 * §4 边界线守卫：客户账簿加钱，必须指向一张已存在的原单。
 * 有原单 = KYT 已对那笔跑过，改金额不算绕闸；无原单 = 凭空给客户加钱，走 V4 补录。
 */
export function requiresRelatedOrder(book: Book, direction: Direction): boolean {
  return book === 'CLIENT' && direction === 'INCREASE';
}
