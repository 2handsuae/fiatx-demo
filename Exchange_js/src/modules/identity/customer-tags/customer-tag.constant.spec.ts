import { CUSTOMER_TAG_DEFINITIONS, isStaticTag, isValidTag } from './constants/customer-tag.constant';

describe('customer tag registry', () => {
  it('每项有 tagCode/displayName/type', () => {
    for (const d of CUSTOMER_TAG_DEFINITIONS) {
      expect(d.tagCode).toBeTruthy();
      expect(d.displayName).toBeTruthy();
      expect(['STATIC', 'DERIVED']).toContain(d.type);
    }
  });
  it('NEW_CUSTOMER/VIP 是 DERIVED、不可手打', () => {
    expect(isStaticTag('NEW_CUSTOMER')).toBe(false);
    expect(isStaticTag('VIP')).toBe(false);
  });
  it('WHITELIST_PILOT 是 STATIC、可手打', () => {
    expect(isStaticTag('WHITELIST_PILOT')).toBe(true);
  });
  it('未注册 tag 无效', () => {
    expect(isValidTag('TYPO_TAG')).toBe(false);
  });
});
