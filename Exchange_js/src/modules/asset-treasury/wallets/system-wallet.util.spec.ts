import {
  CRYPTO_SYSTEM_WALLET_ROLES,
  FIAT_SYSTEM_WALLET_ROLES,
  PROTECTED_SYSTEM_WALLET_ROLES,
  isProtectedSystemWalletRole,
  classifyWalletSurface,
  WalletSurfaceCategory,
} from './system-wallet.util';
import { WalletRole } from './dto/wallet.dto';

describe('system-wallet.util', () => {
  describe('role constants', () => {
    it('CRYPTO_SYSTEM_WALLET_ROLES contains correct roles', () => {
      expect(CRYPTO_SYSTEM_WALLET_ROLES).toEqual([
        WalletRole.C_MAIN, WalletRole.C_OUT, WalletRole.F_LIQ, WalletRole.F_OPS, WalletRole.F_FEE,
      ]);
    });

    it('FIAT_SYSTEM_WALLET_ROLES contains correct roles', () => {
      expect(FIAT_SYSTEM_WALLET_ROLES).toEqual([
        WalletRole.C_CMA, WalletRole.F_SET, WalletRole.F_FEE, WalletRole.F_OPS, WalletRole.F_LIQ,
      ]);
    });

    it('PROTECTED_SYSTEM_WALLET_ROLES is union of both', () => {
      expect(PROTECTED_SYSTEM_WALLET_ROLES).toContain(WalletRole.C_MAIN);
      expect(PROTECTED_SYSTEM_WALLET_ROLES).toContain(WalletRole.C_OUT);
      expect(PROTECTED_SYSTEM_WALLET_ROLES).toContain(WalletRole.C_CMA);
      expect(PROTECTED_SYSTEM_WALLET_ROLES).toContain(WalletRole.F_LIQ);
      expect(PROTECTED_SYSTEM_WALLET_ROLES).toContain(WalletRole.F_OPS);
    });
  });

  describe('isProtectedSystemWalletRole', () => {
    it('returns true for system roles', () => {
      expect(isProtectedSystemWalletRole(WalletRole.C_MAIN)).toBe(true);
      expect(isProtectedSystemWalletRole(WalletRole.F_LIQ)).toBe(true);
    });

    it('returns false for customer roles', () => {
      expect(isProtectedSystemWalletRole(WalletRole.C_DEP)).toBe(false);
      expect(isProtectedSystemWalletRole(WalletRole.C_VIBAN)).toBe(false);
    });
  });

  describe('classifyWalletSurface', () => {
    it('C_MAIN → CUSTOMER_POOL', () => {
      expect(classifyWalletSurface({ walletRole: WalletRole.C_MAIN, ownerType: 'PLATFORM' }))
        .toBe(WalletSurfaceCategory.CUSTOMER_POOL);
    });

    it('C_OUT → CUSTOMER_POOL', () => {
      expect(classifyWalletSurface({ walletRole: WalletRole.C_OUT, ownerType: 'PLATFORM' }))
        .toBe(WalletSurfaceCategory.CUSTOMER_POOL);
    });

    it('C_CMA → CUSTOMER_POOL', () => {
      expect(classifyWalletSurface({ walletRole: WalletRole.C_CMA, ownerType: 'PLATFORM' }))
        .toBe(WalletSurfaceCategory.CUSTOMER_POOL);
    });

    it('F_LIQ → PLATFORM_POOL', () => {
      expect(classifyWalletSurface({ walletRole: WalletRole.F_LIQ, ownerType: 'PLATFORM' }))
        .toBe(WalletSurfaceCategory.PLATFORM_POOL);
    });

    it('F_OPS → PLATFORM_POOL', () => {
      expect(classifyWalletSurface({ walletRole: WalletRole.F_OPS, ownerType: 'PLATFORM' }))
        .toBe(WalletSurfaceCategory.PLATFORM_POOL);
    });

    it('C_DEP customer → CUSTOMER_DEPOSIT', () => {
      expect(classifyWalletSurface({ walletRole: WalletRole.C_DEP, ownerType: 'CUSTOMER' }))
        .toBe(WalletSurfaceCategory.CUSTOMER_DEPOSIT);
    });

    it('C_VIBAN customer → CUSTOMER_DEPOSIT', () => {
      expect(classifyWalletSurface({ walletRole: WalletRole.C_VIBAN, ownerType: 'CUSTOMER' }))
        .toBe(WalletSurfaceCategory.CUSTOMER_DEPOSIT);
    });

    it('LIQUIDITY_PROVIDER → LIQUIDITY_PROVIDER_ACCOUNT', () => {
      expect(classifyWalletSurface({ walletRole: WalletRole.F_LIQ, ownerType: 'LIQUIDITY_PROVIDER' }))
        .toBe(WalletSurfaceCategory.LIQUIDITY_PROVIDER_ACCOUNT);
    });
  });
});
