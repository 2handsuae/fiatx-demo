import { describe, it, expect } from 'vitest';
import { restrictedCapabilities, isCapabilityRestricted } from './restrictedCapabilities';

describe('restrictedCapabilities', () => {
  it('disclosedBlocked 数组 → 原样成集（后端已算好，前端不再归一化）', () => {
    expect(restrictedCapabilities({ disclosedBlocked: ['SWAP', 'WITHDRAW'] })).toEqual(
      new Set(['SWAP', 'WITHDRAW']),
    );
  });

  it('空数组 → 恒 false：制裁客户按钮照常可点，这是设计不是遗漏', () => {
    // SANCTION / KYT_REJECTED_HARD 是 SILENT，不进 disclosedBlocked。
    // 置灰本身即"你被查了"的信号（tipping-off），必须与正常客户逐字相同。
    const sanctioned = { lifecycle: 'ACTIVE', disclosedBlocked: [] };
    expect(restrictedCapabilities(sanctioned).size).toBe(0);
    expect(isCapabilityRestricted(sanctioned, 'SWAP')).toBe(false);
    expect(isCapabilityRestricted(sanctioned, 'WITHDRAW')).toBe(false);
    expect(isCapabilityRestricted(sanctioned, 'DEPOSIT')).toBe(false);
  });

  it("含 'ALL' → 任意能力都被拦", () => {
    const user = { disclosedBlocked: ['ALL'] };
    expect(isCapabilityRestricted(user, 'SWAP')).toBe(true);
    expect(isCapabilityRestricted(user, 'WITHDRAW')).toBe(true);
    expect(isCapabilityRestricted(user, 'DEPOSIT')).toBe(true);
  });

  it('未命中能力不拦', () => {
    expect(isCapabilityRestricted({ disclosedBlocked: ['SWAP'] }, 'WITHDRAW')).toBe(false);
  });

  it('缺失 / 非数组 / null → 空集', () => {
    expect(restrictedCapabilities({}).size).toBe(0);
    expect(restrictedCapabilities(null).size).toBe(0);
    expect(restrictedCapabilities({ disclosedBlocked: 'SWAP' }).size).toBe(0);
  });

  it('旧 restrictions 字段已退役 —— 就算响应里有残留也不许生效', () => {
    expect(restrictedCapabilities({ restrictions: [{ capability: 'SWAP' }] }).size).toBe(0);
  });
});
