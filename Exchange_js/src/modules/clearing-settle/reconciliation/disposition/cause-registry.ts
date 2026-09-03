// 成因注册表（spec §4）——单一来源：财务手册、界面菜单、种子答案键、审计记录
// 四处同码，改这里必同步 doc-final/reference/recon-cause-handbook.md。
// 公理（spec §0）：外部资料是权威，没有「对方错」档——一切成因都是
// 我方账错了 / 我方账缺了 / 时机没到 三种性质之一。
// 平账 A 批（2026-09-02）：删「精度尘埃差」（豁免不做，本系统精度与服务商一致）；公司两成因定码冲销；核销不是成因、是账龄的后续（resolveWriteOff）。
// 平账 B 批（2026-09-03）：漏记入金 / 入金退汇 / 提现退回 三码改走 SUPPLEMENT 出口（补单开门）。
// 纯常量 + 纯函数，无 IO；BadRequestException 是唯一的 Nest 依赖。
import { BadRequestException } from '@nestjs/common';

export type CauseMatchType = 'AMOUNT_MISMATCH' | 'ORPHAN_INTERNAL' | 'ORPHAN_EXTERNAL';
export type CauseBook = 'CLIENT' | 'FIRM';
export type AdjustFamily = 'CORRECT' | 'REVERSE' | 'RECORD' | 'REATTRIBUTE' | 'WRITE_OFF';
export type StoredOutlet =
  | 'ADJUST_CORRECT' | 'ADJUST_REVERSE' | 'ADJUST_RECORD' | 'ADJUST_REATTRIBUTE'
  | 'HOLD_NEXT_PERIOD' | 'HOLD_INVESTIGATING' | 'DEFERRED' | 'SUPPLEMENT';
export type DeferredTarget =
  | 'SUPPLEMENT_DEPOSIT'        // 补单 → 充值域补录（B 批已开）
  | 'SUPPLEMENT_BOUNCE'         // 补单 → 入金退汇认领（B 批已开）
  | 'SUPPLEMENT_PAYOUT_RETURN'  // 补单 → 出金退回认领（B 批已开）
  | 'INTERNAL_TRANSFER'         // 二期内部划转
  | 'INCIDENT'                  // 三期事故升级
  | 'NO_REASON_CODE';           // 冲正类成因遇 SWAP 流水，无对应 reason 码（spec §11-6）

export type CauseCode =
  | 'AMT_MISBOOKED' | 'AMT_FEE_NETTED' | 'AMT_ROUNDING'
  | 'FIRM_AMT_UNDERBOOKED' | 'FIRM_AMT_OVERBOOKED'
  | 'DUP_BOOKING' | 'PHANTOM_BOOKING' | 'PAYOUT_NOT_EXECUTED' | 'MISATTRIBUTED_FROM' | 'CUTOFF_STRADDLE'
  | 'FIRM_MISBOOKED' | 'FIRM_TRANSFER_UNTRACKED'
  | 'MISSED_DEPOSIT' | 'BOUNCED_FUNDS' | 'PAYOUT_RETURNED' | 'MISATTRIBUTED_TO' | 'UNAUTHORIZED_OUTFLOW'
  | 'BANK_INTEREST_UNBOOKED' | 'BANK_CHARGE_UNBOOKED' | 'UNCLAIMED_INFLOW'
  | 'UNEXPLAINED';

type Cell = { matchType: CauseMatchType; book: CauseBook };
const ALL_CELLS: Cell[] = (['AMOUNT_MISMATCH', 'ORPHAN_INTERNAL', 'ORPHAN_EXTERNAL'] as const)
  .flatMap((matchType) => (['CLIENT', 'FIRM'] as const).map((book) => ({ matchType, book })));

export interface CauseSpec {
  cells: Cell[];
  /** 菜单文案 = 手册同词 */
  label: string;
  /** 查证线索一句（手册「查证怎么做」的浓缩版） */
  clue: string;
  kind: 'ADJUST' | 'HOLD_NEXT_PERIOD' | 'HOLD_INVESTIGATING' | 'DEFERRED' | 'SUPPLEMENT';
  family?: AdjustFamily;           // kind=ADJUST 必有
  deferredTarget?: DeferredTarget; // kind=DEFERRED 必有
  deferredLabel?: string;          // kind=DEFERRED 必有（界面显示去向）
  supplementTarget?: DeferredTarget; // kind=SUPPLEMENT 必有（业务域入口）
  supplementLabel?: string;          // kind=SUPPLEMENT 必有（「补单·<label>」）
  requiredDirection?: 'IN' | 'OUT';  // kind=SUPPLEMENT 必有：账单行方向必须与成因一致
}

