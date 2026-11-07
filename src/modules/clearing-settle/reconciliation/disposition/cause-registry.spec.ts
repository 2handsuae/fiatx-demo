import { CAUSE_REGISTRY, CLIENT_SHORTFALL_CAUSE, CauseCode, causeDisplayLabel, resolveWriteOff, resolveAdjustmentPrefill } from './cause-registry';
import { dispositionsFor, causesFor, outletOf, rowDirection } from './cause-registry';

describe('cause-registry —— six-cell cause menu (spec §4, registry is the single source of truth)', () => {
  // Task 13：menuFor（唯一消费者是被删的 resolveOutlet/staticOutletLabel 反推链）已退役，
  // 覆盖面改用 causesFor（唯一真相仍是 CAUSE_REGISTRY，逐处置聚合）+ 下方「19 码无遗漏」
  // 的穷尽性断言，不重建一份平铺菜单。
  // codesInCell 保序返回数组（声明顺序），六格断言用有序数组比较——挪行必须炸（见文件头注释）。
  const codesInCell = (mt: any, book: any): string[] =>
    (Object.entries(CAUSE_REGISTRY) as Array<[CauseCode, any]>)
      .filter(([, s]) => s.cells.some((c: any) => c.matchType === mt && c.book === book))
      .map(([code]) => code);

  // 终审修复批 Item 7：CUTOFF_STRADDLE 的 cells 从单格扩到 ALL_CELLS（跨日切六格都可能
  // 发生），codesInCell 是按 CAUSE_REGISTRY 声明顺序穷尽某格全部合法码（不按 usableIn
  // 过滤），CUTOFF_STRADDLE 声明在文件靠前位置（Internal×Client 段落内），扩到 ALL_CELLS
  // 后在其余五格里也按这个声明位置插入——不是这五格"专属"码变了，只是同一个声明顺序
  // 规则如实反映了它现在也合法。
  it('Mismatch × Client', () => {
    expect(codesInCell('AMOUNT_MISMATCH', 'CLIENT')).toEqual(['AMT_MISBOOKED', 'AMT_FEE_NETTED', 'AMT_ROUNDING', 'CUTOFF_STRADDLE', 'UNEXPLAINED', 'OTHER']);
  });
  it('Mismatch × Firm（2026-11-04：与客户格共用 AMT_* 三码）', () => {
    expect(codesInCell('AMOUNT_MISMATCH', 'FIRM')).toEqual(['AMT_MISBOOKED', 'AMT_FEE_NETTED', 'AMT_ROUNDING', 'CUTOFF_STRADDLE', 'UNEXPLAINED', 'OTHER']);
  });
  it('Internal only × Client', () => {
    expect(codesInCell('ORPHAN_INTERNAL', 'CLIENT')).toEqual([
      'DUP_BOOKING', 'PHANTOM_BOOKING', 'PAYOUT_NOT_EXECUTED', 'MISATTRIBUTED_FROM', 'CUTOFF_STRADDLE', 'UNEXPLAINED', 'OTHER',
    ]);
  });
  it('Internal only × Firm（2026-11-04：DUP_BOOKING 进公司格，声明在 FIRM_MISBOOKED 之前）', () => {
    expect(codesInCell('ORPHAN_INTERNAL', 'FIRM')).toEqual([
      'DUP_BOOKING', 'CUTOFF_STRADDLE', 'FIRM_MISBOOKED', 'UNEXPLAINED', 'OTHER',
    ]);
  });
  it('External only × Client', () => {
    expect(codesInCell('ORPHAN_EXTERNAL', 'CLIENT')).toEqual([
      'CUTOFF_STRADDLE', 'MISSED_DEPOSIT', 'BOUNCED_FUNDS', 'PAYOUT_RETURNED', 'MISATTRIBUTED_TO', 'UNAUTHORIZED_OUTFLOW', 'UNEXPLAINED', 'OTHER',
    ]);
  });
  it('External only × Firm', () => {
    expect(codesInCell('ORPHAN_EXTERNAL', 'FIRM')).toEqual([
      'CUTOFF_STRADDLE', 'BANK_INTEREST_UNBOOKED', 'BANK_CHARGE_UNBOOKED', 'UNCLAIMED_INFLOW', 'UNEXPLAINED', 'OTHER',
    ]);
  });
  it('19 codes assigned, none missing: every code appears in at least one cell (Task 1 adds OTHER, cells=ALL_CELLS)', () => {
    const all = new Set<string>();
    (['AMOUNT_MISMATCH', 'ORPHAN_INTERNAL', 'ORPHAN_EXTERNAL'] as const).forEach((mt) =>
      (['CLIENT', 'FIRM'] as const).forEach((book) => codesInCell(mt, book).forEach((c) => all.add(c))));
    expect([...all].sort()).toEqual(Object.keys(CAUSE_REGISTRY).sort());
  });
  // 公司池两个金额码退役后的「不复活」由上面的 19 码总数 + Mismatch × Firm 逐码清单兜住，不另写墓碑断言。
  it('AMT_FEE_NETTED 的文案不再限定银行（公司池的 LP 兑换扣的不是银行手续费）', () => {
    expect(CAUSE_REGISTRY.AMT_FEE_NETTED.label).toBe('Fee netted');
  });
});

