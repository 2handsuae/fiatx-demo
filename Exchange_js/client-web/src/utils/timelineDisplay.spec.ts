// client-web/src/utils/timelineDisplay.spec.ts

import { dedupeTimelineItems } from './timelineDisplay';

describe('dedupeTimelineItems', () => {
  it('折叠连续同词条目，只留第一条（保留该词开始的时刻）', () => {
    const result = dedupeTimelineItems([
      { label: 'PROCESSING', at: 't1' },
      { label: 'PROCESSING', at: 't2' },
      { label: 'SUCCESS', at: 't3' },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].at).toBe('t1');
    expect(result[1]).toEqual({ label: 'SUCCESS', at: 't3' });
  });

  it('不相邻的同词不折叠', () => {
    const items = [
      { label: 'A', at: 't1' },
      { label: 'B', at: 't2' },
      { label: 'A', at: 't3' },
    ];
    expect(dedupeTimelineItems(items)).toHaveLength(3);
  });

  it('空数组原样返回空', () => {
    expect(dedupeTimelineItems([])).toEqual([]);
  });

  it('单条原样返回', () => {
    const items = [{ label: 'PROCESSING', at: 't1' }];
    expect(dedupeTimelineItems(items)).toEqual(items);
  });
});