const C = (matchType: CauseMatchType, book: CauseBook): Cell => ({ matchType, book });

// ⚠ 每格菜单的排序 = 本表内声明顺序过滤后的顺序（menuFor 不再排序），
// 手册与截图验收都按这个顺序对——挪行等于改菜单。
export const CAUSE_REGISTRY: Record<CauseCode, CauseSpec> = {
  // ── 金额不对 × 客户 ──
  AMT_MISBOOKED:   { cells: [C('AMOUNT_MISMATCH', 'CLIENT')], label: '我方金额录错（含小数点错位、少记）', clue: '对银行回单原件，差额无规律', kind: 'ADJUST', family: 'CORRECT' },
  AMT_FEE_NETTED:  { cells: [C('AMOUNT_MISMATCH', 'CLIENT')], label: '银行轧差入账（手续费被扣净额）', clue: '差额恰为固定费/费率，同通道笔笔如此', kind: 'ADJUST', family: 'CORRECT' },
  AMT_ROUNDING:    { cells: [C('AMOUNT_MISMATCH', 'CLIENT')], label: '舍入精度差（钱已到位）', clue: '差额在最小精度量级', kind: 'ADJUST', family: 'CORRECT' },
  // ── 金额不对 × 公司 ──
  FIRM_AMT_UNDERBOOKED: { cells: [C('AMOUNT_MISMATCH', 'FIRM')], label: '公司收支记少（实扣/实收 > 所记）', clue: '银行回单 vs 我方记账', kind: 'ADJUST', family: 'RECORD' },
  FIRM_AMT_OVERBOOKED:  { cells: [C('AMOUNT_MISMATCH', 'FIRM')], label: '公司收支记多', clue: '银行回单 vs 我方记账', kind: 'ADJUST', family: 'REVERSE' },
  // ── 我有外无 × 客户 ──
  DUP_BOOKING:         { cells: [C('ORPHAN_INTERNAL', 'CLIENT')], label: '重复入账——同一笔入了两次', clue: '已匹配列表里有同参考号同金额的双胞胎', kind: 'ADJUST', family: 'REVERSE' },
  PHANTOM_BOOKING:     { cells: [C('ORPHAN_INTERNAL', 'CLIENT')], label: '假信号入账——外部凭证不存在', clue: '银行/链上查无此笔', kind: 'ADJUST', family: 'REVERSE' },
  PAYOUT_NOT_EXECUTED: { cells: [C('ORPHAN_INTERNAL', 'CLIENT')], label: '提现已记但银行未执行', clue: '无回执/有失败通知', kind: 'ADJUST', family: 'REVERSE' },
  MISATTRIBUTED_FROM:  { cells: [C('ORPHAN_INTERNAL', 'CLIENT')], label: '记错客户——这笔钱是别人的', clue: '对端钱包同日同额「外有我无」成对', kind: 'ADJUST', family: 'REATTRIBUTE' },
  CUTOFF_STRADDLE:     { cells: [C('ORPHAN_INTERNAL', 'CLIENT')], label: '跨账期——下期自平', clue: '外部行时间戳落下一账期，余额并不差', kind: 'HOLD_NEXT_PERIOD' },
  // ── 我有外无 × 公司 ──
  FIRM_MISBOOKED:          { cells: [C('ORPHAN_INTERNAL', 'FIRM')], label: '公司收支误记/重复记', clue: '银行单查无', kind: 'ADJUST', family: 'REVERSE' },
  FIRM_TRANSFER_UNTRACKED: { cells: [C('ORPHAN_INTERNAL', 'FIRM')], label: '公司调拨已记账、无资金单跟踪', clue: '本不该发生——公司资金移动应有内部划转单', kind: 'DEFERRED', deferredTarget: 'INTERNAL_TRANSFER', deferredLabel: '二期内部划转' },
  // ── 外有我无 × 客户 ──
  MISSED_DEPOSIT:   { cells: [C('ORPHAN_EXTERNAL', 'CLIENT')], label: '漏记客户入金', clue: '外部行带客户归属（VIBAN/链上地址）', kind: 'SUPPLEMENT', supplementTarget: 'SUPPLEMENT_DEPOSIT', supplementLabel: '充值补录', requiredDirection: 'IN' },
  BOUNCED_FUNDS:    { cells: [C('ORPHAN_EXTERNAL', 'CLIENT')], label: '入金被退汇/回冲', clue: '外部 OUT 与此前某笔成功入金同源', kind: 'SUPPLEMENT', supplementTarget: 'SUPPLEMENT_BOUNCE', supplementLabel: '退汇认领', requiredDirection: 'OUT' },
  PAYOUT_RETURNED:  { cells: [C('ORPHAN_EXTERNAL', 'CLIENT')], label: '提现被银行退回（出款后退汇）', clue: '外部 IN 与某笔成功提现同额，带原出款关联号', kind: 'SUPPLEMENT', supplementTarget: 'SUPPLEMENT_PAYOUT_RETURN', supplementLabel: '退回认领', requiredDirection: 'IN' },
  MISATTRIBUTED_TO:     { cells: [C('ORPHAN_EXTERNAL', 'CLIENT')], label: '记错客户——这笔是本客户的、记在了别人名下', clue: '对端钱包同日同额「我有外无」成对', kind: 'ADJUST', family: 'REATTRIBUTE' },
  UNAUTHORIZED_OUTFLOW: { cells: [C('ORPHAN_EXTERNAL', 'CLIENT')], label: '未授权转出（盗转/误划）', clue: '我方无任何单据、客户未发起', kind: 'DEFERRED', deferredTarget: 'INCIDENT', deferredLabel: '事故升级（三期）' },
  // ── 外有我无 × 公司 ──
  BANK_INTEREST_UNBOOKED: { cells: [C('ORPHAN_EXTERNAL', 'FIRM')], label: '银行利息未入账', clue: '银行单科目 = 利息', kind: 'ADJUST', family: 'RECORD' },
  BANK_CHARGE_UNBOOKED:   { cells: [C('ORPHAN_EXTERNAL', 'FIRM')], label: '银行杂费/账管费未入账', clue: '银行单科目 = 费用', kind: 'ADJUST', family: 'RECORD' },
  UNCLAIMED_INFLOW:       { cells: [C('ORPHAN_EXTERNAL', 'FIRM')], label: '无主入金待归属', clue: '账户归属排查：查明是客户→转补单，公司→补记', kind: 'HOLD_INVESTIGATING' },
  // ── 每格通用收尾 ──
  UNEXPLAINED: { cells: ALL_CELLS, label: '查不出（已穷尽调查）', clue: '说明里写清查过什么', kind: 'HOLD_INVESTIGATING' },
};

