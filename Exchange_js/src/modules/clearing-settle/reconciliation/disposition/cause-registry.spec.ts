import { menuFor, resolveOutlet, CAUSE_REGISTRY, CauseCode } from './cause-registry';

describe('cause-registry —— 六格成因菜单（spec §4，注册表单一来源）', () => {
  const codes = (mt: any, book: any) => menuFor(mt, book).map((m) => m.code);

  it('金额不对 × 客户', () => {
    expect(codes('AMOUNT_MISMATCH', 'CLIENT')).toEqual([
      'AMT_MISBOOKED', 'AMT_FEE_NETTED', 'AMT_ROUNDING', 'PRECISION_DUST', 'UNEXPLAINED',
    ]);
  });
  it('金额不对 × 公司', () => {
    expect(codes('AMOUNT_MISMATCH', 'FIRM')).toEqual([
      'FIRM_AMT_UNDERBOOKED', 'FIRM_AMT_OVERBOOKED', 'PRECISION_DUST', 'UNEXPLAINED',
    ]);
  });
  it('我有外无 × 客户', () => {
    expect(codes('ORPHAN_INTERNAL', 'CLIENT')).toEqual([
      'DUP_BOOKING', 'PHANTOM_BOOKING', 'PAYOUT_NOT_EXECUTED', 'MISATTRIBUTED_FROM', 'CUTOFF_STRADDLE', 'UNEXPLAINED',
    ]);
  });
  it('我有外无 × 公司', () => {
    expect(codes('ORPHAN_INTERNAL', 'FIRM')).toEqual([
      'FIRM_MISBOOKED', 'FIRM_TRANSFER_UNTRACKED', 'UNEXPLAINED',
    ]);
  });
  it('外有我无 × 客户', () => {
    expect(codes('ORPHAN_EXTERNAL', 'CLIENT')).toEqual([
      'MISSED_DEPOSIT', 'BOUNCED_FUNDS', 'MISATTRIBUTED_TO', 'UNAUTHORIZED_OUTFLOW', 'UNEXPLAINED',
    ]);
  });
  it('外有我无 × 公司', () => {
    expect(codes('ORPHAN_EXTERNAL', 'FIRM')).toEqual([
      'BANK_INTEREST_UNBOOKED', 'BANK_CHARGE_UNBOOKED', 'UNCLAIMED_INFLOW', 'UNEXPLAINED',
    ]);
  });
  it('21 码分完，无遗漏：每个码至少出现在一个格的菜单里', () => {
    const all = new Set<string>();
    (['AMOUNT_MISMATCH', 'ORPHAN_INTERNAL', 'ORPHAN_EXTERNAL'] as const).forEach((mt) =>
      (['CLIENT', 'FIRM'] as const).forEach((book) => codes(mt, book).forEach((c) => all.add(c))));
    expect([...all].sort()).toEqual(Object.keys(CAUSE_REGISTRY).sort());
  });
});

