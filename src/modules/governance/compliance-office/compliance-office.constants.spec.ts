import { COMPLIANCE_OFFICE_AUDIT_ACTIONS } from '../../audit-logging/constants/audit-actions.constant';
import {
  advanceDueDate, judgeCriticality, OBLIGATION_TRANSITIONS, ObligationStatus, VENDOR_ACTION_BY_EDGE, VENDOR_TRANSITIONS, VendorStatus,
} from './compliance-office.constants';

describe('OBLIGATION_TRANSITIONS（铁律④显式迁移表，Task 2）', () => {
  it('只有 ACTIVE ↔ DISABLED 两条边，两态互为彼此的唯一出边', () => {
    expect(OBLIGATION_TRANSITIONS).toEqual({
      [ObligationStatus.ACTIVE]: [ObligationStatus.DISABLED],
      [ObligationStatus.DISABLED]: [ObligationStatus.ACTIVE],
    });
  });
});

describe('VENDOR_TRANSITIONS（铁律④显式迁移表：七态十边，终态零出边，无硬删）', () => {
  it('先评估后审批：七态与十条边就是 spec §5.6 画的那十条，REJECTED / TERMINATED 零出边', () => {
    expect(VENDOR_TRANSITIONS).toEqual({
      [VendorStatus.PENDING_ASSESSMENT]: [VendorStatus.RETURNED, VendorStatus.REJECTED, VendorStatus.PENDING_APPROVAL],
      [VendorStatus.RETURNED]: [VendorStatus.PENDING_ASSESSMENT],
      [VendorStatus.PENDING_APPROVAL]: [
        VendorStatus.ACTIVE, VendorStatus.PENDING_NOTIFICATION, VendorStatus.REJECTED, VendorStatus.PENDING_ASSESSMENT,
      ],
      [VendorStatus.PENDING_NOTIFICATION]: [VendorStatus.ACTIVE],
      [VendorStatus.ACTIVE]: [VendorStatus.TERMINATED],
      [VendorStatus.REJECTED]: [],
      [VendorStatus.TERMINATED]: [],
    });
  });

  it('门不可绕：没有任何边能不经 PENDING_APPROVAL 直达 ACTIVE / PENDING_NOTIFICATION', () => {
    const into = (to: string) => Object.entries(VENDOR_TRANSITIONS).filter(([, targets]) => targets.includes(to)).map(([from]) => from);
    expect(into(VendorStatus.ACTIVE).sort()).toEqual([VendorStatus.PENDING_APPROVAL, VendorStatus.PENDING_NOTIFICATION].sort());
    expect(into(VendorStatus.PENDING_NOTIFICATION)).toEqual([VendorStatus.PENDING_APPROVAL]);
  });
});

describe('VENDOR_ACTION_BY_EDGE（每条边一个审计码，完整性）', () => {
  const edges = Object.entries(VENDOR_TRANSITIONS).flatMap(([from, targets]) => targets.map((to) => `${from}->${to}`));

  it('迁移表的每一条边都登记了审计码，且登记里没有迁移表之外的边', () => {
    expect(edges).toHaveLength(10);
    expect(Object.keys(VENDOR_ACTION_BY_EDGE).sort()).toEqual([...edges].sort());
  });

  it('每个审计码都是合规办公室词表里真实存在、且要求 fromStatus/toStatus 的码（状态边 metadata 必带 from/to）', () => {
    for (const edge of edges) {
      const spec = COMPLIANCE_OFFICE_AUDIT_ACTIONS[VENDOR_ACTION_BY_EDGE[edge]];
      expect({ edge, spec: !!spec }).toEqual({ edge, spec: true });
      expect({ edge, fields: spec.requiredFields }).toEqual({ edge, fields: ['fromStatus', 'toStatus'] });
    }
  });

  it('两种批准落点（ACTIVE / PENDING_NOTIFICATION）共用 VENDOR_APPROVED，激活走 VENDOR_ACTIVATED，终止沿用 VENDOR_TERMINATED', () => {
    expect(VENDOR_ACTION_BY_EDGE['PENDING_APPROVAL->ACTIVE']).toBe('VENDOR_APPROVED');
    expect(VENDOR_ACTION_BY_EDGE['PENDING_APPROVAL->PENDING_NOTIFICATION']).toBe('VENDOR_APPROVED');
    expect(VENDOR_ACTION_BY_EDGE['PENDING_NOTIFICATION->ACTIVE']).toBe('VENDOR_ACTIVATED');
    expect(VENDOR_ACTION_BY_EDGE['ACTIVE->TERMINATED']).toBe('VENDOR_TERMINATED');
  });
});

describe('judgeCriticality（重大性判定纯函数，spec §5.2：四问任一「会」→ MATERIAL）', () => {
  const none = { impactLicence: false, impactLegal: false, impactFinancial: false, impactContinuity: false };

  it('四问全「不会」→ NON_MATERIAL', () => {
    expect(judgeCriticality(none)).toBe('NON_MATERIAL');
  });

  it.each(['impactLicence', 'impactLegal', 'impactFinancial', 'impactContinuity'] as const)('只有 %s 答「会」也判 MATERIAL', (key) => {
    expect(judgeCriticality({ ...none, [key]: true })).toBe('MATERIAL');
  });

  it('四问全「会」→ MATERIAL', () => {
    expect(judgeCriticality({ impactLicence: true, impactLegal: true, impactFinancial: true, impactContinuity: true })).toBe('MATERIAL');
  });
});

describe('advanceDueDate（spec §3.2 翻期纯函数——日历月加法+月末钳制，Task 2）', () => {
  it('2026-01-31 + MONTHLY → 2026-02-28（月末钳制，防 JS 溢出到 3 月）', () => {
    const due = new Date('2026-01-31T09:00:00.000Z');
    const next = advanceDueDate(due, 'MONTHLY');
    expect(next.toISOString()).toBe('2026-02-28T09:00:00.000Z');
  });

  it('2026-11-30 + QUARTERLY → 2027-02-28（跨年 + 钳制）', () => {
    const due = new Date('2026-11-30T09:00:00.000Z');
    const next = advanceDueDate(due, 'QUARTERLY');
    expect(next.toISOString()).toBe('2027-02-28T09:00:00.000Z');
  });

  it('2026-03-15 + ANNUAL → 2027-03-15（无钳制需要，原样日）', () => {
    const due = new Date('2026-03-15T09:00:00.000Z');
    const next = advanceDueDate(due, 'ANNUAL');
    expect(next.toISOString()).toBe('2027-03-15T09:00:00.000Z');
  });

  it('2026-01-31 + SEMIANNUAL → 2026-07-31（31 天月份，非月末钳制场景，回归覆盖第四频率值）', () => {
    const due = new Date('2026-01-31T09:00:00.000Z');
    const next = advanceDueDate(due, 'SEMIANNUAL');
    expect(next.toISOString()).toBe('2026-07-31T09:00:00.000Z');
  });

  it('时分秒随 due 原样保留（不因月份加法被 Date mutator 顺带改写）', () => {
    const due = new Date('2026-05-15T23:59:59.000Z');
    const next = advanceDueDate(due, 'MONTHLY');
    expect(next.getUTCHours()).toBe(23);
    expect(next.getUTCMinutes()).toBe(59);
    expect(next.getUTCSeconds()).toBe(59);
  });
});
