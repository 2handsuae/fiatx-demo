// 调账规则（spec §3/§4/§5）——纯函数，无 IO。
// 关键认知：借贷科目**只由（账簿 × 方向）决定**，成因不参与计算。成因只用于
// 留痕、客户文案、闸门。故没有 shape/bearer 这类字段（初稿有，已删，见 spec §0）。
import { BadRequestException } from '@nestjs/common';
import { TB_ACCOUNT_CODES } from '../../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import type { AdjustFamily } from './cause-registry';

export type Book = 'CLIENT' | 'FIRM';
export type Direction = 'REDUCE' | 'INCREASE';

export type ReasonCode =
  | 'CUSTOMER_REATTRIBUTION'
  | 'UNEXPLAINED_WRITE_OFF'
  | 'UNEXPLAINED_CLIENT_LOSS'
  // 单码制（spec §5）：以下 11 码 + OTHER 直接沿用 cause-registry.ts 的 CauseCode 同名码，
  // 不再经旧两层「成因 → 调账 reason」折叠映射（旧 8 码已 Task 13 退役）。
  | 'AMT_MISBOOKED'
  | 'AMT_FEE_NETTED'
  | 'AMT_ROUNDING'
  | 'DUP_BOOKING'
  | 'PHANTOM_BOOKING'
  | 'PAYOUT_NOT_EXECUTED'
  | 'FIRM_AMT_UNDERBOOKED'
  | 'FIRM_AMT_OVERBOOKED'
  | 'FIRM_MISBOOKED'
  | 'BANK_INTEREST_UNBOOKED'
  | 'BANK_CHARGE_UNBOOKED'
  | 'OTHER';

/**
 * 成因清单（业主 2026-08-28 确认）。**无兜底档**——兜底档一开，说不清的全往里塞，
 * 久了变垃圾桶、审计价值归零。遇到新成因显式加一条。
 * customerLabel = 客户口径词；公司账簿成因为 null（客户看不到公司侧调账）。
 */
