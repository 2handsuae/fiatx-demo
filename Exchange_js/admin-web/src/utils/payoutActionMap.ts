// admin-web/src/utils/payoutActionMap.ts

/* ── Payout Status Badge Colors ──────────────────────────────── */

const PAYOUT_BADGE_MAP: Record<string, string> = {
  CREATED:      'bg-gray-100 text-gray-800',
  SIGNING:      'bg-amber-100 text-amber-800',
  BROADCASTED:  'bg-blue-100 text-blue-800',
  CONFIRMING:   'bg-amber-100 text-amber-800',
  CONFIRMED:    'bg-green-100 text-green-800',
  CLEARED:      'bg-green-100 text-green-800',
  FAILED:       'bg-red-100 text-red-800',
  TIMEOUT:      'bg-gray-100 text-gray-800',
  RETURNED:     'bg-red-100 text-red-800',
};

export function getPayoutStatusBadgeClass(status: string): string {
  return PAYOUT_BADGE_MAP[status.toUpperCase()] || 'bg-gray-100 text-gray-800';
}

/* ── Payout Simulation Action Map ───────────────────────────── */

export interface PayoutSimAction {
  action: string;
  label: string;
  enabledStatuses: Set<string>;
}

const CRYPTO_SIM_ACTIONS: PayoutSimAction[] = [
  { action: 'SIGN',             label: '⚡ Sign',              enabledStatuses: new Set(['CREATED']) },
  { action: 'BROADCAST',        label: '⚡ Broadcast',         enabledStatuses: new Set(['SIGNING']) },
  { action: 'SIGN_FAIL',        label: '⚡ Sign Fail',         enabledStatuses: new Set(['SIGNING']) },
  { action: 'SEEN_IN_MEMPOOL',  label: '⚡ Seen in Mempool',   enabledStatuses: new Set(['BROADCASTED']) },
  { action: 'DROP',             label: '⚡ Drop',              enabledStatuses: new Set(['BROADCASTED']) },
  { action: 'TIMEOUT',          label: '⚡ Timeout',           enabledStatuses: new Set(['BROADCASTED', 'CONFIRMING']) },
  { action: 'CONFIRM',          label: '⚡ Confirm',           enabledStatuses: new Set(['CONFIRMING']) },
  { action: 'FAIL',             label: '⚡ Fail',              enabledStatuses: new Set(['CONFIRMING']) },
  { action: 'CLEAR',            label: '⚡ Clear (system)',     enabledStatuses: new Set(['CONFIRMED']) },
];

const FIAT_SIM_ACTIONS: PayoutSimAction[] = [
  { action: 'SUBMIT',           label: '⚡ Submit',            enabledStatuses: new Set(['CREATED']) },
  { action: 'CONFIRM',          label: '⚡ Confirm',           enabledStatuses: new Set(['CONFIRMING']) },
  { action: 'FAIL',             label: '⚡ Fail',              enabledStatuses: new Set(['CONFIRMING']) },
  { action: 'TIMEOUT',          label: '⚡ Timeout',           enabledStatuses: new Set(['CONFIRMING']) },
  { action: 'CLEAR',            label: '⚡ Clear (system)',     enabledStatuses: new Set(['CONFIRMED']) },
  { action: 'RETURN',           label: '⚡ Return',            enabledStatuses: new Set(['CONFIRMED', 'CLEARED']) },
];

const PAYOUT_TERMINAL = new Set(['CLEARED', 'FAILED', 'TIMEOUT', 'RETURNED']);

export function getPayoutSimActionsForStatus(
  currentStatus: string,
  type: string,
): Array<PayoutSimAction & { enabled: boolean }> {
  const isTerminal = PAYOUT_TERMINAL.has(currentStatus.toUpperCase());
  const actions = type.toUpperCase() === 'FIAT' ? FIAT_SIM_ACTIONS : CRYPTO_SIM_ACTIONS;
  return actions.map((a) => ({
    ...a,
    enabled: !isTerminal && a.enabledStatuses.has(currentStatus.toUpperCase()),
  }));
}
