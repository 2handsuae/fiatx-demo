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

// CLEAR 无按钮 —— withdraw 工作流在 CONFIRM 后自动调,手动点会与自动流程赛跑。
const CRYPTO_SIM_ACTIONS: PayoutSimAction[] = [
  { action: 'SIGN',             label: '⚡ Sign',                        enabledStatuses: new Set(['CREATED']) },
  { action: 'BROADCAST',        label: '⚡ Broadcast',                   enabledStatuses: new Set(['SIGNING']) },
  { action: 'SIGN_FAIL',        label: '⚡ Sign Fail',                   enabledStatuses: new Set(['SIGNING']) },
  { action: 'SEEN_IN_MEMPOOL',  label: '⚡ Seen in Mempool',             enabledStatuses: new Set(['BROADCASTED']) },
  { action: 'DROP',             label: '⚡ Drop',                        enabledStatuses: new Set(['BROADCASTED']) },
  { action: 'TIMEOUT',          label: '⚡ Timeout',                     enabledStatuses: new Set(['BROADCASTED', 'CONFIRMING']) },
  { action: 'CONFIRM',          label: '⚡ Confirm',                     enabledStatuses: new Set(['CONFIRMING']) },
  { action: 'FAIL',             label: '⚡ Fail',                        enabledStatuses: new Set(['CONFIRMING']) },
  { action: 'REORG',            label: '⚡ Reorg — back to broadcasted', enabledStatuses: new Set(['CONFIRMING']) },
];

const FIAT_SIM_ACTIONS: PayoutSimAction[] = [
  { action: 'SUBMIT',           label: '⚡ Submit',               enabledStatuses: new Set(['CREATED']) },
  { action: 'CONFIRM',          label: '⚡ Confirm',              enabledStatuses: new Set(['CONFIRMING']) },
  { action: 'FAIL',             label: '⚡ Fail',                 enabledStatuses: new Set(['CONFIRMING']) },
  { action: 'TIMEOUT',          label: '⚡ Timeout',              enabledStatuses: new Set(['CONFIRMING']) },
  { action: 'RETURN',           label: '⚡ Return (bank recall)', enabledStatuses: new Set(['CONFIRMED', 'CLEARED']) },
];

const CRYPTO_TERMINAL = new Set(['CLEARED', 'FAILED', 'TIMEOUT', 'RETURNED']);
// fiat CLEARED 留有 Return(退票)出口,不算 sim 终态 —— 一刀切终态会把后端允许的
// CLEARED→RETURNED 在 UI 上禁死。
const FIAT_TERMINAL = new Set(['FAILED', 'TIMEOUT', 'RETURNED']);

export function isPayoutSimTerminal(status: string, type: string): boolean {
  const terminal = type.toUpperCase() === 'FIAT' ? FIAT_TERMINAL : CRYPTO_TERMINAL;
  return terminal.has(status.toUpperCase());
}

export function getPayoutSimActionsForStatus(
  currentStatus: string,
  type: string,
): Array<PayoutSimAction & { enabled: boolean }> {
  const isTerminal = isPayoutSimTerminal(currentStatus, type);
  const actions = type.toUpperCase() === 'FIAT' ? FIAT_SIM_ACTIONS : CRYPTO_SIM_ACTIONS;
  return actions.map((a) => ({
    ...a,
    enabled: !isTerminal && a.enabledStatuses.has(currentStatus.toUpperCase()),
  }));
}
