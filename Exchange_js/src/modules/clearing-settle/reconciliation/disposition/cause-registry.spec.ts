import { CAUSE_REGISTRY, CauseCode, resolveWriteOff } from './cause-registry';
import { dispositionsFor, causesFor, outletOf } from './cause-registry';

describe('cause-registry —— six-cell cause menu (spec §4, registry is the single source of truth)', () => {
  // Task 13：menuFor（唯一消费者是被删的 resolveOutlet/staticOutletLabel 反推链）已退役，
  // 覆盖面改用 causesFor（唯一真相仍是 CAUSE_REGISTRY，逐处置聚合）+ 下方「21 码无遗漏」
  // 的穷尽性断言，不重建一份平铺菜单。
  const codesInCell = (mt: any, book: any) => new Set<string>(
    (Object.entries(CAUSE_REGISTRY) as Array<[CauseCode, any]>)
      .filter(([, s]) => s.cells.some((c: any) => c.matchType === mt && c.book === book))
      .map(([code]) => code),
  );

  it('Mismatch × Client', () => {
    expect(codesInCell('AMOUNT_MISMATCH', 'CLIENT')).toEqual(new Set(['AMT_MISBOOKED', 'AMT_FEE_NETTED', 'AMT_ROUNDING', 'UNEXPLAINED', 'OTHER']));
  });
  it('Mismatch × Firm', () => {
    expect(codesInCell('AMOUNT_MISMATCH', 'FIRM')).toEqual(new Set(['FIRM_AMT_UNDERBOOKED', 'FIRM_AMT_OVERBOOKED', 'UNEXPLAINED', 'OTHER']));
  });
  it('Internal only × Client', () => {
    expect(codesInCell('ORPHAN_INTERNAL', 'CLIENT')).toEqual(new Set([
      'DUP_BOOKING', 'PHANTOM_BOOKING', 'PAYOUT_NOT_EXECUTED', 'MISATTRIBUTED_FROM', 'CUTOFF_STRADDLE', 'UNEXPLAINED', 'OTHER',
    ]));
  });
  it('Internal only × Firm', () => {
    expect(codesInCell('ORPHAN_INTERNAL', 'FIRM')).toEqual(new Set([
      'FIRM_MISBOOKED', 'UNEXPLAINED', 'OTHER',
    ]));
  });
  it('External only × Client', () => {
    expect(codesInCell('ORPHAN_EXTERNAL', 'CLIENT')).toEqual(new Set([
      'MISSED_DEPOSIT', 'BOUNCED_FUNDS', 'PAYOUT_RETURNED', 'MISATTRIBUTED_TO', 'UNAUTHORIZED_OUTFLOW', 'UNEXPLAINED', 'OTHER',
    ]));
  });
  it('External only × Firm', () => {
    expect(codesInCell('ORPHAN_EXTERNAL', 'FIRM')).toEqual(new Set([
      'BANK_INTEREST_UNBOOKED', 'BANK_CHARGE_UNBOOKED', 'UNCLAIMED_INFLOW', 'UNEXPLAINED', 'OTHER',
    ]));
  });
  it('21 codes assigned, none missing: every code appears in at least one cell (Task 1 adds OTHER, cells=ALL_CELLS)', () => {
    const all = new Set<string>();
    (['AMOUNT_MISMATCH', 'ORPHAN_INTERNAL', 'ORPHAN_EXTERNAL'] as const).forEach((mt) =>
      (['CLIENT', 'FIRM'] as const).forEach((book) => codesInCell(mt, book).forEach((c) => all.add(c))));
    expect([...all].sort()).toEqual(Object.keys(CAUSE_REGISTRY).sort());
  });
});

