import { WhitelistGuard } from './whitelist.guard';
import { TransferPath } from '../constants/internal-transfer-paths.constant';
import { BadRequestException } from '@nestjs/common';

describe('WhitelistGuard', () => {
  const guard = new WhitelistGuard();

  it('returns the policy for a whitelisted from→to pair', () => {
    const policy = guard.assertWhitelisted('C_DEP', 'C_MAIN');
    expect(policy.path).toBe(TransferPath.CRYPTO_DEPOSIT_SWEEP);
  });

  it('throws for a non-whitelisted pair', () => {
    expect(() => guard.assertWhitelisted('C_DEP', 'F_LIQ')).toThrow(BadRequestException);
  });
});

describe('WhitelistGuard.assertRoute (fiat)', () => {
  const guard = new WhitelistGuard();

  it('accepts the FIAT_SETTLE_OUT route and returns its policy', () => {
    const policy = guard.assertRoute(['C_VIBAN', 'F_SET', 'F_OPS']);
    expect(policy.path).toBe('FIAT_SETTLE_OUT');
    expect(policy.class).toBe('B');
    expect(policy.medium).toBe('BANK');
    expect(policy.mirror).toBe('POOL_TO_FIRM');
  });

  it('accepts the FIAT_SETTLE_IN route', () => {
    const policy = guard.assertRoute(['F_OPS', 'F_SET', 'C_VIBAN']);
    expect(policy.path).toBe('FIAT_SETTLE_IN');
  });

  it('rejects an unknown route', () => {
    expect(() => guard.assertRoute(['C_VIBAN', 'F_LIQ'])).toThrow(BadRequestException);
  });
});

describe('WhitelistGuard.assertWhitelisted (fiat fee collection)', () => {
  const guard = new WhitelistGuard();

  it('accepts C_VIBAN->F_FEE (FIAT_FEE_COLLECT), class B, BANK, mirror POOL_TO_FIRM', () => {
    const p = guard.assertWhitelisted('C_VIBAN', 'F_FEE');
    expect(p.path).toBe('FIAT_WITHDRAW_FEE_COLLECT');
    expect(p.class).toBe('B');
    expect(p.medium).toBe('BANK');
    expect(p.mirror).toBe('POOL_TO_FIRM');
  });

  it('accepts F_OPS->F_FEE (FIAT_SPREAD_COLLECT) with no mirror (company-internal)', () => {
    const p = guard.assertWhitelisted('F_OPS', 'F_FEE');
    expect(p.path).toBe('FIAT_SWAP_FEE_COLLECT');
    expect(p.mirror).toBeUndefined();
  });
});
