export const PERMISSIONS = {
  BASE_ACCESS: 'api.get.auth_me',

  USERS_READ: 'api.get.users',
  USERS_CREATE: 'api.post.users',
  // Task 18：对外识别改 userNo 后，五码随 rbac.catalog.ts 的 :id → :userNo 一起漂——
  // buildPermissionCode(method, path) 派生值，同 47 行注释的镜像约定。
  USERS_INVITATION_RESEND: 'api.post.users_userno_invitations_resend',
  IAM_ROLES_READ: 'api.get.admin_iam_roles',
  IAM_PERMISSIONS_READ: 'api.get.admin_iam_permissions',
  IAM_USER_ROLES_READ: 'api.get.admin_iam_users_id_roles',
  // Task 26：IAM_USER_ROLES_WRITE（旧版直改角色 PUT，零前端消费方）随 rbac.catalog.ts
  // 12 死行清零一起删——role-change-request 审批流早已取代它。
  IAM_ROLE_CHANGE_REQUESTS_CREATE: 'api.post.admin_iam_role_change_requests',
  IAM_ROLE_CHANGE_REQUESTS_READ: 'api.get.admin_iam_role_change_requests',
  // Task 25：详情端点改按 requestNo 查询后，rbac.catalog.ts 的 :id → :requestNo 一起漂——
  // 同 6-7 行 Task 18 那条镜像约定。
  IAM_ROLE_CHANGE_REQUEST_DETAIL_READ: 'api.get.admin_iam_role_change_requests_requestno',
  USERS_SUSPEND: 'api.post.users_userno_suspend',
  USERS_REACTIVATE: 'api.post.users_userno_reactivate',
  USERS_RESET_MFA: 'api.post.admin_iam_users_userno_reset_mfa',
  USERS_RESET_PASSWORD: 'api.post.users_userno_reset_password',

  CUSTOMERS_READ: 'api.get.customers',
  // 客户域业务号化（2026-09-03）：对外识别改 customerNo 后，此码随 rbac.catalog.ts
  // 的 :id → :customerNo 一起漂——同 6-7 行 Task 18 那条镜像约定。
  CUSTOMERS_DETAIL_READ: 'api.get.customers_customerno',

  CUSTOMER_TAGS_CATALOG_READ: 'api.get.admin_customer_tags_catalog',
  CUSTOMER_TAGS_READ: 'api.get.admin_customers_customerno_effective_tags',
  CUSTOMER_TAGS_ASSIGN: 'api.post.admin_customers_customerno_tags',
  CUSTOMER_TAGS_REVOKE: 'api.delete.admin_customers_customerno_tags_tagcode',

  CUSTOMER_RESTRICTIONS_READ: 'api.get.admin_customers_customerno_restrictions',
  CUSTOMER_RESTRICTIONS_WRITE: 'api.post.admin_customers_customerno_restrictions',
  CUSTOMER_RESTRICTIONS_RELEASE:
    'api.post.admin_customers_customerno_restrictions_restrictionno_release',

  // 客户域波二（Task 10）：准入核准提单——精确镜像 rbac.catalog.ts 里 Task 8
  // 已登记的 buildPermissionCode(method, path) 派生值。
  CUSTOMER_ONBOARDING_ACCEPT_WRITE: 'api.post.admin_customers_customerno_onboarding_acceptance',
  // 终审补齐（2026-09-07）：查关联准入核准单状态——精确镜像 rbac.catalog.ts 同名 GET 路由。
  CUSTOMER_ONBOARDING_ACCEPTANCE_READ: 'api.get.admin_customers_customerno_onboarding_acceptance',

  // 交易档位升级波三（Task 13）：升级核准提单——精确镜像 tier-upgrade.admin.controller.ts
  // 的 buildPermissionCode('POST', '/admin/customers/:customerNo/tier-upgrade-acceptance')。
  CUSTOMER_TIER_UPGRADE_ACCEPT_WRITE:
    'api.post.admin_customers_customerno_tier_upgrade_acceptance',

  MATERIAL_REQUESTS_READ: 'api.get.admin_customers_customerno_material_requests',
  MATERIAL_REQUESTS_WRITE: 'api.post.admin_customers_customerno_material_requests',
  MATERIAL_REQUESTS_BY_ORDER_READ: 'api.get.admin_material_requests_by_order_orderdomain_orderref',

  SWAP_QUOTES_READ: 'api.get.admin_swap_transactions_quotes',
  // 报价换键（波二 Task 5）：详情端点改按 quoteNo 查询后，rbac.catalog.ts 的
  // quotes/:id → quotes/:quoteNo 一起漂——同 47 行注释的镜像约定。
  SWAP_QUOTES_DETAIL_READ: 'api.get.admin_swap_transactions_quotes_quoteno',
  SWAP_TRANSACTIONS_READ: 'api.get.admin_swap_transactions',
  // 单号换键（波五 Task 9）：详情端点改按 swapNo 查询后，rbac.catalog.ts 的
  // :id → :swapNo 一起漂——同 55-56 行注释的镜像约定。
  SWAP_TRANSACTION_DETAIL_READ: 'api.get.admin_swap_transactions_swapno',

  RECON_RUN_READ: 'api.get.admin_reconciliation_runs',
  RECON_RUN_DETAIL_READ: 'api.get.admin_reconciliation_runs_runno',
  // Task 7（差异行处置按钮）：Re-reconcile 此前无权限门——OPS 点了 403；这里补上，
  // 精确镜像 rbac.catalog.ts 里 RECON_RUN_WRITE 组的 buildPermissionCode 派生值。
  RECON_RUN_WRITE: 'api.post.admin_reconciliation_runs_wallet',
  RECON_CASE_READ: 'api.get.admin_reconciliation_cases',
  RECON_CASE_DETAIL_READ: 'api.get.admin_reconciliation_cases_caseno',
  RECON_EXTERNAL_BALANCE_READ: 'api.get.admin_reconciliation_external_balances',

  // Task 7（调账单 admin 前端）——三个码精确镜像 rbac.catalog.ts 里 Task 6 已登记的
  // buildPermissionCode(method, path) 派生值，不是自造字符串。
  RECON_ADJUSTMENT_CREATE: 'api.post.admin_reconciliation_adjustments',
  RECON_ADJUSTMENT_SUBMIT: 'api.post.admin_reconciliation_adjustments_adjustmentno_submit',
  RECON_ADJUSTMENT_DETAIL_READ: 'api.get.admin_reconciliation_adjustments_adjustmentno',
  // 平账收尾·界面收口轮 Task 5——调账单列表端点（Task 4 已在 rbac.catalog.ts 登记）。
  RECON_ADJUSTMENT_LIST_READ: 'api.get.admin_reconciliation_adjustments',
  RECON_DISPOSITION_CREATE: 'api.post.admin_reconciliation_cases_caseno_dispositions',
  RECON_REATTRIBUTION_CANDIDATES_READ: 'api.get.admin_reconciliation_cases_caseno_reattribution_candidates',

  // 平账二期（2026-09-05）：内部划转单——五个码精确镜像 rbac.catalog.ts route() 的 buildPermissionCode 派生值
  INTERNAL_TRANSFERS_READ: 'api.get.admin_internal_transfers',
  INTERNAL_TRANSFER_DETAIL_READ: 'api.get.admin_internal_transfers_transferno',
  INTERNAL_TRANSFER_COMPENSATION_WRITE: 'api.post.admin_internal_transfers_compensation',
  INTERNAL_TRANSFER_ADVANCE_WRITE: 'api.post.admin_internal_transfers_advance',
  INTERNAL_TRANSFER_CANCEL: 'api.post.admin_internal_transfers_transferno_cancel',

  // 战役乙波一（Task 7）：LP 档案——六个码精确镜像 rbac.catalog.ts 里 Task 3 已登记的
  // buildPermissionCode(method, path) 派生值（同 82 行 INTERNAL_TRANSFERS_* 先例）。
  LP_PROFILES_READ: 'api.get.admin_lp_profiles',
  LP_PROFILE_DETAIL_READ: 'api.get.admin_lp_profiles_lpno',
  LP_PROFILE_CREATE: 'api.post.admin_lp_profiles',
  LP_PROFILE_SETTLEMENT_CHANGE_WRITE: 'api.post.admin_lp_profiles_lpno_settlement_change',
  LP_PROFILE_SUSPEND: 'api.post.admin_lp_profiles_lpno_suspend',
  LP_PROFILE_REACTIVATE: 'api.post.admin_lp_profiles_lpno_reactivate',

  // 战役乙波一（Task 8）：LP 兑换单——六个码精确镜像 rbac.catalog.ts 里 T6 已登记的
  // buildPermissionCode(method, path) 派生值（同上方 89-96 行 Task 7 先例）。
  LP_EXCHANGES_READ: 'api.get.admin_lp_exchanges',
  LP_EXCHANGE_DETAIL_READ: 'api.get.admin_lp_exchanges_exchangeno',
  LP_EXCHANGE_CREATE: 'api.post.admin_lp_exchanges',
  LP_EXCHANGE_CANCEL: 'api.post.admin_lp_exchanges_exchangeno_cancel',
  LP_EXCHANGE_ACCEPT: 'api.post.admin_lp_exchanges_exchangeno_accept',
  LP_EXCHANGE_SIMULATE_DELIVERY: 'api.post.admin_lp_exchanges_exchangeno_simulate_delivery',

  // 战役乙波二（Task 6）：注资单——六个码精确镜像 rbac.catalog.ts 里 T3 已登记的
  // buildPermissionCode(method, path) 派生值（同上方 98-105 行 LP_EXCHANGE_* 先例）。
  CAPITAL_INJECTIONS_READ: 'api.get.admin_capital_injections',
  CAPITAL_INJECTION_DETAIL_READ: 'api.get.admin_capital_injections_cinno',
  CAPITAL_INJECTION_CREATE: 'api.post.admin_capital_injections',
  CAPITAL_INJECTION_CANCEL: 'api.post.admin_capital_injections_cinno_cancel',
  CAPITAL_INJECTION_SIMULATE_CONTRIBUTION: 'api.post.admin_capital_injections_cinno_simulate_contribution',
  CAPITAL_INJECTION_CONFIRM: 'api.post.admin_capital_injections_cinno_confirm',

  // 战役乙波二 Task 6 Step 3.5（T1 评审收口，两族一次接齐）：付款单读权——本任务只需要
  // 它来给 FundsOrderDetail.tsx 的「Linked Vendor payment」回链按权限门控（同 INTERNAL_
  // TRANSFERS_READ/LP_EXCHANGES_READ 先例）；付款单自己的 List/Detail 页与其余码归 Task 7。
  VENDOR_PAYMENTS_READ: 'api.get.admin_vendor_payments',

  // 战役乙波二（Task 7）：付款单——四个码精确镜像 rbac.catalog.ts 里 T5 已登记的
  // buildPermissionCode(method, path) 派生值（同上方 107-114 行 CAPITAL_INJECTION_* 先例）。
  // 付款单无 simulate-contribution/confirm 端点（腿 1 推进走资金单页 ⚡，落账在腿事件里
  // 自动收口），故只有四码，比注资单少两个。
  VENDOR_PAYMENT_DETAIL_READ: 'api.get.admin_vendor_payments_payno',
  VENDOR_PAYMENT_CREATE: 'api.post.admin_vendor_payments',
  VENDOR_PAYMENT_CANCEL: 'api.post.admin_vendor_payments_payno_cancel',

  // 战役乙波二（Task 8）：公司资金全景看板——页面本身不消费任何专属后端端点（复用既有
  // TB_ACCOUNTS_READ/TB_FLOWS_READ 数据端点），但那两条数据路由同时被技术官/运营的
  // LEDGER_ACCOUNT_READ 覆盖，不能借来门控导航/路由。这个值不是 buildPermissionCode()
  // 派生的 'api.xxx' 字面量，而是 rbac.catalog.ts 里唯一挂 FUNDING_DASHBOARD_VIEW 单组的
  // 服务层/前端门控标记码（cap.treasury.funding_dashboard，MARKER，同 cap.incident.*
  // 先例）——只有金库/CFO/高管/内审恰四职务会在 /auth/me 的 permissions 里拿到它。
  FUNDING_DASHBOARD_VIEW: 'cap.treasury.funding_dashboard',

  // 平账三期（2026-09-06）：事故登记——三个码精确镜像 rbac.catalog.ts route() 的
  // buildPermissionCode 派生值。列表/详情两个 GET 路由的 allowedGroups 同时含
  // INCIDENT_READ/INCIDENT_WRITE（route() 已登记），写动作只有 INCIDENT_WRITE 一组；
  // 本页所有写按钮（登记/调查/升级/定损/挂善后/通报/结案/撤回）统一用注册端点这一个
  // 代表码判断——同一权限组绑定的角色，会一并拿到该组下全部路由的码，不必逐动作各开一码。
  INCIDENTS_READ: 'api.get.admin_incidents',
  INCIDENT_DETAIL_READ: 'api.get.admin_incidents_incidentno',
  INCIDENT_WRITE: 'api.post.admin_incidents',

  // 战役甲波二（Task 9）：报送台——三个码精确镜像 rbac.catalog.ts route() 的
  // buildPermissionCode 派生值。spec §6：REG_FILING_WRITE 是唯一写组，挂全部 POST 路由
  // （开单/草稿/送签/标已提交/往来记录/办结/作废），不设 cap.* 标记码（该域经办人唯合规官，
  // 无需按族区分）——同 INCIDENT_WRITE 的既有代表码惯例，本页全部写按钮统一用这一个码判断，
  // 不逐动作各开一码。
  REG_FILINGS_READ: 'api.get.admin_regulatory_filings',
  REG_FILING_DETAIL_READ: 'api.get.admin_regulatory_filings_filingno',
  REG_FILING_WRITE: 'api.post.admin_regulatory_filings',

  // 战役甲波四（Task 9）：合规办公室骨架——闹钟墙 + 合规日历（周期义务）+ 两本登记册
  // （外包商 / RI）。四个键名精确照 rbac.catalog.ts 的 PermissionGroup 字面量
  // （COMPLIANCE_OFFICE_VIEW/OBLIGATION_WRITE/VENDOR_REGISTER_WRITE/RI_REGISTER_WRITE，
  // 见该文件 98-101 行）；值是 buildPermissionCode(method, path) 对该组第一条注册路由的
  // 派生值——同组内其余路由（见 rbac.catalog.ts 515-537 行）绑定的角色完全一致，按本文件
  // 既有代表码惯例（REG_FILING_WRITE 等）只登记一个代表码，三个页面全部写按钮/⚡ 按钮
  // 统一用它判断。⚡ 两枚按钮（obligations simulate-due / regulatory-filings
  // simulate-deadline-timeout）复用既有 DEMO_CLOCK_WRITE（同组，见 rbac.catalog.ts
  // 526/511 行），不新增键。
  COMPLIANCE_OFFICE_VIEW: 'api.get.admin_compliance_office_clock_wall',
  OBLIGATION_WRITE: 'api.post.admin_compliance_obligations',
  VENDOR_REGISTER_WRITE: 'api.post.admin_outsourcing_vendors',
  RI_REGISTER_WRITE: 'api.post.admin_responsible_individuals',

  // 战役甲波五（Task 9）：投诉工作流——两个键名精确照 rbac.catalog.ts 的 PermissionGroup
  // 字面量（COMPLAINT_READ/COMPLAINT_WRITE，route() 507-513 行）。列表/详情两个 GET 路由
  // 的 allowedGroups 同时含 COMPLAINT_READ/COMPLAINT_WRITE，六个写路由（acknowledge/
  // investigation/notes/extend/propose-resolution/escalate）只挂 COMPLAINT_WRITE——同
  // INCIDENT_WRITE/REG_FILING_WRITE 既有代表码惯例，一个码代表整组，两个页面 + 全部写
  // 按钮统一用它们判断，不逐路由各开一码。⚡ 拨钟按钮复用既有 DEMO_CLOCK_WRITE（同组，见
  // rbac.catalog.ts simulate-timeout 路由），不新增键。
  COMPLAINT_READ: 'api.get.admin_complaints',
  COMPLAINT_WRITE: 'api.post.admin_complaints_complaintno_acknowledge',

  SUMSUB_EVENTS_READ: 'api.get.admin_sumsub_events',
  AUDIT_LOGS_READ: 'api.get.admin_audit_logs',
  AUDIT_EXPORT_CREATE: 'api.post.admin_audit_evidence_packages',
  AUDIT_EVIDENCE_EXPORTS_READ: 'api.get.admin_audit_evidence_packages',
  AUDIT_EVIDENCE_EXPORT_DOWNLOAD:
    'api.get.admin_audit_evidence_packages_packageno_download',
  GOV_APPROVALS_READ: 'api.get.admin_control_gates_approvals',
  // Task 17：对外识别改 approvalNo 后，四码随 rbac.catalog.ts 的 :id → :approvalNo
  // 一起漂——buildPermissionCode(method, path) 派生值，同 47 行注释的镜像约定。
  GOV_APPROVAL_DETAIL_READ: 'api.get.admin_control_gates_approvals_approvalno',
  GOV_APPROVAL_APPROVE: 'api.post.admin_control_gates_approvals_approvalno_approve',
  GOV_APPROVAL_REJECT: 'api.post.admin_control_gates_approvals_approvalno_reject',
  GOV_APPROVAL_CANCEL: 'api.post.admin_control_gates_approvals_approvalno_cancel',

  // 评审修复（对账两角色收权，2026-09-10）：DEMO_CLOCK_WRITE 组挂 5 条路由（充值/提现/兑换
  // 各自的 simulate-sla-timeout、对账案件 aging 超时、本组 approvals/simulate-timeout）；
  // Deposit/WithdrawTransactionDetail.tsx 与 ApprovalDetailPage.tsx 三处 ⚡ 拨钟按钮此前从
  // 未查权限码，只按订单/审批状态显隐（运营 2026-09-10 两角色定案后不再持有该组，按钮却仍在、
  // 一点即 403）。按本文件既有代表码惯例（见上方 FUNDS_ORDER_PUSH_WRITE 注释）只登记
  // approvals/simulate-timeout 这一个，同组路由绑定角色一致，三处按钮统一用它判断。
  DEMO_CLOCK_WRITE: 'api.post.admin_control_gates_approvals_approvalno_simulate_timeout',

  IAM_ROLE_DEFINITIONS_CREATE: 'api.post.admin_iam_role_definitions',
  IAM_ROLE_DEFINITIONS_PERMISSION_GROUPS: 'api.get.admin_iam_role_definitions_permission_groups',
  IAM_ROLE_DEFINITIONS_MODIFY: 'api.post.admin_iam_role_definitions_roleid_modify',
  IAM_ROLE_DEFINITION_MODIFY_REQUESTS_READ: 'api.get.admin_iam_role_definition_modify_requests',
  // Task 26：详情端点改按 requestNo 查询后，rbac.catalog.ts 的 :id → :requestNo 一起漂——
  // 同 15-16 行 Task 25 那条镜像约定。
  IAM_ROLE_DEFINITION_MODIFY_REQUEST_DETAIL_READ: 'api.get.admin_iam_role_definition_modify_requests_requestno',
  IAM_ACTION_BUCKETS_READ: 'api.get.admin_iam_action_buckets',

  // Approval Policy Management
  GOV_APPROVAL_POLICIES_READ: 'api.get.admin_governance_approval_policies',
  GOV_APPROVAL_POLICY_CHANGE_CREATE: 'api.post.admin_governance_approval_policies_actiontype_change_requests',
  GOV_APPROVAL_POLICY_CHANGE_REQUESTS_READ: 'api.get.admin_governance_approval_policies_change_requests',
  GOV_APPROVAL_POLICY_CHANGE_REQUEST_DETAIL_READ: 'api.get.admin_governance_approval_policies_change_requests_id',

  WALLETS_READ: 'api.get.wallets',
  // Task 18：同上，钱包详情随 :id → :walletNo 一起漂。
  WALLET_DETAIL_READ: 'api.get.wallets_walletno',
  // PAYINS_* / PAYOUTS_* / INTERNAL_FUNDS_* removed in Round 2 (C6) — merged into FUNDS_ORDERS_*.

  ASSETS_READ: 'api.get.assets',
  ASSET_SUSPEND: 'api.post.admin_assets_assetno_suspend',
  ASSET_REACTIVATE: 'api.post.admin_assets_assetno_reactivate',
  DEPOSIT_TRANSACTIONS_READ: 'api.get.deposit_transactions',
  // 单号换键（波五 Task 9）：详情端点改按 depositNo 查询后，rbac.catalog.ts 的
  // :id → :depositNo 一起漂——同 55-56 行注释的镜像约定。
  DEPOSIT_TRANSACTION_DETAIL_READ: 'api.get.deposit_transactions_depositno',
  WITHDRAW_TRANSACTIONS_READ: 'api.get.withdraw_transactions',
  WITHDRAW_TRANSACTION_DETAIL_READ: 'api.get.withdraw_transactions_withdrawno',

  // 平账 B 批（Task 9）——三条补单路的写权限码，精确镜像 rbac.catalog.ts 里
  // Task 5/6/7 已登记的 buildPermissionCode(method, path) 派生值。
  DEPOSIT_SUPPLEMENT_WRITE: 'api.post.deposit_transactions_supplement',
  DEPOSIT_CLAWBACK_WRITE: 'api.post.deposit_transactions_depositno_clawback',
  WITHDRAW_RETURN_CLAIM_WRITE: 'api.post.withdraw_transactions_withdrawno_return_claim',
  // Unified funds-orders admin surface (Round 2 / C6) — replaces the legacy
  // payins / payouts / internal-funds read permissions.
  FUNDS_ORDERS_READ: 'api.get.admin_funds_orders',
  FUNDS_ORDER_DETAIL_READ: 'api.get.admin_funds_orders_fundsorderno',
  // 对账平账两角色定案（2026-09-10）：FundsOrderDetail.tsx 的 Sync / Manual Confirm / ⚡
  // Simulation 三个写动作此前没有任何权限码门控（只按订单状态判断），全靠后端 403 兜底——
  // OPS_OFFICER 迁移前恰好三个端点都在，从没露出过。运营现在只持 FUNDS_ORDER_VIEW，这个缺口
  // 才第一次会露出「按钮在、一点就 403」。三个端点（advance / push/sync / push/manual）同挂
  // rbac.catalog.ts 的 FUNDS_ORDER_ACT 组，按本文件既有代表码惯例（见上方事故登记注释）只登记
  // push/sync 这一个，三个按钮统一用它判断。
  FUNDS_ORDER_PUSH_WRITE: 'api.post.admin_funds_orders_fundsorderno_push_sync',


  TB_ACCOUNTS_READ: 'api.get.admin_tb_accounts',
  TB_TRANSFERS_READ: 'api.get.admin_tb_transfers',
  TB_TRANSFER_DETAIL_READ: 'api.get.admin_tb_transfers_tbtransferid',
  TB_FLOWS_READ: 'api.get.admin_tb_account_flows',

  TRANSACTION_LIMIT_READ: 'api.get.admin_transaction_limit_rules',
  TRANSACTION_LIMIT_WRITE: 'api.post.admin_transaction_limit_rules_ruleno_change',

  WITHDRAWAL_ADDRESSES_READ: 'api.get.admin_withdrawal_addresses',
  WITHDRAWAL_ADDRESS_DETAIL_READ: 'api.get.admin_withdrawal_addresses_addressno',
  WITHDRAWAL_ADDRESS_SUSPEND: 'api.post.admin_withdrawal_addresses_addressno_suspend',
  WITHDRAWAL_ADDRESS_SKIP_COOLING: 'api.post.admin_withdrawal_addresses_addressno_skip_cooling',
  WITHDRAWAL_ADDRESS_UNSUSPEND: 'api.post.admin_withdrawal_addresses_addressno_unsuspend',
  WITHDRAWAL_FEE_LEVELS_READ: 'api.get.admin_withdrawal_fee_levels',
  SWAP_FEE_LEVELS_READ: 'api.get.admin_swap_fee_levels',
  SWAP_FEE_LEVEL_RETIRE: 'api.post.admin_swap_fee_levels_levelcode_retire',
  WITHDRAWAL_FEE_LEVEL_RETIRE: 'api.post.admin_withdrawal_fee_levels_levelcode_retire',
  WITHDRAW_QUOTES_READ: 'api.get.admin_withdrawal_fee_levels_quotes',
  // 报价换键（波二 Task 5）：详情端点改按 quoteNo 查询后，rbac.catalog.ts 的
  // quotes/:id → quotes/:quoteNo 一起漂——同 47 行注释的镜像约定。
  WITHDRAW_QUOTES_DETAIL_READ: 'api.get.admin_withdrawal_fee_levels_quotes_quoteno',
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