describe('Recon batch A: firm-book reversal codes + write-off determination (spec §3.3 / §5)', () => {
  it('precision-dust cause removed (exempted, decisions 2026-09-02)', () => {
    expect((CAUSE_REGISTRY as any).PRECISION_DUST).toBeUndefined();
  });
  describe('resolveWriteOff: one principle — "make internal equal external"', () => {
    it('mismatch: external < internal (booked) → REDUCE, amount = |delta|', () => {
      expect(resolveWriteOff({ matchType: 'AMOUNT_MISMATCH', book: 'FIRM', deltaSign: -1, internalDirection: 'IN', deltaAmount: '-7' }))
        .toEqual({ reasonCode: 'UNEXPLAINED_WRITE_OFF', family: 'WRITE_OFF', direction: 'REDUCE', amountMinor: '7' });
    });
    it('mismatch: outbound flow flips sign — internal OUT records 90, external deducted 100, raw delta +10 → REDUCE', () => {
      expect(resolveWriteOff({ matchType: 'AMOUNT_MISMATCH', book: 'FIRM', deltaSign: 1, internalDirection: 'OUT', deltaAmount: '10' }).direction).toBe('REDUCE');
    });
    it('internal only: internal IN → REDUCE, OUT → INCREASE, amount = internal line amount', () => {
      expect(resolveWriteOff({ matchType: 'ORPHAN_INTERNAL', book: 'FIRM', internalDirection: 'IN', internalAmount: '500' }))
        .toEqual({ reasonCode: 'UNEXPLAINED_WRITE_OFF', family: 'WRITE_OFF', direction: 'REDUCE', amountMinor: '500' });
      expect(resolveWriteOff({ matchType: 'ORPHAN_INTERNAL', book: 'FIRM', internalDirection: 'OUT', internalAmount: '500' }).direction).toBe('INCREASE');
    });
    it('external only: external IN → INCREASE, OUT → REDUCE, amount = external line amount', () => {
      expect(resolveWriteOff({ matchType: 'ORPHAN_EXTERNAL', book: 'FIRM', externalDirection: 'IN', externalAmount: '300' }))
        .toEqual({ reasonCode: 'UNEXPLAINED_WRITE_OFF', family: 'WRITE_OFF', direction: 'INCREASE', amountMinor: '300' });
      expect(resolveWriteOff({ matchType: 'ORPHAN_EXTERNAL', book: 'FIRM', externalDirection: 'OUT', externalAmount: '300' }).direction).toBe('REDUCE');
    });
    it('client pool: reason code is UNEXPLAINED_CLIENT_LOSS, direction still follows "make internal equal external"', () => {
      const r = resolveWriteOff({ matchType: 'AMOUNT_MISMATCH', book: 'CLIENT', deltaSign: -1, internalDirection: 'IN', deltaAmount: '-7500000' });
      expect(r).toEqual({ reasonCode: 'UNEXPLAINED_CLIENT_LOSS', family: 'WRITE_OFF', direction: 'REDUCE', amountMinor: '7500000' });
      const inc = resolveWriteOff({ matchType: 'ORPHAN_EXTERNAL', book: 'CLIENT', externalDirection: 'IN', externalAmount: '100' });
      expect(inc.reasonCode).toBe('UNEXPLAINED_CLIENT_LOSS');
      expect(inc.direction).toBe('INCREASE'); // direction is computed as-is; "client pool cannot INCREASE" is enforced by adjustment.service and the read side, not this pure function
    });
    it('firm pool is still UNEXPLAINED_WRITE_OFF', () => {
      expect(resolveWriteOff({ matchType: 'ORPHAN_INTERNAL', book: 'FIRM', internalDirection: 'IN', internalAmount: '7' }).reasonCode).toBe('UNEXPLAINED_WRITE_OFF');
    });
  });
  it('FIRM_TRANSFER_UNTRACKED retired (wave 2 does not do firm-pool reallocation, this outlet never lights up)', () => {
    expect((CAUSE_REGISTRY as any).FIRM_TRANSFER_UNTRACKED).toBeUndefined();
  });
});

