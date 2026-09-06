// admin-web/src/utils/causeRegistry.ts
//
// 平账一期半（T8）：前端不自建成因表——菜单（含文案与出口词）由后端
// FlowComparisonRow.menu 下发（唯一真相在后端 cause-registry.ts）。这里只放前端
// 自己要的展示词与行事实推导：出口徽标色、行事实推导、方向依据文案。
import type { FlowComparisonRow } from '../pages/ReconciliationCasesDetailPage';

export const OUTLET_TONE: Record<string, 'green' | 'blue' | 'amber' | 'red'> = {
  ADJUST_CORRECT: 'blue', ADJUST_REVERSE: 'blue', ADJUST_RECORD: 'blue', ADJUST_REATTRIBUTE: 'blue',
  HOLD_NEXT_PERIOD: 'amber', HOLD_INVESTIGATING: 'amber', DEFERRED: 'amber',
  // 平账 B 批（Task 9）：SUPPLEMENT 同 DEFERRED 语义——不落分录、等业务域执行。
  SUPPLEMENT: 'amber',
  // 平账三期（Task 9）：INCIDENT——事故未了案子照旧红的语义。
  INCIDENT: 'red',
};

/** 行事实（出口判定的输入）——从被点的那一行原样取，POST 时带给后端。 */
export const rowFacts = (row: FlowComparisonRow) => ({
  deltaSign: row.deltaAmount != null ? (row.deltaAmount.startsWith('-') ? -1 : 1) as 1 | -1 : undefined,
  internalDirection: row.internalFlow?.direction,
  internalSourceType: row.internalFlow?.sourceType,
  externalDirection: row.externalLine?.direction,
});

/** 方向只读时的推导依据一句话（spec §3.3 表）。 */
export const directionNoteFor = (matchType: string): string =>
  matchType === 'AMOUNT_MISMATCH' ? '方向由差额符号推出（外部−内部；出账流水按钱的方向翻过来算），不可改'
  : matchType === 'ORPHAN_INTERNAL' ? '方向 = 内部流水方向取反（IN→减，OUT→加），不可改'
  : '方向 = 外部流水方向照搬（IN→加，OUT→减），不可改';
