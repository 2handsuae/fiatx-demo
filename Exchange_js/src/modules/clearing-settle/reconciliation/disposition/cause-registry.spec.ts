import { menuFor, resolveOutlet, staticOutletLabel, CAUSE_REGISTRY, CauseCode, FAMILY_LABEL, resolveWriteOff } from './cause-registry';

describe('cause-registry —— six-cell cause menu (spec §4, registry is the single source of truth)', () => {
  const codes = (mt: any, book: any) => menuFor(mt, book).map((m) => m.code);

  it('Mismatch × Client', () => {
    expect(codes('AMOUNT_MISMATCH', 'CLIENT')).toEqual(['AMT_MISBOOKED', 'AMT_FEE_NETTED', 'AMT_ROUNDING', 'UNEXPLAINED']);
  });
  it('Mismatch × Firm', () => {
    expect(codes('AMOUNT_MISMATCH', 'FIRM')).toEqual(['FIRM_AMT_UNDERBOOKED', 'FIRM_AMT_OVERBOOKED', 'UNEXPLAINED']);
  });
  it('Internal only × Client', () => {
    expect(codes('ORPHAN_INTERNAL', 'CLIENT')).toEqual([
      'DUP_BOOKING', 'PHANTOM_BOOKING', 'PAYOUT_NOT_EXECUTED', 'MISATTRIBUTED_FROM', 'CUTOFF_STRADDLE', 'UNEXPLAINED',
    ]);
  });
  it('Internal only × Firm', () => {
    expect(codes('ORPHAN_INTERNAL', 'FIRM')).toEqual([
      'FIRM_MISBOOKED', 'UNEXPLAINED',
    ]);
  });
  it('External only × Client', () => {
    expect(codes('ORPHAN_EXTERNAL', 'CLIENT')).toEqual([
      'MISSED_DEPOSIT', 'BOUNCED_FUNDS', 'PAYOUT_RETURNED', 'MISATTRIBUTED_TO', 'UNAUTHORIZED_OUTFLOW', 'UNEXPLAINED',
    ]);
  });
  it('External only × Firm', () => {
    expect(codes('ORPHAN_EXTERNAL', 'FIRM')).toEqual([
      'BANK_INTEREST_UNBOOKED', 'BANK_CHARGE_UNBOOKED', 'UNCLAIMED_INFLOW', 'UNEXPLAINED',
    ]);
  });
  it('20 codes assigned, none missing: every code appears in at least one cell menu', () => {
    const all = new Set<string>();
    (['AMOUNT_MISMATCH', 'ORPHAN_INTERNAL', 'ORPHAN_EXTERNAL'] as const).forEach((mt) =>
      (['CLIENT', 'FIRM'] as const).forEach((book) => codes(mt, book).forEach((c) => all.add(c))));
    expect([...all].sort()).toEqual(Object.keys(CAUSE_REGISTRY).sort());
  });
});

