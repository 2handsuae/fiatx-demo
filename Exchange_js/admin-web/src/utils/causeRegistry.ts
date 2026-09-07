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

/** Row facts (the input to outlet resolution) — taken as-is from the clicked row, sent to the backend on POST. */
export const rowFacts = (row: FlowComparisonRow) => ({
  deltaSign: row.deltaAmount != null ? (row.deltaAmount.startsWith('-') ? -1 : 1) as 1 | -1 : undefined,
  internalDirection: row.internalFlow?.direction,
  internalSourceType: row.internalFlow?.sourceType,
  externalDirection: row.externalLine?.direction,
});

/** One-line rationale for read-only direction (spec §3.3 table). Task 8: translated alongside the page's English pass. */
export const directionNoteFor = (matchType: string): string =>
  matchType === 'AMOUNT_MISMATCH' ? 'Direction is derived from the delta sign (external − internal; outbound flows flip the sign) — not editable'
  : matchType === 'ORPHAN_INTERNAL' ? 'Direction = internal flow direction reversed (IN → decrease, OUT → increase) — not editable'
  : 'Direction = external flow direction as-is (IN → increase, OUT → decrease) — not editable';
