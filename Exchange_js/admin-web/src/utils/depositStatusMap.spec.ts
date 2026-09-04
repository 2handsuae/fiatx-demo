// admin-web/src/utils/depositStatusMap.spec.ts

import {
  getDepositStatusMeta,
  ALL_DEPOSIT_STATUSES,
  DEPOSIT_STATUS_FILTERS,
} from './depositStatusMap';

/**
 * Single source of truth for the admin-facing deposit status badge.
 * admin sees the RAW backend status (FROZEN/SEIZED/etc are shown as-is —
 * this is the "as-is" table, see design §1.1). Do not soften wording here;
 * the client-facing table (depositStatusView.ts) is the one that hides it.
 */

// [status, expected label, expected group] — copied verbatim from
// doc-final/superpowers/specs/2026-07-29-deposit-frontend-design.md §1.1
const CASES: Array<[string, string, string]> = [
  ['PAYIN_PENDING', 'PAYIN PENDING', 'IN_PROGRESS'],
  ['COMPLIANCE_PENDING', 'COMPLIANCE PENDING', 'IN_PROGRESS'],
  ['ACTION_PENDING', 'AWAITING CUSTOMER', 'WAITING'],
  ['OPERATION_PENDING', 'OPERATION PENDING', 'NEEDS_OFFICER'],
  ['MANUAL_CHECKING', 'MANUAL CHECKING', 'NEEDS_OFFICER'],
  ['FROZEN', 'FROZEN', 'NEEDS_OFFICER'],
  ['SUCCESS', 'SUCCESS', 'COMPLETED'],
  ['RETURNING', 'RETURNING', 'DISPOSING'],
  ['RETURNED', 'RETURNED', 'COMPLETED'],
  ['CLAWED_BACK', 'CLAWED BACK', 'COMPLETED'],
  ['SEIZING', 'SEIZING', 'DISPOSING'],
  ['SEIZED', 'SEIZED', 'COMPLETED'],
  ['CONFISCATING', 'CONFISCATING', 'DISPOSING'],
  ['CONFISCATED', 'CONFISCATED', 'COMPLETED'],
  ['FAILED', 'FAILED', 'EXCEPTION'],
];

describe('depositStatusMap (admin, as-is)', () => {
  it('covers exactly the 15 backend statuses (one row per DEPOSIT_STATUS_MAP key — keeps this drift-proof)', () => {
    expect(CASES).toHaveLength(15);
    expect(CASES.map(([status]) => status).sort()).toEqual([...ALL_DEPOSIT_STATUSES].sort());
  });

  it.each(CASES)('%s -> label=%s group=%s', (status, label, group) => {
    const meta = getDepositStatusMeta(status);
    expect(meta.label).toBe(label);
    expect(meta.group).toBe(group);
  });

  it('every badge label is fully uppercase', () => {
    for (const [status] of CASES) {
      const meta = getDepositStatusMeta(status);
      expect(meta.label).toBe(meta.label.toUpperCase());
    }
  });

  it('badgeClass uses the adm-* design token system, never raw Tailwind colors', () => {
    for (const [status] of CASES) {
      const meta = getDepositStatusMeta(status);
      expect(meta.badgeClass).toMatch(/adm-/);
      // reject the legacy raw-Tailwind idiom this table is meant to correct
      expect(meta.badgeClass).not.toMatch(/bg-(red|blue|green|amber|purple|orange|gray|cyan)-\d/);
    }
  });

  it('falls back to EXCEPTION + the raw status code for unknown/unmapped statuses (surfaces config gaps, never hides them)', () => {
    const meta = getDepositStatusMeta('SOME_FUTURE_STATUS');
    expect(meta.label).toBe('SOME_FUTURE_STATUS');
    expect(meta.group).toBe('EXCEPTION');
    expect(meta.badgeClass).toMatch(/adm-/);
  });

  it('OPERATION_PENDING 归 NEEDS_OFFICER 组,有专属文案', () => {
    const meta = getDepositStatusMeta('OPERATION_PENDING');
    expect(meta.label).toBe('OPERATION PENDING');
    expect(meta.group).toBe('NEEDS_OFFICER');
    expect(meta.badgeClass).not.toBe(getDepositStatusMeta('UNKNOWN_XYZ').badgeClass);
  });
});

/**
 * Admin list filter groups (design spec §2.1). The owner decided the filter
 * dropdown should be operator-facing groups, not the raw 14 statuses —
 * "Disposing" merges RETURNING/SEIZING/CONFISCATING into one option.
 * REJECTED/EXPIRED no longer exist at all (state machine narrowing, owner
 * decision 2026-07-31 — see doc-final/reference/truth/v4-deposit.md §2), so
 * there is no longer a special-case exclusion to track here.
 */
describe('DEPOSIT_STATUS_FILTERS (admin list filter groups, spec §2.1)', () => {
  it('every filter status is one of the 14 backend statuses', () => {
    for (const group of DEPOSIT_STATUS_FILTERS) {
      for (const status of group.statuses) {
        expect(ALL_DEPOSIT_STATUSES).toContain(status);
      }
    }
  });

  it('"Disposing" merges the three in-flight remediation statuses', () => {
    const disposing = DEPOSIT_STATUS_FILTERS.find((g) => g.label === 'Disposing');
    expect(disposing?.statuses).toEqual(['RETURNING', 'SEIZING', 'CONFISCATING']);
  });

  // 终审 Important 4 回归闸:此前只断言"每个 filter status 都是合法后端状态"(单向),
  // 不断言反向覆盖——DEPOSIT_STATUS_MAP 加了 OPERATION_PENDING 但 FILTERS 忘了跟进,
  // 这条单向断言拦不住。反向断言:每个后端状态都至少被一个 filter 覆盖,下次再漏加
  // 会立刻红。REJECTED/EXPIRED 已随状态机收窄整体删除,不再需要例外名单。
  it('every backend status is covered by at least one filter (reverse coverage — catches a status added to the map but forgotten in the filters)', () => {
    const covered = new Set(DEPOSIT_STATUS_FILTERS.flatMap((g) => g.statuses));
    const uncovered = ALL_DEPOSIT_STATUSES.filter((status) => !covered.has(status));
    expect(uncovered).toEqual([]);
  });

  it('offers "Operation pending" so ops can find below-min deposits awaiting disposition (queue reachability — this status is admin-only, hidden from the customer entirely)', () => {
    const group = DEPOSIT_STATUS_FILTERS.find((g) => g.label === 'Operation pending');
    expect(group?.statuses).toEqual(['OPERATION_PENDING']);
  });
});
