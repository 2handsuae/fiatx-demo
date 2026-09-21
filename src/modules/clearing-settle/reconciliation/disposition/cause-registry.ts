// 成因注册表（spec §4）——单一来源：财务手册、界面菜单、种子答案键、审计记录
// 四处同码，改这里必同步 doc-final/reference/recon-cause-handbook.md。
// 公理（spec §0）：外部资料是权威，没有「对方错」档——一切成因都是
// 我方账错了 / 我方账缺了 / 时机没到 三种性质之一。
// 平账 A 批（2026-09-02）：删「精度尘埃差」（豁免不做，本系统精度与服务商一致）；公司两成因定码冲销；核销不是成因、是账龄的后续（resolveWriteOff）。
// 平账 B 批（2026-09-03）：漏记入金 / 入金退汇 / 提现退回 三码改走 SUPPLEMENT 出口（补单开门）。
// 平账二期（2026-09-05）：退役 FIRM_TRANSFER_UNTRACKED（二期不做公司池调拨，「留档·二期内部划转」永远点不通；同格误记 → 冲销、查不出 → 挂起已分完），21 → 20。
// 平账三期（2026-09-06）：UNAUTHORIZED_OUTFLOW 出口从「留档·事故升级（三期）」改为独立出口 INCIDENT（事故登记落地）。
// Task 13（2026-09-08）：单码制（Task 12A）落地后，resolveOutlet/menuFor/staticOutletLabel 三个
// 「成因 → 出口反推」函数在生产代码里已零消费者（reasonCode 现在由财务在开单表单直选，写端走
// outletOf(disposition) 直存，读侧走「存储 outlet 反查」，见 reconciliation-query.service.ts
// KIND_OF_OUTLET）——随之退役；各码 kind/family 字段、DeferredTarget.NO_REASON_CODE（连同它的
// SWAP-无冲正码 file-only 分支）一并清空，三者的唯一消费者就是被删的这三个函数。
// 纯常量 + 纯函数，无 IO，无 Nest 依赖。

export type CauseMatchType = 'AMOUNT_MISMATCH' | 'ORPHAN_INTERNAL' | 'ORPHAN_EXTERNAL';
export type CauseBook = 'CLIENT' | 'FIRM';
export type AdjustFamily = 'CORRECT' | 'REVERSE' | 'RECORD' | 'REATTRIBUTE' | 'WRITE_OFF';
export type StoredOutlet =
  | 'ADJUST_CORRECT' | 'ADJUST_REVERSE' | 'ADJUST_RECORD' | 'ADJUST_REATTRIBUTE'
  | 'HOLD_NEXT_PERIOD' | 'HOLD_INVESTIGATING' | 'DEFERRED' | 'SUPPLEMENT' | 'INCIDENT';
export type DeferredTarget =
  | 'SUPPLEMENT_DEPOSIT'        // 补单 → 充值域补录（B 批已开）
  | 'SUPPLEMENT_BOUNCE'         // 补单 → 入金退汇认领（B 批已开）
  | 'SUPPLEMENT_PAYOUT_RETURN'; // 补单 → 出金退回认领（B 批已开）

export type CauseCode =
  | 'AMT_MISBOOKED' | 'AMT_FEE_NETTED' | 'AMT_ROUNDING'
  | 'FIRM_AMT_UNDERBOOKED' | 'FIRM_AMT_OVERBOOKED'
  | 'DUP_BOOKING' | 'PHANTOM_BOOKING' | 'PAYOUT_NOT_EXECUTED' | 'MISATTRIBUTED_FROM' | 'CUTOFF_STRADDLE'
  | 'FIRM_MISBOOKED'
  | 'MISSED_DEPOSIT' | 'BOUNCED_FUNDS' | 'PAYOUT_RETURNED' | 'MISATTRIBUTED_TO' | 'UNAUTHORIZED_OUTFLOW'
  | 'BANK_INTEREST_UNBOOKED' | 'BANK_CHARGE_UNBOOKED' | 'UNCLAIMED_INFLOW'
  | 'UNEXPLAINED'
  | 'OTHER';

