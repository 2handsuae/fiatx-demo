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
  actualExternal: string;
  explain?: { inTransitSigned: string; residual: string } | null;
  flowSummary?: { orphanInternal: number; orphanExternal: number; mismatch: number } | null;
  // Task 8：残差已被哪些落账调账单解释掉的金额合计（前端算，见页面
  // explainedSumMinor——与 flowComparison 里 explainedByAdjustmentNo 非空行同一份
  // 数据源，避免结论句这里另算一套出现分歧）。最小单位整数字符串，未传按 '0' 处理。
  explainedSum?: string | null;
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
  } else if (k.bucket === 'BREAK') {
    // 规则2/3（Task 8 重写）：三模板逐字照抄 brief——残差非零时一律先说
    // "no in-transit cover"，再按有无已解释行分叉；不再单独描述在途部分解释的
    // 中间态（旧口径），避免与"已解释行"文案打架。
    if (!isZeroStr(k.explainedSum)) {
      base = {
        text: `External balance is ${fmt(absStr(k.deltaAmount))} ${k.assetCode} short of our books — no in-transit cover; ${fmt(k.explainedSum as string)} explained, awaiting re-reconcile.`,
        tone: 'red',
      };
    } else {
      base = {
        text: `External balance is ${fmt(absStr(k.deltaAmount))} ${k.assetCode} short of our books — no in-transit cover, full amount unexplained.`,
        tone: 'red',
      };
    }
  } else if (k.bucket === 'IN_TRANSIT') {
    // 规则4
    base = { text: `External balance is ${fmt(absStr(k.deltaAmount))} ${k.assetCode} short of our books — fully covered by in-transit orders.`, tone: 'blue' };
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
