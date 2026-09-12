/* 审计页实体跳转（波三F，业主拍甲案）：按 primarySubjectType 把 primarySubjectNo
   （业务号，铁律⑥）映射到详情/列表路由。逐条对照 App.tsx 现状路由实证；交易三单
   详情路由仍收内部 id（波五换键），走「列表页 + ?keyword=」（I2 已接通）。
   映射缺席 = 保持纯文本——照 approvalEntityRoutes 的纪律，不硬造。
   FUNDS_ORDER 不在 AuditEntityTypes 常量里但真实落库（push-order/advance-workflow
   两处字面量），必须收编。 */
export const AUDIT_ENTITY_ROUTE_BY_SUBJECT_TYPE: Record<string, (no: string) => string> = {
  DEPOSIT_TRANSACTION: (no) => `/admin/trading/deposits?keyword=${no}`,
  WITHDRAW_TRANSACTION: (no) => `/admin/trading/withdrawals?keyword=${no}`,
  SWAP_TRANSACTION: (no) => `/admin/trading/swaps?keyword=${no}`,
  SWAP_QUOTE: (no) => `/admin/trading/swap-quotes/${no}`,
  WITHDRAW_QUOTE: (no) => `/admin/trading/withdraw-quotes/${no}`,
  CUSTOMER: (no) => `/admin/customers/${no}`,
  APPROVAL_CASE: (no) => `/admin/governance/approvals/${no}`,
  FUNDS_ORDER: (no) => `/admin/funds-orders/${no}`,
  INCIDENT: (no) => `/admin/governance/incidents/${no}`,
  ASSET: (no) => `/admin/assets/${no}`,
  TRANSACTION_LIMIT_POLICY: (no) => `/admin/assets/transaction-limits/${no}`,
  WALLET: (no) => `/admin/custody/wallets/${no}`,
  WITHDRAWAL_ADDRESS: (no) => `/admin/custody/withdrawal-addresses/${no}`,
  INTERNAL_TRANSFER: (no) => `/admin/treasury/internal-transfers/${no}`,
  ADMIN_USER: (no) => `/admin/iam/members/${no}`,
  RECONCILIATION_RUN_V8: (no) => `/admin/reconciliation/runs/${no}`,
  RECONCILIATION_CASE: (no) => `/admin/reconciliation/cases/${no}`,
  RECON_ADJUSTMENT: (no) => `/admin/reconciliation/adjustments/${no}`,
};
