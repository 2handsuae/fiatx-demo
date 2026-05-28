// admin-web/src/utils/withdrawActionMap.ts

/* ── Withdraw Action Map ─────────────────────────────────────────
   State-machine-aware action availability for the Withdraw Detail
   sidebar. Each action knows its button style and which statuses
   enable it.
   ────────────────────────────────────────────────────────────── */

export interface WithdrawAction {
  action: string;
  label: string;
  /** workflowPrimary | workflowSecondary | workflowNegative */
  variant: 'workflowPrimary' | 'workflowSecondary' | 'workflowNegative';
  /** Whether a reason modal is required before executing */
  requiresReason: boolean;
  /** Ordered set of statuses where this action is enabled */
  enabledStatuses: Set<string>;
}

/**
 * Canonical ordered list of withdraw actions.
 * Order: primary → secondary → negative (per frontend-admin.md).
 */
export const WITHDRAW_ACTIONS: WithdrawAction[] = [
  {
    action: 'approve',
    label: 'Approve',
    variant: 'workflowPrimary',
    requiresReason: false,
    enabledStatuses: new Set(['PENDING_APPROVAL']),
  },
  {
    action: 'freeze',
    label: 'Freeze',
    variant: 'workflowSecondary',
    requiresReason: false,
    enabledStatuses: new Set(['PENDING_COMPLIANCE', 'PENDING_APPROVAL']),
  },
  {
    action: 'resume',
    label: 'Resume',
    variant: 'workflowSecondary',
    requiresReason: false,
    enabledStatuses: new Set(['FROZEN']),
  },
  {
    action: 'reject',
    label: 'Reject',
    variant: 'workflowNegative',
    requiresReason: true,
    enabledStatuses: new Set(['PENDING_COMPLIANCE', 'PENDING_APPROVAL']),
  },
  {
    action: 'cancel',
    label: 'Cancel',
    variant: 'workflowNegative',
    requiresReason: true,
    enabledStatuses: new Set(['CREATED']),
  },
];

/** Terminal statuses where no actions are available at all */
const TERMINAL_STATUSES = new Set([
  'SUCCESS', 'REJECTED', 'CANCELLED', 'FAILED', 'RETURNED',
]);

/**
 * Returns the full WITHDRAW_ACTIONS list annotated with `enabled` for
 * the given current status. Hides all actions for terminal statuses.
 */
export function getWithdrawActionsForStatus(
  currentStatus: string,
): Array<WithdrawAction & { enabled: boolean }> {
  const isTerminal = TERMINAL_STATUSES.has(currentStatus);
  return WITHDRAW_ACTIONS.map((a) => ({
    ...a,
    enabled: !isTerminal && a.enabledStatuses.has(currentStatus),
  }));
}

/* ── Withdraw Status Badge Colors ─────────────────────────────── */

const WITHDRAW_BADGE_MAP: Record<string, string> = {
  CREATED:              'bg-gray-100 text-gray-800',
  PENDING_COMPLIANCE:   'bg-purple-100 text-purple-800',
  PENDING_APPROVAL:     'bg-amber-100 text-amber-800',
  APPROVED:             'bg-blue-100 text-blue-800',
  PAYOUT_PENDING:       'bg-blue-100 text-blue-800',
  PROCESSING:           'bg-blue-100 text-blue-800',
  SUCCESS:              'bg-green-100 text-green-800',
  REJECTED:             'bg-red-100 text-red-800',
  CANCELLED:            'bg-red-100 text-red-800',
  RETURNED:             'bg-red-100 text-red-800',
  FAILED:               'bg-orange-100 text-orange-800',
  FROZEN:               'bg-cyan-100 text-cyan-800',
};

export function getWithdrawStatusBadgeClass(status: string): string {
  return WITHDRAW_BADGE_MAP[status.toUpperCase()] || 'bg-gray-100 text-gray-800';
}
