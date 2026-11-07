// admin-web/src/utils/caseFlowRows.ts
//
// 戊波二 T10：案件页 Differences 表的行可见性与「已解释」合计规则。
// 第 0 轮锚配对（T9b）之后，一条差异一旦被落账的调账单 / 认损补缺单解释，就变成一条带
// explainedByAdjustmentNo 的 MATCHED 行：它不再是异常行，但"这条差异被哪张单解释掉了"
// 要在页面上留着（Status 标签 + Hero 的 explained 合计），所以不能跟着普通 MATCHED 行一起折叠隐藏。
import type { FlowComparisonRow } from './reconTypes';

type RowFacts = Pick<FlowComparisonRow, 'matchType' | 'explainedByAdjustmentNo'>;

/** 被某张单解释掉的 MATCHED 行（默认就展示，不折叠）。 */
export const isExplainedRow = (r: RowFacts): boolean =>
  r.matchType === 'MATCHED' && !!r.explainedByAdjustmentNo;

/** 折叠区里的"普通已匹配行"——开关上的计数只数这些（解释行本来就在表里）。 */
export const hiddenMatchedCount = (rows: RowFacts[]): number =>
  rows.filter((r) => r.matchType === 'MATCHED' && !r.explainedByAdjustmentNo).length;

/** 表里要展示的行：非 MATCHED 一律展示；MATCHED 只有被解释的行默认展示，其余等展开。 */
export const visibleFlowRows = <T extends RowFacts>(rows: T[], showMatched: boolean): T[] =>
  rows.filter((r) => showMatched || r.matchType !== 'MATCHED' || isExplainedRow(r));

/** Hero 结论句里的已解释合计（最小单位整数字符串）：所有被解释行的 explainedAmount 之和。 */
export const explainedSumMinor = (rows: Array<RowFacts & Pick<FlowComparisonRow, 'explainedAmount'>>): string =>
  rows
    .filter((r) => !!r.explainedByAdjustmentNo)
    .reduce((sum, r) => sum + BigInt(r.explainedAmount ?? '0'), 0n)
    .toString();

/**
 * 戊波二 T11 修复（R41）：Hero「awaiting re-reconcile」的判据——有没有「附着的单据已落账、但这一行还没被上一轮对账轧掉」的行。
 * 已落账 = 挂着的调账单 POSTED，或挂着的认损补缺单已记短缺（recognized，码 91 已落）；没被轧掉 = 行还是异常行（非 MATCHED）。
 * 第 0 轮已配成 MATCHED 的行早已重对账过，不算；在途 / 对内差额行没有可附着的单，不算。
 */
export const awaitsReconcile = (rows: Array<Pick<FlowComparisonRow, 'matchType' | 'disposition' | 'transfer'>>): boolean =>
  rows.some((r) =>
    (r.matchType === 'ORPHAN_EXTERNAL' || r.matchType === 'ORPHAN_INTERNAL' || r.matchType === 'AMOUNT_MISMATCH')
    && (r.disposition?.adjustmentStatus === 'POSTED' || r.transfer?.recognized === true));

/** explainedByAdjustmentNo 可能是调账单号（ADJ…）也可能是认损补缺划转单号（ITR…）——各去各的详情页。 */
export const explainedByKind = (no: string): 'TRANSFER' | 'ADJUSTMENT' =>
  no.startsWith('ITR') ? 'TRANSFER' : 'ADJUSTMENT';