export const FAMILY_LABEL: Record<AdjustFamily, string> = {
  CORRECT: '冲正', REVERSE: '冲销', RECORD: '补记', REATTRIBUTE: '改记', WRITE_OFF: '核销',
};

export function staticOutletLabel(code: CauseCode): string {
  const spec = CAUSE_REGISTRY[code];
  if (spec.kind === 'ADJUST') return FAMILY_LABEL[spec.family!];
  if (spec.kind === 'HOLD_NEXT_PERIOD') return '挂起·等下期';
  if (spec.kind === 'HOLD_INVESTIGATING') return '挂起·调查中';
  if (spec.kind === 'SUPPLEMENT') return `补单·${spec.supplementLabel}`;
  return `留档·${spec.deferredLabel}`;
}

export function menuFor(matchType: CauseMatchType, book: CauseBook) {
  return (Object.entries(CAUSE_REGISTRY) as Array<[CauseCode, CauseSpec]>)
    .filter(([, s]) => s.cells.some((c) => c.matchType === matchType && c.book === book))
    .map(([code, s]) => ({ code, label: s.label, clue: s.clue, outletLabel: staticOutletLabel(code) }));
}

export interface RowFacts {
  matchType: CauseMatchType; book: CauseBook;
  deltaSign?: 1 | -1;                       // AMOUNT_MISMATCH：sign(外部 − 内部)，两边都是原始金额（不带方向）
  internalDirection?: 'IN' | 'OUT';        // ORPHAN_INTERNAL；AMOUNT_MISMATCH 也要——见 signedDeltaSign
  internalSourceType?: string;             // AMOUNT_MISMATCH：内部流水 sourceType
  externalDirection?: 'IN' | 'OUT';        // ORPHAN_EXTERNAL
}

