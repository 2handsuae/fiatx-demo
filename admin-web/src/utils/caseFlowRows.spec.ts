// 戊波二 T10：被解释的 MATCHED 行默认可见 + 计入 Hero 已解释合计 + ITR 号去划转单页。
import {
  awaitsReconcile, explainedByKind, explainedSumMinor, hiddenMatchedCount, isExplainedRow, visibleFlowRows,
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

// 戊波二 T11 修复（R41）：Hero「awaiting re-reconcile」只对「已落账但还没被上一轮轧掉」的行成立。
describe('awaitsReconcile', () => {
  type A = Parameters<typeof awaitsReconcile>[0][number];
  const mm = (extra: Partial<A> = {}): A => ({ matchType: 'AMOUNT_MISMATCH', ...extra });
  const withAdj = (status: string): A => mm({ disposition: { adjustmentStatus: status } as A['disposition'] });

  it('异常行上挂的调账单已 POSTED（还没重对账）→ 在等', () => {
    expect(awaitsReconcile([withAdj('POSTED')])).toBe(true);
  });
  it('调账单还没落账（待批 / 草稿）→ 不是在等重对账，是在等 CFO', () => {
    expect(awaitsReconcile([withAdj('PENDING_APPROVAL'), withAdj('DRAFT')])).toBe(false);
  });
  it('认损补缺单已记短缺（recognized）而行还是异常行 → 在等；没记成 → 不等', () => {
    const t = (recognized: boolean): A => mm({ transfer: { transferNo: 'ITR1', purpose: 'SHORTFALL_TOPUP', status: 'EXECUTING', recognized } });
    expect(awaitsReconcile([t(true)])).toBe(true);
    expect(awaitsReconcile([t(false)])).toBe(false);
  });
  it('已被第 0 轮配成 MATCHED 的行（带 explainedBy）早已轧掉，不触发；在途 / 对内差额行也不触发', () => {
    const matched: A = { matchType: 'MATCHED', disposition: { adjustmentStatus: 'POSTED' } as A['disposition'], transfer: { transferNo: 'ITR1', purpose: 'SHORTFALL_TOPUP', status: 'SUCCESS', recognized: true } };
    expect(awaitsReconcile([matched, { matchType: 'IN_TRANSIT' }, { matchType: 'INVARIANT' }])).toBe(false);
  });
  it('一条已轧掉、另一条异常行挂着已落账单据 → 仍在等（只要有一条没轧掉）', () => {
    expect(awaitsReconcile([{ matchType: 'MATCHED' }, withAdj('POSTED')])).toBe(true);
  });
});
