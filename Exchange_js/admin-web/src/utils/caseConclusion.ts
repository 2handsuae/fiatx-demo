// admin-web/src/utils/caseConclusion.ts
//
// Case 详情页 Hero 下的一句话结论（spec 2026-07-03-case-detail-slim §3）。
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
  deltaAmount: string;            // human decimal string（Prisma Decimal.toString()）
  actualExternal: string;
  explain?: { inTransitSigned: string; residual: string } | null;
  flowSummary?: { orphanInternal: number; orphanExternal: number; mismatch: number } | null;
}

export interface CaseConclusion { text: string; tone: ConclusionTone; }

const isZeroStr = (s: string | null | undefined): boolean =>
  s == null || parseFloat(s) === 0 || Number.isNaN(parseFloat(s));

const absStr = (s: string): string => s.replace(/^-/, '');

/** bucket=null（历史 case）返回 null → 调用方不渲染结论行。 */
export function buildCaseConclusion(
  k: CaseConclusionInput,
  fmt: (v: string) => string,
): CaseConclusion | null {
  if (!k.bucket) return null;

  let base: CaseConclusion;
  if (k.walletNo == null && k.coaCode == null) {
    // 规则1 无主外部账户（后端 caseReason 未持久化，用前端判据）
    base = {
      text: `外部账户 ${k.walletRef ?? '—'} 无法归属任何钱包，余额 ${fmt(k.actualExternal)} 待认领`,
      tone: 'red',
    };
  } else if (k.bucket === 'BREAK') {
    const transit = k.explain?.inTransitSigned ?? '0';
    if (isZeroStr(transit)) {
      // 规则2 无在途解释
      const dir = parseFloat(k.deltaAmount) < 0 ? '少' : '多';
      base = {
        text: `外部比内部${dir} ${fmt(absStr(k.deltaAmount))} ${k.assetCode}，无在途解释 → 全额待排查`,
        tone: 'red',
      };
    } else {
      // 规则3 部分解释
      base = {
        text: `差额 ${fmt(k.deltaAmount)} 中 ${fmt(transit)} 由在途解释，残差 ${fmt(k.explain?.residual ?? '0')} 待排查`,
        tone: 'red',
      };
    }
  } else if (k.bucket === 'IN_TRANSIT') {
    // 规则4
    base = { text: `差额 ${fmt(k.deltaAmount)} 已被在途单全额解释，等待外部确认后自愈`, tone: 'blue' };
  } else if (k.bucket === 'SOFT_FLAG') {
    // 规则5
    const n = (k.flowSummary?.orphanInternal ?? 0) + (k.flowSummary?.orphanExternal ?? 0) + (k.flowSummary?.mismatch ?? 0);
    base = { text: `余额已对平，但 ${n} 笔流水配不上 → 假匹配待核`, tone: 'amber' };
  } else {
    return null; // MATCHED 不会有 case，防御性兜底
  }

  if (k.status === 'RESOLVED') {
    return { text: `已解决 · ${base.text}`, tone: 'neutral' };
  }
  return base;
}