describe('Recon batch A: firm-book reversal codes + write-off determination (spec §3.3 / §5)', () => {
  it('precision-dust cause removed (exempted, decisions 2026-09-02)', () => {
    expect((CAUSE_REGISTRY as any).PRECISION_DUST).toBeUndefined();
  });
  describe('resolveWriteOff: one principle — "make internal equal external"', () => {
    it('mismatch: external < internal (booked) → REDUCE, amount = |delta|', () => {
      expect(resolveWriteOff({ matchType: 'AMOUNT_MISMATCH', book: 'FIRM', deltaSign: -1, internalDirection: 'IN', deltaAmount: '-7' }))
        .toEqual({ kind: 'WRITE_OFF', reasonCode: 'UNEXPLAINED_WRITE_OFF', family: 'WRITE_OFF', direction: 'REDUCE', amountMinor: '7' });
    });
    it('mismatch: outbound flow flips sign — internal OUT records 90, external deducted 100, raw delta +10 → REDUCE', () => {
      expect(resolveWriteOff({ matchType: 'AMOUNT_MISMATCH', book: 'FIRM', deltaSign: 1, internalDirection: 'OUT', deltaAmount: '10' }).direction).toBe('REDUCE');
    });
    it('internal only: internal IN → REDUCE, OUT → INCREASE, amount = internal line amount', () => {
      expect(resolveWriteOff({ matchType: 'ORPHAN_INTERNAL', book: 'FIRM', internalDirection: 'IN', internalAmount: '500' }))
        .toEqual({ kind: 'WRITE_OFF', reasonCode: 'UNEXPLAINED_WRITE_OFF', family: 'WRITE_OFF', direction: 'REDUCE', amountMinor: '500' });
      expect(resolveWriteOff({ matchType: 'ORPHAN_INTERNAL', book: 'FIRM', internalDirection: 'OUT', internalAmount: '500' }).direction).toBe('INCREASE');
    });
    it('external only: external IN → INCREASE, OUT → REDUCE, amount = external line amount', () => {
      expect(resolveWriteOff({ matchType: 'ORPHAN_EXTERNAL', book: 'FIRM', externalDirection: 'IN', externalAmount: '300' }))
        .toEqual({ kind: 'WRITE_OFF', reasonCode: 'UNEXPLAINED_WRITE_OFF', family: 'WRITE_OFF', direction: 'INCREASE', amountMinor: '300' });
      expect(resolveWriteOff({ matchType: 'ORPHAN_EXTERNAL', book: 'FIRM', externalDirection: 'OUT', externalAmount: '300' }).direction).toBe('REDUCE');
    });
    // 戊波二 T7a：客户池认损不再是调账单——客户池分支产出 kind = SHORTFALL_TOPUP（认损补缺），成因是固定常量。
    it('client pool: kind is SHORTFALL_TOPUP with the fixed cause constant; direction still follows "make internal equal external"', () => {
      expect(CLIENT_SHORTFALL_CAUSE).toBe('UNEXPLAINED_CLIENT_LOSS');
      const r = resolveWriteOff({ matchType: 'AMOUNT_MISMATCH', book: 'CLIENT', deltaSign: -1, internalDirection: 'IN', deltaAmount: '-7500000' });
      expect(r).toEqual({ kind: 'SHORTFALL_TOPUP', reasonCode: CLIENT_SHORTFALL_CAUSE, family: 'WRITE_OFF', direction: 'REDUCE', amountMinor: '7500000' });
      const inc = resolveWriteOff({ matchType: 'ORPHAN_EXTERNAL', book: 'CLIENT', externalDirection: 'IN', externalAmount: '100' });
      expect(inc.kind).toBe('SHORTFALL_TOPUP');
      expect(inc.reasonCode).toBe(CLIENT_SHORTFALL_CAUSE);
      expect(inc.direction).toBe('INCREASE'); // direction is computed as-is; "client pool cannot INCREASE" is enforced by the shortfall top-up guard and the read side, not this pure function
    });
    it('firm pool is still UNEXPLAINED_WRITE_OFF', () => {
      const r = resolveWriteOff({ matchType: 'ORPHAN_INTERNAL', book: 'FIRM', internalDirection: 'IN', internalAmount: '7' });
      expect(r.reasonCode).toBe('UNEXPLAINED_WRITE_OFF');
      expect(r.kind).toBe('WRITE_OFF');
    });
  });
  it('FIRM_TRANSFER_UNTRACKED retired (wave 2 does not do firm-pool reallocation, this outlet never lights up)', () => {
    expect((CAUSE_REGISTRY as any).FIRM_TRANSFER_UNTRACKED).toBeUndefined();
  });
});