describe('resolveOutlet —— 出口与 reason 派生（spec §4）', () => {
  it('冲正：reason 按内部流水 sourceType 派生，方向按差额符号', () => {
    expect(resolveOutlet('AMT_MISBOOKED', {
      matchType: 'AMOUNT_MISMATCH', book: 'CLIENT', deltaSign: 1, internalSourceType: 'DEPOSIT',
    })).toEqual({
      outlet: 'ADJUST_CORRECT', outletLabel: '冲正', family: 'CORRECT',
      reasonCode: 'DEPOSIT_AMOUNT_CORRECTION', direction: 'INCREASE',
    });
    expect(resolveOutlet('AMT_MISBOOKED', {
      matchType: 'AMOUNT_MISMATCH', book: 'CLIENT', deltaSign: -1, internalSourceType: 'WITHDRAW',
    }).reasonCode).toBe('WITHDRAW_AMOUNT_CORRECTION');
    expect(resolveOutlet('AMT_MISBOOKED', {
      matchType: 'AMOUNT_MISMATCH', book: 'CLIENT', deltaSign: -1, internalSourceType: 'WITHDRAW',
    }).direction).toBe('REDUCE');
  });
  it('冲正遇 SWAP 流水：本轮无码 → 留档（spec §11-6）', () => {
    const r = resolveOutlet('AMT_MISBOOKED', {
      matchType: 'AMOUNT_MISMATCH', book: 'CLIENT', deltaSign: 1, internalSourceType: 'SWAP',
    });
    expect(r.outlet).toBe('DEFERRED');
    expect(r.deferredTarget).toBe('NO_REASON_CODE');
  });
  it('冲销：reason 一码一因，方向 = 内部流水方向取反', () => {
    expect(resolveOutlet('DUP_BOOKING', {
      matchType: 'ORPHAN_INTERNAL', book: 'CLIENT', internalDirection: 'IN',
    })).toEqual({
      outlet: 'ADJUST_REVERSE', outletLabel: '冲销', family: 'REVERSE',
      reasonCode: 'DEPOSIT_DUPLICATE_REVERSAL', direction: 'REDUCE',
    });
    expect(resolveOutlet('PHANTOM_BOOKING', {
      matchType: 'ORPHAN_INTERNAL', book: 'CLIENT', internalDirection: 'IN',
    }).reasonCode).toBe('DEPOSIT_SIGNAL_VOID');
    expect(resolveOutlet('PAYOUT_NOT_EXECUTED', {
      matchType: 'ORPHAN_INTERNAL', book: 'CLIENT', internalDirection: 'OUT',
    })).toEqual(expect.objectContaining({ reasonCode: 'WITHDRAW_VOID_REFUND', direction: 'INCREASE' }));
  });
  it('补记：公司金额差按差额符号选码；公司孤儿按外部方向', () => {
    expect(resolveOutlet('FIRM_AMT_UNDERBOOKED', {
      matchType: 'AMOUNT_MISMATCH', book: 'FIRM', deltaSign: -1,
    })).toEqual(expect.objectContaining({ outlet: 'ADJUST_RECORD', reasonCode: 'BANK_CHARGE', direction: 'REDUCE' }));
    expect(resolveOutlet('BANK_INTEREST_UNBOOKED', {
      matchType: 'ORPHAN_EXTERNAL', book: 'FIRM', externalDirection: 'IN',
    })).toEqual(expect.objectContaining({ reasonCode: 'BANK_INTEREST', direction: 'INCREASE' }));
    expect(resolveOutlet('BANK_CHARGE_UNBOOKED', {
      matchType: 'ORPHAN_EXTERNAL', book: 'FIRM', externalDirection: 'OUT',
    })).toEqual(expect.objectContaining({ reasonCode: 'BANK_CHARGE', direction: 'REDUCE' }));
  });
  it('改记：两端同码 CUSTOMER_REATTRIBUTION，无方向', () => {
    const from = resolveOutlet('MISATTRIBUTED_FROM', { matchType: 'ORPHAN_INTERNAL', book: 'CLIENT', internalDirection: 'IN' });
    const to = resolveOutlet('MISATTRIBUTED_TO', { matchType: 'ORPHAN_EXTERNAL', book: 'CLIENT', externalDirection: 'IN' });
    for (const r of [from, to]) {
      expect(r.outlet).toBe('ADJUST_REATTRIBUTE');
      expect(r.reasonCode).toBe('CUSTOMER_REATTRIBUTION');
      expect(r.direction).toBeUndefined();
    }
  });
  it('挂起两子类', () => {
    expect(resolveOutlet('CUTOFF_STRADDLE', { matchType: 'ORPHAN_INTERNAL', book: 'CLIENT' }).outlet).toBe('HOLD_NEXT_PERIOD');
    expect(resolveOutlet('UNEXPLAINED', { matchType: 'AMOUNT_MISMATCH', book: 'FIRM' }).outlet).toBe('HOLD_INVESTIGATING');
    expect(resolveOutlet('UNCLAIMED_INFLOW', { matchType: 'ORPHAN_EXTERNAL', book: 'FIRM' }).outlet).toBe('HOLD_INVESTIGATING');
  });
  it('留档四路：补单进/补单出/公司冲销/事故', () => {
    expect(resolveOutlet('MISSED_DEPOSIT', { matchType: 'ORPHAN_EXTERNAL', book: 'CLIENT' }))
      .toEqual(expect.objectContaining({ outlet: 'DEFERRED', deferredTarget: 'SUPPLEMENT_DEPOSIT' }));
    expect(resolveOutlet('BOUNCED_FUNDS', { matchType: 'ORPHAN_EXTERNAL', book: 'CLIENT' }).deferredTarget).toBe('SUPPLEMENT_BOUNCE');
    expect(resolveOutlet('FIRM_AMT_OVERBOOKED', { matchType: 'AMOUNT_MISMATCH', book: 'FIRM' }).deferredTarget).toBe('FIRM_REVERSAL');
    expect(resolveOutlet('UNAUTHORIZED_OUTFLOW', { matchType: 'ORPHAN_EXTERNAL', book: 'CLIENT' }).deferredTarget).toBe('INCIDENT');
  });
  it('成因不属于该格 → 显式拒绝（无兜底档的机器面）', () => {
    expect(() => resolveOutlet('BANK_INTEREST_UNBOOKED', { matchType: 'ORPHAN_INTERNAL', book: 'CLIENT' })).toThrow(/不属于/);
  });
});
