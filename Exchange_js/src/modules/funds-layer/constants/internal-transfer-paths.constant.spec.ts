import {
  TransferPath,
  AccountingClass,
  TRANSFER_PATH_WHITELIST,
  resolvePathPolicy,
} from './internal-transfer-paths.constant';

describe('TRANSFER_PATH_WHITELIST', () => {
  it('defines the 6 crypto paths and 2 fiat paths', () => {
    expect(Object.keys(TRANSFER_PATH_WHITELIST).sort()).toEqual(
      ['AGGREGATE', 'FEE_COLLECT', 'FIAT_SETTLE_IN', 'FIAT_SETTLE_OUT', 'FUND_OUT', 'FUND_RETURN', 'INTERNAL_IN', 'INTERNAL_OUT'].sort(),
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
});