/**
 * 金额不对：差额对余额的方向。
 *
 * deltaSign 是**原始金额**差 sign(外部 − 内部)，不带流水方向；但余额是带方向的钱
 * （wallet-balance-checker.service.ts 的口径 signed = IN ? +amt : −amt）。所以出账
 * 流水要把符号翻过来：提现内部记 90、银行实扣 100，原始差是 +10，可这 10 块是客户
 * 余额**多出来**的，得减；若不翻，会判成「加」，且 WITHDRAW_AMOUNT_CORRECTION 只
 * 许 INCREASE，反方向那半边会在开单时恒 400。公司侧同理：支出记少 = 未入账的银行
 * 杂费（BANK_CHARGE），照原始符号会记成利息收入。
 */
function signedDeltaSign(facts: RowFacts): 1 | -1 {
  const raw: 1 | -1 = facts.deltaSign === -1 ? -1 : 1;
  return facts.internalDirection === 'OUT' ? (raw === 1 ? -1 : 1) : raw;
}

export interface ResolvedOutlet {
  outlet: StoredOutlet; outletLabel: string;
  family?: AdjustFamily; reasonCode?: string;
  direction?: 'REDUCE' | 'INCREASE'; deferredTarget?: DeferredTarget;
}

/**
 * 出口判定（spec §4）：成因 + 行事实 → 出口/族/调账 reason/方向 全部机器可判。
 * 方向统一口径「差额 = 外部 − 内部」：金额不对按差额符号（出账流水翻符号，见
 * signedDeltaSign）；我有外无按内部方向取反；外有我无按外部方向照搬。
 * reason 派生规则见 spec §4「调账 reason 派生」。
 */
export function resolveOutlet(code: CauseCode, facts: RowFacts): ResolvedOutlet {
  const spec = CAUSE_REGISTRY[code];
  if (!spec) throw new BadRequestException(`未知成因码：${code}`);
  if (!spec.cells.some((c) => c.matchType === facts.matchType && c.book === facts.book)) {
    throw new BadRequestException(`成因 ${code} 不属于该格（${facts.matchType} × ${facts.book}）`);
  }
  if (spec.kind === 'HOLD_NEXT_PERIOD') return { outlet: 'HOLD_NEXT_PERIOD', outletLabel: '挂起·等下期' };
  if (spec.kind === 'HOLD_INVESTIGATING') return { outlet: 'HOLD_INVESTIGATING', outletLabel: '挂起·调查中' };
  if (spec.kind === 'SUPPLEMENT') {
    // 平账 B 批（spec §2.1-3）：补单三路各认一个方向，选错成因当场拒，不让错方向的表单开出来。
    if (facts.externalDirection && facts.externalDirection !== spec.requiredDirection) {
      throw new BadRequestException(`成因 ${code} 要求账单行方向为 ${spec.requiredDirection}，该行是 ${facts.externalDirection}——成因与账单行方向不符`);
    }
    return { outlet: 'SUPPLEMENT', outletLabel: `补单·${spec.supplementLabel}`, deferredTarget: spec.supplementTarget };
  }
  if (spec.kind === 'DEFERRED') {
    return { outlet: 'DEFERRED', outletLabel: `留档·${spec.deferredLabel}`, deferredTarget: spec.deferredTarget };
  }

  const family = spec.family!;
  if (family === 'REATTRIBUTE') {
    return { outlet: 'ADJUST_REATTRIBUTE', outletLabel: '改记', family, reasonCode: 'CUSTOMER_REATTRIBUTION' };
  }
  if (family === 'CORRECT') {
    const direction: 'REDUCE' | 'INCREASE' = signedDeltaSign(facts) === -1 ? 'REDUCE' : 'INCREASE';
    const reasonCode = facts.internalSourceType === 'DEPOSIT' ? 'DEPOSIT_AMOUNT_CORRECTION'
      : facts.internalSourceType === 'WITHDRAW' ? 'WITHDRAW_AMOUNT_CORRECTION' : null;
    if (!reasonCode) {
      // SWAP 等流水本轮无冲正码（spec §11-6）——留档，不硬塞
      return { outlet: 'DEFERRED', outletLabel: '留档·本流水类型暂无冲正码（下一轮）', deferredTarget: 'NO_REASON_CODE' };
    }
    return { outlet: 'ADJUST_CORRECT', outletLabel: '冲正', family, reasonCode, direction };
  }
  if (family === 'REVERSE') {
    // 公司账簿两成因（A 批定码）：金额不对按差额符号（出账翻符号，同冲正）；孤儿按内部方向取反。
    if (code === 'FIRM_AMT_OVERBOOKED' || code === 'FIRM_MISBOOKED') {
      const direction: 'REDUCE' | 'INCREASE' = facts.matchType === 'AMOUNT_MISMATCH'
        ? (signedDeltaSign(facts) === -1 ? 'REDUCE' : 'INCREASE')
        : (facts.internalDirection === 'OUT' ? 'INCREASE' : 'REDUCE');
      return { outlet: 'ADJUST_REVERSE', outletLabel: '冲销', family, reasonCode: 'FIRM_ENTRY_REVERSAL', direction };
    }
    const direction: 'REDUCE' | 'INCREASE' = facts.internalDirection === 'OUT' ? 'INCREASE' : 'REDUCE';
    const reasonCode = code === 'DUP_BOOKING' ? 'DEPOSIT_DUPLICATE_REVERSAL'
      : code === 'PHANTOM_BOOKING' ? 'DEPOSIT_SIGNAL_VOID' : 'WITHDRAW_VOID_REFUND';
    return { outlet: 'ADJUST_REVERSE', outletLabel: '冲销', family, reasonCode, direction };
  }
  // RECORD（公司补记）：金额差按差额符号（出账翻符号），公司孤儿按外部方向
  const positive = facts.matchType === 'AMOUNT_MISMATCH' ? signedDeltaSign(facts) === 1 : facts.externalDirection === 'IN';
  return {
    outlet: 'ADJUST_RECORD', outletLabel: '补记', family,
    reasonCode: positive ? 'BANK_INTEREST' : 'BANK_CHARGE',
    direction: positive ? 'INCREASE' : 'REDUCE',
  };
}

