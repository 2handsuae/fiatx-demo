// admin-web/src/utils/fundActionMap.ts
//
// InternalFund 模拟动作映射。
// 权威来源：src/modules/funds-layer/domain/funds-flow.service.ts 的
// CRYPTO_TRANSITIONS / FIAT_TRANSITIONS（改动状态机时必须同步本文件）。
// 注意：终态是 CLEAR（非 Payout 的 CLEARED）；InternalFund 含 CANCEL 动作。

export interface FundSimAction {
  action: string;
  label: string;
  enabledStatuses: Set<string>;
}

const CRYPTO_SIM_ACTIONS: FundSimAction[] = [
  { action: 'SIGN',            label: '⚡ Sign',            enabledStatuses: new Set(['CREATED']) },
  { action: 'BROADCAST',       label: '⚡ Broadcast',       enabledStatuses: new Set(['SIGNING']) },
  { action: 'SIGN_FAIL',       label: '⚡ Sign Fail',       enabledStatuses: new Set(['SIGNING']) },
  { action: 'SEEN_IN_MEMPOOL', label: '⚡ Seen in Mempool', enabledStatuses: new Set(['BROADCASTED']) },
  { action: 'DROP',            label: '⚡ Drop',            enabledStatuses: new Set(['BROADCASTED']) },
  { action: 'TIMEOUT',         label: '⚡ Timeout',         enabledStatuses: new Set(['BROADCASTED', 'CONFIRMING']) },
  { action: 'CONFIRM',         label: '⚡ Confirm',         enabledStatuses: new Set(['CONFIRMING']) },
  { action: 'FAIL',            label: '⚡ Fail',            enabledStatuses: new Set(['CONFIRMING']) },
  { action: 'CLEAR',           label: '⚡ Clear (system)',  enabledStatuses: new Set(['CONFIRMED']) },
  { action: 'CANCEL',          label: '⚡ Cancel',          enabledStatuses: new Set(['CREATED', 'SIGNING', 'BROADCASTED', 'CONFIRMING']) },
];

const FIAT_SIM_ACTIONS: FundSimAction[] = [
  { action: 'SUBMIT',  label: '⚡ Submit',         enabledStatuses: new Set(['CREATED']) },
  { action: 'CONFIRM', label: '⚡ Confirm',        enabledStatuses: new Set(['CONFIRMING']) },
  { action: 'FAIL',    label: '⚡ Fail',           enabledStatuses: new Set(['CONFIRMING']) },
  { action: 'TIMEOUT', label: '⚡ Timeout',        enabledStatuses: new Set(['CONFIRMING']) },
  { action: 'CLEAR',   label: '⚡ Clear (system)', enabledStatuses: new Set(['CONFIRMED']) },
  { action: 'RETURN',  label: '⚡ Return',         enabledStatuses: new Set(['CONFIRMED', 'CLEAR']) },
  { action: 'CANCEL',  label: '⚡ Cancel',         enabledStatuses: new Set(['CREATED']) },
];

const FUND_TERMINAL = new Set(['CLEAR', 'FAILED', 'TIMEOUT', 'RETURNED', 'CANCELLED']);

export function getFundSimActionsForStatus(
  currentStatus: string,
  assetType?: string | null,
): Array<FundSimAction & { enabled: boolean }> {
  const status = currentStatus.toUpperCase();
  const isTerminal = FUND_TERMINAL.has(status);
  const actions = assetType?.toUpperCase() === 'FIAT' ? FIAT_SIM_ACTIONS : CRYPTO_SIM_ACTIONS;
  return actions.map((a) => ({
    ...a,
    enabled: !isTerminal && a.enabledStatuses.has(status),
  }));
}