describe('Recon batch B: supplement outlet (spec §6)', () => {
  it('19 cause codes (Task 1 adds OTHER); three carry supplementTarget/supplementLabel (the SUPPLEMENT route)', () => {
    expect(Object.keys(CAUSE_REGISTRY)).toHaveLength(19);
    expect(CAUSE_REGISTRY.MISSED_DEPOSIT.supplementTarget).toBe('SUPPLEMENT_DEPOSIT');
    expect(CAUSE_REGISTRY.BOUNCED_FUNDS.supplementTarget).toBe('SUPPLEMENT_BOUNCE');
    expect(CAUSE_REGISTRY.PAYOUT_RETURNED.supplementTarget).toBe('SUPPLEMENT_PAYOUT_RETURN');
    expect(CAUSE_REGISTRY.MISSED_DEPOSIT.supplementLabel).toBe('Deposit backfill');
    expect(CAUSE_REGISTRY.BOUNCED_FUNDS.supplementLabel).toBe('Recall claim');
    expect(CAUSE_REGISTRY.PAYOUT_RETURNED.supplementLabel).toBe('Return claim');
  });
  it('direction 登记：恰好这九个成因只适用于单一方向，其余缺省 = 两个方向都适用（读面按行方向过滤，写端 record() 不校验）', () => {
    const registered = Object.fromEntries(
      Object.entries(CAUSE_REGISTRY).filter(([, s]) => s.direction != null).map(([code, s]) => [code, s.direction]),
    );
    expect(registered).toEqual({
      PHANTOM_BOOKING: 'IN', PAYOUT_NOT_EXECUTED: 'OUT',
      MISSED_DEPOSIT: 'IN', BOUNCED_FUNDS: 'OUT', PAYOUT_RETURNED: 'IN',
      UNAUTHORIZED_OUTFLOW: 'OUT',
      BANK_INTEREST_UNBOOKED: 'IN', BANK_CHARGE_UNBOOKED: 'OUT', UNCLAIMED_INFLOW: 'IN',
    });
  });
  it('causesFor menu order: external only × client = missed / recall / return / misattributed / unauthorized / unexplained / other', () => {
    expect(causesFor('SUPPLEMENT', 'ORPHAN_EXTERNAL', 'CLIENT').map((c) => c.code))
      .toEqual(['MISSED_DEPOSIT', 'BOUNCED_FUNDS', 'PAYOUT_RETURNED']);
  });
});