describe('Recon batch B: supplement outlet (spec §6)', () => {
  it('21 cause codes (Task 1 adds OTHER); three carry supplementTarget/supplementLabel (the SUPPLEMENT route)', () => {
    expect(Object.keys(CAUSE_REGISTRY)).toHaveLength(21);
    expect(CAUSE_REGISTRY.MISSED_DEPOSIT.supplementTarget).toBe('SUPPLEMENT_DEPOSIT');
    expect(CAUSE_REGISTRY.BOUNCED_FUNDS.supplementTarget).toBe('SUPPLEMENT_BOUNCE');
    expect(CAUSE_REGISTRY.PAYOUT_RETURNED.supplementTarget).toBe('SUPPLEMENT_PAYOUT_RETURN');
    expect(CAUSE_REGISTRY.MISSED_DEPOSIT.supplementLabel).toBe('Deposit backfill');
    expect(CAUSE_REGISTRY.BOUNCED_FUNDS.supplementLabel).toBe('Recall claim');
    expect(CAUSE_REGISTRY.PAYOUT_RETURNED.supplementLabel).toBe('Return claim');
  });
  it('three supplement causes require the statement line direction — MISSED_DEPOSIT/PAYOUT_RETURNED are IN, BOUNCED_FUNDS is OUT (write-side direction check now lives in disposition.service.ts record(), not a resolveOutlet reduction)', () => {
    expect(CAUSE_REGISTRY.MISSED_DEPOSIT.requiredDirection).toBe('IN');
    expect(CAUSE_REGISTRY.BOUNCED_FUNDS.requiredDirection).toBe('OUT');
    expect(CAUSE_REGISTRY.PAYOUT_RETURNED.requiredDirection).toBe('IN');
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
  it('金额不对×公司 = 补记+冲销+两挂起', () => expect(dispositionsFor({ matchType: 'AMOUNT_MISMATCH', book: 'FIRM', ...base, internalSourceType: 'DEPOSIT' }))
    .toEqual(['RECORD', 'REVERSE', 'HOLD_NEXT_PERIOD', 'HOLD_INVESTIGATING']));
  it('我有外无×客户 = 冲销+改记+两挂起；SWAP 行只剩挂起+改记外还去掉冲销', () => {
    expect(dispositionsFor({ matchType: 'ORPHAN_INTERNAL', book: 'CLIENT', ...base, internalSourceType: 'DEPOSIT' }))
      .toEqual(['REVERSE', 'REATTRIBUTE', 'HOLD_NEXT_PERIOD', 'HOLD_INVESTIGATING']);
    expect(dispositionsFor({ matchType: 'ORPHAN_INTERNAL', book: 'CLIENT', ...base, internalSourceType: 'SWAP' }))
      .toEqual(['REATTRIBUTE', 'HOLD_NEXT_PERIOD', 'HOLD_INVESTIGATING']);
  });
  it('我有外无×公司 = 冲销+两挂起', () => expect(dispositionsFor({ matchType: 'ORPHAN_INTERNAL', book: 'FIRM', ...base, internalSourceType: 'DEPOSIT' }))
    .toEqual(['REVERSE', 'HOLD_NEXT_PERIOD', 'HOLD_INVESTIGATING']));
  it('外有我无×客户 = 补单+改记+事故+两挂起', () => expect(dispositionsFor({ matchType: 'ORPHAN_EXTERNAL', book: 'CLIENT', externalDirection: 'IN' }))
    .toEqual(['SUPPLEMENT', 'REATTRIBUTE', 'INCIDENT', 'HOLD_NEXT_PERIOD', 'HOLD_INVESTIGATING']));
  it('外有我无×公司 = 补记+两挂起', () => expect(dispositionsFor({ matchType: 'ORPHAN_EXTERNAL', book: 'FIRM', externalDirection: 'IN' }))
    .toEqual(['RECORD', 'HOLD_NEXT_PERIOD', 'HOLD_INVESTIGATING']));
});
describe('causesFor —— 按处置出码 + OTHER（spec §4/§5）', () => {
  const codes = (k: any, m: any, b: any) => causesFor(k, m, b).map((c) => c.code);
  it('冲正@金额不对×客户 = 三码+OTHER', () => expect(codes('CORRECT', 'AMOUNT_MISMATCH', 'CLIENT'))
    .toEqual(['AMT_MISBOOKED', 'AMT_FEE_NETTED', 'AMT_ROUNDING', 'OTHER']));
  it('冲销@我有外无×客户 = 三码+OTHER', () => expect(codes('REVERSE', 'ORPHAN_INTERNAL', 'CLIENT'))
    .toEqual(['DUP_BOOKING', 'PHANTOM_BOOKING', 'PAYOUT_NOT_EXECUTED', 'OTHER']));
  it('补记@外有我无×公司 = 利息+杂费+OTHER', () => expect(codes('RECORD', 'ORPHAN_EXTERNAL', 'FIRM'))
    .toEqual(['BANK_INTEREST_UNBOOKED', 'BANK_CHARGE_UNBOOKED', 'OTHER']));
  it('改记/补单/事故的码固定、无 OTHER', () => {
    expect(codes('REATTRIBUTE', 'ORPHAN_INTERNAL', 'CLIENT')).toEqual(['MISATTRIBUTED_FROM']);
    expect(codes('SUPPLEMENT', 'ORPHAN_EXTERNAL', 'CLIENT')).toEqual(['MISSED_DEPOSIT', 'BOUNCED_FUNDS', 'PAYOUT_RETURNED']);
    expect(codes('INCIDENT', 'ORPHAN_EXTERNAL', 'CLIENT')).toEqual(['UNAUTHORIZED_OUTFLOW']);
  });
  it('挂起等下期 = 跨账期(+OTHER)；调查中@公司外有我无 = 归属排查+查无果+OTHER', () => {
    expect(codes('HOLD_NEXT_PERIOD', 'ORPHAN_INTERNAL', 'CLIENT')).toEqual(['CUTOFF_STRADDLE', 'OTHER']);
    expect(codes('HOLD_INVESTIGATING', 'ORPHAN_EXTERNAL', 'FIRM')).toEqual(['UNCLAIMED_INFLOW', 'UNEXPLAINED', 'OTHER']);
  });
});
it('outletOf 存储映射稳定（spec §8 值域沿用）', () => {
  expect(outletOf('CORRECT')).toBe('ADJUST_CORRECT');
  expect(outletOf('REATTRIBUTE')).toBe('ADJUST_REATTRIBUTE');
  expect(outletOf('HOLD_NEXT_PERIOD')).toBe('HOLD_NEXT_PERIOD');
});
