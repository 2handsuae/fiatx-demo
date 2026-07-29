// admin-web/src/utils/depositStatusMap.ts

/* ── Deposit Status Map (admin, as-is) ───────────────────────────
   Single source of truth for the admin-facing deposit status badge.
   admin shows the RAW backend status (FROZEN / SEIZED / etc as-is) —
   this is the operator-facing table. The client-facing counterpart
   (client-web/src/utils/depositStatusView.ts) softens the same 15
   statuses for tipping-off compliance; the two tables are deliberately
   different and must never be merged.

   Source of the 15 backend statuses:
   src/modules/trading/deposit-transactions/dto/deposit-transaction.dto.ts:4-20

   Badge copy and grouping copied verbatim from design spec §1.1:
   doc-final/superpowers/specs/2026-07-29-deposit-frontend-design.md
   ────────────────────────────────────────────────────────────── */

export type DepositStatusGroup =
  | 'IN_PROGRESS'
  | 'WAITING'
  | 'NEEDS_OFFICER'
  | 'DISPOSING'
  | 'COMPLETED'
  | 'EXCEPTION';

export interface DepositStatusMeta {
  label: string;
  group: DepositStatusGroup;
  badgeClass: string;
}

/* adm-* token combos (rules/frontend-admin.md forbids raw Tailwind colors) */
const NEUTRAL = 'border-adm-t3/25 bg-adm-t3/10 text-adm-t2';
const AMBER = 'border-adm-amber/25 bg-adm-amber/10 text-adm-amber';
const RED = 'border-adm-red/25 bg-adm-red/10 text-adm-red';
const GREEN = 'border-adm-green/25 bg-adm-green/10 text-adm-green';
/* "Disposing" (in-flight remediation: returning/seizing/confiscating) */
const ORANGE = 'border-adm-yellow/25 bg-adm-yellow/10 text-adm-yellow';
/* "Completed" remediation outcomes (returned/seized/confiscated) */
const GRAYBLUE = 'border-adm-blue/25 bg-adm-blue/10 text-adm-blue';
/* FAILED — muted red, distinct from the FROZEN/needs-officer red above */
const GRAYRED = 'border-adm-red/20 bg-adm-t3/10 text-adm-red';
/* REJECTED/EXPIRED — fully muted, slated for deletion (BACKLOG d7b4456e) */
const GRAY = 'border-adm-t3/25 bg-adm-t3/10 text-adm-t3';
/* unknown/unmapped status — warning color, surfaces config gaps loudly */
const WARNING = 'border-adm-yellow/40 bg-adm-yellow/10 text-adm-yellow';

const DEPOSIT_STATUS_MAP: Record<string, DepositStatusMeta> = {
  PAYIN_PENDING: { label: 'AWAITING PAYIN', group: 'IN_PROGRESS', badgeClass: NEUTRAL },
  COMPLIANCE_PENDING: { label: 'COMPLIANCE REVIEW', group: 'IN_PROGRESS', badgeClass: NEUTRAL },
  ACTION_PENDING: { label: 'AWAITING CUSTOMER', group: 'WAITING', badgeClass: AMBER },
  MANUAL_CHECKING: { label: 'MANUAL CHECKING', group: 'NEEDS_OFFICER', badgeClass: AMBER },
  FROZEN: { label: 'FROZEN', group: 'NEEDS_OFFICER', badgeClass: RED },
  SUCCESS: { label: 'SUCCESS', group: 'COMPLETED', badgeClass: GREEN },
  RETURNING: { label: 'RETURNING', group: 'DISPOSING', badgeClass: ORANGE },
  RETURNED: { label: 'RETURNED', group: 'COMPLETED', badgeClass: GRAYBLUE },
  SEIZING: { label: 'SEIZING', group: 'DISPOSING', badgeClass: ORANGE },
  SEIZED: { label: 'SEIZED', group: 'COMPLETED', badgeClass: GRAYBLUE },
  CONFISCATING: { label: 'CONFISCATING', group: 'DISPOSING', badgeClass: ORANGE },
  CONFISCATED: { label: 'CONFISCATED', group: 'COMPLETED', badgeClass: GRAYBLUE },
  FAILED: { label: 'FAILED', group: 'EXCEPTION', badgeClass: GRAYRED },
  REJECTED: { label: 'REJECTED', group: 'EXCEPTION', badgeClass: GRAY },
  EXPIRED: { label: 'EXPIRED', group: 'EXCEPTION', badgeClass: GRAY },
};

/**
 * Returns badge metadata for a deposit status. Unknown/unmapped statuses
 * fall back to the raw status code (never hidden) + EXCEPTION group +
 * warning color, so a future backend status without a mapping update is
 * loud and visible to operators rather than silently mis-rendered.
 */
export function getDepositStatusMeta(status: string): DepositStatusMeta {
  const key = String(status || '').toUpperCase();
  return (
    DEPOSIT_STATUS_MAP[key] ?? {
      label: status,
      group: 'EXCEPTION',
      badgeClass: WARNING,
    }
  );
}

/**
 * All 15 backend deposit statuses, derived from the map above so this
 * stays the single source of truth (consumers must not keep a second,
 * independently-maintained status list — see admin list page filter).
 */
export const ALL_DEPOSIT_STATUSES: string[] = Object.keys(DEPOSIT_STATUS_MAP);

export interface DepositStatusFilterGroup {
  label: string;
  /** Raw backend statuses this filter option maps to (>1 means a merged filter). */
  statuses: string[];
}

/**
 * Operator-facing filter groups for the admin deposit list, per design spec
 * §2.1. This collapses the 15 raw statuses into the groups an operator picks
 * from — "Disposing" merges the three in-flight remediation statuses
 * (returning/seizing/confiscating) into a single filter option.
 *
 * REJECTED and EXPIRED are intentionally left out of this list: the owner
 * has decided to remove those two statuses later (see BACKLOG d7b4456e), so
 * no new filter UI is built for them. The badge map above still renders them
 * as-is for historical transactions — this only affects the filter dropdown.
 *
 * Single source of truth: the admin list page reads this array to render its
 * status filter, it must not keep its own independently-maintained list.
 */
export const DEPOSIT_STATUS_FILTERS: DepositStatusFilterGroup[] = [
  { label: 'Awaiting payin', statuses: ['PAYIN_PENDING'] },
  { label: 'Compliance review', statuses: ['COMPLIANCE_PENDING'] },
  { label: 'Awaiting customer', statuses: ['ACTION_PENDING'] },
  { label: 'Manual checking', statuses: ['MANUAL_CHECKING'] },
  { label: 'Frozen', statuses: ['FROZEN'] },
  { label: 'Disposing', statuses: ['RETURNING', 'SEIZING', 'CONFISCATING'] },
  { label: 'Returned', statuses: ['RETURNED'] },
  { label: 'Seized', statuses: ['SEIZED'] },
  { label: 'Confiscated', statuses: ['CONFISCATED'] },
  { label: 'Success', statuses: ['SUCCESS'] },
  { label: 'Failed', statuses: ['FAILED'] },
];
