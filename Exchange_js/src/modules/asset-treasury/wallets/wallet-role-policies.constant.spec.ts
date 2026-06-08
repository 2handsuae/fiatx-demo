import { WALLET_ROLE_POLICIES } from './wallet-role-policies.constant';
import { FIAT_SYSTEM_WALLET_ROLES, PLATFORM_POOL_ROLES } from './system-wallet.util';
import { WalletRole } from './dto/wallet.dto';

describe('fiat settlement wallet roles', () => {
  it('F_SET and F_FEE are PLATFORM/FIAT pool roles', () => {
    for (const role of [WalletRole.F_SET, WalletRole.F_FEE]) {
      const policy = WALLET_ROLE_POLICIES[role];
      expect(policy).toBeDefined();
      expect(policy.allowedOwnerTypes).toContain('PLATFORM');
      expect(policy.allowedAssetTypes).toContain('FIAT');
    }
  });

  it('fiat system wallet role set includes C_CMA, F_SET, F_FEE, F_OPS, F_LIQ', () => {
    expect(FIAT_SYSTEM_WALLET_ROLES).toEqual(
      expect.arrayContaining([
        WalletRole.C_CMA, WalletRole.F_SET, WalletRole.F_FEE,
        WalletRole.F_OPS, WalletRole.F_LIQ,
      ]),
    );
  });

  it('F_SET and F_FEE are platform pool roles', () => {
    expect(PLATFORM_POOL_ROLES.has(WalletRole.F_SET)).toBe(true);
    expect(PLATFORM_POOL_ROLES.has(WalletRole.F_FEE)).toBe(true);
  });
});
