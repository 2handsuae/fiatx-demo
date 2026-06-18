import { Prisma } from '@prisma/client';
import { InvariantCheckerService } from './invariant-checker.service';

const D = (n: string | number) => new Prisma.Decimal(n);

describe('InvariantCheckerService', () => {
  const svc = new InvariantCheckerService();

  it('I1 passes when CLIENT_CUSTODY = PAYABLE + SUSPENSE + CLEARING', () => {
    const bal = {
      'A.CLIENT_CUSTODY': D('1794.150136'),
      'L.CLIENT_PAYABLE': D('1395.720136'),
      'L.DEPOSIT_SUSPENSE': D('398.43'),
      'L.TRADE_CLEARING': D('0'),
      'A.FX_POSITION': D('0'), 'R.FX_UNREALIZED_PNL': D('0'),
    };
    const checks = svc.check('USDT', 'CRYPTO', bal);
    const i1 = checks.find(c => c.invariantCode === 'I1')!;
    expect(i1.status).toBe('PASS');
    expect(i1.delta.toString()).toBe('0');
  });

  it('I1 fails and reports delta when mismatched', () => {
    const bal = {
      'A.CLIENT_CUSTODY': D('100'),
      'L.CLIENT_PAYABLE': D('90'),
      'L.DEPOSIT_SUSPENSE': D('0'),
      'L.TRADE_CLEARING': D('0'),
      'A.FX_POSITION': D('0'), 'R.FX_UNREALIZED_PNL': D('0'),
    };
    const i1 = svc.check('USDT', 'CRYPTO', bal).find(c => c.invariantCode === 'I1')!;
    expect(i1.status).toBe('FAIL');
    expect(i1.delta.toString()).toBe('10');
  });

  it('I4 passes when full ledger balances (Σ debit_net = 0)', () => {
    const bal = { 'A.CLIENT_CUSTODY': D('100'), 'L.DEPOSIT_SUSPENSE': D('100') };
    const i4 = svc.check('USDT', 'CRYPTO', bal).find(c => c.invariantCode === 'I4')!;
    expect(i4.status).toBe('PASS');
    expect(i4.delta.toString()).toBe('0');
  });

  it('I4 fails when ledger does not balance', () => {
    const bal = { 'A.CLIENT_CUSTODY': D('100'), 'L.DEPOSIT_SUSPENSE': D('90') };
    const i4 = svc.check('USDT', 'CRYPTO', bal).find(c => c.invariantCode === 'I4')!;
    expect(i4.status).toBe('FAIL');
  });
});
