import { ACK_DEADLINE_DAYS, COMPLAINT_TRANSITIONS, ComplaintStatus, EXTENDED_DEADLINE_DAYS, RESOLVE_DEADLINE_DAYS } from './complaint.constants';

describe('COMPLAINT_TRANSITIONS（铁律④显式迁移表，Task 2 brief 原文）', () => {
  it('六态全边穷举——逐字等于 brief 给的迁移表', () => {
    expect(COMPLAINT_TRANSITIONS).toEqual({
      RECEIVED: ['ACKNOWLEDGED'],
      ACKNOWLEDGED: ['INVESTIGATING'],
      INVESTIGATING: ['INVESTIGATING_EXTENDED', 'RESOLUTION_PENDING'],
      INVESTIGATING_EXTENDED: ['RESOLUTION_PENDING'],
      RESOLUTION_PENDING: ['RESOLVED', 'INVESTIGATING', 'INVESTIGATING_EXTENDED'],
      RESOLVED: [],
    });
  });

  it('RESOLVED 终态零出边', () => {
    expect(COMPLAINT_TRANSITIONS[ComplaintStatus.RESOLVED]).toEqual([]);
  });

  it('非法跃迁抽样：RECEIVED 不能直达 RESOLUTION_PENDING（跳过 ACK/调查两步）', () => {
    expect(COMPLAINT_TRANSITIONS[ComplaintStatus.RECEIVED]).not.toContain(ComplaintStatus.RESOLUTION_PENDING);
  });

  it('非法跃迁抽样：RESOLVED 不能跃迁到任意状态（终态零出边覆盖全部五个非终态）', () => {
    const others = [
      ComplaintStatus.RECEIVED, ComplaintStatus.ACKNOWLEDGED, ComplaintStatus.INVESTIGATING,
      ComplaintStatus.INVESTIGATING_EXTENDED, ComplaintStatus.RESOLUTION_PENDING,
    ];
    for (const to of others) {
      expect(COMPLAINT_TRANSITIONS[ComplaintStatus.RESOLVED]).not.toContain(to);
    }
  });
});

describe('双钟期限常量（Market Conduct III.A.1.a/b/b.ii）', () => {
  it('ACK_DEADLINE_DAYS = 7（III.A.1.a）', () => {
    expect(ACK_DEADLINE_DAYS).toBe(7);
  });

  it('RESOLVE_DEADLINE_DAYS = 28（III.A.1.b）', () => {
    expect(RESOLVE_DEADLINE_DAYS).toBe(28);
  });

  it('EXTENDED_DEADLINE_DAYS = 56（III.A.1.b.ii）', () => {
    expect(EXTENDED_DEADLINE_DAYS).toBe(56);
  });
});
