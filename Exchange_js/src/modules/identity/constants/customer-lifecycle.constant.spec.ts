import { BadRequestException } from '@nestjs/common';
import {
  CUSTOMER_LIFECYCLE_TERMINAL,
  CUSTOMER_LIFECYCLE_TRANSITIONS,
  CustomerLifecycle,
  CustomerLifecycleAction,
  nextLifecycle,
} from './customer-lifecycle.constant';

// 守则性测试（复刻充值域 28 边做法，见 deposit-transactions.service.spec.ts:1219-1300）：
// 设计稿 2026-08-15-customer-lifecycle-restrictions-design.md §3.1 定稿的 10 条边逐条列出
// ——多一条、少一条、边指向变了，这里都会红。再用穷举（7 状态 × 9 动作 = 63 组合）反向
// 断言：凡不在这 10 条边名单里的组合一律抛 BadRequestException，即没有偷偷长出第 11 条边。
const ALL_LIFECYCLES: CustomerLifecycle[] = [
  'PROSPECT',
  'IN_VERIFICATION',
  'PENDING_APPROVAL',
  'ACTIVE',
  'REJECTED',
  'WITHDRAWN',
  'OFFBOARDED',
];

const ALL_ACTIONS: CustomerLifecycleAction[] = [
  'START_VERIFICATION',
  'VERIFICATION_PASSED',
  'VERIFICATION_REJECTED',
  'WITHDRAW_APPLICATION',
  'CDD_CLEARED',
  'FINAL_APPROVED',
  'FINAL_REJECTED',
  'REAPPLY',
  'OFFBOARD',
];

const EXPECTED_EDGES: Array<{
  from: CustomerLifecycle;
  action: CustomerLifecycleAction;
  to: CustomerLifecycle;
}> = [
  { from: 'PROSPECT', action: 'START_VERIFICATION', to: 'IN_VERIFICATION' },

  { from: 'IN_VERIFICATION', action: 'VERIFICATION_PASSED', to: 'PENDING_APPROVAL' },
  { from: 'IN_VERIFICATION', action: 'VERIFICATION_REJECTED', to: 'REJECTED' },
  { from: 'IN_VERIFICATION', action: 'WITHDRAW_APPLICATION', to: 'WITHDRAWN' },
  { from: 'IN_VERIFICATION', action: 'CDD_CLEARED', to: 'ACTIVE' },

  { from: 'PENDING_APPROVAL', action: 'FINAL_APPROVED', to: 'ACTIVE' },
  { from: 'PENDING_APPROVAL', action: 'FINAL_REJECTED', to: 'REJECTED' },

  { from: 'ACTIVE', action: 'OFFBOARD', to: 'OFFBOARDED' },

  { from: 'REJECTED', action: 'REAPPLY', to: 'IN_VERIFICATION' },
  { from: 'WITHDRAWN', action: 'REAPPLY', to: 'IN_VERIFICATION' },
];

describe('customer lifecycle transition table (10-edge guard)', () => {
  it('table lists exactly 10 edges', () => {
    expect(EXPECTED_EDGES).toHaveLength(10);
    const declared = ALL_LIFECYCLES.reduce(
      (sum, from) => sum + Object.keys(CUSTOMER_LIFECYCLE_TRANSITIONS[from]).length,
      0,
    );
    expect(declared).toBe(10);
  });

  it.each(
    EXPECTED_EDGES.map((e) => [`${e.from} --${e.action}--> ${e.to}`, e] as const),
  )('%s', (_label, edge) => {
    expect(nextLifecycle(edge.from, edge.action)).toBe(edge.to);
  });

  it('every (lifecycle, action) pair NOT in the 10-edge list throws (no undocumented edge exists)', () => {
    const edgeKeys = new Set(EXPECTED_EDGES.map((e) => `${e.from}::${e.action}`));
    for (const from of ALL_LIFECYCLES) {
      for (const action of ALL_ACTIONS) {
        if (edgeKeys.has(`${from}::${action}`)) continue;
        expect(() => nextLifecycle(from, action)).toThrow(BadRequestException);
        expect(() => nextLifecycle(from, action)).toThrow(
          `Invalid lifecycle action ${action} from ${from}`,
        );
      }
    }
  });

  it('transition table keys cover exactly the 7 lifecycles', () => {
    expect(Object.keys(CUSTOMER_LIFECYCLE_TRANSITIONS).sort()).toEqual(
      [...ALL_LIFECYCLES].sort(),
    );
  });

  // INV-1（设计稿 §3.1）：ACTIVE 的唯一出口是 OFFBOARDED。
  // 今天三处写 ACTIVE→REJECTED / ACTIVE→WITHDRAWN 的代码（sumsub-ingestion:194、
  // tier-upgrade-case:175、material-refresh:151）本轮改为贴限制便签，不动 lifecycle。
  it('INV-1: ACTIVE has no edge to REJECTED or WITHDRAWN', () => {
    expect(CUSTOMER_LIFECYCLE_TRANSITIONS.ACTIVE).toEqual({ OFFBOARD: 'OFFBOARDED' });
    const targets = Object.values(CUSTOMER_LIFECYCLE_TRANSITIONS.ACTIVE);
    expect(targets).not.toContain('REJECTED');
    expect(targets).not.toContain('WITHDRAWN');
  });

  it('OFFBOARDED is terminal: zero out-edges', () => {
    expect(CUSTOMER_LIFECYCLE_TRANSITIONS.OFFBOARDED).toEqual({});
    for (const action of ALL_ACTIONS) {
      expect(() => nextLifecycle('OFFBOARDED', action)).toThrow(BadRequestException);
    }
  });

  it('CUSTOMER_LIFECYCLE_TERMINAL is exactly {OFFBOARDED}', () => {
    expect([...CUSTOMER_LIFECYCLE_TERMINAL]).toEqual(['OFFBOARDED']);
  });

  it('REJECTED / WITHDRAWN are NOT terminal — REAPPLY reopens verification', () => {
    expect(CUSTOMER_LIFECYCLE_TERMINAL.has('REJECTED')).toBe(false);
    expect(CUSTOMER_LIFECYCLE_TERMINAL.has('WITHDRAWN')).toBe(false);
    expect(nextLifecycle('REJECTED', 'REAPPLY')).toBe('IN_VERIFICATION');
    expect(nextLifecycle('WITHDRAWN', 'REAPPLY')).toBe('IN_VERIFICATION');
  });
});
