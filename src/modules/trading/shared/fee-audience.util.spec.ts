import { matchesAudience } from './fee-audience.util';

const now = new Date('2026-07-12T00:00:00Z');
describe('matchesAudience', () => {
  it('空 requiredTags + 无窗 → 恒命中', () => {
    expect(matchesAudience({ requiredTagsJson: '[]', validFrom: null, validTo: null }, new Set(), now)).toBe(true);
  });
  it('requiredTags 子集才命中', () => {
    const lvl = { requiredTagsJson: '["VIP"]', validFrom: null, validTo: null };
    expect(matchesAudience(lvl, new Set(['VIP']), now)).toBe(true);
    expect(matchesAudience(lvl, new Set(['NEW_CUSTOMER']), now)).toBe(false);
  });
  it('多标签需全部满足', () => {
    const lvl = { requiredTagsJson: '["VIP","WHITELIST_PILOT"]', validFrom: null, validTo: null };
    expect(matchesAudience(lvl, new Set(['VIP']), now)).toBe(false);
    expect(matchesAudience(lvl, new Set(['VIP','WHITELIST_PILOT']), now)).toBe(true);
  });
  it('窗外不命中，窗内命中', () => {
    expect(matchesAudience({ requiredTagsJson: '[]', validFrom: new Date('2026-08-01'), validTo: new Date('2026-08-31') }, new Set(), now)).toBe(false);
    expect(matchesAudience({ requiredTagsJson: '[]', validFrom: new Date('2026-07-01'), validTo: new Date('2026-07-31') }, new Set(), now)).toBe(true);
  });
});