const base = { deltaSign: 1 as const, internalDirection: 'IN' as const };
describe('dispositionsFor —— 六格硬边界（spec §2）', () => {
  it('金额不对×客户 = 冲正+两挂起', () => expect(dispositionsFor({ matchType: 'AMOUNT_MISMATCH', book: 'CLIENT', ...base, internalSourceType: 'DEPOSIT' }))
    .toEqual(['CORRECT', 'HOLD_NEXT_PERIOD', 'HOLD_INVESTIGATING']));
  it('金额不对×客户 SWAP 行无冲正（A1b 甲）', () => expect(dispositionsFor({ matchType: 'AMOUNT_MISMATCH', book: 'CLIENT', ...base, internalSourceType: 'SWAP' }))
    .toEqual(['HOLD_NEXT_PERIOD', 'HOLD_INVESTIGATING']));
  it('金额不对×公司 = 更正+两挂起（2026-11-04：不再出补记/冲销）', () => expect(dispositionsFor({ matchType: 'AMOUNT_MISMATCH', book: 'FIRM', ...base, internalSourceType: 'DEPOSIT' }))
    .toEqual(['CORRECT', 'HOLD_NEXT_PERIOD', 'HOLD_INVESTIGATING']));
  it('我有外无×客户 = 冲销+改记+两挂起；SWAP 行只剩挂起+改记外还去掉冲销', () => {
    expect(dispositionsFor({ matchType: 'ORPHAN_INTERNAL', book: 'CLIENT', ...base, internalSourceType: 'DEPOSIT' }))
      .toEqual(['REVERSE', 'REATTRIBUTE', 'HOLD_NEXT_PERIOD', 'HOLD_INVESTIGATING']);
    expect(dispositionsFor({ matchType: 'ORPHAN_INTERNAL', book: 'CLIENT', ...base, internalSourceType: 'SWAP' }))
      .toEqual(['REATTRIBUTE', 'HOLD_NEXT_PERIOD', 'HOLD_INVESTIGATING']);
  });
  it('我有外无×公司 = 冲销+两挂起', () => expect(dispositionsFor({ matchType: 'ORPHAN_INTERNAL', book: 'FIRM', ...base, internalSourceType: 'DEPOSIT' }))
    .toEqual(['REVERSE', 'HOLD_NEXT_PERIOD', 'HOLD_INVESTIGATING']));
  it('外有我无×客户：入账行 = 补单+改记+两挂起（无事故）；出账行才多一个事故', () => {
    expect(dispositionsFor({ matchType: 'ORPHAN_EXTERNAL', book: 'CLIENT', externalDirection: 'IN' }))
      .toEqual(['SUPPLEMENT', 'REATTRIBUTE', 'HOLD_NEXT_PERIOD', 'HOLD_INVESTIGATING']);
    expect(dispositionsFor({ matchType: 'ORPHAN_EXTERNAL', book: 'CLIENT', externalDirection: 'OUT' }))
      .toEqual(['SUPPLEMENT', 'REATTRIBUTE', 'INCIDENT', 'HOLD_NEXT_PERIOD', 'HOLD_INVESTIGATING']);
  });
  it('外有我无×公司 = 补记+两挂起（两个方向一样）', () => {
    expect(dispositionsFor({ matchType: 'ORPHAN_EXTERNAL', book: 'FIRM', externalDirection: 'IN' }))
      .toEqual(['RECORD', 'HOLD_NEXT_PERIOD', 'HOLD_INVESTIGATING']);
    expect(dispositionsFor({ matchType: 'ORPHAN_EXTERNAL', book: 'FIRM', externalDirection: 'OUT' }))
      .toEqual(['RECORD', 'HOLD_NEXT_PERIOD', 'HOLD_INVESTIGATING']);
  });
});
describe('causesFor —— 按处置出码 + OTHER（spec §4/§5）', () => {
  const codes = (k: any, m: any, b: any) => causesFor(k, m, b).map((c) => c.code);
  it('冲正@金额不对×客户 = 三码+OTHER', () => expect(codes('CORRECT', 'AMOUNT_MISMATCH', 'CLIENT'))
    .toEqual(['AMT_MISBOOKED', 'AMT_FEE_NETTED', 'AMT_ROUNDING', 'OTHER']));
  it('冲销@我有外无×客户 = 三码+OTHER', () => expect(codes('REVERSE', 'ORPHAN_INTERNAL', 'CLIENT'))
    .toEqual(['DUP_BOOKING', 'PHANTOM_BOOKING', 'PAYOUT_NOT_EXECUTED', 'OTHER']));
  it('补记@外有我无×公司 = 利息+杂费+OTHER', () => expect(codes('RECORD', 'ORPHAN_EXTERNAL', 'FIRM'))
    .toEqual(['BANK_INTEREST_UNBOOKED', 'BANK_CHARGE_UNBOOKED', 'OTHER']));
  it('更正@金额不对×公司 = 与客户格同一组 AMT_* 三码+OTHER', () => expect(codes('CORRECT', 'AMOUNT_MISMATCH', 'FIRM'))
    .toEqual(['AMT_MISBOOKED', 'AMT_FEE_NETTED', 'AMT_ROUNDING', 'OTHER']));
  it('冲销@我有外无×公司 = 重复入账+公司记错+OTHER（声明顺序定菜单顺序）', () => expect(codes('REVERSE', 'ORPHAN_INTERNAL', 'FIRM'))
    .toEqual(['DUP_BOOKING', 'FIRM_MISBOOKED', 'OTHER']));
  it('公司格已无补记/冲销 的金额码：RECORD / REVERSE @ 金额不对×公司 只剩 OTHER', () => {
    expect(codes('RECORD', 'AMOUNT_MISMATCH', 'FIRM')).toEqual(['OTHER']);
    expect(codes('REVERSE', 'AMOUNT_MISMATCH', 'FIRM')).toEqual(['OTHER']);
  });
  it('改记/补单/事故的码固定、无 OTHER', () => {
    expect(codes('REATTRIBUTE', 'ORPHAN_INTERNAL', 'CLIENT')).toEqual(['MISATTRIBUTED_FROM']);
    expect(codes('SUPPLEMENT', 'ORPHAN_EXTERNAL', 'CLIENT')).toEqual(['MISSED_DEPOSIT', 'BOUNCED_FUNDS', 'PAYOUT_RETURNED']);
    expect(codes('INCIDENT', 'ORPHAN_EXTERNAL', 'CLIENT')).toEqual(['UNAUTHORIZED_OUTFLOW']);
  });
  // 终审修复批 Item 7：CUTOFF_STRADDLE cells 扩到 ALL_CELLS 后，「挂起·等下期」在
  // 六格里菜单都该是 [CUTOFF_STRADDLE, OTHER]（此前只有 Internal×Client 一格有
  // CUTOFF_STRADDLE，其余五格挂起·等下期只剩 OTHER 一个选项，与样机 M8 不符）；
  // 调查中@公司外有我无 = 归属排查+查无果+OTHER 不受本项改动影响，原样保留同一断言。
  it('挂起等下期 = 跨账期(+OTHER)，六格一致（终审修复批 Item 7）；调查中@公司外有我无 = 归属排查+查无果+OTHER', () => {
    (['AMOUNT_MISMATCH', 'ORPHAN_INTERNAL', 'ORPHAN_EXTERNAL'] as const).forEach((matchType) => {
      (['CLIENT', 'FIRM'] as const).forEach((book) => {
        expect(codes('HOLD_NEXT_PERIOD', matchType, book)).toEqual(['CUTOFF_STRADDLE', 'OTHER']);
      });
    });
    expect(codes('HOLD_INVESTIGATING', 'ORPHAN_EXTERNAL', 'FIRM')).toEqual(['UNCLAIMED_INFLOW', 'UNEXPLAINED', 'OTHER']);
  });

  // 2026-11-04：行方向过滤对所有处置统一成立——给了方向就摘掉 direction 登记为另一方向的成因，
  // 没登记 direction 的成因（DUP_BOOKING / OTHER / AMT_* …）两个方向都留。
  describe('带行方向（第四参）', () => {
    const dirCodes = (k: any, m: any, b: any, d: 'IN' | 'OUT') => causesFor(k, m, b, d).map((c) => c.code);
    it('③ 冲销@我有外无×客户：入账行 = 重复+幻影+OTHER；出账行 = 重复+提现未执行+OTHER', () => {
      expect(dirCodes('REVERSE', 'ORPHAN_INTERNAL', 'CLIENT', 'IN')).toEqual(['DUP_BOOKING', 'PHANTOM_BOOKING', 'OTHER']);
      expect(dirCodes('REVERSE', 'ORPHAN_INTERNAL', 'CLIENT', 'OUT')).toEqual(['DUP_BOOKING', 'PAYOUT_NOT_EXECUTED', 'OTHER']);
    });
    it('④ 冲销@我有外无×公司：重复入账没登记方向，两个方向菜单一样', () => {
      expect(dirCodes('REVERSE', 'ORPHAN_INTERNAL', 'FIRM', 'IN')).toEqual(['DUP_BOOKING', 'FIRM_MISBOOKED', 'OTHER']);
      expect(dirCodes('REVERSE', 'ORPHAN_INTERNAL', 'FIRM', 'OUT')).toEqual(['DUP_BOOKING', 'FIRM_MISBOOKED', 'OTHER']);
    });
    it('⑤ 补单@外有我无×客户：入账行 = 漏记入金+提现退回；出账行 = 入金退汇', () => {
      expect(dirCodes('SUPPLEMENT', 'ORPHAN_EXTERNAL', 'CLIENT', 'IN')).toEqual(['MISSED_DEPOSIT', 'PAYOUT_RETURNED']);
      expect(dirCodes('SUPPLEMENT', 'ORPHAN_EXTERNAL', 'CLIENT', 'OUT')).toEqual(['BOUNCED_FUNDS']);
    });
    it('⑤ 事故@外有我无×客户：未授权转出码只对出账行有，入账行摘空', () => {
      expect(dirCodes('INCIDENT', 'ORPHAN_EXTERNAL', 'CLIENT', 'OUT')).toEqual(['UNAUTHORIZED_OUTFLOW']);
      expect(dirCodes('INCIDENT', 'ORPHAN_EXTERNAL', 'CLIENT', 'IN')).toEqual([]);
    });
    it('⑥ 补记@外有我无×公司：入账行 = 银行利息+OTHER；出账行 = 银行费用+OTHER', () => {
      expect(dirCodes('RECORD', 'ORPHAN_EXTERNAL', 'FIRM', 'IN')).toEqual(['BANK_INTEREST_UNBOOKED', 'OTHER']);
      expect(dirCodes('RECORD', 'ORPHAN_EXTERNAL', 'FIRM', 'OUT')).toEqual(['BANK_CHARGE_UNBOOKED', 'OTHER']);
    });
    it('⑥ 调查中@外有我无×公司：入账行多一个无主来款，出账行没有', () => {
      expect(dirCodes('HOLD_INVESTIGATING', 'ORPHAN_EXTERNAL', 'FIRM', 'IN')).toEqual(['UNCLAIMED_INFLOW', 'UNEXPLAINED', 'OTHER']);
      expect(dirCodes('HOLD_INVESTIGATING', 'ORPHAN_EXTERNAL', 'FIRM', 'OUT')).toEqual(['UNEXPLAINED', 'OTHER']);
    });
    it('没登记方向的成因不受影响：①② 更正的 AMT_* 与六格挂起·等下期，入账 / 出账一样', () => {
      (['IN', 'OUT'] as const).forEach((d) => {
        (['CLIENT', 'FIRM'] as const).forEach((b) => {
          expect(dirCodes('CORRECT', 'AMOUNT_MISMATCH', b, d)).toEqual(['AMT_MISBOOKED', 'AMT_FEE_NETTED', 'AMT_ROUNDING', 'OTHER']);
          expect(dirCodes('HOLD_NEXT_PERIOD', 'ORPHAN_EXTERNAL', b, d)).toEqual(['CUTOFF_STRADDLE', 'OTHER']);
        });
      });
    });
    it('不给方向（行上没带方向）= 不过滤，保持整格菜单', () => {
      expect(causesFor('RECORD', 'ORPHAN_EXTERNAL', 'FIRM', undefined).map((c) => c.code))
        .toEqual(['BANK_INTEREST_UNBOOKED', 'BANK_CHARGE_UNBOOKED', 'OTHER']);
    });
  });
});

