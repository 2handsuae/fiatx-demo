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
  ['MANUAL_CHECKING', 'MANUAL CHECKING', 'NEEDS_OFFICER'],
  ['FROZEN', 'FROZEN', 'NEEDS_OFFICER'],
  ['SUCCESS', 'SUCCESS', 'COMPLETED'],
  ['RETURNING', 'RETURNING', 'DISPOSING'],
  ['RETURNED', 'RETURNED', 'COMPLETED'],
  ['SEIZING', 'SEIZING', 'DISPOSING'],
  ['SEIZED', 'SEIZED', 'COMPLETED'],
  ['CONFISCATING', 'CONFISCATING', 'DISPOSING'],
  ['CONFISCATED', 'CONFISCATED', 'COMPLETED'],
  ['FAILED', 'FAILED', 'EXCEPTION'],
  ['REJECTED', 'REJECTED', 'EXCEPTION'],
  ['EXPIRED', 'EXPIRED', 'EXCEPTION'],
];

describe('depositStatusMap (admin, as-is)', () => {
  it('covers exactly the 15 backend statuses', () => {
    expect(CASES).toHaveLength(15);
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
});

/**
 * Admin list filter groups (design spec §2.1). The owner decided the filter
 * dropdown should be operator-facing groups, not the raw 15 statuses —
 * "Disposing" merges RETURNING/SEIZING/CONFISCATING into one option, and
 * REJECTED/EXPIRED are excluded (slated for deletion, see BACKLOG d7b4456e).
 */
describe('DEPOSIT_STATUS_FILTERS (admin list filter groups, spec §2.1)', () => {
  it('every filter status is one of the 15 backend statuses', () => {
    for (const group of DEPOSIT_STATUS_FILTERS) {
      for (const status of group.statuses) {
        expect(ALL_DEPOSIT_STATUSES).toContain(status);
      }
    }
  });

  it('never offers REJECTED or EXPIRED as a filter (owner decision: to be deleted)', () => {
    const allFilterStatuses = DEPOSIT_STATUS_FILTERS.flatMap((g) => g.statuses);
    expect(allFilterStatuses).not.toContain('REJECTED');
    expect(allFilterStatuses).not.toContain('EXPIRED');
  });

  it('"Disposing" merges the three in-flight remediation statuses', () => {
    const disposing = DEPOSIT_STATUS_FILTERS.find((g) => g.label === 'Disposing');
    expect(disposing?.statuses).toEqual(['RETURNING', 'SEIZING', 'CONFISCATING']);
  });
});
