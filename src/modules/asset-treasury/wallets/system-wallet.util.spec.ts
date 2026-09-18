import { PLATFORM_WALLET_ROLES, CUSTOMER_DEPOSIT_ROLES, isPlatformWalletRole, customerRoleForNetworkKind } from './system-wallet.util';

describe('system-wallet.util（波一）', () => {
  it('平台角色 = 四个 vault 码；客户收款角色 = C_DEP / C_VIBAN', () => {
    expect([...PLATFORM_WALLET_ROLES].sort()).toEqual(['F_FEE', 'F_LIQ', 'F_OPS', 'F_SET']);
    expect([...CUSTOMER_DEPOSIT_ROLES].sort()).toEqual(['C_DEP', 'C_VIBAN']);
  });
  it('C_MAIN / C_OUT / C_CMA 不再是任何角色', () => {
    for (const r of ['C_MAIN', 'C_OUT', 'C_CMA']) {
      expect(isPlatformWalletRole(r)).toBe(false);
      expect(CUSTOMER_DEPOSIT_ROLES.has(r)).toBe(false);
    }
  });
  it('客户收款角色由网络种类决定：CHAIN → C_DEP，BANK_RAIL → C_VIBAN', () => {
    expect(customerRoleForNetworkKind('CHAIN')).toBe('C_DEP');
    expect(customerRoleForNetworkKind('BANK_RAIL')).toBe('C_VIBAN');
  });
});
