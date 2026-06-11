// admin-web/src/utils/depositActionMap.ts

/* ── Deposit Action Map ─────────────────────────────────────────
   State-machine-aware action availability for the Deposit Detail
   sidebar. Each action knows its button style and which statuses
   enable it.
   ────────────────────────────────────────────────────────────── */

export interface DepositAction {
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
 * Canonical ordered list of deposit actions.
 * Order: primary → secondary → negative (per frontend-admin.md).
 */
export const DEPOSIT_ACTIONS: DepositAction[] = [
  {
    action: 'approve',
    label: 'Approve',
    variant: 'workflowPrimary',
    requiresReason: false,
    enabledStatuses: new Set(['COMPLIANCE_PENDING', 'ACTION_PENDING', 'FROZEN']),
  },
  {
    action: 'freeze',
    label: 'Freeze',
    variant: 'workflowSecondary',
    requiresReason: false,
    enabledStatuses: new Set(['COMPLIANCE_PENDING', 'ACTION_PENDING']),
  },
  {
    action: 'resume',
    label: 'Resume',
    variant: 'workflowSecondary',
    requiresReason: false,
    enabledStatuses: new Set(['ACTION_PENDING']),
  },
  {
    action: 'expire',
    label: 'Expire',
    variant: 'workflowSecondary',
    requiresReason: false,
    enabledStatuses: new Set(['ACTION_PENDING']),
  },
  {
    action: 'reject',
    label: 'Reject',
    variant: 'workflowNegative',
    requiresReason: true,
    enabledStatuses: new Set(['COMPLIANCE_PENDING', 'ACTION_PENDING']),
  },
  {
    action: 'confiscate',
    label: 'Confiscate',
    variant: 'workflowNegative',
    requiresReason: true,
    enabledStatuses: new Set(['FROZEN']),
  },
];

/** Terminal statuses where no actions are available at all */
const TERMINAL_STATUSES = new Set([
  'SUCCESS', 'REJECTED', 'FAILED', 'EXPIRED', 'CONFISCATED',
]);

/**
 * Returns the full DEPOSIT_ACTIONS list annotated with `enabled` for
 * the given current status. Hides all actions for terminal statuses.
 */
export function getDepositActionsForStatus(
  currentStatus: string,
): Array<DepositAction & { enabled: boolean }> {
  const isTerminal = TERMINAL_STATUSES.has(currentStatus);
  return DEPOSIT_ACTIONS.map((a) => ({
    ...a,
    enabled: !isTerminal && a.enabledStatuses.has(currentStatus),
  }));
}

/* ── Compliance Layer Styling ──────────────────────────────────── */

const LAYER_PASS = new Set(['PASSED', 'ACTIVE', 'APPROVED', 'CLEAR', 'CLEARED', 'NOT_REQUIRED']);
const LAYER_PENDING = new Set(['PENDING', 'CREATED', 'RECEIVED']);
const LAYER_FAIL = new Set(['FAILED', 'REJECTED', 'SUSPENDED', 'BLOCKED']);

export interface LayerStyle {
  borderColor: string;
  textColor: string;
  label: string;
}

export function getComplianceLayerStyle(value: string | null | undefined): LayerStyle {
  const v = String(value || '').trim().toUpperCase();
  if (!v) return { borderColor: 'border-adm-border', textColor: 'text-adm-t3', label: 'N/A' };
  if (LAYER_PASS.has(v)) return { borderColor: 'border-adm-green', textColor: 'text-adm-green', label: v };
  if (LAYER_PENDING.has(v)) return { borderColor: 'border-adm-amber', textColor: 'text-adm-amber', label: v };
  if (LAYER_FAIL.has(v)) return { borderColor: 'border-adm-red', textColor: 'text-adm-red', label: v };
  return { borderColor: 'border-adm-border', textColor: 'text-adm-t3', label: v };
}

/* ── Payin Simulation Action Map ──────────────────────────────── */

export interface PayinSimAction {
  event: string;
  label: string;
  enabledStatuses: Set<string>;
}

const CRYPTO_SIM_ACTIONS: PayinSimAction[] = [
  { event: 'MEMPOOL_SEEN',    label: '⚡ Mempool Seen',            enabledStatuses: new Set(['DETECTED']) },
  { event: 'CHAIN_CONFIRMED', label: '⚡ Chain Confirmed',         enabledStatuses: new Set(['CONFIRMING']) },
  { event: 'DROPPED',         label: '⚡ Dropped / RBF Replaced',  enabledStatuses: new Set(['DETECTED', 'CONFIRMING']) },
  { event: 'REORG',           label: '⚡ Reorg — back to mempool', enabledStatuses: new Set(['CONFIRMING']) },
];

const FIAT_SIM_ACTIONS: PayinSimAction[] = [
  { event: 'FIAT_CONFIRMED',   label: '⚡ Bank Received',    enabledStatuses: new Set(['DETECTED']) },
  { event: 'FIAT_FAILED',      label: '⚡ Fiat Failed',      enabledStatuses: new Set(['DETECTED']) },
];

const PAYIN_TERMINAL = new Set(['CLEARED', 'FAILED']);

export function getPayinSimActionsForStatus(
  currentStatus: string,
  type: string,
): Array<PayinSimAction & { enabled: boolean }> {
  const isTerminal = PAYIN_TERMINAL.has(currentStatus.toUpperCase());
  const actions = type.toUpperCase() === 'FIAT' ? FIAT_SIM_ACTIONS : CRYPTO_SIM_ACTIONS;
  return actions.map((a) => ({
    ...a,
    enabled: !isTerminal && a.enabledStatuses.has(currentStatus.toUpperCase()),
  }));
}

/* ── Deposit Status Badge Colors ──────────────────────────────── */

const DEPOSIT_BADGE_MAP: Record<string, string> = {
  PAYIN_PENDING:       'bg-blue-100 text-blue-800',
  COMPLIANCE_PENDING:  'bg-purple-100 text-purple-800',
  ACTION_PENDING:      'bg-amber-100 text-amber-800',
  FROZEN:              'bg-cyan-100 text-cyan-800',
  SUCCESS:             'bg-green-100 text-green-800',
  REJECTED:            'bg-red-100 text-red-800',
  FAILED:              'bg-orange-100 text-orange-800',
  EXPIRED:             'bg-gray-100 text-gray-800',
  CONFISCATED:         'bg-red-200 text-red-900',
};

export function getDepositStatusBadgeClass(status: string): string {
  return DEPOSIT_BADGE_MAP[status.toUpperCase()] || 'bg-gray-100 text-gray-800';
}

/* ── Payin Status Badge Colors ────────────────────────────────── */

const PAYIN_BADGE_MAP: Record<string, string> = {
  DETECTED:   'bg-blue-100 text-blue-800',
  CONFIRMING: 'bg-amber-100 text-amber-800',
  CONFIRMED:  'bg-indigo-100 text-indigo-800',
  CLEARED:    'bg-green-100 text-green-800',
  FAILED:     'bg-red-100 text-red-800',
};

export function getPayinStatusBadgeClass(status: string): string {
  return PAYIN_BADGE_MAP[status.toUpperCase()] || 'bg-gray-100 text-gray-800';
}