type Cell = { matchType: CauseMatchType; book: CauseBook };
const ALL_CELLS: Cell[] = (['AMOUNT_MISMATCH', 'ORPHAN_INTERNAL', 'ORPHAN_EXTERNAL'] as const)
  .flatMap((matchType) => (['CLIENT', 'FIRM'] as const).map((book) => ({ matchType, book })));

export type DispositionKind =
  | 'CORRECT' | 'REVERSE' | 'RECORD' | 'REATTRIBUTE'
  | 'SUPPLEMENT' | 'INCIDENT' | 'HOLD_NEXT_PERIOD' | 'HOLD_INVESTIGATING';

interface CauseSpec {
  cells: Cell[];
  /** 菜单文案 = 手册同词 */
  label: string;
  /** 查证线索一句（手册「查证怎么做」的浓缩版） */
  clue: string;
  /** 该码归属哪个/哪些处置（causesFor 按此过滤，声明顺序输出） */
  usableIn: DispositionKind[];
  supplementTarget?: DeferredTarget; // usableIn 含 SUPPLEMENT 时必有（业务域入口）
  supplementLabel?: string;          // usableIn 含 SUPPLEMENT 时必有（「补单·<label>」）
  requiredDirection?: 'IN' | 'OUT';  // usableIn 含 SUPPLEMENT 时必有：账单行方向必须与成因一致
}

const C = (matchType: CauseMatchType, book: CauseBook): Cell => ({ matchType, book });

