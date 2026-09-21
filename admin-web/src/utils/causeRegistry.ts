// admin-web/src/utils/causeRegistry.ts
//
// 平账一期半（T8）：前端不自建成因表——菜单（含文案与出口词）由后端
// FlowComparisonRow.menu 下发（唯一真相在后端 cause-registry.ts）。这里只放前端
// 自己要的展示词与行事实推导：出口徽标色、行事实推导、方向依据文案。
import type { FlowComparisonRow, FlowMatchType } from './reconTypes';
import { TONE_CLASSES } from './reconBucketMap';

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

// Style + bilingual label maps for the type badge cell.
export const MATCH_TONE: Record<FlowMatchType, string> = {
  MATCHED:         `${TONE_CLASSES.green.border} ${TONE_CLASSES.green.bg} ${TONE_CLASSES.green.text}`,
  IN_TRANSIT:      `${TONE_CLASSES.blue.border} ${TONE_CLASSES.blue.bg} ${TONE_CLASSES.blue.text}`,
  ORPHAN_INTERNAL: `${TONE_CLASSES.amber.border} ${TONE_CLASSES.amber.bg} ${TONE_CLASSES.amber.text}`,
  ORPHAN_EXTERNAL: `${TONE_CLASSES.amber.border} ${TONE_CLASSES.amber.bg} ${TONE_CLASSES.amber.text}`,
  AMOUNT_MISMATCH: `${TONE_CLASSES.red.border} ${TONE_CLASSES.red.bg} ${TONE_CLASSES.red.text}`,
};

export const MATCH_LABEL: Record<FlowMatchType, string> = {
  MATCHED:         'Matched',
  IN_TRANSIT:      'In-transit',
  ORPHAN_INTERNAL: 'Internal only',
  ORPHAN_EXTERNAL: 'External only',
  AMOUNT_MISMATCH: 'Mismatch',
};

// Task 8（Account 节）：科目码 → 人话短语，缺映射不算错——原码原样显示，且始终把
// 原码放 title（既给了兜底文本，也给了可核对的原始值）。Task 15：导出给 Cases 列表页
// 复用（同一份映射，不重抄）。
export const COA_PHRASE: Record<string, string> = {
  'L.CLIENT_PAYABLE': 'Client payable',
  'L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE': 'Client payable + Deposit suspense',
  'E.FIRM_OPS': 'Firm operating',
};