describe('rowDirection —— 行方向的定义', () => {
  it('外有我无看外部流水方向（即便带了内部方向也不看）', () => {
    expect(rowDirection({ matchType: 'ORPHAN_EXTERNAL', book: 'CLIENT', externalDirection: 'OUT', internalDirection: 'IN' })).toBe('OUT');
    expect(rowDirection({ matchType: 'ORPHAN_EXTERNAL', book: 'FIRM', externalDirection: 'IN' })).toBe('IN');
  });
  it('金额不对 / 我有外无 看内部流水方向（即便带了外部方向也不看）', () => {
    expect(rowDirection({ matchType: 'AMOUNT_MISMATCH', book: 'CLIENT', internalDirection: 'OUT', externalDirection: 'IN' })).toBe('OUT');
    expect(rowDirection({ matchType: 'ORPHAN_INTERNAL', book: 'FIRM', internalDirection: 'IN', externalDirection: 'OUT' })).toBe('IN');
  });
  it('对应方向缺失 → undefined', () => {
    expect(rowDirection({ matchType: 'ORPHAN_EXTERNAL', book: 'CLIENT', internalDirection: 'IN' })).toBeUndefined();
    expect(rowDirection({ matchType: 'ORPHAN_INTERNAL', book: 'CLIENT', externalDirection: 'IN' })).toBeUndefined();
  });
});
it('outletOf 存储映射稳定（spec §8 值域沿用）', () => {
  expect(outletOf('CORRECT')).toBe('ADJUST_CORRECT');
  expect(outletOf('REATTRIBUTE')).toBe('ADJUST_REATTRIBUTE');
  expect(outletOf('HOLD_NEXT_PERIOD')).toBe('HOLD_NEXT_PERIOD');
});

