import {
  getSwapStatusMeta,
  isSwapTerminalStatus,
  ALL_SWAP_STATUSES,
  SWAP_STATUS_FILTERS,
} from './swapStatusMap';

/* 七个后端状态,来源：
   src/modules/trading/swap-transactions/dto/swap-transaction.dto.ts */
const BACKEND_STATUSES = [
  'COMPLIANCE_PENDING',
  'PROCESSING',
  'SUCCESS',
  'REJECTED',
  'FROZEN',
  'FAILED',
  'REVERSED',
];

describe('swapStatusMap', () => {
  it('FROZEN 是红色 —— 与充值/提现同口径,不是 StatusPill 的青色', () => {
    const meta = getSwapStatusMeta('FROZEN');
    expect(meta.group).toBe('NEEDS_OFFICER');
    expect(meta.badgeClass).toContain('adm-red');
    expect(meta.badgeClass).not.toContain('cyan');
  });

  /* 直接比对映射表的**键集**,而不是「label 不含 UNKNOWN」——
     后者对「整条映射条目被删」测不出来：fallback 会把 label 设成状态码本身,
     断言照样绿。键集断言删一条/多一条都红。 */
  it('映射表键集 == 七个后端状态,一个不多一个不少', () => {
    expect([...ALL_SWAP_STATUSES].sort()).toEqual([...BACKEND_STATUSES].sort());
  });

  it('七个后端状态都拿到真条目(不是 fallback)', () => {
    for (const s of BACKEND_STATUSES) {
      const meta = getSwapStatusMeta(s);
      // fallback 的 badgeClass 恒为 WARNING(adm-yellow);真条目一律不是它
      expect(meta.badgeClass).not.toContain('adm-yellow');
      expect(meta.badgeClass).toMatch(/adm-/);
    }
  });

  it('未映射状态落 WARNING 且原样显示状态码（不静默吞）', () => {
    const meta = getSwapStatusMeta('SOME_FUTURE_STATUS');
    expect(meta.label).toBe('SOME_FUTURE_STATUS');
    expect(meta.group).toBe('EXCEPTION');
    expect(meta.badgeClass).toContain('adm-yellow');
  });

  it('FROZEN 算终态 —— 兑换域零出边(与提现的 FROZEN 刻意相反)', () => {
    expect(isSwapTerminalStatus('FROZEN')).toBe(true);
  });

  it('终态判定 == 转移表里出边为空的那几行,一个不多一个不少', () => {
    const terminal = ['SUCCESS', 'REJECTED', 'FROZEN', 'FAILED', 'REVERSED'];
    for (const s of BACKEND_STATUSES) {
      expect(isSwapTerminalStatus(s)).toBe(terminal.includes(s));
    }
  });

  it('筛选分组覆盖到每个状态', () => {
    const grouped = SWAP_STATUS_FILTERS.flatMap((f) => f.statuses);
    for (const s of ['COMPLIANCE_PENDING', 'PROCESSING', 'SUCCESS', 'REJECTED', 'FROZEN']) {
      expect(grouped).toContain(s);
    }
  });
});
