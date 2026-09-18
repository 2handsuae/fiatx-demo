import { fakeChainTxHash, fakeBankRef } from './fake-external-refs.util';

describe('fakeChainTxHash', () => {
  it('returns deterministic 0x + 64 hex chars for same seed', () => {
    const a = fakeChainTxHash('PI2606304273');
    const b = fakeChainTxHash('PI2606304273');
    expect(a).toBe(b);
    expect(a).toMatch(/^0x[a-f0-9]{64}$/);
    expect(a.length).toBe(66);
  });

  it('returns different hash for different seed', () => {
    const a = fakeChainTxHash('PI001');
    const b = fakeChainTxHash('PI002');
    expect(a).not.toBe(b);
  });
});

describe('fakeBankRef', () => {
  it('returns ZB + YYYYMMDD + 10 hex upper for given (seed, date)', () => {
    const ref = fakeBankRef('PI2606304273', '2026-06-29');
    expect(ref).toMatch(/^ZB\d{8}[A-F0-9]{10}$/);
    expect(ref.startsWith('ZB20260629')).toBe(true);
    expect(ref.length).toBe(20);
  });

  it('accepts Date object as 2nd arg', () => {
    const ref = fakeBankRef('PI001', new Date('2026-06-29T12:00:00Z'));
    expect(ref.startsWith('ZB20260629')).toBe(true);
  });

  it('same (seed, date) → same ref (deterministic)', () => {
    const a = fakeBankRef('PI001', '2026-06-29');
    const b = fakeBankRef('PI001', '2026-06-29');
    expect(a).toBe(b);
  });

  it('different namespace prevents collision between chain hash and bank ref', () => {
    const chainHex = fakeChainTxHash('SAME-SEED').slice(2);
    const bankHex = fakeBankRef('SAME-SEED', '2026-06-29').slice(-10).toLowerCase();
    expect(chainHex.slice(0, 10)).not.toBe(bankHex);
  });
});