export interface WriteOffFacts extends RowFacts {
  internalAmount?: string;   // ORPHAN_INTERNAL：内部行金额（最小单位）
  externalAmount?: string;   // ORPHAN_EXTERNAL：外部行金额（最小单位）
  deltaAmount?: string;      // AMOUNT_MISMATCH：外部 − 内部（最小单位，带符号）
}

/**
 * 核销判定（spec §3.3）——不是成因出口，是账龄到线后「挂起·调查中」行的后续处置。
 * 一句原则：让内部等于外部。金额不对按差额符号（出账翻符号，同冲正）；我有外无
 * 取内部方向的反向（同冲销）；外有我无照外部方向（同补记孤儿）。
 */
export function resolveWriteOff(facts: WriteOffFacts): {
  reasonCode: 'UNEXPLAINED_WRITE_OFF'; family: 'WRITE_OFF'; direction: 'REDUCE' | 'INCREASE'; amountMinor: string;
} {
  const abs = (s: string | undefined) => (s ?? '0').replace(/^-/, '');
  if (facts.matchType === 'AMOUNT_MISMATCH') {
    const direction: 'REDUCE' | 'INCREASE' = signedDeltaSign(facts) === -1 ? 'REDUCE' : 'INCREASE';
    return { reasonCode: 'UNEXPLAINED_WRITE_OFF', family: 'WRITE_OFF', direction, amountMinor: abs(facts.deltaAmount) };
  }
  if (facts.matchType === 'ORPHAN_INTERNAL') {
    const direction: 'REDUCE' | 'INCREASE' = facts.internalDirection === 'OUT' ? 'INCREASE' : 'REDUCE';
    return { reasonCode: 'UNEXPLAINED_WRITE_OFF', family: 'WRITE_OFF', direction, amountMinor: abs(facts.internalAmount) };
  }
  const direction: 'REDUCE' | 'INCREASE' = facts.externalDirection === 'IN' ? 'INCREASE' : 'REDUCE';
  return { reasonCode: 'UNEXPLAINED_WRITE_OFF', family: 'WRITE_OFF', direction, amountMinor: abs(facts.externalAmount) };
}
