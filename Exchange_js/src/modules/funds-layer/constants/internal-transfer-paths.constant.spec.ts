import {
  TransferPath,
  AccountingClass,
  TRANSFER_PATH_WHITELIST,
  resolvePathPolicy,
  resolveRoutePolicy,
} from './internal-transfer-paths.constant';

describe('TRANSFER_PATH_WHITELIST', () => {
  it('defines the 6 crypto paths and 4 fiat paths', () => {
    expect(Object.keys(TRANSFER_PATH_WHITELIST).sort()).toEqual(
      ['AGGREGATE', 'FEE_COLLECT', 'FIAT_FEE_COLLECT', 'FIAT_SETTLE_IN', 'FIAT_SETTLE_OUT', 'FIAT_SPREAD_COLLECT', 'FUND_OUT', 'FUND_RETURN', 'INTERNAL_IN', 'INTERNAL_OUT'].sort(),
    );
  });

  it('crypto paths use CHAIN medium and a real WalletRole', () => {
    const cryptoPaths = ['AGGREGATE', 'FEE_COLLECT', 'FUND_OUT', 'FUND_RETURN', 'INTERNAL_IN', 'INTERNAL_OUT'];
    const validRoles = ['C_DEP', 'C_OUT', 'C_MAIN', 'F_LIQ', 'F_OPS'];
    for (const policy of Object.values(TRANSFER_PATH_WHITELIST)) {
      if (!cryptoPaths.includes(policy.path)) continue;
      expect(policy.medium).toBe('CHAIN');
      expect(validRoles).toContain(policy.from);
      expect(validRoles).toContain(policy.to);
    }
  });

  it('fiat settlement paths use BANK medium, a 3-hop route, and drain TRADE_CLEARING', () => {
    for (const path of [TransferPath.FIAT_SETTLE_OUT, TransferPath.FIAT_SETTLE_IN]) {
      const policy = TRANSFER_PATH_WHITELIST[path];
      expect(policy.medium).toBe('BANK');
      expect(policy.class).toBe(AccountingClass.B);
      expect(policy.drain).toBe('TRADE_CLEARING');
      expect(policy.route).toHaveLength(3);
      expect(policy.route?.[1]).toBe('F_SET');
    }
  });

  it('B-class paths declare a drain account, A-class do not', () => {
    expect(TRANSFER_PATH_WHITELIST[TransferPath.INTERNAL_OUT].class).toBe(AccountingClass.B);
    expect(TRANSFER_PATH_WHITELIST[TransferPath.INTERNAL_OUT].drain).toBe('TRADE_CLEARING');
    expect(TRANSFER_PATH_WHITELIST[TransferPath.FEE_COLLECT].drain).toBe('FEE_RECEIVABLE');
    expect(TRANSFER_PATH_WHITELIST[TransferPath.AGGREGATE].class).toBe(AccountingClass.A);
    expect(TRANSFER_PATH_WHITELIST[TransferPath.AGGREGATE].drain).toBeUndefined();
  });

  it('resolvePathPolicy returns policy for a known from→to role pair', () => {
    expect(resolvePathPolicy('C_DEP', 'C_MAIN')?.path).toBe(TransferPath.AGGREGATE);
    expect(resolvePathPolicy('C_MAIN', 'C_OUT')?.path).toBe(TransferPath.FUND_OUT);
  });

  it('resolvePathPolicy returns null for non-whitelisted pair', () => {
    expect(resolvePathPolicy('C_DEP', 'F_LIQ')).toBeNull();
  });

  it('resolveRoutePolicy returns the policy for an exact route match', () => {
    expect(resolveRoutePolicy(['C_VIBAN', 'F_SET', 'F_LIQ'])?.path).toBe(TransferPath.FIAT_SETTLE_OUT);
    expect(resolveRoutePolicy(['F_LIQ', 'F_SET', 'C_VIBAN'])?.path).toBe(TransferPath.FIAT_SETTLE_IN);
  });

  it('resolveRoutePolicy returns null for an unknown or partial route', () => {
    expect(resolveRoutePolicy(['C_VIBAN', 'F_LIQ'])).toBeNull();
    expect(resolveRoutePolicy(['C_VIBAN', 'F_SET'])).toBeNull();
    expect(resolveRoutePolicy([])).toBeNull();
  });
});
