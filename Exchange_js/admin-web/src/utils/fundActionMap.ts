// admin-web/src/utils/fundActionMap.ts
//
// InternalFund 模拟动作映射。
// 权威来源：src/modules/funds-layer/domain/funds-flow.service.ts 的
// CRYPTO_TRANSITIONS / FIAT_TRANSITIONS（改动状态机时必须同步本文件）。
// 注意：终态是 CLEAR（非 Payout 的 CLEARED）。

export interface FundSimAction {
  action: string;
  label: string;
  enabledStatuses: Set<string>;
}

// CLEAR 无按钮 —— autoClearConfirmedFunds 在整笔 transfer SUCCESS 时自动清算
// 所有 CONFIRMED leg,手动点会与自动流程赛跑。
const CRYPTO_SIM_ACTIONS: FundSimAction[] = [
  { action: 'SIGN',            label: '⚡ Sign',                        enabledStatuses: new Set(['CREATED']) },
  { action: 'BROADCAST',       label: '⚡ Broadcast',                   enabledStatuses: new Set(['SIGNING']) },
  { action: 'SIGN_FAIL',       label: '⚡ Sign Fail',                   enabledStatuses: new Set(['SIGNING']) },
  { action: 'SEEN_IN_MEMPOOL', label: '⚡ Seen in Mempool',             enabledStatuses: new Set(['BROADCASTED']) },
  { action: 'DROP',            label: '⚡ Drop',                        enabledStatuses: new Set(['BROADCASTED']) },
  { action: 'TIMEOUT',         label: '⚡ Timeout',                     enabledStatuses: new Set(['BROADCASTED', 'CONFIRMING']) },
  { action: 'CONFIRM',         label: '⚡ Confirm',                     enabledStatuses: new Set(['CONFIRMING']) },
  { action: 'FAIL',            label: '⚡ Fail',                        enabledStatuses: new Set(['CONFIRMING']) },
  { action: 'REORG',           label: '⚡ Reorg — back to broadcasted', enabledStatuses: new Set(['CONFIRMING']) },
  { action: 'CANCEL',          label: '⚡ Cancel',                      enabledStatuses: new Set(['CREATED', 'SIGNING', 'BROADCASTED', 'CONFIRMING']) },
];

const FIAT_SIM_ACTIONS: FundSimAction[] = [
  { action: 'SUBMIT',  label: '⚡ Submit',               enabledStatuses: new Set(['CREATED']) },
  { action: 'CONFIRM', label: '⚡ Confirm',              enabledStatuses: new Set(['CONFIRMING']) },
  { action: 'FAIL',    label: '⚡ Fail',                 enabledStatuses: new Set(['CONFIRMING']) },
  { action: 'TIMEOUT', label: '⚡ Timeout',              enabledStatuses: new Set(['CONFIRMING']) },
  { action: 'RETURN',  label: '⚡ Return (bank recall)', enabledStatuses: new Set(['CONFIRMED', 'CLEAR']) },
  { action: 'CANCEL',  label: '⚡ Cancel',               enabledStatuses: new Set(['CREATED']) },
];

const CRYPTO_TERMINAL = new Set(['CLEAR', 'FAILED', 'TIMEOUT', 'RETURNED', 'CANCELLED']);
// fiat CLEAR 留有 Return(银行召回)出口,不算 sim 终态 —— 一刀切终态会把后端允许的
// CLEAR→RETURNED 在 UI 上禁死。
const FIAT_TERMINAL = new Set(['FAILED', 'TIMEOUT', 'RETURNED', 'CANCELLED']);

export function isFundSimTerminal(
  status: string,
  assetType?: string | null,
): boolean {
  const terminal =
    assetType?.toUpperCase() === 'FIAT' ? FIAT_TERMINAL : CRYPTO_TERMINAL;
  return terminal.has(status.toUpperCase());
}

export function getFundSimActionsForStatus(
  currentStatus: string,
  assetType?: string | null,
): Array<FundSimAction & { enabled: boolean }> {
  const status = currentStatus.toUpperCase();
  const isTerminal = isFundSimTerminal(status, assetType);
  const actions = assetType?.toUpperCase() === 'FIAT' ? FIAT_SIM_ACTIONS : CRYPTO_SIM_ACTIONS;
  return actions.map((a) => ({
    ...a,
    enabled: !isTerminal && a.enabledStatuses.has(status),
  }));
}