describe('resolveOutlet —— outlet and reason derivation (spec §4)', () => {
  it('Correction: reason derived from internal flow sourceType, direction from the delta sign', () => {
    expect(resolveOutlet('AMT_MISBOOKED', {
      matchType: 'AMOUNT_MISMATCH', book: 'CLIENT', deltaSign: 1,
      internalDirection: 'IN', internalSourceType: 'DEPOSIT',
    })).toEqual({
      outlet: 'ADJUST_CORRECT', outletLabel: 'Correction', family: 'CORRECT',
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
  // Outbound flows (withdrawals, firm outgoings): deltaSign is the raw amount delta, but the
  // direction of money is inverted — this group of four cases is the behavioral evidence for
  // the "flip the sign" line; reverting it flips green to red.
  it('Correction · client withdrawal (OUT): bank over-deducted needs REDUCE, under-deducted needs INCREASE — not the raw delta sign', () => {
    // We recorded 90, bank actually deducted 100 → raw delta +10, but the customer's balance is **short** by 10 → REDUCE
    expect(resolveOutlet('AMT_MISBOOKED', {
      matchType: 'AMOUNT_MISMATCH', book: 'CLIENT', deltaSign: 1,
      internalDirection: 'OUT', internalSourceType: 'WITHDRAW',
    })).toEqual({
      outlet: 'ADJUST_CORRECT', outletLabel: 'Correction', family: 'CORRECT',
      reasonCode: 'WITHDRAW_AMOUNT_CORRECTION', direction: 'REDUCE',
    });
    // We recorded 90, bank actually deducted 80 → raw delta −10, customer was over-deducted by 10 → refund, INCREASE
    expect(resolveOutlet('AMT_MISBOOKED', {
      matchType: 'AMOUNT_MISMATCH', book: 'CLIENT', deltaSign: -1,
      internalDirection: 'OUT', internalSourceType: 'WITHDRAW',
    })).toEqual({
      outlet: 'ADJUST_CORRECT', outletLabel: 'Correction', family: 'CORRECT',
      reasonCode: 'WITHDRAW_AMOUNT_CORRECTION', direction: 'INCREASE',
    });
  });
  it('Record entry · firm outgoing (OUT) underbooked = bank charge, not bank interest (handbook: "outgoing shortfall records as a bank charge")', () => {
    // Firm account actually deducted 100 > 90 recorded → raw delta +10, an unbooked bank charge → charge, REDUCE
    expect(resolveOutlet('FIRM_AMT_UNDERBOOKED', {
      matchType: 'AMOUNT_MISMATCH', book: 'FIRM', deltaSign: 1, internalDirection: 'OUT',
    })).toEqual(expect.objectContaining({
      outlet: 'ADJUST_RECORD', family: 'RECORD', reasonCode: 'BANK_CHARGE', direction: 'REDUCE',
    }));
    // Control: firm incoming (IN) underbooked → interest, INCREASE (handbook: "incoming shortfall records as bank interest")
    expect(resolveOutlet('FIRM_AMT_UNDERBOOKED', {
      matchType: 'AMOUNT_MISMATCH', book: 'FIRM', deltaSign: 1, internalDirection: 'IN',
    })).toEqual(expect.objectContaining({ reasonCode: 'BANK_INTEREST', direction: 'INCREASE' }));
  });
  it('Firm outgoing overbooked: mismatch × firm → reversal (A-batch code, outbound flow flips sign to INCREASE)', () => {
    expect(resolveOutlet('FIRM_AMT_OVERBOOKED', {
      matchType: 'AMOUNT_MISMATCH', book: 'FIRM', deltaSign: -1, internalDirection: 'OUT',
    })).toEqual(expect.objectContaining({ outlet: 'ADJUST_REVERSE', family: 'REVERSE', reasonCode: 'FIRM_ENTRY_REVERSAL', direction: 'INCREASE' }));
  });
  it('Correction meets a SWAP flow: no code this round → file only (spec §11-6)', () => {
    const r = resolveOutlet('AMT_MISBOOKED', {
      matchType: 'AMOUNT_MISMATCH', book: 'CLIENT', deltaSign: 1, internalSourceType: 'SWAP',
    });
    expect(r.outlet).toBe('DEFERRED');
    expect(r.deferredTarget).toBe('NO_REASON_CODE');
  });
  it('Reversal: one reason per code, direction = internal flow direction inverted', () => {
    expect(resolveOutlet('DUP_BOOKING', {
      matchType: 'ORPHAN_INTERNAL', book: 'CLIENT', internalDirection: 'IN',
    })).toEqual({
      outlet: 'ADJUST_REVERSE', outletLabel: 'Reversal', family: 'REVERSE',
      reasonCode: 'DEPOSIT_DUPLICATE_REVERSAL', direction: 'REDUCE',
    });
    expect(resolveOutlet('PHANTOM_BOOKING', {
      matchType: 'ORPHAN_INTERNAL', book: 'CLIENT', internalDirection: 'IN',
    }).reasonCode).toBe('DEPOSIT_SIGNAL_VOID');
    expect(resolveOutlet('PAYOUT_NOT_EXECUTED', {
      matchType: 'ORPHAN_INTERNAL', book: 'CLIENT', internalDirection: 'OUT',
    })).toEqual(expect.objectContaining({ reasonCode: 'WITHDRAW_VOID_REFUND', direction: 'INCREASE' }));
  });
  it('Record entry: firm mismatch picks the code by delta sign; firm orphan picks it by external direction', () => {
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
  it('Reattribution: both sides share the code CUSTOMER_REATTRIBUTION, no direction', () => {
    const from = resolveOutlet('MISATTRIBUTED_FROM', { matchType: 'ORPHAN_INTERNAL', book: 'CLIENT', internalDirection: 'IN' });
    const to = resolveOutlet('MISATTRIBUTED_TO', { matchType: 'ORPHAN_EXTERNAL', book: 'CLIENT', externalDirection: 'IN' });
    for (const r of [from, to]) {
      expect(r.outlet).toBe('ADJUST_REATTRIBUTE');
      expect(r.reasonCode).toBe('CUSTOMER_REATTRIBUTION');
      expect(r.direction).toBeUndefined();
    }
  });
  it('two Hold subtypes', () => {
    expect(resolveOutlet('CUTOFF_STRADDLE', { matchType: 'ORPHAN_INTERNAL', book: 'CLIENT' }).outlet).toBe('HOLD_NEXT_PERIOD');
    expect(resolveOutlet('UNEXPLAINED', { matchType: 'AMOUNT_MISMATCH', book: 'FIRM' }).outlet).toBe('HOLD_INVESTIGATING');
    expect(resolveOutlet('UNCLAIMED_INFLOW', { matchType: 'ORPHAN_EXTERNAL', book: 'FIRM' }).outlet).toBe('HOLD_INVESTIGATING');
  });
  it('Incident outlet: unauthorized outflow → INCIDENT (recon wave 3, no longer file-only; the three supplement paths moved to SUPPLEMENT in batch B, see cases below; firm reversal codes fixed in batch A)', () => {
    expect(resolveOutlet('UNAUTHORIZED_OUTFLOW', { matchType: 'ORPHAN_EXTERNAL', book: 'CLIENT' }))
      .toEqual({ outlet: 'INCIDENT', outletLabel: 'Incident · Pending' });
    expect(staticOutletLabel('UNAUTHORIZED_OUTFLOW')).toBe('Incident · Pending'); // menu's static label matches, pre-registration state
  });
  it('cause does not belong to this cell → explicit rejection (no catch-all on the machine side)', () => {
    expect(() => resolveOutlet('BANK_INTEREST_UNBOOKED', { matchType: 'ORPHAN_INTERNAL', book: 'CLIENT' })).toThrow(/does not belong/);
  });
});

describe('Recon batch A: firm-book reversal codes + write-off determination (spec §3.3 / §5)', () => {
  it('precision-dust cause removed (exempted, decisions 2026-09-02)', () => {
    expect((CAUSE_REGISTRY as any).PRECISION_DUST).toBeUndefined();
  });
  it('firm overbooked: mismatch × firm → reversal, direction by delta sign (overbooked = external − internal is negative → REDUCE)', () => {
    const r = resolveOutlet('FIRM_AMT_OVERBOOKED', { matchType: 'AMOUNT_MISMATCH', book: 'FIRM', deltaSign: -1, internalDirection: 'IN' });
    expect(r).toEqual({ outlet: 'ADJUST_REVERSE', outletLabel: 'Reversal', family: 'REVERSE', reasonCode: 'FIRM_ENTRY_REVERSAL', direction: 'REDUCE' });
  });
  it('firm overbooked · outbound flow flips sign: internal OUT records 100, bank actually deducted 90 → raw delta −10 → flips to +10 → INCREASE', () => {
    const r = resolveOutlet('FIRM_AMT_OVERBOOKED', { matchType: 'AMOUNT_MISMATCH', book: 'FIRM', deltaSign: -1, internalDirection: 'OUT' });
    expect(r.direction).toBe('INCREASE');
  });
  it('firm entry error: internal only × firm → reversal, direction = internal direction inverted', () => {
    expect(resolveOutlet('FIRM_MISBOOKED', { matchType: 'ORPHAN_INTERNAL', book: 'FIRM', internalDirection: 'IN' }).direction).toBe('REDUCE');
    expect(resolveOutlet('FIRM_MISBOOKED', { matchType: 'ORPHAN_INTERNAL', book: 'FIRM', internalDirection: 'OUT' }).direction).toBe('INCREASE');
  });
  it('family word table includes write-off', () => {
    expect(FAMILY_LABEL.WRITE_OFF).toBe('Write-off');
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
  it('20 cause codes; three route through the SUPPLEMENT outlet', () => {
    expect(Object.keys(CAUSE_REGISTRY)).toHaveLength(20);
    expect(CAUSE_REGISTRY.MISSED_DEPOSIT.kind).toBe('SUPPLEMENT');
    expect(CAUSE_REGISTRY.BOUNCED_FUNDS.kind).toBe('SUPPLEMENT');
    expect(CAUSE_REGISTRY.PAYOUT_RETURNED.kind).toBe('SUPPLEMENT');
    expect(staticOutletLabel('MISSED_DEPOSIT')).toBe('Supplement · Deposit backfill');
    expect(staticOutletLabel('BOUNCED_FUNDS')).toBe('Supplement · Recall claim');
    expect(staticOutletLabel('PAYOUT_RETURNED')).toBe('Supplement · Return claim');
  });
  it('resolveOutlet: outlet SUPPLEMENT + target', () => {
    expect(resolveOutlet('MISSED_DEPOSIT', { matchType: 'ORPHAN_EXTERNAL', book: 'CLIENT', externalDirection: 'IN' }))
      .toEqual({ outlet: 'SUPPLEMENT', outletLabel: 'Supplement · Deposit backfill', deferredTarget: 'SUPPLEMENT_DEPOSIT' });
    expect(resolveOutlet('BOUNCED_FUNDS', { matchType: 'ORPHAN_EXTERNAL', book: 'CLIENT', externalDirection: 'OUT' }).deferredTarget).toBe('SUPPLEMENT_BOUNCE');
    expect(resolveOutlet('PAYOUT_RETURNED', { matchType: 'ORPHAN_EXTERNAL', book: 'CLIENT', externalDirection: 'IN' }).deferredTarget).toBe('SUPPLEMENT_PAYOUT_RETURN');
  });
  it('cause does not match the statement line direction → 400', () => {
    expect(() => resolveOutlet('MISSED_DEPOSIT', { matchType: 'ORPHAN_EXTERNAL', book: 'CLIENT', externalDirection: 'OUT' })).toThrow(/do not match/);
    expect(() => resolveOutlet('BOUNCED_FUNDS', { matchType: 'ORPHAN_EXTERNAL', book: 'CLIENT', externalDirection: 'IN' })).toThrow(/do not match/);
  });
  it('menu order: external only × client = missed / recall / return / misattributed / unauthorized / unexplained', () => {
    expect(menuFor('ORPHAN_EXTERNAL', 'CLIENT').map((m) => m.code))
      .toEqual(['MISSED_DEPOSIT', 'BOUNCED_FUNDS', 'PAYOUT_RETURNED', 'MISATTRIBUTED_TO', 'UNAUTHORIZED_OUTFLOW', 'UNEXPLAINED']);
  });
});
