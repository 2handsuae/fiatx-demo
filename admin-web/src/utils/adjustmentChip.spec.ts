import { adjustmentChip } from './adjustmentChip';

describe('adjustmentChip（案件页差异行 Status 标签，按挂着的调账单 status）', () => {
  const A = 'ADJ261107000001';

  it('POSTED → Explained · ADJ…，带对勾（重对账之前就是这个，不等 Re-reconcile）', () => {
    expect(adjustmentChip({ adjustmentNo: A, status: 'POSTED' }))
      .toEqual({ tone: 'green', label: `Explained · ${A}`, check: true });
  });

  it('待批 / 草稿 / 读面没带状态 → Pending CFO · ADJ…', () => {
    for (const status of ['PENDING_APPROVAL', 'DRAFT', null, undefined]) {
      expect(adjustmentChip({ adjustmentNo: A, status })).toEqual({ tone: 'blue', label: `Pending CFO · ${A}` });
    }
  });

  it('REJECTED 不会冒充待批或已解释', () => {
    const chip = adjustmentChip({ adjustmentNo: A, status: 'REJECTED' });
    expect(chip.tone).toBe('gray');
    expect(chip.label).toBe(`Rejected · ${A}`);
  });
});
