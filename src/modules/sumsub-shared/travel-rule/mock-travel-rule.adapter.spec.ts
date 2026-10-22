import { MockTravelRuleAdapter, MOCK_VASP_DIRECTORY } from './mock-travel-rule.adapter';

describe('MockTravelRuleAdapter — screenAddress 确定性尾号规则', () => {
  const adapter = new MockTravelRuleAdapter();

  it.each([
    ['TXabc2222', 'YELLOW'],
    ['TXabc3333', 'RED'],
    ['TXabc1111', 'GREEN'],
    ['TXabc0000', 'GREEN'],
    ['TXabc4444', 'GREEN'],
    ['AE070331234567890122222', 'YELLOW'],
    ['AE070331234567890123333', 'RED'],
    ['AE070331234567890123456', 'GREEN'],
  ])('%s → %s', async (address, expected) => {
    await expect(adapter.screenAddress(address, 'TRON')).resolves.toBe(expected);
  });
});

describe('MockTravelRuleAdapter — attributeAddress 确定性尾号规则', () => {
  const adapter = new MockTravelRuleAdapter();

  it('归因规则不变：仅尾号 1111 → Mock VASP；2222 / 3333 → 自托管', async () => {
    await expect(adapter.attributeAddress('TXabc1111', 'TRON')).resolves.toEqual({
      attributed: true,
      vaspName: 'Mock VASP Exchange',
      vaspDid: 'did:mock:vasp-exchange-001',
    });
    await expect(adapter.attributeAddress('TXabc2222', 'TRON')).resolves.toEqual({ attributed: false });
    await expect(adapter.attributeAddress('TXabc3333', 'TRON')).resolves.toEqual({ attributed: false });
  });

  it('尾号 4444 → Grey Harbor Exchange（不合格样本）', async () => {
    await expect(adapter.attributeAddress('TXabc4444', 'TRON')).resolves.toEqual({
      attributed: true,
      vaspName: 'Grey Harbor Exchange',
      vaspDid: 'did:mock:grey-harbor-001',
    });
  });

  it('其余尾号 → 自托管', async () => {
    await expect(adapter.attributeAddress('TXabc0000', 'TRON')).resolves.toEqual({ attributed: false });
  });
});

describe('MockTravelRuleAdapter — getVaspProfile 名录档案', () => {
  const adapter = new MockTravelRuleAdapter();

  it('Mock VASP Exchange：EEC 完成 / 评分 3 / 持牌（政策口径全过）', () => {
    expect(adapter.getVaspProfile('did:mock:vasp-exchange-001')).toEqual({
      name: 'Mock VASP Exchange',
      eecStatus: 'COMPLETED',
      riskScore: 3,
      licensed: true,
    });
  });

  it('Grey Harbor Exchange：EEC 未完成 / 评分 42 / 无牌（政策口径不过）', () => {
    expect(adapter.getVaspProfile('did:mock:grey-harbor-001')).toEqual({
      name: 'Grey Harbor Exchange',
      eecStatus: 'PENDING',
      riskScore: 42,
      licensed: false,
    });
  });

  it('未知 did → null', () => {
    expect(adapter.getVaspProfile('did:mock:nobody-999')).toBeNull();
    expect(adapter.getVaspProfile('')).toBeNull();
  });

  it('名录恰好两条，归因出口的 did 都在名录里', async () => {
    expect(Object.keys(MOCK_VASP_DIRECTORY).sort()).toEqual(['did:mock:grey-harbor-001', 'did:mock:vasp-exchange-001']);
    for (const addr of ['TXabc1111', 'TXabc4444']) {
      const attr = await adapter.attributeAddress(addr, 'TRON');
      expect(adapter.getVaspProfile(attr.vaspDid as string)).not.toBeNull();
    }
  });
});