describe('dispositionsFor — 公司池处置不受来源限制（2026-11-04；来源限制只对客户池成立）', () => {
  it('金额不对×公司：任何来源（含 SWAP、含没有来源）都是更正+两挂起，不出补记/冲销', () => {
    ['DEPOSIT', 'WITHDRAWAL', 'SWAP', undefined].forEach((internalSourceType) => {
      expect(dispositionsFor({ matchType: 'AMOUNT_MISMATCH', book: 'FIRM', internalSourceType }))
        .toEqual(['CORRECT', 'HOLD_NEXT_PERIOD', 'HOLD_INVESTIGATING']);
    });
  });
  it('我有外无×公司：任何来源（含 SWAP、含没有来源）都出冲销', () => {
    ['DEPOSIT', 'WITHDRAWAL', 'SWAP', undefined].forEach((internalSourceType) => {
      expect(dispositionsFor({ matchType: 'ORPHAN_INTERNAL', book: 'FIRM', internalSourceType }))
        .toEqual(['REVERSE', 'HOLD_NEXT_PERIOD', 'HOLD_INVESTIGATING']);
    });
  });
  it('客户池的来源限制保留：SWAP 行金额不对不出更正、我有外无不出冲销（A1b 甲）', () => {
    expect(dispositionsFor({ matchType: 'AMOUNT_MISMATCH', book: 'CLIENT', internalSourceType: 'SWAP' }))
      .not.toContain('CORRECT');
    expect(dispositionsFor({ matchType: 'ORPHAN_INTERNAL', book: 'CLIENT', internalSourceType: 'SWAP' }))
      .not.toContain('REVERSE');
  });
});

