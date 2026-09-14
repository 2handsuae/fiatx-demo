/**
 * S9：审批策略 → 裁决人必须持有的详情页读权限组。
 * 镜像 admin-web/src/pages/approvalEntityRoutes.ts 的 ENTITY_ROUTE_BY_ACTION 键集——两边键集相等由
 * admin-web/src/pages/approvalEntityRoutes.spec.ts 断言（判例：每张手工维护的表都必须配伴生断言）。
 */
export const DETAIL_READ_GROUP_BY_POLICY: Record<string, string> = {
  ASSET_SUSPENSION: 'ASSET_CONFIG_READ',
  ASSET_REACTIVATION: 'ASSET_CONFIG_READ',
  TRANSACTION_LIMIT_CHANGE: 'TRANSACTION_LIMIT_READ',
  SWAP_FEE_LEVEL_CREATION: 'SWAP_FEE_LEVEL_READ',
  SWAP_FEE_LEVEL_RETIRE: 'SWAP_FEE_LEVEL_READ',
  WITHDRAWAL_FEE_LEVEL_CREATION: 'WITHDRAWAL_FEE_LEVEL_READ',
  WITHDRAWAL_FEE_LEVEL_RETIRE: 'WITHDRAWAL_FEE_LEVEL_READ',
  WITHDRAW_LARGE_VALUE_APPROVAL: 'TRADING_WITHDRAW_READ',
  WITHDRAW_UNFREEZE: 'TRADING_WITHDRAW_READ',
  WITHDRAW_SANCTION_REFUND: 'TRADING_WITHDRAW_READ',
  DEPOSIT_CONFISCATION: 'TRADING_DEPOSIT_READ',
  DEPOSIT_RETURN: 'TRADING_DEPOSIT_READ',
  DEPOSIT_SEIZE: 'TRADING_DEPOSIT_READ',
  DEPOSIT_UNFREEZE: 'TRADING_DEPOSIT_READ',
  // 波五 Task 3 补的 swap 解冻/拒退（2026-09-14）：admin-web 那边的 entityRef 映射当时
  // 加了（approvalEntityRoutes.ts），这张表漏加——两表键集不相等，S9 断言当场证伪
  // （评审在 Task 6 收尾时抓到）。镜像 WITHDRAW_UNFREEZE/WITHDRAW_SANCTION_REFUND：
  // 详情路由是 /admin/trading/swaps/:id，读端点挂 TRADING_SWAP_READ。
  SWAP_UNFREEZE: 'TRADING_SWAP_READ',
  SWAP_SANCTION_REFUND: 'TRADING_SWAP_READ',
  ADMIN_INVITE_APPROVAL: 'IAM_MEMBER_READ',
  ADMIN_SUSPENSION_APPROVAL: 'IAM_MEMBER_READ',
  ADMIN_REACTIVATION_APPROVAL: 'IAM_MEMBER_READ',
  ADMIN_PASSWORD_RESET: 'IAM_MEMBER_READ',
  ADMIN_MFA_RESET: 'IAM_MEMBER_READ',
  ROLE_DEFINITION_CREATE: 'IAM_ROLE_READ',
  ROLE_DEFINITION_MODIFY: 'IAM_ROLE_READ',
  // brief 快照没列这两条——`git grep -n "(r) =>" admin-web/src/pages/ApprovalDetailPage.tsx`
  // 核对，页面确实把这两个 actionType 链到业务详情页，故本任务补齐（2026-09-04）：
  ADMIN_ROLE_BINDING_CHANGE_APPROVAL: 'IAM_ROLE_READ', // → /admin/iam/role-change-requests/:id，读端点挂 IAM_ROLE_READ
  RECON_ADJUSTMENT_POST: 'RECON_CASE_READ', // → /admin/reconciliation/adjustments/:id，读端点挂 RECON_CASE_READ
  // 平账二期（2026-09-05）：内部划转单（entityRef = transferNo）
  INTERNAL_TRANSFER_APPROVAL: 'INTERNAL_TRANSFER_READ', // → /admin/treasury/internal-transfers/:transferNo
  // 平账三期（2026-09-06）：事故登记结案，两个动作类型都指向事故详情路由（entityRef = incidentNo）
  INCIDENT_CLOSE_SECURITY: 'INCIDENT_READ', // → /admin/governance/incidents/:incidentNo
  INCIDENT_CLOSE_FINANCIAL: 'INCIDENT_READ', // → /admin/governance/incidents/:incidentNo
  // 客户域（entityRef = customerNo）
  CUSTOMER_ONBOARDING_ACCEPTANCE: 'CUSTOMER_READ', // → /admin/customers/:customerNo（SMO 持 CUSTOMER_READ）
  CUSTOMER_TIER_UPGRADE: 'CUSTOMER_READ', // → /admin/customers/:customerNo（SMO 持 CUSTOMER_READ）
};
