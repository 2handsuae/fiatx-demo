import { fakeTronAddress } from './tron-address.util';
import { NETWORKS } from '../../config/manifests/networks.manifest';

describe('fakeTronAddress', () => {
  it('同一种子导出同一地址，且符合 TRON 地址形态', () => {
    const a = fakeTronAddress('DEMO|C_DEP|CU001');
    expect(a).toBe(fakeTronAddress('DEMO|C_DEP|CU001'));
    expect(a).toMatch(NETWORKS.TRON.addressPattern);
  });
  it('不同种子不同地址', () => {
    expect(fakeTronAddress('a')).not.toBe(fakeTronAddress('b'));
  });
});