export const REASON_SPECS: Record<ReasonCode, {
  /** 'ANY' 仅 OTHER 用——双簿通用兜底，assertReasonAllowed 对它跳过账簿校验。 */
  book: Book | 'ANY'; directions: Direction[];
  /** 客户口径词——公司账簿成因为 null（客户看不到公司侧调账）。 */
  customerLabel: string | null;
  /** 内部口径词（审批页、管理台、审计摘要用）。**每个成因都必须有**——
   *  末站发现审批页对公司侧成因回落成裸枚举「成因：BANK_CHARGE」，而客户侧
   *  都是中文，同一屏半英半中。`customerLabel` 的 null 是刻意的（客户不可见），
   *  不该被借用来当内部展示词，故另立此列。 */
  internalLabel: string;
  /** 族——直接用 cause-registry.ts 的 AdjustFamily，不另抄一份字面量联合：
   *  抄一份的话，注册表加/改族这里不会报错，只会静默漂移。
   *  只用于留痕/统计分组，不参与 assertReasonAllowed 的合法性判定。 */
  family: AdjustFamily;
}> = {
  // 第四族（spec §6）：钱在托管里一分没动，主人记错了。不走 book×direction
  // 语义（directions 空 = assertReasonAllowed 对它恒拒），分录由
  // resolveReattributionLegs 直接定；两个客户的应付对转，资产腿不动。
  CUSTOMER_REATTRIBUTION:     { book: 'CLIENT', directions: [],                     customerLabel: 'Account correction', internalLabel: 'Customer reattribution', family: 'REATTRIBUTE' },
  // 平账 A 批（spec §3）：第五族核销——查无果 + 账龄到线 + 小额，公司认下来。
  // 不是成因表里的成因：触发它的是账龄，开单守卫在 adjustment.service.assertWriteOffAllowed。
  UNEXPLAINED_WRITE_OFF:      { book: 'FIRM',   directions: ['REDUCE', 'INCREASE'], customerLabel: null, internalLabel: 'Unexplained write-off', family: 'WRITE_OFF' },
  // 平账二期（spec §7.1）：客户池查无果认损——托管里真少了钱，先让账跟着外面走（客户余额下降），
  // 再由公司补款划转补齐；只许 REDUCE（托管里多出来的走补录，不许核销进客户余额）。
  // 平账三期：事故路（大额未授权转出走事故登记而非「查无果」）也用这个码——「查无果」
  // 二字对事故路不成立，internalLabel 改中性表述，两条来路都适用。
  UNEXPLAINED_CLIENT_LOSS:    { book: 'CLIENT', directions: ['REDUCE'],             customerLabel: 'Balance adjustment',     internalLabel: 'Client loss recognition', family: 'WRITE_OFF' },

  // ═══ 单码制（spec §5）：cause-registry.ts 的 CauseCode 直落调账 reason，不再经旧的
  // 「成因 → 折叠码」映射（旧 resolveOutlet 那套八码 REASON_CODE 折叠已 Task 13 退役）。
  // customerLabel/internalLabel/family 取值见 task-2-brief.md Step 3；directions 见测试表。
  AMT_MISBOOKED:          { book: 'CLIENT', directions: ['REDUCE', 'INCREASE'], customerLabel: 'Balance correction', internalLabel: 'Amount misbooked', family: 'CORRECT' },
  AMT_FEE_NETTED:         { book: 'CLIENT', directions: ['REDUCE', 'INCREASE'], customerLabel: 'Balance correction', internalLabel: 'Bank fee netted', family: 'CORRECT' },
  AMT_ROUNDING:           { book: 'CLIENT', directions: ['REDUCE', 'INCREASE'], customerLabel: 'Balance correction', internalLabel: 'Rounding difference', family: 'CORRECT' },
  DUP_BOOKING:            { book: 'CLIENT', directions: ['REDUCE'],             customerLabel: 'Duplicate deposit reversal', internalLabel: 'Duplicate posting (twin)', family: 'REVERSE' },
  PHANTOM_BOOKING:        { book: 'CLIENT', directions: ['REDUCE'],             customerLabel: 'Deposit reversal', internalLabel: 'Phantom posting', family: 'REVERSE' },
  PAYOUT_NOT_EXECUTED:    { book: 'CLIENT', directions: ['INCREASE'],           customerLabel: 'Withdrawal refund', internalLabel: 'Payout not executed', family: 'REVERSE' },
  FIRM_AMT_UNDERBOOKED:   { book: 'FIRM',   directions: ['REDUCE', 'INCREASE'], customerLabel: null, internalLabel: 'Firm amount underbooked', family: 'RECORD' },
  FIRM_AMT_OVERBOOKED:    { book: 'FIRM',   directions: ['REDUCE', 'INCREASE'], customerLabel: null, internalLabel: 'Firm amount overbooked', family: 'REVERSE' },
  FIRM_MISBOOKED:         { book: 'FIRM',   directions: ['REDUCE', 'INCREASE'], customerLabel: null, internalLabel: 'Firm entry error', family: 'REVERSE' },
  BANK_INTEREST_UNBOOKED: { book: 'FIRM',   directions: ['INCREASE'],           customerLabel: null, internalLabel: 'Bank interest unbooked', family: 'RECORD' },
  BANK_CHARGE_UNBOOKED:   { book: 'FIRM',   directions: ['REDUCE'],             customerLabel: null, internalLabel: 'Bank charges unbooked', family: 'RECORD' },
  // OTHER：双簿双向兜底（cause-registry.ts 里 usableIn 覆盖 CORRECT/REVERSE/RECORD/两个 HOLD，
  // 但调账只在 ADJUST 出口用得到 reasonCode）。family 填 'CORRECT' 只是占位——OTHER 不真的属于
  // 冲正族，只用于留痕/统计分组时有个桶放，assertReasonAllowed 的合法性判定不读这个字段。
  OTHER:                  { book: 'ANY',    directions: ['REDUCE', 'INCREASE'], customerLabel: 'Balance correction', internalLabel: 'Other', family: 'CORRECT' },
};

export function assertReasonAllowed(reasonCode: ReasonCode, book: Book, direction: Direction): void {
  const spec = REASON_SPECS[reasonCode];
  if (!spec) throw new BadRequestException(`Unknown reason code: ${reasonCode}`);
  if (spec.book !== 'ANY' && spec.book !== book) {
    throw new BadRequestException(`Reason ${reasonCode} can only be used on the ${spec.book} book, but this case is on the ${book} book`);
  }
  if (!spec.directions.includes(direction)) {
    throw new BadRequestException(`Reason ${reasonCode} does not allow direction ${direction}`);
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

/** 第五种分录组合（spec §6）：借 错记方 CLIENT_PAYABLE / 贷 正主方 CLIENT_PAYABLE。
 *  同码不同 ownerUuid——resolveTbAccountId 按 (code, ledger, ownerUuid) 落到两个
 *  不同的客户负债户上。客户资产腿（CLIENT_ASSET）刻意不动：托管里的钱没动。 */
export function resolveReattributionLegs(): { debitCode: number; creditCode: number } {
  return { debitCode: TB_ACCOUNT_CODES.CLIENT_PAYABLE, creditCode: TB_ACCOUNT_CODES.CLIENT_PAYABLE };
}
