import {
  buildCryptoSystemWalletNo,
  buildFiatPoolWalletNo,
  classifyWalletSurface,
  isProtectedPoolWalletRole,
} from './system-wallet.util';

describe('system-wallet.util', () => {
  it('should build deterministic wallet numbers for protected pool roles', () => {
    expect(buildCryptoSystemWalletNo('MASTER', 'USDT', 'TRON')).toBe(
      'WA-MST-USDT-TRON',
    );
    expect(buildCryptoSystemWalletNo('PAYOUT', 'BTC', 'BITCOIN')).toBe(
      'WA-PAY-BTC-BITCOIN',
    );
    expect(buildFiatPoolWalletNo('CUST_BANK', 'AED')).toBe('WA-CBK-AED-NA');
    expect(buildFiatPoolWalletNo('LIQ_BANK', 'AED')).toBe('WA-LBK-AED-NA');
  });

  it('should identify protected pool roles from direct roles and wallet numbers', () => {
    expect(isProtectedPoolWalletRole('MASTER')).toBe(true);
    expect(isProtectedPoolWalletRole('WA-LIQ-BTC-BITCOIN')).toBe(true);
    expect(isProtectedPoolWalletRole('GENERAL')).toBe(false);
  });

  it('should classify wallet surfaces according to phase1 vocabulary', () => {
    expect(
      classifyWalletSurface({
        ownerType: 'CUSTOMER',
        ownerId: null,
        ownerNo: 'CUSTOMER_POOL',
        walletRole: 'MASTER',
        direction: 'BIDIRECTIONAL',
      }),
    ).toBe('CUSTOMER_POOL');

    expect(
      classifyWalletSurface({
        ownerType: 'PLATFORM',
        ownerId: null,
        ownerNo: 'PLATFORM',
        walletRole: 'LIQ_BANK',
        direction: 'BIDIRECTIONAL',
      }),
    ).toBe('PLATFORM_POOL');

    expect(
      classifyWalletSurface({
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        ownerNo: 'CUST-001',
        walletRole: 'DEPOSIT',
        direction: 'INBOUND',
      }),
    ).toBe('CUSTOMER_DEPOSIT');

    expect(
      classifyWalletSurface({
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        ownerNo: 'CUST-001',
        walletRole: 'GENERAL',
        direction: 'OUTBOUND',
      }),
    ).toBe('CUSTOMER_PAYOUT_TARGET');
  });
});