// ⚠ 每格菜单的排序 = 本表内声明顺序过滤后的顺序（causesFor 不排序），
// 手册与截图验收都按这个顺序对——挪行等于改菜单。
export const CAUSE_REGISTRY: Record<CauseCode, CauseSpec> = {
  // ── 金额不对 × 客户 ──
  AMT_MISBOOKED:   { cells: [C('AMOUNT_MISMATCH', 'CLIENT')], label: 'Amount misbooked', clue: 'Check the original bank receipt; the difference follows no pattern.', usableIn: ['CORRECT'] },
  AMT_FEE_NETTED:  { cells: [C('AMOUNT_MISMATCH', 'CLIENT')], label: 'Bank fee netted', clue: 'The difference matches a fixed fee or rate, consistent across every transaction on this channel.', usableIn: ['CORRECT'] },
  AMT_ROUNDING:    { cells: [C('AMOUNT_MISMATCH', 'CLIENT')], label: 'Rounding difference', clue: 'The difference is at the smallest precision unit.', usableIn: ['CORRECT'] },
  // ── 金额不对 × 公司 ──
  FIRM_AMT_UNDERBOOKED: { cells: [C('AMOUNT_MISMATCH', 'FIRM')], label: 'Firm amount underbooked', clue: 'Compare the bank receipt against our own books.', usableIn: ['RECORD'] },
  FIRM_AMT_OVERBOOKED:  { cells: [C('AMOUNT_MISMATCH', 'FIRM')], label: 'Firm amount overbooked', clue: 'Compare the bank receipt against our own books.', usableIn: ['REVERSE'] },
  // ── 我有外无 × 客户 ──
  DUP_BOOKING:         { cells: [C('ORPHAN_INTERNAL', 'CLIENT')], label: 'Duplicate posting (twin)', clue: 'The matched list has a twin entry with the same reference number and amount.', usableIn: ['REVERSE'] },
  PHANTOM_BOOKING:     { cells: [C('ORPHAN_INTERNAL', 'CLIENT')], label: 'Phantom posting', clue: 'No record of this transaction at the bank or on-chain.', usableIn: ['REVERSE'] },
  PAYOUT_NOT_EXECUTED: { cells: [C('ORPHAN_INTERNAL', 'CLIENT')], label: 'Payout not executed', clue: 'No receipt on file, or a failure notice was received.', usableIn: ['REVERSE'] },
  MISATTRIBUTED_FROM:  { cells: [C('ORPHAN_INTERNAL', 'CLIENT')], label: 'Misattributed customer', clue: 'A same-day, same-amount "external only" entry exists on the counterparty wallet.', usableIn: ['REATTRIBUTE'] },
  // 终审修复批 Item 7：cells 从单格 ORPHAN_INTERNAL×CLIENT 扩到 ALL_CELLS——跨日切
  // 是「记账时点 vs 外部上报时点」的时序问题，六格（三 matchType × 两 book）任何一格
  // 都可能撞上，不是客户池"我有外无"独有；此前只放一格，「挂起·等下期」在其余五格
  // 只剩 OTHER 一个选项，与样机 M8（六格 HOLD_NEXT_PERIOD 菜单一致含 CUTOFF_STRADDLE）
  // 不符。
  CUTOFF_STRADDLE:     { cells: ALL_CELLS, label: 'Cross-period timing', clue: "The external line's timestamp falls in the next accounting period; the balance is not actually short.", usableIn: ['HOLD_NEXT_PERIOD'] },
  // ── 我有外无 × 公司 ──
  FIRM_MISBOOKED:          { cells: [C('ORPHAN_INTERNAL', 'FIRM')], label: 'Firm entry error', clue: 'No matching entry on the bank statement.', usableIn: ['REVERSE'] },
  // ── 外有我无 × 客户 ──
  MISSED_DEPOSIT:   { cells: [C('ORPHAN_EXTERNAL', 'CLIENT')], label: 'Missed customer deposit', clue: 'The external line carries customer attribution (VIBAN / on-chain address).', usableIn: ['SUPPLEMENT'], supplementTarget: 'SUPPLEMENT_DEPOSIT', supplementLabel: 'Deposit backfill', requiredDirection: 'IN' },
  BOUNCED_FUNDS:    { cells: [C('ORPHAN_EXTERNAL', 'CLIENT')], label: 'Deposit recalled', clue: 'The external OUT line traces back to an earlier successful deposit.', usableIn: ['SUPPLEMENT'], supplementTarget: 'SUPPLEMENT_BOUNCE', supplementLabel: 'Recall claim', requiredDirection: 'OUT' },
  PAYOUT_RETURNED:  { cells: [C('ORPHAN_EXTERNAL', 'CLIENT')], label: 'Payout returned by bank', clue: 'The external IN line matches a successful withdrawal in amount and carries the original payout reference.', usableIn: ['SUPPLEMENT'], supplementTarget: 'SUPPLEMENT_PAYOUT_RETURN', supplementLabel: 'Return claim', requiredDirection: 'IN' },
  MISATTRIBUTED_TO:     { cells: [C('ORPHAN_EXTERNAL', 'CLIENT')], label: 'Misattributed customer', clue: 'A same-day, same-amount "internal only" entry exists on the counterparty wallet.', usableIn: ['REATTRIBUTE'] },
  UNAUTHORIZED_OUTFLOW: { cells: [C('ORPHAN_EXTERNAL', 'CLIENT')], label: 'Unauthorized outflow', clue: 'We hold no order for it, and the customer did not initiate it.', usableIn: ['INCIDENT'] },
  // ── 外有我无 × 公司 ──
  BANK_INTEREST_UNBOOKED: { cells: [C('ORPHAN_EXTERNAL', 'FIRM')], label: 'Bank interest unbooked', clue: 'The bank statement line item is interest.', usableIn: ['RECORD'] },
  BANK_CHARGE_UNBOOKED:   { cells: [C('ORPHAN_EXTERNAL', 'FIRM')], label: 'Bank charges unbooked', clue: 'The bank statement line item is a fee.', usableIn: ['RECORD'] },
  UNCLAIMED_INFLOW:       { cells: [C('ORPHAN_EXTERNAL', 'FIRM')], label: 'Unclaimed inflow', clue: "Trace the account owner: if it's a customer, route to Supplement; if it's the firm, route to Record entry.", usableIn: ['HOLD_INVESTIGATING'] },
  // ── 每格通用收尾 ──
  UNEXPLAINED: { cells: ALL_CELLS, label: 'Unexplained (exhausted)', clue: 'State clearly in the notes what was investigated.', usableIn: ['HOLD_INVESTIGATING'] },
  // ── 统一注册表新增（Task 1）：所有处置通用的自由文本兜底 ──
  OTHER: { cells: ALL_CELLS, label: 'Other', clue: 'State the reason in your own words; it is recorded verbatim.', usableIn: ['CORRECT', 'REVERSE', 'RECORD', 'HOLD_NEXT_PERIOD', 'HOLD_INVESTIGATING'] },
};