describe('resolveAdjustmentPrefill（波四：开单预填单一来源）', () => {
  it('AMOUNT_MISMATCH 出账翻符号：内部 OUT、原始差 +10 → REDUCE（BACKLOG:176 组合首次入网）', () => {
    expect(resolveAdjustmentPrefill({ matchType: 'AMOUNT_MISMATCH', book: 'CLIENT', deltaSign: 1, internalDirection: 'OUT', deltaAmount: '10' }))
      .toEqual({ amountMinor: '10', direction: 'REDUCE', reattributionSide: 'TO' });
  });
  it('AMOUNT_MISMATCH 入账不翻：内部 IN、原始差 -10 → REDUCE、金额取绝对值', () => {
    expect(resolveAdjustmentPrefill({ matchType: 'AMOUNT_MISMATCH', book: 'FIRM', deltaSign: -1, internalDirection: 'IN', deltaAmount: '-10' }))
      .toEqual({ amountMinor: '10', direction: 'REDUCE', reattributionSide: 'TO' });
  });
  it('ORPHAN_INTERNAL：内部 IN → REDUCE、side=FROM、金额取内部行', () => {
    expect(resolveAdjustmentPrefill({ matchType: 'ORPHAN_INTERNAL', book: 'CLIENT', internalDirection: 'IN', internalAmount: '77' }))
      .toEqual({ amountMinor: '77', direction: 'REDUCE', reattributionSide: 'FROM' });
  });
  it('ORPHAN_EXTERNAL：外部 IN → INCREASE、side=TO、金额取外部行', () => {
    expect(resolveAdjustmentPrefill({ matchType: 'ORPHAN_EXTERNAL', book: 'CLIENT', externalDirection: 'IN', externalAmount: '55' }))
      .toEqual({ amountMinor: '55', direction: 'INCREASE', reattributionSide: 'TO' });
  });
});

