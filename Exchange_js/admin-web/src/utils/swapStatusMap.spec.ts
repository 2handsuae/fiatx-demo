import { getSwapStatusMeta, SWAP_STATUS_FILTERS } from './swapStatusMap';

describe('swapStatusMap', () => {
  it('FROZEN 是红色 —— 与充值/提现同口径,不是 StatusPill 的青色', () => {
    const meta = getSwapStatusMeta('FROZEN');
    expect(meta.group).toBe('NEEDS_OFFICER');
    expect(meta.badgeClass).toContain('adm-red');
    expect(meta.badgeClass).not.toContain('cyan');
  });

  it('七个后端状态全覆盖', () => {
    for (const s of ['COMPLIANCE_PENDING', 'PROCESSING', 'SUCCESS', 'REJECTED', 'FROZEN', 'FAILED', 'REVERSED']) {
      expect(getSwapStatusMeta(s).label).not.toContain('UNKNOWN');
    }
  });

  it('未映射状态落 WARNING 且原样显示状态码（不静默吞）', () => {
    const meta = getSwapStatusMeta('SOME_FUTURE_STATUS');
    expect(meta.label).toBe('SOME_FUTURE_STATUS');
    expect(meta.group).toBe('EXCEPTION');
    expect(meta.badgeClass).toContain('adm-yellow');
  });

  it('筛选分组覆盖到每个状态', () => {
    const grouped = SWAP_STATUS_FILTERS.flatMap((f) => f.statuses);
    for (const s of ['COMPLIANCE_PENDING', 'PROCESSING', 'SUCCESS', 'REJECTED', 'FROZEN']) {
      expect(grouped).toContain(s);
    }
  });
});
