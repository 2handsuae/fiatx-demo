// admin-web/src/utils/withdrawStatusMap.ts

/* ── Withdraw Status Map (admin, as-is) ──────────────────────────
   Single source of truth for the admin-facing withdraw status badge —
   mirrors admin-web/src/utils/depositStatusMap.ts (deliberate fork, Task 10).
   admin shows the RAW backend status as-is; this is the operator-facing
   table (no tipping-off softening — that is the client Task 11 concern,
   not this file's).

   Source of the 10 backend statuses (10-state machine, task-1-brief.md):
   src/modules/trading/withdraw-transactions/dto/withdraw-transaction.dto.ts
   (WithdrawTransactionStatus enum).
   ────────────────────────────────────────────────────────────── */

export type WithdrawStatusGroup =
  | 'IN_PROGRESS'
  | 'WAITING'
  | 'NEEDS_OFFICER'
  | 'COMPLETED'
  | 'EXCEPTION';

export interface WithdrawStatusMeta {
  label: string;
  description: string;
  group: WithdrawStatusGroup;
  badgeClass: string;
}

/* adm-* token combos (rules/frontend-admin.md forbids raw Tailwind colors) —
   copied verbatim from depositStatusMap.ts's token set. */
const NEUTRAL = 'border-adm-t3/25 bg-adm-t3/10 text-adm-t2';
const AMBER = 'border-adm-amber/25 bg-adm-amber/10 text-adm-amber';
const RED = 'border-adm-red/25 bg-adm-red/10 text-adm-red';
const GREEN = 'border-adm-green/25 bg-adm-green/10 text-adm-green';
/* Non-exception terminal outcomes (returned to sender) */
const GRAYBLUE = 'border-adm-blue/25 bg-adm-blue/10 text-adm-blue';
/* FAILED — muted red, distinct from the FROZEN/needs-officer red above */
const GRAYRED = 'border-adm-red/20 bg-adm-t3/10 text-adm-red';
/* unknown/unmapped status — warning color, surfaces config gaps loudly */
const WARNING = 'border-adm-yellow/40 bg-adm-yellow/10 text-adm-yellow';

const WITHDRAW_STATUS_MAP: Record<string, WithdrawStatusMeta> = {
  COMPLIANCE_PENDING: {
    label: 'COMPLIANCE PENDING',
    description: 'Submitted to Sumsub KYT, awaiting a verdict.',
    group: 'IN_PROGRESS',
    badgeClass: NEUTRAL,
  },
  PENDING_APPROVAL: {
    label: 'PENDING APPROVAL',
    description: 'Large-value withdrawal awaiting senior management approval.',
    group: 'IN_PROGRESS',
    badgeClass: NEUTRAL,
  },
  ACTION_PENDING: {
    label: 'ACTION PENDING',
    description: 'Awaiting the customer to supply additional information.',
    group: 'WAITING',
    badgeClass: AMBER,
  },
  MANUAL_CHECKING: {
    label: 'MANUAL CHECKING',
    description: 'Rejected with no disposition tag — routed to officer review.',
    group: 'NEEDS_OFFICER',
    badgeClass: AMBER,
  },
  FROZEN: {
    label: 'FROZEN',
    description: 'Sanctions/MLRO hold — exits only via unfreeze or refund approval.',
    group: 'NEEDS_OFFICER',
    badgeClass: RED,
  },
  PAYOUT_PENDING: {
    label: 'PAYOUT PENDING',
    description: 'Compliance cleared — payout broadcast in flight.',
    group: 'IN_PROGRESS',
    badgeClass: NEUTRAL,
  },
  SUCCESS: {
    label: 'SUCCESS',
    description: 'Payout confirmed and cleared.',
    group: 'COMPLETED',
    badgeClass: GREEN,
  },
  REJECTED: {
    label: 'REJECTED',
    description: 'Withdrawal rejected before payout — funds released back to the customer.',
    group: 'COMPLETED',
    badgeClass: RED,
  },
  FAILED: {
    label: 'FAILED',
    description: 'Payout broadcast failed — funds released back to the customer.',
    group: 'EXCEPTION',
    badgeClass: GRAYRED,
  },
  RETURNED: {
    label: 'RETURNED',
    description: 'Payout bounced by the bank/network after broadcast.',
    group: 'COMPLETED',
    badgeClass: GRAYBLUE,
  },
};

/**
 * Returns badge metadata for a withdraw status. Unknown/unmapped statuses
 * fall back to the raw status code (never hidden) + EXCEPTION group +
 * warning color, so a future backend status without a mapping update is
 * loud and visible to operators rather than silently mis-rendered.
 */
export function getWithdrawStatusMeta(status: string): WithdrawStatusMeta {
  const key = String(status || '').toUpperCase();
  return (
    WITHDRAW_STATUS_MAP[key] ?? {
      label: status,
      description: 'Unmapped status — surface to engineering.',
      group: 'EXCEPTION',
      badgeClass: WARNING,
    }
  );
}

/**
 * All 10 backend withdraw statuses, derived from the map above so this
 * stays the single source of truth (consumers must not keep a second,
 * independently-maintained status list).
 */
export const ALL_WITHDRAW_STATUSES: string[] = Object.keys(WITHDRAW_STATUS_MAP);

export interface WithdrawStatusFilterGroup {
  label: string;
  /** Raw backend statuses this filter option maps to (>1 means a merged filter). */
  statuses: string[];
}

/**
 * Operator-facing filter groups for the admin withdraw list (task-10-brief.md).
 * "Processing" merges COMPLIANCE_PENDING + PENDING_APPROVAL — both are pre-payout
 * pipeline stages where nothing has gone wrong yet, just different gates
 * (Sumsub KYT vs. senior-management sign-off for large value).
 *
 * Single source of truth: the admin list page reads this array to render its
 * status filter, it must not keep its own independently-maintained list.
 */
export const WITHDRAW_STATUS_FILTERS: WithdrawStatusFilterGroup[] = [
  { label: 'Processing', statuses: ['COMPLIANCE_PENDING', 'PENDING_APPROVAL'] },
  { label: 'Action required', statuses: ['ACTION_PENDING'] },
  { label: 'Manual checking', statuses: ['MANUAL_CHECKING'] },
  { label: 'Frozen', statuses: ['FROZEN'] },
  { label: 'Payout', statuses: ['PAYOUT_PENDING'] },
  { label: 'Success', statuses: ['SUCCESS'] },
  { label: 'Rejected', statuses: ['REJECTED'] },
  { label: 'Failed', statuses: ['FAILED'] },
  { label: 'Returned', statuses: ['RETURNED'] },
];

/** The 4 zero-out-edge terminal statuses of the 10-state machine (spec §2). */
const WITHDRAW_TERMINAL_STATUSES = new Set(['SUCCESS', 'REJECTED', 'FAILED', 'RETURNED']);

/**
 * Whether a withdraw status is terminal — used by the detail page to hide any
 * generic disposition actions once a withdrawal is done (FROZEN is deliberately
 * NOT terminal here: it still has two legal exits via the maker-checker
 * unfreeze/refund arcs, so its own Frozen Disposition group stays visible).
 */
export function isWithdrawTerminalStatus(status: string): boolean {
  return WITHDRAW_TERMINAL_STATUSES.has(String(status || '').toUpperCase());
}
