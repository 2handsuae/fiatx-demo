// admin-web/src/utils/withdrawStatusMap.spec.ts

import {
  getWithdrawStatusMeta,
  WITHDRAW_STATUS_FILTERS,
  isWithdrawTerminalStatus,
} from './withdrawStatusMap';

/**
 * Single source of truth for the admin-facing withdraw status badge.
 * admin sees the RAW backend status as-is (no tipping-off softening here —
 * mirrors depositStatusMap.spec.ts's "as-is table" convention).
 */

// [status, expected label, expected group] — the 10-state machine
// (src/modules/trading/withdraw-transactions/dto/withdraw-transaction.dto.ts).
const CASES: Array<[string, string, string]> = [
  ['COMPLIANCE_PENDING', 'COMPLIANCE PENDING', 'IN_PROGRESS'],
  ['PENDING_APPROVAL', 'PENDING APPROVAL', 'IN_PROGRESS'],
  ['ACTION_PENDING', 'ACTION PENDING', 'WAITING'],
  ['MANUAL_CHECKING', 'MANUAL CHECKING', 'NEEDS_OFFICER'],
  ['FROZEN', 'FROZEN', 'NEEDS_OFFICER'],
  ['PAYOUT_PENDING', 'PAYOUT PENDING', 'IN_PROGRESS'],
  ['SUCCESS', 'SUCCESS', 'COMPLETED'],
  ['REJECTED', 'REJECTED', 'COMPLETED'],
  ['FAILED', 'FAILED', 'EXCEPTION'],
  ['RETURNED', 'RETURNED', 'COMPLETED'],
];

// 穷举参照列表，供下方 WITHDRAW_STATUS_FILTERS 覆盖率断言使用（与 CASES 同源）。
const ALL_WITHDRAW_STATUSES: string[] = CASES.map(([status]) => status);

describe('withdrawStatusMap (admin, as-is)', () => {
  it('covers exactly the 10 backend statuses (hardcoded row count, mirrors the 10-state machine)', () => {
    expect(CASES).toHaveLength(10);
  });

  it.each(CASES)('%s -> label=%s group=%s', (status, label, group) => {
    const meta = getWithdrawStatusMeta(status);
    expect(meta.label).toBe(label);
    expect(meta.group).toBe(group);
  });

  it('every badge label is fully uppercase', () => {
    for (const [status] of CASES) {
      const meta = getWithdrawStatusMeta(status);
      expect(meta.label).toBe(meta.label.toUpperCase());
    }
  });

  it('every status has a non-empty description', () => {
    for (const [status] of CASES) {
      expect(getWithdrawStatusMeta(status).description.length).toBeGreaterThan(0);
    }
  });

  it('badgeClass uses the adm-* design token system, never raw Tailwind colors', () => {
    for (const [status] of CASES) {
      const meta = getWithdrawStatusMeta(status);
      expect(meta.badgeClass).toMatch(/adm-/);
      // reject the legacy raw-Tailwind idiom this table is meant to correct
      expect(meta.badgeClass).not.toMatch(/bg-(red|blue|green|amber|purple|orange|gray|cyan)-\d/);
    }
  });

  it('falls back to EXCEPTION + the raw status code for unknown/unmapped statuses (surfaces config gaps, never hides them)', () => {
    const meta = getWithdrawStatusMeta('SOME_FUTURE_STATUS');
    expect(meta.label).toBe('SOME_FUTURE_STATUS');
    expect(meta.group).toBe('EXCEPTION');
    expect(meta.badgeClass).toMatch(/adm-/);
  });

  it('FROZEN and REJECTED both render red but carry different groups (needs-officer vs. answered-terminal)', () => {
    const frozen = getWithdrawStatusMeta('FROZEN');
    const rejected = getWithdrawStatusMeta('REJECTED');
    expect(frozen.group).toBe('NEEDS_OFFICER');
    expect(rejected.group).toBe('COMPLETED');
  });
});

/**
 * Admin list filter groups (task-10-brief.md). "Processing" merges
 * COMPLIANCE_PENDING + PENDING_APPROVAL into one filter option — both are
 * pre-payout pipeline stages where nothing has gone wrong yet.
 */
describe('WITHDRAW_STATUS_FILTERS (admin list filter groups)', () => {
  it('every filter status is one of the 10 backend statuses', () => {
    for (const group of WITHDRAW_STATUS_FILTERS) {
      for (const status of group.statuses) {
        expect(ALL_WITHDRAW_STATUSES).toContain(status);
      }
    }
  });

  it('"Processing" merges COMPLIANCE_PENDING + PENDING_APPROVAL', () => {
    const processing = WITHDRAW_STATUS_FILTERS.find((g) => g.label === 'Processing');
    expect(processing?.statuses).toEqual(['COMPLIANCE_PENDING', 'PENDING_APPROVAL']);
  });

  // Bidirectional coverage assertion (required by task-10-brief.md): the one-way
  // assertion above ("every filter status is a real status") does not catch a
  // status added to the map but forgotten in the filters — this reverse
  // assertion does. Mirrors depositStatusMap.spec.ts's regression-gate test.
  it('every backend status is covered by exactly one filter group (bidirectional coverage)', () => {
    const coverageCount = new Map<string, number>();
    for (const group of WITHDRAW_STATUS_FILTERS) {
      for (const status of group.statuses) {
        coverageCount.set(status, (coverageCount.get(status) ?? 0) + 1);
      }
    }

    const uncovered = ALL_WITHDRAW_STATUSES.filter((status) => !coverageCount.has(status));
    expect(uncovered).toEqual([]);

    const overCovered = [...coverageCount.entries()].filter(([, count]) => count > 1);
    expect(overCovered).toEqual([]);
  });
});

describe('isWithdrawTerminalStatus', () => {
  it('SUCCESS/REJECTED/FAILED/RETURNED are terminal', () => {
    expect(isWithdrawTerminalStatus('SUCCESS')).toBe(true);
    expect(isWithdrawTerminalStatus('REJECTED')).toBe(true);
    expect(isWithdrawTerminalStatus('FAILED')).toBe(true);
    expect(isWithdrawTerminalStatus('RETURNED')).toBe(true);
  });

  it('FROZEN is NOT terminal — it still has two legal maker-checker exits', () => {
    expect(isWithdrawTerminalStatus('FROZEN')).toBe(false);
  });

  it('the other 5 non-terminal statuses are not terminal', () => {
    for (const status of ['COMPLIANCE_PENDING', 'PENDING_APPROVAL', 'ACTION_PENDING', 'MANUAL_CHECKING', 'PAYOUT_PENDING']) {
      expect(isWithdrawTerminalStatus(status)).toBe(false);
    }
  });
});
