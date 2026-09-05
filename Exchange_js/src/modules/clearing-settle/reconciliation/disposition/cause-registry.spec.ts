import { menuFor, resolveOutlet, staticOutletLabel, CAUSE_REGISTRY, CauseCode, FAMILY_LABEL, resolveWriteOff } from './cause-registry';

describe('cause-registry —— 六格成因菜单（spec §4，注册表单一来源）', () => {
  const codes = (mt: any, book: any) => menuFor(mt, book).map((m) => m.code);

  it('金额不对 × 客户', () => {
    expect(codes('AMOUNT_MISMATCH', 'CLIENT')).toEqual(['AMT_MISBOOKED', 'AMT_FEE_NETTED', 'AMT_ROUNDING', 'UNEXPLAINED']);
  });
  it('金额不对 × 公司', () => {
    expect(codes('AMOUNT_MISMATCH', 'FIRM')).toEqual(['FIRM_AMT_UNDERBOOKED', 'FIRM_AMT_OVERBOOKED', 'UNEXPLAINED']);
  });
  it('我有外无 × 客户', () => {
    expect(codes('ORPHAN_INTERNAL', 'CLIENT')).toEqual([
      'DUP_BOOKING', 'PHANTOM_BOOKING', 'PAYOUT_NOT_EXECUTED', 'MISATTRIBUTED_FROM', 'CUTOFF_STRADDLE', 'UNEXPLAINED',
    ]);
  });
  it('我有外无 × 公司', () => {
    expect(codes('ORPHAN_INTERNAL', 'FIRM')).toEqual([
      'FIRM_MISBOOKED', 'UNEXPLAINED',
    ]);
  });
  it('外有我无 × 客户', () => {
    expect(codes('ORPHAN_EXTERNAL', 'CLIENT')).toEqual([
      'MISSED_DEPOSIT', 'BOUNCED_FUNDS', 'PAYOUT_RETURNED', 'MISATTRIBUTED_TO', 'UNAUTHORIZED_OUTFLOW', 'UNEXPLAINED',
    ]);
  });
  it('外有我无 × 公司', () => {
    expect(codes('ORPHAN_EXTERNAL', 'FIRM')).toEqual([
      'BANK_INTEREST_UNBOOKED', 'BANK_CHARGE_UNBOOKED', 'UNCLAIMED_INFLOW', 'UNEXPLAINED',
    ]);
  });
  it('20 码分完，无遗漏：每个码至少出现在一个格的菜单里', () => {
    const all = new Set<string>();
    (['AMOUNT_MISMATCH', 'ORPHAN_INTERNAL', 'ORPHAN_EXTERNAL'] as const).forEach((mt) =>
      (['CLIENT', 'FIRM'] as const).forEach((book) => codes(mt, book).forEach((c) => all.add(c))));
    expect([...all].sort()).toEqual(Object.keys(CAUSE_REGISTRY).sort());
  });
});