export interface RowFacts {
  matchType: CauseMatchType; book: CauseBook;
  deltaSign?: 1 | -1;                       // AMOUNT_MISMATCH：sign(外部 − 内部)，两边都是原始金额（不带方向）
  internalDirection?: 'IN' | 'OUT';        // ORPHAN_INTERNAL；AMOUNT_MISMATCH 也要——见 signedDeltaSign
  internalSourceType?: string;             // AMOUNT_MISMATCH：内部流水 sourceType
  externalDirection?: 'IN' | 'OUT';        // ORPHAN_EXTERNAL
}

// ═══ 统一注册表（Task 1，spec §2/§4/§5/§8）：合法处置矩阵 + 按处置出码菜单 ═══
export const DISPOSITION_LABEL: Record<DispositionKind, string> = {
  CORRECT: 'Correction', REVERSE: 'Reversal', RECORD: 'Record entry', REATTRIBUTE: 'Reattribute',
  SUPPLEMENT: 'Supplement', INCIDENT: 'Register incident',
  HOLD_NEXT_PERIOD: 'Hold · Next period', HOLD_INVESTIGATING: 'Hold · Investigating',
};
// 冲正/冲销只对 DEPOSIT/WITHDRAW 系来源开放（A1b 甲：SWAP 等无调账码，按钮不出现）。
// 注意流水投影里的提现 sourceType 字面量既有 'WITHDRAW' 也有 'WITHDRAWAL'（account_flows
// 表实测为 WITHDRAWAL）——两者都收，执行时先
// `grep -rn "sourceType" src/modules/clearing-settle/reconciliation/projector/` 复核投影字面量。
const ADJUSTABLE_SOURCES = new Set(['DEPOSIT', 'WITHDRAW', 'WITHDRAWAL']);
const sourceAdjustable = (t?: string) => t != null && ADJUSTABLE_SOURCES.has(t);
export function dispositionsFor(facts: RowFacts): DispositionKind[] {
  const out: DispositionKind[] = [];
  if (facts.matchType === 'AMOUNT_MISMATCH') {
    if (facts.book === 'CLIENT') { if (sourceAdjustable(facts.internalSourceType)) out.push('CORRECT'); }
    else { out.push('RECORD'); if (sourceAdjustable(facts.internalSourceType)) out.push('REVERSE'); }
  } else if (facts.matchType === 'ORPHAN_INTERNAL') {
    if (sourceAdjustable(facts.internalSourceType)) out.push('REVERSE');
    if (facts.book === 'CLIENT') out.push('REATTRIBUTE');
  } else { // ORPHAN_EXTERNAL
    if (facts.book === 'CLIENT') out.push('SUPPLEMENT', 'REATTRIBUTE', 'INCIDENT');
    else out.push('RECORD');
  }
  out.push('HOLD_NEXT_PERIOD', 'HOLD_INVESTIGATING');
  return out;
}

export function causesFor(kind: DispositionKind, matchType: CauseMatchType, book: CauseBook): Array<{ code: CauseCode; label: string; clue: string }> {
  return (Object.entries(CAUSE_REGISTRY) as Array<[CauseCode, CauseSpec]>)
    .filter(([, s]) => s.usableIn.includes(kind) && s.cells.some((c) => c.matchType === matchType && c.book === book))
    .map(([code, s]) => ({ code, label: s.label, clue: s.clue }));
}