describe('causeDisplayLabel（2026-11-04：Other 带上一行成因名，其余取注册表 label）', () => {
  it('OTHER + otherCause → "Other · <otherCause>"（trim 后）；OTHER 缺名字 → 裸 "Other"', () => {
    expect(causeDisplayLabel('OTHER', '  Bank holiday batch skew ')).toBe('Other · Bank holiday batch skew');
    expect(causeDisplayLabel('OTHER', null)).toBe('Other');
    expect(causeDisplayLabel('OTHER', '   ')).toBe('Other');
  });
  it('非 OTHER 成因忽略 otherCause，取注册表 label；未登记的码原样回码', () => {
    expect(causeDisplayLabel('AMT_FEE_NETTED', 'ignored')).toBe(CAUSE_REGISTRY.AMT_FEE_NETTED.label);
    expect(causeDisplayLabel('UNEXPLAINED_CLIENT_LOSS')).toBe('UNEXPLAINED_CLIENT_LOSS'); // 退出调账单成因表后仍不是 CAUSE_REGISTRY 的码，原样回码
  });
  it('OTHER 的查证线索指向两处分工：成因名写 Other cause、查了什么写调查说明', () => {
    expect(CAUSE_REGISTRY.OTHER.clue).toBe('Name the cause in one line under Other cause; put what was checked in the investigation note.');
  });
});
