// admin-web/src/utils/depositActionMap.ts

/* ── Deposit Action Map ─────────────────────────────────────────
   Compliance-layer styling + payin simulation action availability
   shared by the Deposit Detail page (and, for getComplianceLayerStyle,
   the Withdraw Detail page).
   ────────────────────────────────────────────────────────────── */

/* ── Compliance Layer Styling ──────────────────────────────────── */

const LAYER_PASS = new Set(['PASSED', 'ACTIVE', 'APPROVED', 'CLEAR', 'CLEARED', 'NOT_REQUIRED']);
// ON_HOLD / AWAITING_USER / ONHOLD / AWAITUSER 是 Sumsub KYT 的两个未决裁决(officer 复核中 /
// 等客户补料)——归"未决"色，不是失败。deposit 详情页把 sumsubVerdict(驼峰原值 onHold/awaitUser)
// 原样传进来,经 toUpperCase() 变成 ONHOLD/AWAITUSER(不是 ON_HOLD/AWAITING_USER),缺这两个
// 变体会导致这两态在 L2 落回默认灰色,和"无状态"视觉无区分——这两态恰是最需要 officer 注意的。
const LAYER_PENDING = new Set([
  'PENDING',
  'CREATED',
  'RECEIVED',
  'ON_HOLD',
  'AWAITING_USER',
  'ONHOLD',
  'AWAITUSER',
]);
// 第四批：这个函数还要吃第二套取值域 —— 客户关系生命周期（CustomerLifecycle 七态,
// src/modules/identity/constants/customer-lifecycle.constant.ts）。三域详情页的
// `L1 · Eligibility` 那一格读的就是它。口径与 L1GateService 的 CUSTOMER_ELIGIBILITY
// 判定逐字一致：`lifecycle === 'ACTIVE'` 才算过（ACTIVE 已在 LAYER_PASS 里）,其余六态
// 一律 FAIL —— 闸门是二值的,颜色也就该是二值的,不另造「琥珀=在途」这一档去暗示一个
// 闸门根本没做的区分。REJECTED 两套取值域同名,共用下面这一条。
// 两套取值域**不相交**（Sumsub 那套 vs 生命周期那套）,合在一个函数里不会互相污染。
const LAYER_FAIL = new Set([
  'FAILED',
  'REJECTED',
  'SUSPENDED',
  'BLOCKED',
  'PROSPECT',
  'IN_VERIFICATION',
  'PENDING_APPROVAL',
  'WITHDRAWN',
  'OFFBOARDED',
]);

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
  FAILED:              'bg-orange-100 text-orange-800',
  CONFISCATING:        'bg-amber-100 text-amber-800',
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
