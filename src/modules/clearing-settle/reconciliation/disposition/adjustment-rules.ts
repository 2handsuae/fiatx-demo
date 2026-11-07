// 调账规则（spec §3/§4/§5）——纯函数，无 IO。
// 戊波一（账本按位置重立）：现金腿 = 案子钱包的现金户，由账簿定（客户池 1 / 公司池 50）；
// 对手腿客户池恒为应付，公司池按**处置家族**分（成因码经 REASON_SPECS 折到家族）。
// 成因本身仍不参与计算，只用于留痕、客户文案、闸门——但家族决定公司池的对手科目
// （更正/冲销 → 公司权益，补记杂费 → 银行与托管费用，补记利息 / 核销多钱 → 其他收入，核销少钱 → 对账核销损失）。
import { BadRequestException } from '@nestjs/common';
import { TB_ACCOUNT_CODES } from '../../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import type { AdjustFamily } from './cause-registry';

export type Book = 'CLIENT' | 'FIRM';
export type Direction = 'REDUCE' | 'INCREASE';

/** 调账凭证 evidence.sourceType 的唯一字面。落账（adjustment.service）与对账引擎（匹配器 / 案件流水对照
 *  排除调账行）共用这一个常量，两侧不许各写各的字面量。 */
export const RECON_ADJUSTMENT_SOURCE_TYPE = 'RECON_ADJUSTMENT';

/** 改记凭证第二笔（现金对）的 evidence.eventCode。TB 转账号由 (sourceType, sourceNo, eventCode) 决定，
 *  第二笔必须与第一笔（应付对，eventCode = RECON_ADJUSTMENT_POSTED）不同；落账与详情页读面共用这一个字面量。 */
export const RECON_ADJUSTMENT_CASH_EVENT_CODE = 'RECON_ADJUSTMENT_POSTED_CASH';

// 客户池认损（UNEXPLAINED_CLIENT_LOSS）戊波二 T7a 起不再是调账单成因：已从下面的 ReasonCode / REASON_SPECS 退出，
// 码本身作「认损补缺」划转单的固定成因保留为 cause-registry.ts 的 CLIENT_SHORTFALL_CAUSE。

export type ReasonCode =
  | 'CUSTOMER_REATTRIBUTION'
  | 'UNEXPLAINED_WRITE_OFF'
  // 单码制（spec §5）：以下 9 码 + OTHER 直接沿用 cause-registry.ts 的 CauseCode 同名码，
  // 不再经旧两层「成因 → 调账 reason」折叠映射（旧 8 码已 Task 13 退役）。
  | 'AMT_MISBOOKED'
  | 'AMT_FEE_NETTED'
  | 'AMT_ROUNDING'
  | 'DUP_BOOKING'
  | 'PHANTOM_BOOKING'
  | 'PAYOUT_NOT_EXECUTED'
  | 'FIRM_MISBOOKED'
  | 'BANK_INTEREST_UNBOOKED'
  | 'BANK_CHARGE_UNBOOKED'
  | 'OTHER';

/**
 * 成因清单（业主 2026-08-28 确认）。**无兜底档**——兜底档一开，说不清的全往里塞，
 * 久了变垃圾桶、审计价值归零。遇到新成因显式加一条。
 * customerLabel = 客户口径词；客户话术只在客户池使用，公司池调账客户不可见，快照取 null。
 */
