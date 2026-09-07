// ⚡ 模拟操作动作矩阵 —— 和后端 funds-order-transitions.constant.ts 对齐。
// deposit/withdraw 送 FundsOrderAction(打 /admin/funds-orders/:no/advance)。
// swap 腿送 InternalFundAction(打 /admin/swap-transactions/:swapNo/legs/:legSeq/advance)。

export type AssetType = 'CRYPTO' | 'FIAT';

export interface SimAction {
  key: string;              // 稳定 key
  fundsOrderAction: string; // deposit/withdraw 用(FundsOrderAction)
  swapAction: string;       // swap 腿用(InternalFundAction)
  labelEn: string;
  destructive: boolean;
  enabledStatuses: Set<string>;   // crypto/fiat 各自的可用状态
}

// crypto: CREATED→SUBMIT→SUBMITTED→OBSERVE_CONFIRMING→CONFIRMING→CONFIRM→CONFIRMED
const CRYPTO_ACTIONS: SimAction[] = [
  { key: 'SUBMIT', fundsOrderAction: 'SUBMIT', swapAction: 'SIGN',
    labelEn: '⚡ Broadcast', destructive: false,
    enabledStatuses: new Set(['CREATED']) },
  { key: 'OBSERVE_CONFIRMING', fundsOrderAction: 'OBSERVE_CONFIRMING', swapAction: 'SEEN_IN_MEMPOOL',
    labelEn: '⚡ Seen in Mempool', destructive: false,
    enabledStatuses: new Set(['SUBMITTED']) },
  { key: 'CONFIRM', fundsOrderAction: 'CONFIRM', swapAction: 'CONFIRM',
    labelEn: '⚡ Confirm', destructive: false,
    enabledStatuses: new Set(['CONFIRMING']) },
  { key: 'FAIL', fundsOrderAction: 'FAIL', swapAction: 'FAIL',
    labelEn: '⚡ Fail', destructive: true,
    enabledStatuses: new Set(['SUBMITTED', 'CONFIRMING']) },
  { key: 'TIMEOUT', fundsOrderAction: 'TIMEOUT', swapAction: 'TIMEOUT',
    labelEn: '⚡ Timeout', destructive: true,
    enabledStatuses: new Set(['SUBMITTED', 'CONFIRMING']) },
];

// fiat: CREATED→SUBMIT→SUBMITTED→CONFIRM→CONFIRMED(无 OBSERVE_CONFIRMING)
const FIAT_ACTIONS: SimAction[] = [
  { key: 'SUBMIT', fundsOrderAction: 'SUBMIT', swapAction: 'SUBMIT',
    labelEn: '⚡ Submit', destructive: false,
    enabledStatuses: new Set(['CREATED']) },
  { key: 'CONFIRM', fundsOrderAction: 'CONFIRM', swapAction: 'CONFIRM',
    labelEn: '⚡ Settle', destructive: false,
    enabledStatuses: new Set(['SUBMITTED']) },
  { key: 'FAIL', fundsOrderAction: 'FAIL', swapAction: 'FAIL',
    labelEn: '⚡ Fail', destructive: true,
    enabledStatuses: new Set(['SUBMITTED']) },
  { key: 'TIMEOUT', fundsOrderAction: 'TIMEOUT', swapAction: 'TIMEOUT',
    labelEn: '⚡ Timeout', destructive: true,
    enabledStatuses: new Set(['SUBMITTED']) },
];

const TERMINAL = new Set(['CLEARED', 'FAILED', 'TIMEOUT']);

export function getFundsOrderSimActions(
  status: string,
  assetType: AssetType,
): Array<SimAction & { enabled: boolean }> {
  const s = (status || '').toUpperCase();
  if (TERMINAL.has(s)) return [];
  const actions = assetType === 'FIAT' ? FIAT_ACTIONS : CRYPTO_ACTIONS;
  return actions
    .filter((a) => a.enabledStatuses.has(s))
    .map((a) => ({ ...a, enabled: true }));
}
