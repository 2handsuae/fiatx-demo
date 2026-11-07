// admin-web/src/utils/caseConclusion.ts
//
// Case 详情页 Hero 下的一句话结论（spec 2026-07-03-case-detail-slim §3；英文口径
// 重写见平账收尾·界面收口 Task 8 brief Step 1 + design/Main.dc.html §1）。
// 纯函数：输入 = getCase 返回体字段子集 + 金额格式化器；输出 = 文案 + 色调。
// 规则变更零后端成本——判定全部基于已有 API 字段前端派生。
import type { ReconBucket } from './reconBucketMap';

export type ConclusionTone = 'red' | 'blue' | 'amber' | 'neutral';

export interface CaseConclusionInput {
  bucket: ReconBucket | null | undefined;
  status: string;                 // OPEN | RESOLVED
  assetCode: string;
  walletRef: string | null;
  walletNo: string | null;        // 无主头判据之一：wallet 表解析不到 → null
  coaCode: string | null;         // 无主头判据之二
  deltaAmount: string;            // 原始最小单位（分）整数字符串——与 formatAmount 的入参口径一致
  // 戊波二 T10：对内差额（签名最小单位字符串）；仅对内不平的案子 deltaAmount 恒 0，结论句要改说「两本账对不上」。
  internalDeltaAmount?: string | null;
  actualExternal: string;
  explain?: { inTransitSigned: string; residual: string } | null;
  flowSummary?: { orphanInternal: number; orphanExternal: number; mismatch: number } | null;
  // Task 8：残差已被哪些落账调账单解释掉的金额合计（前端算，见页面
  // explainedSumMinor——与 flowComparison 里 explainedByAdjustmentNo 非空行同一份
  // 数据源，避免结论句这里另算一套出现分歧）。最小单位整数字符串，未传按 '0' 处理。
  explainedSum?: string | null;
  // 戊波二 T11 修复（R41）：「awaiting re-reconcile」只在还有没被上一轮对账轧掉的已落账单据时才说——
  // 第 0 轮已配成 MATCHED 的行早已轧平（重对账过了），不触发；判定规则见 utils/caseFlowRows.ts 的 awaitsReconcile。
  awaitingReconcile?: boolean;
}

export interface CaseConclusion { text: string; tone: ConclusionTone; }

const isZeroStr = (s: string | null | undefined): boolean =>
  s == null || parseFloat(s) === 0 || Number.isNaN(parseFloat(s));

const absStr = (s: string): string => s.replace(/^-/, '');

/** bucket=null (historical case) returns null → the caller renders no conclusion line. */
export function buildCaseConclusion(
  k: CaseConclusionInput,
  fmt: (v: string) => string,
): CaseConclusion | null {
  if (!k.bucket) return null;

  let base: CaseConclusion;
  if (k.walletNo == null && k.coaCode == null) {
    // 规则1 无主外部账户（后端 caseReason 未持久化，用前端判据）
    base = {
      text: `External account ${k.walletRef ?? '—'} cannot be attributed to any wallet — balance ${fmt(k.actualExternal)} ${k.assetCode} pending claim.`,
      tone: 'red',
    };
  } else if (k.bucket === 'BREAK' && isZeroStr(k.deltaAmount) && !isZeroStr(k.internalDeltaAmount)) {
    // 戊波二 T10：对外差额为 0、只有钱包自己的两本账对不上（INVARIANT）——下面「External balance is 0.00 … short of / in excess of
    // our books … full amount unexplained」对这种案子是句空话。正数 = 现金 + 短缺待补 多于 应付 + 暂扣。
    const more = parseFloat(k.internalDeltaAmount as string) > 0 ? 'more' : 'less';
    base = k.status === 'RESOLVED'
      // 已结案（自愈）= 账早已更正归零（副行 Δ 0.00）：说过去时，不再「Needs a correcting entry」。金额取破口那一刻存下的对内差额。
      ? { text: `Books were ${fmt(absStr(k.internalDeltaAmount as string))} ${k.assetCode} out of balance; corrected by a later entry.`, tone: 'red' }
      : {
        text: `External balance matches our cash, but this wallet's own books do not agree — cash + shortfall is ${fmt(absStr(k.internalDeltaAmount as string))} ${k.assetCode} ${more} than payable + held. Needs a correcting entry.`,
        tone: 'red',
      };
  } else if (k.bucket === 'BREAK') {
    // 规则2/3（Task 8 重写；Fix round 修正方向口径）：dir 由 deltaAmount 符号定——
    // 负数=外部少于账上=short of，正数=外部多于账上（盈余案）=in excess of；此前
    // 三模板硬编码 "short of" 且 absStr 抹了符号，盈余案会说反话。coverPhrase 同样
    // 改判据——inTransitSigned 非零时说"部分被在途覆盖"（旧版 rule3 口径译回来，
    // 金额已在 In-Transit 格子展示，句子不重复数字），零时才说"无在途覆盖"；再按
    // 有无已解释行分叉。
    const dir = parseFloat(k.deltaAmount) < 0 ? 'short of' : 'in excess of';
    const coverPhrase = isZeroStr(k.explain?.inTransitSigned)
      ? 'no in-transit cover'
      : 'partly covered by in-transit orders';
    if (!isZeroStr(k.explainedSum)) {
      base = {
        // 戊波二 T10：已结案的案子（页面按结案轮重建，被解释的行已是 MATCHED）不再「等重对账」——它已经重对过了。
        // 戊波二 T11 修复（R41）：开着的案子也一样——已解释的行若已被上一轮配成 MATCHED 就不再等；只有页面判出
        // 还有「已落账但没被轧掉」的行（awaitingReconcile）才带这句。
        text: `External balance is ${fmt(absStr(k.deltaAmount))} ${k.assetCode} ${dir} our books — ${coverPhrase}; ${fmt(k.explainedSum as string)} explained${k.status !== 'RESOLVED' && k.awaitingReconcile ? ', awaiting re-reconcile' : ''}.`,
        tone: 'red',
      };
    } else {
      base = {
        text: `External balance is ${fmt(absStr(k.deltaAmount))} ${k.assetCode} ${dir} our books — ${coverPhrase}, full amount unexplained.`,
        tone: 'red',
      };
    }
  } else if (k.bucket === 'IN_TRANSIT') {
    // 规则4——同样按符号定方向，覆盖语义本身不变（该桶恒是"全覆盖"）。
    const dir = parseFloat(k.deltaAmount) < 0 ? 'short of' : 'in excess of';
    base = { text: `External balance is ${fmt(absStr(k.deltaAmount))} ${k.assetCode} ${dir} our books — fully covered by in-transit orders.`, tone: 'blue' };
  } else if (k.bucket === 'COMPENSATING') {
    // 规则5
    const n = (k.flowSummary?.orphanInternal ?? 0) + (k.flowSummary?.orphanExternal ?? 0) + (k.flowSummary?.mismatch ?? 0);
    base = { text: `Balances are matched, but ${n} flow${n === 1 ? '' : 's'} don't line up — false match pending review.`, tone: 'amber' };
  } else {
    return null; // MATCHED 不会有 case，防御性兜底
  }

  if (k.status === 'RESOLVED') {
    return { text: `Resolved · ${base.text}`, tone: 'neutral' };
  }
  return base;
}
