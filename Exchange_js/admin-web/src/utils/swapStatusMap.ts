// admin-web/src/utils/swapStatusMap.ts

/* ── Swap Status Map (admin, as-is) ──────────────────────────────
   兑换域此前没有映射表,列表页用通用 StatusPill 兜底 —— 后果是
   FROZEN 在兑换页显示青色（StatusPill.tsx:45），而在充值/提现页是红色。
   第四批统一：三域各有一份形状相同的映射表,颜色令牌共用。

   客户面的对应物是 client-web/src/utils/swapStatusView.ts（tipping-off
   收敛：FROZEN → REJECTED），两张表刻意不同,永远不要合并。

   七个后端状态来源：
   src/modules/trading/swap-transactions/dto/swap-transaction.dto.ts
   ────────────────────────────────────────────────────────────── */

export type SwapStatusGroup =
  | 'IN_PROGRESS'
  | 'NEEDS_OFFICER'
  | 'COMPLETED'
  | 'EXCEPTION';

export interface SwapStatusMeta {
  label: string;
  group: SwapStatusGroup;
  badgeClass: string;
}

/* 颜色令牌与 depositStatusMap / withdrawStatusMap 逐字一致 */
const NEUTRAL = 'border-adm-t3/25 bg-adm-t3/10 text-adm-t2';
const RED = 'border-adm-red/25 bg-adm-red/10 text-adm-red';
const GREEN = 'border-adm-green/25 bg-adm-green/10 text-adm-green';
const GRAYRED = 'border-adm-red/20 bg-adm-t3/10 text-adm-red';
const WARNING = 'border-adm-yellow/40 bg-adm-yellow/10 text-adm-yellow';

const SWAP_STATUS_MAP: Record<string, SwapStatusMeta> = {
  COMPLIANCE_PENDING: { label: 'COMPLIANCE PENDING', group: 'IN_PROGRESS', badgeClass: NEUTRAL },
  PROCESSING: { label: 'PROCESSING', group: 'IN_PROGRESS', badgeClass: NEUTRAL },
  SUCCESS: { label: 'SUCCESS', group: 'COMPLETED', badgeClass: GREEN },
  REJECTED: { label: 'REJECTED', group: 'EXCEPTION', badgeClass: GRAYRED },
  /* 制裁/MLRO 冻结 —— 零出边终态。红色,与充值/提现的 FROZEN 同色。 */
  FROZEN: { label: 'FROZEN', group: 'NEEDS_OFFICER', badgeClass: RED },
  /* ⚠️ FAILED / REVERSED 在兑换转移表里零入边、全仓无写入方 —— 不可达。
     保留条目是为了将来若复活不会 fallback 成 WARNING 误导运营。 */
  FAILED: { label: 'FAILED', group: 'EXCEPTION', badgeClass: GRAYRED },
  REVERSED: { label: 'REVERSED', group: 'EXCEPTION', badgeClass: GRAYRED },
};

export function getSwapStatusMeta(status: string): SwapStatusMeta {
  const key = String(status || '').toUpperCase();
  return (
    SWAP_STATUS_MAP[key] ?? {
      label: key || 'UNKNOWN',
      group: 'EXCEPTION',
      badgeClass: WARNING,
    }
  );
}

/* 映射表实际覆盖的状态码全集 —— 与 depositStatusMap / withdrawStatusMap 同款出口。
   测试拿它跟后端七态做**键集**断言：只验 label 不含 'UNKNOWN' 是测不出条目被删的
   （fallback 会把 label 设成状态码本身），键集比对才会红。 */
export const ALL_SWAP_STATUSES: string[] = Object.keys(SWAP_STATUS_MAP);

/* 兑换转移表里**零出边**的终态全集,来源逐字对照：
   src/modules/trading/swap-transactions/swap-transactions.service.ts 的 TRANSITIONS
   —— SUCCESS / REJECTED / FROZEN / FAILED / REVERSED 五行都是 `{}`。
   FROZEN 的零出边是**故意的**（服务里原话）,不是忘了写:制裁/MLRO 冻结在兑换域
   不可逆,与提现的 FROZEN（有 unfreeze/refund 两条合法出边,故那边**不**算终态）
   刻意相反 —— 所以这份不能跟 isWithdrawTerminalStatus 合并。
   FAILED / REVERSED 零入边不可达,一并列出的理由与上面映射表保留其条目一致。 */
const SWAP_TERMINAL_STATUSES = new Set([
  'SUCCESS',
  'REJECTED',
  'FROZEN',
  'FAILED',
  'REVERSED',
]);

/**
 * 兑换单是否已到终态 —— 详情页据此显示「Terminal — no further action available」。
 */
export function isSwapTerminalStatus(status: string): boolean {
  return SWAP_TERMINAL_STATUSES.has(String(status || '').toUpperCase());
}

export const SWAP_STATUS_FILTERS: Array<{ label: string; statuses: string[] }> = [
  { label: 'In progress', statuses: ['COMPLIANCE_PENDING', 'PROCESSING'] },
  { label: 'Needs officer', statuses: ['FROZEN'] },
  { label: 'Completed', statuses: ['SUCCESS'] },
  { label: 'Exception', statuses: ['REJECTED', 'FAILED', 'REVERSED'] },
];