export const REASON_SPECS: Record<ReasonCode, {
  /** 'ANY' = 两本账都能用，assertReasonAllowed 对它跳过账簿校验（分录：现金腿由账簿定，公司池对手腿由 family 定）。
   *  OTHER 兜底，以及客户 / 公司两格共用的 AMT_* 三码、DUP_BOOKING（业主 2026-11-04）。 */
  book: Book | 'ANY'; directions: Direction[];
  /** 客户口径词——只在客户池使用；公司池调账客户不可见，快照取 null（'ANY' 码的话术也不外露到公司池）。 */
  customerLabel: string | null;
  /** 内部口径词（审批页、管理台、审计摘要用）。**每个成因都必须有**——
   *  末站发现审批页对公司侧成因回落成裸枚举「成因：BANK_CHARGE」，而客户侧
   *  都是中文，同一屏半英半中。`customerLabel` 的 null 是刻意的（客户不可见），
   *  不该被借用来当内部展示词，故另立此列。 */
  internalLabel: string;
  /** 族——直接用 cause-registry.ts 的 AdjustFamily，不另抄一份字面量联合：
   *  抄一份的话，注册表加/改族这里不会报错，只会静默漂移。
   *  决定公司池调账的对手科目（resolvePostingLegs：CORRECT / REVERSE → 公司权益，RECORD / WRITE_OFF 按方向见该函数），
   *  同时用于留痕/统计分组；不参与 assertReasonAllowed 的合法性判定。 */
  family: AdjustFamily;
}> = {
  // 第四族（spec §6）：钱在托管里一分没动，主人记错了。不走 book×direction
  // 语义（directions 空 = assertReasonAllowed 对它恒拒），分录由
  // resolveReattributionLegs 直接定：一张凭证四腿——两个客户的应付对转 + 两个客户钱包的现金户一进一出
  // （每客户一钱包，「记错人」就是「记错钱包」；托管里的钱没动，动的是账上记在谁的现金户）。
  CUSTOMER_REATTRIBUTION:     { book: 'CLIENT', directions: [],                     customerLabel: 'Account correction', internalLabel: 'Customer reattribution', family: 'REATTRIBUTE' },
  // 平账 A 批（spec §3）：第五族核销——查无果 + 账龄到线 + 小额，公司认下来。
  // 不是成因表里的成因：触发它的是账龄，开单守卫在 adjustment.service.assertWriteOffAllowed。
  UNEXPLAINED_WRITE_OFF:      { book: 'FIRM',   directions: ['REDUCE', 'INCREASE'], customerLabel: null, internalLabel: 'Unexplained write-off', family: 'WRITE_OFF' },
  // ═══ 单码制（spec §5）：cause-registry.ts 的 CauseCode 直落调账 reason，不再经旧的
  // 「成因 → 折叠码」映射（旧 resolveOutlet 那套八码 REASON_CODE 折叠已 Task 13 退役）。
  // customerLabel/internalLabel/family 取值见 task-2-brief.md Step 3；directions 见测试表。
  AMT_MISBOOKED:          { book: 'ANY',    directions: ['REDUCE', 'INCREASE'], customerLabel: 'Balance correction', internalLabel: 'Amount misbooked', family: 'CORRECT' },
  AMT_FEE_NETTED:         { book: 'ANY',    directions: ['REDUCE', 'INCREASE'], customerLabel: 'Balance correction', internalLabel: 'Fee netted', family: 'CORRECT' },
  AMT_ROUNDING:           { book: 'ANY',    directions: ['REDUCE', 'INCREASE'], customerLabel: 'Balance correction', internalLabel: 'Rounding difference', family: 'CORRECT' },
  // DUP_BOOKING 两本账共用：客户池冲重复入账（入账行 REDUCE、出账行重复入账冲掉 = INCREASE），公司池两个方向都可能。
  DUP_BOOKING:            { book: 'ANY',    directions: ['REDUCE', 'INCREASE'], customerLabel: 'Duplicate entry reversal', internalLabel: 'Duplicate posting (twin)', family: 'REVERSE' },
  PHANTOM_BOOKING:        { book: 'CLIENT', directions: ['REDUCE'],             customerLabel: 'Deposit reversal', internalLabel: 'Phantom posting', family: 'REVERSE' },
  PAYOUT_NOT_EXECUTED:    { book: 'CLIENT', directions: ['INCREASE'],           customerLabel: 'Withdrawal refund', internalLabel: 'Payout not executed', family: 'REVERSE' },
  FIRM_MISBOOKED:         { book: 'FIRM',   directions: ['REDUCE', 'INCREASE'], customerLabel: null, internalLabel: 'Firm entry error', family: 'REVERSE' },
  BANK_INTEREST_UNBOOKED: { book: 'FIRM',   directions: ['INCREASE'],           customerLabel: null, internalLabel: 'Bank interest unbooked', family: 'RECORD' },
  BANK_CHARGE_UNBOOKED:   { book: 'FIRM',   directions: ['REDUCE'],             customerLabel: null, internalLabel: 'Bank charges unbooked', family: 'RECORD' },
  // OTHER：双簿双向兜底（cause-registry.ts 里 usableIn 覆盖 CORRECT/REVERSE/RECORD/两个 HOLD，
  // 但调账只在 ADJUST 出口用得到 reasonCode）。family 填 'CORRECT'：公司池的 OTHER 按冲正族走，
  // 对手腿是公司权益（resolvePostingLegs 读这个字段），客户池照常对应付；assertReasonAllowed 的合法性判定不读它。
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

/**
 * 公司池对手腿（附录 B「平账调账单」）。REDUCE = 公司现金变少、INCREASE = 变多，对手科目看家族：
 *   CORRECT / REVERSE 两个方向 → 公司权益；
 *   RECORD：INCREASE（补记银行利息）→ 其他收入，REDUCE（补记银行杂费）→ 银行与托管费用；
 *   WRITE_OFF：REDUCE（托管里少了）→ 对账核销损失，INCREASE（托管里多出）→ 其他收入
 *   （不能贷 301：它是借方户，贷不得超借会被 TB 拒——总纲 §4 岔口 7）。
 */
function firmCounterCode(family: AdjustFamily, direction: Direction): number {
  switch (family) {
    case 'CORRECT':
    case 'REVERSE':
      return TB_ACCOUNT_CODES.FIRM_EQUITY;
    case 'RECORD':
      return direction === 'INCREASE' ? TB_ACCOUNT_CODES.INCOME_OTHER : TB_ACCOUNT_CODES.EXPENSE_BANK_CUSTODY;
    case 'WRITE_OFF':
      return direction === 'REDUCE' ? TB_ACCOUNT_CODES.EXPENSE_RECON_LOSS : TB_ACCOUNT_CODES.INCOME_OTHER;
    case 'REATTRIBUTE':
      // 改记不走 book×direction，分录由 resolveReattributionLegs 定；调用方分流在前，到这里是调用错。
      throw new Error('REATTRIBUTE has no book × direction legs — use resolveReattributionLegs');
  }
}

/**
 * 单腿凭证的借贷科目码。现金码 = 账簿（客户池 1 / 公司池 50），具体落到案子钱包的哪个现金户由调用方经
 * `AccountingService.resolveCashAccountId(walletRef, ledger)` 取。
 * REDUCE = 借对手 / 贷现金；INCREASE = 借现金 / 贷对手。
 */
export function resolvePostingLegs(book: Book, direction: Direction, reasonCode: ReasonCode): { debitCode: number; creditCode: number } {
  const cashCode = book === 'CLIENT' ? TB_ACCOUNT_CODES.CLIENT_CASH : TB_ACCOUNT_CODES.FIRM_CASH;
  const counterCode = book === 'CLIENT'
    ? TB_ACCOUNT_CODES.CLIENT_PAYABLE
    : firmCounterCode(REASON_SPECS[reasonCode].family, direction);
  return direction === 'REDUCE'
    ? { debitCode: counterCode, creditCode: cashCode }
    : { debitCode: cashCode, creditCode: counterCode };
}

/**
 * §4 边界线守卫：客户账簿加钱，必须指向一张已存在的原单。
 * 有原单 = KYT 已对那笔跑过，改金额不算绕闸；无原单 = 凭空给客户加钱，走 V4 补录。
 */
export function requiresRelatedOrder(book: Book, direction: Direction): boolean {
  return book === 'CLIENT' && direction === 'INCREASE';
}

/** 第五种分录组合（改记）：一张凭证两笔码 80，四条腿——
 *  应付对：借 错记方 CLIENT_PAYABLE / 贷 正主方 CLIENT_PAYABLE（同码不同 ownerUuid，
 *    resolveTbAccountId 按 (code, ledger, ownerUuid) 落到两个不同的客户负债户）；
 *  现金对：借 正主方钱包 CLIENT_CASH / 贷 错记方钱包 CLIENT_CASH（同码不同钱包，
 *    每客户一个钱包，「记错人」就是「记错钱包」——钱实际在正主的钱包里，账却记在错记方的现金户上；
 *    总纲 §4 岔口 6）。
 *  现金对不挪的话，两案永远不自愈，正主的应付还会比他的现金多、提现撞不负标志。 */
export function resolveReattributionLegs(): {
  payable: { debitCode: number; creditCode: number };
  cash: { debitCode: number; creditCode: number };
} {
  return {
    payable: { debitCode: TB_ACCOUNT_CODES.CLIENT_PAYABLE, creditCode: TB_ACCOUNT_CODES.CLIENT_PAYABLE },
    cash: { debitCode: TB_ACCOUNT_CODES.CLIENT_CASH, creditCode: TB_ACCOUNT_CODES.CLIENT_CASH },
  };
}