describe('resolveOutlet —— 出口与 reason 派生（spec §4）', () => {
  it('冲正：reason 按内部流水 sourceType 派生，方向按差额符号', () => {
    expect(resolveOutlet('AMT_MISBOOKED', {
      matchType: 'AMOUNT_MISMATCH', book: 'CLIENT', deltaSign: 1,
      internalDirection: 'IN', internalSourceType: 'DEPOSIT',
    })).toEqual({
      outlet: 'ADJUST_CORRECT', outletLabel: '冲正', family: 'CORRECT',
      reasonCode: 'DEPOSIT_AMOUNT_CORRECTION', direction: 'INCREASE',
    });
    expect(resolveOutlet('AMT_MISBOOKED', {
      matchType: 'AMOUNT_MISMATCH', book: 'CLIENT', deltaSign: -1,
      internalDirection: 'IN', internalSourceType: 'DEPOSIT',
    }).direction).toBe('REDUCE');
    expect(resolveOutlet('AMT_MISBOOKED', {
      matchType: 'AMOUNT_MISMATCH', book: 'CLIENT', deltaSign: -1,
      internalDirection: 'OUT', internalSourceType: 'WITHDRAW',
    }).reasonCode).toBe('WITHDRAW_AMOUNT_CORRECTION');
  });
  // 出账流水（提现、公司支出）：deltaSign 是原始金额差，钱的方向是反的——
  // 这一组四个用例就是「翻符号」那一行的行为证据，改回不翻会当场变红。
  it('冲正 · 客户提现（OUT）：银行多扣要减、少扣要加，不是照原始差额符号', () => {
    // 我方记 90、银行实扣 100 → 原始差 +10，但客户余额是**多**出来的 10 → 减
    expect(resolveOutlet('AMT_MISBOOKED', {
      matchType: 'AMOUNT_MISMATCH', book: 'CLIENT', deltaSign: 1,
      internalDirection: 'OUT', internalSourceType: 'WITHDRAW',
    })).toEqual({
      outlet: 'ADJUST_CORRECT', outletLabel: '冲正', family: 'CORRECT',
      reasonCode: 'WITHDRAW_AMOUNT_CORRECTION', direction: 'REDUCE',
    });
    // 我方记 90、银行实扣 80 → 原始差 −10，客户被多扣了 10 → 退还，加
    expect(resolveOutlet('AMT_MISBOOKED', {
      matchType: 'AMOUNT_MISMATCH', book: 'CLIENT', deltaSign: -1,
      internalDirection: 'OUT', internalSourceType: 'WITHDRAW',
    })).toEqual({
      outlet: 'ADJUST_CORRECT', outletLabel: '冲正', family: 'CORRECT',
      reasonCode: 'WITHDRAW_AMOUNT_CORRECTION', direction: 'INCREASE',
    });
  });
  it('补记 · 公司支出（OUT）记少 = 银行杂费，不是银行利息（手册「支出差补记为银行杂费」）', () => {
    // 公司账户实扣 100 > 所记 90 → 原始差 +10，这是笔没入账的银行扣费 → 杂费、减
    expect(resolveOutlet('FIRM_AMT_UNDERBOOKED', {
      matchType: 'AMOUNT_MISMATCH', book: 'FIRM', deltaSign: 1, internalDirection: 'OUT',
    })).toEqual(expect.objectContaining({
      outlet: 'ADJUST_RECORD', family: 'RECORD', reasonCode: 'BANK_CHARGE', direction: 'REDUCE',
    }));
    // 对照组：公司收入（IN）记少 → 利息、加（手册「收入差补记为银行利息」）
    expect(resolveOutlet('FIRM_AMT_UNDERBOOKED', {
      matchType: 'AMOUNT_MISMATCH', book: 'FIRM', deltaSign: 1, internalDirection: 'IN',
    })).toEqual(expect.objectContaining({ reasonCode: 'BANK_INTEREST', direction: 'INCREASE' }));
  });
  it('公司支出记多：金额不对 × 公司 → 冲销（A 批定码，出账流水翻符号后为加）', () => {
    expect(resolveOutlet('FIRM_AMT_OVERBOOKED', {
      matchType: 'AMOUNT_MISMATCH', book: 'FIRM', deltaSign: -1, internalDirection: 'OUT',
    })).toEqual(expect.objectContaining({ outlet: 'ADJUST_REVERSE', family: 'REVERSE', reasonCode: 'FIRM_ENTRY_REVERSAL', direction: 'INCREASE' }));
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
  it('留档一路：事故（补单三路 B 批已改走 SUPPLEMENT 出口，见下方新增用例；公司冲销 A 批已定码，不再留档）', () => {
    expect(resolveOutlet('UNAUTHORIZED_OUTFLOW', { matchType: 'ORPHAN_EXTERNAL', book: 'CLIENT' }).deferredTarget).toBe('INCIDENT');
  });
  it('成因不属于该格 → 显式拒绝（无兜底档的机器面）', () => {
    expect(() => resolveOutlet('BANK_INTEREST_UNBOOKED', { matchType: 'ORPHAN_INTERNAL', book: 'CLIENT' })).toThrow(/不属于/);
  });
});

describe('平账 A 批：公司账簿冲销定码 + 核销判定（spec §3.3 / §5）', () => {
  it('精度尘埃差已删（豁免不做，decisions 2026-09-02）', () => {
    expect((CAUSE_REGISTRY as any).PRECISION_DUST).toBeUndefined();
  });
  it('公司收支记多：金额不对 × 公司 → 冲销，方向按差额符号（记多 = 外部 − 内部为负 → 减）', () => {
    const r = resolveOutlet('FIRM_AMT_OVERBOOKED', { matchType: 'AMOUNT_MISMATCH', book: 'FIRM', deltaSign: -1, internalDirection: 'IN' });
    expect(r).toEqual({ outlet: 'ADJUST_REVERSE', outletLabel: '冲销', family: 'REVERSE', reasonCode: 'FIRM_ENTRY_REVERSAL', direction: 'REDUCE' });
  });
  it('公司收支记多·出账流水翻符号：内部 OUT 记 100、银行实扣 90 → 原始差 −10 → 翻成 +10 → 加', () => {
    const r = resolveOutlet('FIRM_AMT_OVERBOOKED', { matchType: 'AMOUNT_MISMATCH', book: 'FIRM', deltaSign: -1, internalDirection: 'OUT' });
    expect(r.direction).toBe('INCREASE');
  });
  it('公司收支误记：我有外无 × 公司 → 冲销，方向 = 内部方向取反', () => {
    expect(resolveOutlet('FIRM_MISBOOKED', { matchType: 'ORPHAN_INTERNAL', book: 'FIRM', internalDirection: 'IN' }).direction).toBe('REDUCE');
    expect(resolveOutlet('FIRM_MISBOOKED', { matchType: 'ORPHAN_INTERNAL', book: 'FIRM', internalDirection: 'OUT' }).direction).toBe('INCREASE');
  });
  it('族词表含核销', () => {
    expect(FAMILY_LABEL.WRITE_OFF).toBe('核销');
  });
  describe('resolveWriteOff：一句原则「让内部等于外部」', () => {
    it('金额不对：外部 < 内部（入账）→ 减，金额 = |差额|', () => {
      expect(resolveWriteOff({ matchType: 'AMOUNT_MISMATCH', book: 'FIRM', deltaSign: -1, internalDirection: 'IN', deltaAmount: '-7' }))
        .toEqual({ reasonCode: 'UNEXPLAINED_WRITE_OFF', family: 'WRITE_OFF', direction: 'REDUCE', amountMinor: '7' });
    });
    it('金额不对：出账流水翻符号——内部 OUT 记 90、外部扣 100，原始差 +10 → 减', () => {
      expect(resolveWriteOff({ matchType: 'AMOUNT_MISMATCH', book: 'FIRM', deltaSign: 1, internalDirection: 'OUT', deltaAmount: '10' }).direction).toBe('REDUCE');
    });
    it('我有外无：内部 IN → 减、OUT → 加，金额 = 内部行金额', () => {
      expect(resolveWriteOff({ matchType: 'ORPHAN_INTERNAL', book: 'FIRM', internalDirection: 'IN', internalAmount: '500' }))
        .toEqual({ reasonCode: 'UNEXPLAINED_WRITE_OFF', family: 'WRITE_OFF', direction: 'REDUCE', amountMinor: '500' });
      expect(resolveWriteOff({ matchType: 'ORPHAN_INTERNAL', book: 'FIRM', internalDirection: 'OUT', internalAmount: '500' }).direction).toBe('INCREASE');
    });
    it('外有我无：外部 IN → 加、OUT → 减，金额 = 外部行金额', () => {
      expect(resolveWriteOff({ matchType: 'ORPHAN_EXTERNAL', book: 'FIRM', externalDirection: 'IN', externalAmount: '300' }))
        .toEqual({ reasonCode: 'UNEXPLAINED_WRITE_OFF', family: 'WRITE_OFF', direction: 'INCREASE', amountMinor: '300' });
      expect(resolveWriteOff({ matchType: 'ORPHAN_EXTERNAL', book: 'FIRM', externalDirection: 'OUT', externalAmount: '300' }).direction).toBe('REDUCE');
    });
    it('客户池：成因码是 UNEXPLAINED_CLIENT_LOSS，方向仍按「让内部等于外部」', () => {
      const r = resolveWriteOff({ matchType: 'AMOUNT_MISMATCH', book: 'CLIENT', deltaSign: -1, internalDirection: 'IN', deltaAmount: '-7500000' });
      expect(r).toEqual({ reasonCode: 'UNEXPLAINED_CLIENT_LOSS', family: 'WRITE_OFF', direction: 'REDUCE', amountMinor: '7500000' });
      const inc = resolveWriteOff({ matchType: 'ORPHAN_EXTERNAL', book: 'CLIENT', externalDirection: 'IN', externalAmount: '100' });
      expect(inc.reasonCode).toBe('UNEXPLAINED_CLIENT_LOSS');
      expect(inc.direction).toBe('INCREASE'); // 方向照算；「客户池不许 INCREASE」由 adjustment.service 与读面拦，不在纯函数里拦
    });
    it('公司池仍是 UNEXPLAINED_WRITE_OFF', () => {
      expect(resolveWriteOff({ matchType: 'ORPHAN_INTERNAL', book: 'FIRM', internalDirection: 'IN', internalAmount: '7' }).reasonCode).toBe('UNEXPLAINED_WRITE_OFF');
    });
  });
  it('FIRM_TRANSFER_UNTRACKED 已退役（二期不做公司池调拨，出口永远点不通）', () => {
    expect((CAUSE_REGISTRY as any).FIRM_TRANSFER_UNTRACKED).toBeUndefined();
  });
});

describe('平账 B 批：补单出口（spec §6）', () => {
  it('成因码 20 个；三码走 SUPPLEMENT 出口', () => {
    expect(Object.keys(CAUSE_REGISTRY)).toHaveLength(20);
    expect(CAUSE_REGISTRY.MISSED_DEPOSIT.kind).toBe('SUPPLEMENT');
    expect(CAUSE_REGISTRY.BOUNCED_FUNDS.kind).toBe('SUPPLEMENT');
    expect(CAUSE_REGISTRY.PAYOUT_RETURNED.kind).toBe('SUPPLEMENT');
    expect(staticOutletLabel('MISSED_DEPOSIT')).toBe('补单·充值补录');
    expect(staticOutletLabel('BOUNCED_FUNDS')).toBe('补单·退汇认领');
    expect(staticOutletLabel('PAYOUT_RETURNED')).toBe('补单·退回认领');
  });
  it('resolveOutlet：出口 SUPPLEMENT + 去向', () => {
    expect(resolveOutlet('MISSED_DEPOSIT', { matchType: 'ORPHAN_EXTERNAL', book: 'CLIENT', externalDirection: 'IN' }))
      .toEqual({ outlet: 'SUPPLEMENT', outletLabel: '补单·充值补录', deferredTarget: 'SUPPLEMENT_DEPOSIT' });
    expect(resolveOutlet('BOUNCED_FUNDS', { matchType: 'ORPHAN_EXTERNAL', book: 'CLIENT', externalDirection: 'OUT' }).deferredTarget).toBe('SUPPLEMENT_BOUNCE');
    expect(resolveOutlet('PAYOUT_RETURNED', { matchType: 'ORPHAN_EXTERNAL', book: 'CLIENT', externalDirection: 'IN' }).deferredTarget).toBe('SUPPLEMENT_PAYOUT_RETURN');
  });
  it('成因与账单行方向不符 → 400', () => {
    expect(() => resolveOutlet('MISSED_DEPOSIT', { matchType: 'ORPHAN_EXTERNAL', book: 'CLIENT', externalDirection: 'OUT' })).toThrow(/方向不符/);
    expect(() => resolveOutlet('BOUNCED_FUNDS', { matchType: 'ORPHAN_EXTERNAL', book: 'CLIENT', externalDirection: 'IN' })).toThrow(/方向不符/);
  });
  it('菜单顺序：外有我无×客户 = 漏记 / 退汇 / 退回 / 记错客户 / 未授权 / 查不出', () => {
    expect(menuFor('ORPHAN_EXTERNAL', 'CLIENT').map((m) => m.code))
      .toEqual(['MISSED_DEPOSIT', 'BOUNCED_FUNDS', 'PAYOUT_RETURNED', 'MISATTRIBUTED_TO', 'UNAUTHORIZED_OUTFLOW', 'UNEXPLAINED']);
  });
});
