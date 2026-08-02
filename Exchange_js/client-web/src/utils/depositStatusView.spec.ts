// client-web/src/utils/depositStatusView.spec.ts

import { getDepositStatusView } from './depositStatusView';

/**
 * Client-facing deposit status view — the tipping-off-safe table.
 * FROZEN / SEIZING / SEIZED / MANUAL_CHECKING must all read as the same
 * neutral "UNDER REVIEW"; CONFISCATING / CONFISCATED must never surface
 * to the client at all (server already filters them out — this util's
 * job is to make sure that even if one leaks through, it never renders
 * enforcement language). See design §1.2.
 */

// Every status defined on the backend enum, minus OPERATION_PENDING (a
// BELOW_MIN-hold-pending admin-only status the customer never sees)
// (src/modules/trading/deposit-transactions/dto/deposit-transaction.dto.ts:4-19)
const ALL_STATUSES = [
  'PAYIN_PENDING',
  'COMPLIANCE_PENDING',
  'ACTION_PENDING',
  'SUCCESS',
  'FROZEN',
  'FAILED',
  'CONFISCATED',
  'MANUAL_CHECKING',
  'RETURNING',
  'RETURNED',
  'SEIZING',
  'SEIZED',
  'CONFISCATING',
];

// [status, expected label] — copied verbatim from design §1.2
const LABEL_CASES: Array<[string, string]> = [
  ['PAYIN_PENDING', 'PROCESSING'],
  ['COMPLIANCE_PENDING', 'PROCESSING'],
  ['ACTION_PENDING', 'ACTION REQUIRED'],
  ['SUCCESS', 'SUCCESS'],
  ['RETURNING', 'RETURNING'],
  ['RETURNED', 'RETURNED'],
  ['FROZEN', 'UNDER REVIEW'],
  ['SEIZING', 'UNDER REVIEW'],
  ['SEIZED', 'UNDER REVIEW'],
  ['MANUAL_CHECKING', 'UNDER REVIEW'],
  ['FAILED', 'FAILED'],
];

describe('depositStatusView (client, tipping-off safe)', () => {
  it('exercises all 13 backend statuses', () => {
    expect(ALL_STATUSES).toHaveLength(13);
  });

  it.each(LABEL_CASES)('%s -> label=%s', (status, label) => {
    expect(getDepositStatusView(status).label).toBe(label);
  });

  it('every badge label is fully uppercase', () => {
    for (const [status] of LABEL_CASES) {
      const v = getDepositStatusView(status);
      expect(v.label).toBe(v.label.toUpperCase());
    }
  });

  it('unknown statuses fall back to PROCESSING (never a bare/raw status code)', () => {
    const v = getDepositStatusView('SOME_FUTURE_STATUS');
    expect(v.label).toBe('PROCESSING');
    expect(v.tone).toBe('neutral');
  });

  it('CONFISCATING/CONFISCATED never render as such to the client (server-filtered defensive default)', () => {
    expect(getDepositStatusView('CONFISCATING').label).not.toBe('CONFISCATING');
    expect(getDepositStatusView('CONFISCATED').label).not.toBe('CONFISCATED');
  });

  // ── The actual compliance guardrail ────────────────────────────
  // Tipping-off: a customer must never see sanction/enforcement wording.
  // This must hold across ALL 13 statuses, not just the four sensitive
  // ones, so a future edit anywhere in the map can't quietly regress it.
  const FORBIDDEN = /sanction|seiz|frozen|freeze|confiscat|enforcement|government|police/i;

  it.each(ALL_STATUSES)('forbidden-word sweep: %s output contains no sanction/enforcement language', (status) => {
    const v = getDepositStatusView(status);
    const text = `${v.label} ${v.note ?? ''}`;
    expect(text).not.toMatch(FORBIDDEN);
  });
});
