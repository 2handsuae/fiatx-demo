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
  // 详情路由是 /admin/trading/swaps/:swapNo（波五 Task 9 换键），读端点挂 TRADING_SWAP_READ。
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
  INTERNAL_TRANSFER_APPROVAL: 'INTERNAL_TRANSFER_READ', // → /admin/custody/internal-transfers/:transferNo
  // 平账三期（2026-09-06）：事故登记结案，两个动作类型都指向事故详情路由（entityRef = incidentNo）
  INCIDENT_CLOSE_SECURITY: 'INCIDENT_READ', // → /admin/governance/incidents/:incidentNo
  INCIDENT_CLOSE_FINANCIAL: 'INCIDENT_READ', // → /admin/governance/incidents/:incidentNo
  // 战役甲波一 Task 8（结案四链，2026-09-25）：新两条动作类型同样指向事故详情路由。T9 已给
  // CISO（TECHSEC 裁决人）补上 INCIDENT_READ（rbac.catalog.ts CISO 绑定区）。
  INCIDENT_CLOSE_TECHSEC: 'INCIDENT_READ', // → /admin/governance/incidents/:incidentNo
  INCIDENT_CLOSE_PRUDENTIAL: 'INCIDENT_READ', // → /admin/governance/incidents/:incidentNo（SMO 已持 INCIDENT_READ）
  // 客户域（entityRef = customerNo）
  CUSTOMER_ONBOARDING_ACCEPTANCE: 'CUSTOMER_READ', // → /admin/customers/:customerNo（SMO 持 CUSTOMER_READ）
  CUSTOMER_TIER_UPGRADE: 'CUSTOMER_READ', // → /admin/customers/:customerNo（SMO 持 CUSTOMER_READ）
  // 战役甲波二（entityRef = filingNo）：报送签发，裁决人高管持 REG_FILING_READ。
  REG_FILING_SUBMIT: 'REG_FILING_READ', // → /admin/governance/regulatory-filings/:filingNo
  // 战役甲波三 T4修（评审黄4，approvalEntityRoutes.ts 同批加行）：制裁定性提单
  // （entityRef = customerNo），唯一裁决人 MLRO 持 CUSTOMER_READ（rbac.catalog.ts MLRO
  // 绑定区）——批完看得见 /admin/customers/:customerNo。
  SANCTION_DISPOSITION: 'CUSTOMER_READ', // → /admin/customers/:customerNo（MLRO 持 CUSTOMER_READ）
  // 战役甲波五 Task 9（承接项E，approvalEntityRoutes.ts 同批加行）：两条裁决人都是
  // COMPLIANCE_OFFICER（approval.constants.ts 431/435 行两条策略），→ /admin/governance/
  // complaints/:complaintNo 挂 COMPLAINT_READ；→ /admin/governance/incidents/:incidentNo
  // 挂 INCIDENT_READ（同既有四条 INCIDENT_CLOSE_* 惯例）——两个读权限组合规官均持有
  // （rbac.catalog.ts COMPLIANCE_OFFICER 绑定区）。
  COMPLAINT_RESOLUTION: 'COMPLAINT_READ', // → /admin/governance/complaints/:complaintNo（合规官持 COMPLAINT_READ）
  INCIDENT_CLOSE_CUSTOMER: 'INCIDENT_READ', // → /admin/governance/incidents/:incidentNo（合规官持 INCIDENT_READ）
  // 战役乙波一：LP 档案 / LP 兑换单，唯一裁决人 CFO 持 LP_READ（rbac.catalog.ts CFO 绑定区）。
  // T7 加了 approvalEntityRoutes.ts 的 LP_PROFILE_APPROVAL/LP_PROFILE_CHANGE 两行，漏加这张
  // 表的对应行——S9 断言当时就该红（本任务 Task 8 补 LP_EXCHANGE_APPROVAL 时顺手补齐两处旧账）。
  LP_PROFILE_APPROVAL: 'LP_READ', // → /admin/lp-profiles/:lpNo（CFO 持 LP_READ）
  LP_PROFILE_CHANGE: 'LP_READ', // → /admin/lp-profiles/:lpNo（CFO 持 LP_READ）
  LP_EXCHANGE_APPROVAL: 'LP_READ', // → /admin/lp-exchanges/:exchangeNo（CFO 持 LP_READ）
  // 战役乙波二 Task 6：注资单，唯一裁决人 CFO 持 FUNDING_READ（rbac.catalog.ts CFO 绑定区）。
  CAPITAL_INJECTION_APPROVAL: 'FUNDING_READ', // → /admin/capital-injections/:cinNo（CFO 持 FUNDING_READ）
  // 战役乙波二 Task 7：付款单，唯一裁决人 CFO 同样持 FUNDING_READ（同上行先例）。
  VENDOR_PAYMENT_APPROVAL: 'FUNDING_READ', // → /admin/vendor-payments/:payNo（CFO 持 FUNDING_READ）
};