// Task 13：导出单一来源——读面（reconciliation-query.service.ts）与写面
// （adjustment.service.ts 结论文案）各自反查处置种类的 KIND_OF_OUTLET，都从这张表
// 派生，不再各抄一份键表。
export const OUTLET_OF: Record<DispositionKind, StoredOutlet> = {
  CORRECT: 'ADJUST_CORRECT', REVERSE: 'ADJUST_REVERSE', RECORD: 'ADJUST_RECORD', REATTRIBUTE: 'ADJUST_REATTRIBUTE',
  SUPPLEMENT: 'SUPPLEMENT', INCIDENT: 'INCIDENT',
  HOLD_NEXT_PERIOD: 'HOLD_NEXT_PERIOD', HOLD_INVESTIGATING: 'HOLD_INVESTIGATING',
};
export function outletOf(kind: DispositionKind): StoredOutlet {
  return OUTLET_OF[kind];
}

/**
 * 金额不对：差额对余额的方向。
 *
 * deltaSign 是**原始金额**差 sign(外部 − 内部)，不带流水方向；但余额是带方向的钱
 * （wallet-balance-checker.service.ts 的口径 signed = IN ? +amt : −amt）。所以出账
 * 流水要把符号翻过来：提现内部记 90、银行实扣 100，原始差是 +10，可这 10 块是客户
 * 余额**多出来**的，得减；若不翻，会判成「加」。公司侧同理：支出记少 = 未入账的
 * 银行杂费，照原始符号会记成利息收入。
 */
function signedDeltaSign(facts: RowFacts): 1 | -1 {
  const raw: 1 | -1 = facts.deltaSign === -1 ? -1 : 1;
  return facts.internalDirection === 'OUT' ? (raw === 1 ? -1 : 1) : raw;
}

interface WriteOffFacts extends RowFacts {
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
  reasonCode: 'UNEXPLAINED_WRITE_OFF' | 'UNEXPLAINED_CLIENT_LOSS'; family: 'WRITE_OFF'; direction: 'REDUCE' | 'INCREASE'; amountMinor: string;
} {
  // 平账二期：客户池另立成因码（分录同为借应付 / 贷资产池，但审批文案、客户可见标签、守卫都不同）
  const reasonCode = facts.book === 'FIRM' ? 'UNEXPLAINED_WRITE_OFF' : 'UNEXPLAINED_CLIENT_LOSS';
  const abs = (s: string | undefined) => (s ?? '0').replace(/^-/, '');
  if (facts.matchType === 'AMOUNT_MISMATCH') {
    const direction: 'REDUCE' | 'INCREASE' = signedDeltaSign(facts) === -1 ? 'REDUCE' : 'INCREASE';
    return { reasonCode, family: 'WRITE_OFF', direction, amountMinor: abs(facts.deltaAmount) };
  }
  if (facts.matchType === 'ORPHAN_INTERNAL') {
    const direction: 'REDUCE' | 'INCREASE' = facts.internalDirection === 'OUT' ? 'INCREASE' : 'REDUCE';
    return { reasonCode, family: 'WRITE_OFF', direction, amountMinor: abs(facts.internalAmount) };
  }
  const direction: 'REDUCE' | 'INCREASE' = facts.externalDirection === 'IN' ? 'INCREASE' : 'REDUCE';
  return { reasonCode, family: 'WRITE_OFF', direction, amountMinor: abs(facts.externalAmount) };
}

/**
 * 开单预填（波四）：差异行「开调账单」的金额/方向/改记 side——方向与金额直接委托
 * resolveWriteOff（同一条「让内部等于外部」公式：出账翻符号/内部反向/外部照搬），
 * side 与 disposition.service.ts listReattributionCandidates 的约定同源：错记方=FROM、
 * 正主方=TO。此前这三个值由前端两处各算一遍（页面 rowAdjustmentPrefill 漏了出账
 * 翻符号 = BACKLOG:176，弹窗 deriveKindDirection 是本文件的手抄镜像），波四起收回
 * 本文件单一来源，由 reconciliation-query.service 随行下发。
 */
export interface AdjustmentPrefill {
  amountMinor: string;
  direction: 'REDUCE' | 'INCREASE';
  reattributionSide: 'FROM' | 'TO';
}
export function resolveAdjustmentPrefill(facts: WriteOffFacts): AdjustmentPrefill {
  const { direction, amountMinor } = resolveWriteOff(facts);
  return { amountMinor, direction, reattributionSide: facts.matchType === 'ORPHAN_INTERNAL' ? 'FROM' : 'TO' };
}
