import { describe, it, expect } from 'vitest';
import { restrictedCapabilities, isCapabilityRestricted } from './restrictedCapabilities';

describe('restrictedCapabilities', () => {
  it('对象数组（运行时真实形状）→ 取 capability', () => {
    const user = { restrictions: [{ capability: 'SWAP', reason: 'KYT_REJECTED' }, { capability: 'WITHDRAW', reason: 'KYT_REJECTED' }] };
    expect(restrictedCapabilities(user)).toEqual(new Set(['SWAP', 'WITHDRAW']));
  });
  it('字符串数组（类型声明的旧形状）→ 原样', () => {
    expect(restrictedCapabilities({ restrictions: ['SWAP'] })).toEqual(new Set(['SWAP']));
  });
  it('空/缺失/非数组 → 空集', () => {
    expect(restrictedCapabilities({ restrictions: [] }).size).toBe(0);
    expect(restrictedCapabilities({}).size).toBe(0);
    expect(restrictedCapabilities(null).size).toBe(0);
    expect(restrictedCapabilities({ restrictions: 'SWAP' }).size).toBe(0);
  });
  it('ALL 通配拦一切能力', () => {
    const user = { restrictions: [{ capability: 'ALL', reason: 'FROZEN' }] };
    expect(isCapabilityRestricted(user, 'SWAP')).toBe(true);
    expect(isCapabilityRestricted(user, 'DEPOSIT')).toBe(true);
  });
  it('未命中能力不拦', () => {
    const user = { restrictions: [{ capability: 'SWAP', reason: 'x' }] };
    expect(isCapabilityRestricted(user, 'WITHDRAW')).toBe(false);
  });
});
