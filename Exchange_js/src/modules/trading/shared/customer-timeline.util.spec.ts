import { buildCustomerTimeline } from './customer-timeline.util';

/** 模拟充值域收敛：白名单放行，其余一律 COMPLIANCE_PENDING */
const PASS = new Set(['PAYIN_PENDING', 'COMPLIANCE_PENDING', 'PROCESSING', 'SUCCESS', 'FAILED']);
const collapse = (s: string) => (PASS.has(s) ? s : 'COMPLIANCE_PENDING');
const entry = (status: string, t: string) => ({ status, timestamp: t });
const T0 = '2026-09-15T10:00:00.000Z';

describe('buildCustomerTimeline', () => {
  it('正常路径：出生条目 + 逐步推进', () => {
    const raw = JSON.stringify([
      entry('COMPLIANCE_PENDING', '2026-09-15T10:00:01.000Z'),
      entry('PROCESSING', '2026-09-15T10:00:05.000Z'),
      entry('SUCCESS', '2026-09-15T10:00:09.000Z'),
    ]);
    expect(buildCustomerTimeline(raw, 'COMPLIANCE_PENDING', T0, collapse)).toEqual([
      { status: 'COMPLIANCE_PENDING', at: T0 }, // 出生条目；后一条同态被去重吞掉
      { status: 'PROCESSING', at: '2026-09-15T10:00:05.000Z' },
      { status: 'SUCCESS', at: '2026-09-15T10:00:09.000Z' },
    ]);
  });

  it('★不变式：冻结→解冻的单与普通单时间线不可区分（tipping-off）', () => {
    const normal = JSON.stringify([
      entry('COMPLIANCE_PENDING', '2026-09-15T10:00:01.000Z'),
      entry('PROCESSING', '2026-09-15T10:03:00.000Z'),
      entry('SUCCESS', '2026-09-15T10:04:00.000Z'),
    ]);
    const frozen = JSON.stringify([
      entry('COMPLIANCE_PENDING', '2026-09-15T10:00:01.000Z'),
      entry('FROZEN', '2026-09-15T10:01:00.000Z'),              // 执法态
      entry('COMPLIANCE_PENDING', '2026-09-15T10:02:00.000Z'),  // 解冻回炉
      entry('PROCESSING', '2026-09-15T10:03:00.000Z'),
      entry('SUCCESS', '2026-09-15T10:04:00.000Z'),
    ]);
    const a = buildCustomerTimeline(normal, 'COMPLIANCE_PENDING', T0, collapse);
    const b = buildCustomerTimeline(frozen, 'COMPLIANCE_PENDING', T0, collapse);
    expect(b).toEqual(a); // 等长等形：FROZEN 收敛后与前条同态被吞，解冻回炉同理
  });

  it('坏 JSON / 空历史：只剩出生条目', () => {
    expect(buildCustomerTimeline('not-json{', 'PAYIN_PENDING', T0, collapse))
      .toEqual([{ status: 'PAYIN_PENDING', at: T0 }]);
    expect(buildCustomerTimeline(null, 'PAYIN_PENDING', T0, collapse))
      .toEqual([{ status: 'PAYIN_PENDING', at: T0 }]);
  });

  it('缺 status 或缺 timestamp 的脏条目跳过；createdAt 传 Date 也行', () => {
    const raw = JSON.stringify([
      { status: 'PROCESSING' }, // 无 timestamp → 跳过
      { timestamp: '2026-09-15T10:00:05.000Z' }, // 无 status → 跳过
      entry('SUCCESS', '2026-09-15T10:00:09.000Z'),
    ]);
    expect(buildCustomerTimeline(raw, 'COMPLIANCE_PENDING', new Date(T0), collapse)).toEqual([
      { status: 'COMPLIANCE_PENDING', at: T0 },
      { status: 'SUCCESS', at: '2026-09-15T10:00:09.000Z' },
    ]);
  });
});
