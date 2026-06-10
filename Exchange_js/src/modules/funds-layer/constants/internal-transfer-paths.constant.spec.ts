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

  it('fiat settlement paths use BANK medium, a 3-hop route, and have POOL_TO_FIRM / FIRM_TO_POOL mirror', () => {
    const outPolicy = TRANSFER_PATH_WHITELIST[TransferPath.FIAT_SETTLE_OUT];
    expect(outPolicy.medium).toBe('BANK');
    expect(outPolicy.class).toBe(AccountingClass.B);
    expect(outPolicy.mirror).toBe('POOL_TO_FIRM');
    expect(outPolicy.route).toHaveLength(3);
    expect(outPolicy.route?.[1]).toBe('F_SET');

    const inPolicy = TRANSFER_PATH_WHITELIST[TransferPath.FIAT_SETTLE_IN];
    expect(inPolicy.medium).toBe('BANK');
    expect(inPolicy.class).toBe(AccountingClass.B);
    expect(inPolicy.mirror).toBe('FIRM_TO_POOL');
    expect(inPolicy.route).toHaveLength(3);
    expect(inPolicy.route?.[1]).toBe('F_SET');
  });

  it('mirror values: POOL_TO_FIRM for pool→firm paths, FIRM_TO_POOL for reverse, undefined for no-op', () => {
    // Pool→Firm paths
    expect(TRANSFER_PATH_WHITELIST[TransferPath.INTERNAL_OUT].mirror).toBe('POOL_TO_FIRM');
    expect(TRANSFER_PATH_WHITELIST[TransferPath.FEE_COLLECT].mirror).toBe('POOL_TO_FIRM');
    expect(TRANSFER_PATH_WHITELIST[TransferPath.FIAT_SETTLE_OUT].mirror).toBe('POOL_TO_FIRM');
    expect(TRANSFER_PATH_WHITELIST[TransferPath.FIAT_FEE_COLLECT].mirror).toBe('POOL_TO_FIRM');
    // Firm→Pool paths
    expect(TRANSFER_PATH_WHITELIST[TransferPath.INTERNAL_IN].mirror).toBe('FIRM_TO_POOL');
    expect(TRANSFER_PATH_WHITELIST[TransferPath.FIAT_SETTLE_IN].mirror).toBe('FIRM_TO_POOL');
    // No mirror: pool-internal or company-internal movements
    expect(TRANSFER_PATH_WHITELIST[TransferPath.AGGREGATE].mirror).toBeUndefined();
    expect(TRANSFER_PATH_WHITELIST[TransferPath.FUND_OUT].mirror).toBeUndefined();
    expect(TRANSFER_PATH_WHITELIST[TransferPath.FUND_RETURN].mirror).toBeUndefined();
    expect(TRANSFER_PATH_WHITELIST[TransferPath.FIAT_SPREAD_COLLECT].mirror).toBeUndefined();
  });

  it('B-class paths have mirror or are FIAT_SPREAD_COLLECT; A-class paths have no mirror', () => {
    expect(TRANSFER_PATH_WHITELIST[TransferPath.INTERNAL_OUT].class).toBe(AccountingClass.B);
    expect(TRANSFER_PATH_WHITELIST[TransferPath.INTERNAL_OUT].mirror).toBeDefined();
    expect(TRANSFER_PATH_WHITELIST[TransferPath.AGGREGATE].class).toBe(AccountingClass.A);
    expect(TRANSFER_PATH_WHITELIST[TransferPath.AGGREGATE].mirror).toBeUndefined();
    // FIAT_SPREAD_COLLECT is B-class but no mirror (company-internal)
    expect(TRANSFER_PATH_WHITELIST[TransferPath.FIAT_SPREAD_COLLECT].class).toBe(AccountingClass.B);
    expect(TRANSFER_PATH_WHITELIST[TransferPath.FIAT_SPREAD_COLLECT].mirror).toBeUndefined();
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
