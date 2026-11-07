// 戊波二 T10：被解释的 MATCHED 行默认可见 + 计入 Hero 已解释合计 + ITR 号去划转单页。
import {
  explainedByKind, explainedSumMinor, hiddenMatchedCount, isExplainedRow, visibleFlowRows,
} from './caseFlowRows';

import type { FlowMatchType } from './reconTypes';

interface R { id: string; matchType: FlowMatchType; explainedByAdjustmentNo?: string | null; explainedAmount?: string }
const row = (id: string, matchType: FlowMatchType, extra: Partial<R> = {}): R => ({ id, matchType, ...extra });

const rows: R[] = [
  row('mm', 'AMOUNT_MISMATCH'),
  row('plain', 'MATCHED'),
  row('adj', 'MATCHED', { explainedByAdjustmentNo: 'ADJ261107000001', explainedAmount: '22800' }),
  row('itr', 'MATCHED', { explainedByAdjustmentNo: 'ITR261107000002', explainedAmount: '7500000' }),
  row('inv', 'INVARIANT'),
];

describe('visibleFlowRows', () => {
  it('默认：异常行 + INVARIANT + 被解释的 MATCHED 行；普通 MATCHED 折叠', () => {
    expect(visibleFlowRows(rows, false).map((r) => r.id)).toEqual(['mm', 'adj', 'itr', 'inv']);
  });
  it('展开：全部', () => {
    expect(visibleFlowRows(rows, true).map((r) => r.id)).toEqual(['mm', 'plain', 'adj', 'itr', 'inv']);
  });
});

describe('hiddenMatchedCount / isExplainedRow', () => {
  it('开关计数只数折叠区里的普通 MATCHED 行，被解释行不重复计', () => {
    expect(hiddenMatchedCount(rows)).toBe(1);
    expect(isExplainedRow(rows[2])).toBe(true);
    expect(isExplainedRow(rows[1])).toBe(false);
    // 异常行即便误带了 explainedBy 也不是"被解释的 MATCHED 行"
    expect(isExplainedRow(row('x', 'ORPHAN_EXTERNAL', { explainedByAdjustmentNo: 'ADJ1' }))).toBe(false);
  });
});

describe('explainedSumMinor', () => {
  it('只数带 explainedByAdjustmentNo 的行，求 explainedAmount 之和（BigInt，不丢精度）', () => {
    expect(explainedSumMinor(rows)).toBe('7522800');
  });
  it('只数带 explainedByAdjustmentNo 的行：没有它的行即便带着 explainedAmount 也不算（金额归属由「被哪张单解释」定，不由字段是否出现定）', () => {
    expect(explainedSumMinor([
      row('stray', 'ORPHAN_EXTERNAL', { explainedAmount: '999' }),
      row('ok', 'MATCHED', { explainedByAdjustmentNo: 'ADJ1', explainedAmount: '5' }),
    ])).toBe('5');
  });
  it('没有被解释的行 → 0', () => {
    expect(explainedSumMinor([row('a', 'MATCHED'), row('b', 'ORPHAN_EXTERNAL')])).toBe('0');
  });
  it('超出 Number 安全整数的金额不丢位', () => {
    expect(explainedSumMinor([
      row('big', 'MATCHED', { explainedByAdjustmentNo: 'ADJ1', explainedAmount: '9007199254740993' }),
      row('one', 'MATCHED', { explainedByAdjustmentNo: 'ADJ2', explainedAmount: '1' }),
    ])).toBe('9007199254740994');
  });
});

describe('explainedByKind', () => {
  it('ITR… → 划转单页；ADJ… → 调账单页', () => {
    expect(explainedByKind('ITR261107362652')).toBe('TRANSFER');
    expect(explainedByKind('ADJ261107000001')).toBe('ADJUSTMENT');
  });
});
