/* 审计页实体跳转（波三F，业主拍甲案）：按 primarySubjectType 把 primarySubjectNo
   （业务号，铁律⑥）映射到详情/列表路由。逐条对照 App.tsx 现状路由实证。
   映射缺席 = 保持纯文本——照 approvalEntityRoutes 的纪律，不硬造。 */
export const AUDIT_ENTITY_ROUTE_BY_SUBJECT_TYPE: Record<string, (no: string) => string> = {
  // 交易三单详情路由已换业务号（波五 Task 9）：直达详情页，不再绕列表页 keyword。
  DEPOSIT_TRANSACTION: (no) => `/admin/trading/deposits/${no}`,
  WITHDRAW_TRANSACTION: (no) => `/admin/trading/withdrawals/${no}`,
  SWAP_TRANSACTION: (no) => `/admin/trading/swaps/${no}`,
  SWAP_QUOTE: (no) => `/admin/trading/swap-quotes/${no}`,
  WITHDRAW_QUOTE: (no) => `/admin/trading/withdraw-quotes/${no}`,
  CUSTOMER: (no) => `/admin/customers/${no}`,
  APPROVAL_CASE: (no) => `/admin/governance/approvals/${no}`,
  FUNDS_ORDER: (no) => `/admin/funds-orders/${no}`,
  INCIDENT: (no) => `/admin/governance/incidents/${no}`,
  // 战役甲波二（Task 9）：报送单十码全部以 REGULATORY_FILING/filingNo 为 primarySubject
  // （regulatory-filing.service.ts recordAudit），同 INCIDENT 一行的既有登记纪律补齐。
  REGULATORY_FILING: (no) => `/admin/governance/regulatory-filings/${no}`,
  ASSET: (no) => `/admin/assets/${no}`,
  TRANSACTION_LIMIT_POLICY: (no) => `/admin/assets/transaction-limits/${no}`,
  WALLET: (no) => `/admin/custody/wallets/${no}`,
  WITHDRAWAL_ADDRESS: (no) => `/admin/custody/withdrawal-addresses/${no}`,
  INTERNAL_TRANSFER: (no) => `/admin/custody/internal-transfers/${no}`,
  ADMIN_USER: (no) => `/admin/iam/members/${no}`,
  RECONCILIATION_RUN_V8: (no) => `/admin/reconciliation/runs/${no}`,
  RECONCILIATION_CASE: (no) => `/admin/reconciliation/cases/${no}`,
  RECON_ADJUSTMENT: (no) => `/admin/reconciliation/adjustments/${no}`,
  WITHDRAWAL_FEE_LEVEL: (no) => `/admin/pricing/withdrawal-fee-levels/${no}`,
  SWAP_FEE_LEVEL: (no) => `/admin/pricing/swap-fee-levels/${no}`,
};
