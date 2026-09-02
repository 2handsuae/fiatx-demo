export const PERMISSIONS = {
  BASE_ACCESS: 'api.get.auth_me',

  USERS_READ: 'api.get.users',
  USERS_CREATE: 'api.post.users',
  USERS_INVITATION_RESEND: 'api.post.users_id_invitations_resend',
  IAM_ROLES_READ: 'api.get.admin_iam_roles',
  IAM_PERMISSIONS_READ: 'api.get.admin_iam_permissions',
  IAM_USER_ROLES_READ: 'api.get.admin_iam_users_id_roles',
  IAM_USER_ROLES_WRITE: 'api.put.admin_iam_users_id_roles',
  IAM_ROLE_CHANGE_REQUESTS_CREATE: 'api.post.admin_iam_role_change_requests',
  IAM_ROLE_CHANGE_REQUESTS_READ: 'api.get.admin_iam_role_change_requests',
  IAM_ROLE_CHANGE_REQUEST_DETAIL_READ: 'api.get.admin_iam_role_change_requests_id',
  USERS_SUSPEND: 'api.post.users_id_suspend',
  USERS_REACTIVATE: 'api.post.users_id_reactivate',
  USERS_RESET_MFA: 'api.post.admin_iam_users_id_reset_mfa',
  USERS_RESET_PASSWORD: 'api.post.users_id_reset_password',

  CUSTOMERS_READ: 'api.get.customers',
  CUSTOMERS_DETAIL_READ: 'api.get.customers_id',

  CUSTOMER_TAGS_CATALOG_READ: 'api.get.admin_customer_tags_catalog',
  CUSTOMER_TAGS_READ: 'api.get.admin_customers_customerno_effective_tags',
  CUSTOMER_TAGS_ASSIGN: 'api.post.admin_customers_customerno_tags',
  CUSTOMER_TAGS_REVOKE: 'api.delete.admin_customers_customerno_tags_tagcode',

  CUSTOMER_RESTRICTIONS_READ: 'api.get.admin_customers_customerno_restrictions',
  CUSTOMER_RESTRICTIONS_WRITE: 'api.post.admin_customers_customerno_restrictions',
  CUSTOMER_RESTRICTIONS_RELEASE:
    'api.post.admin_customers_customerno_restrictions_restrictionno_release',

  MATERIAL_REQUESTS_READ: 'api.get.admin_customers_customerno_material_requests',
  MATERIAL_REQUESTS_WRITE: 'api.post.admin_customers_customerno_material_requests',
  MATERIAL_REQUESTS_BY_ORDER_READ: 'api.get.admin_material_requests_by_order_orderdomain_orderref',

  SWAP_QUOTES_READ: 'api.get.admin_swap_transactions_quotes',
  SWAP_QUOTES_DETAIL_READ: 'api.get.admin_swap_transactions_quotes_id',
  SWAP_TRANSACTIONS_READ: 'api.get.admin_swap_transactions',
  SWAP_TRANSACTION_DETAIL_READ: 'api.get.admin_swap_transactions_id',

  RECON_RUN_READ: 'api.get.admin_reconciliation_runs',
  RECON_RUN_DETAIL_READ: 'api.get.admin_reconciliation_runs_runno',
  RECON_CASE_READ: 'api.get.admin_reconciliation_cases',
  RECON_CASE_DETAIL_READ: 'api.get.admin_reconciliation_cases_caseno',
  RECON_EXTERNAL_BALANCE_READ: 'api.get.admin_reconciliation_external_balances',

  // Task 7（调账单 admin 前端）——三个码精确镜像 rbac.catalog.ts 里 Task 6 已登记的
  // buildPermissionCode(method, path) 派生值，不是自造字符串。
  RECON_ADJUSTMENT_CREATE: 'api.post.admin_reconciliation_adjustments',
  RECON_ADJUSTMENT_SUBMIT: 'api.post.admin_reconciliation_adjustments_adjustmentno_submit',
  RECON_ADJUSTMENT_DETAIL_READ: 'api.get.admin_reconciliation_adjustments_adjustmentno',

  SUMSUB_EVENTS_READ: 'api.get.admin_sumsub_events',
  AUDIT_LOGS_READ: 'api.get.admin_audit_logs',
  AUDIT_EXPORT_CREATE: 'api.post.admin_audit_evidence_packages',
  AUDIT_EVIDENCE_EXPORTS_READ: 'api.get.admin_audit_evidence_packages',
  AUDIT_EVIDENCE_EXPORT_DETAIL_READ: 'api.get.admin_audit_evidence_packages_id',
  AUDIT_EVIDENCE_EXPORT_DOWNLOAD:
    'api.get.admin_audit_evidence_packages_id_download',
  GOV_APPROVALS_READ: 'api.get.admin_control_gates_approvals',
  // Task 17：对外识别改 approvalNo 后，四码随 rbac.catalog.ts 的 :id → :approvalNo
  // 一起漂——buildPermissionCode(method, path) 派生值，同 47 行注释的镜像约定。
  GOV_APPROVAL_DETAIL_READ: 'api.get.admin_control_gates_approvals_approvalno',
  GOV_APPROVAL_APPROVE: 'api.post.admin_control_gates_approvals_approvalno_approve',
  GOV_APPROVAL_REJECT: 'api.post.admin_control_gates_approvals_approvalno_reject',
  GOV_APPROVAL_CANCEL: 'api.post.admin_control_gates_approvals_approvalno_cancel',

  IAM_ROLE_DEFINITIONS_CREATE: 'api.post.admin_iam_role_definitions',
  IAM_ROLE_DEFINITIONS_PERMISSION_GROUPS: 'api.get.admin_iam_role_definitions_permission_groups',
  IAM_ROLE_DEFINITIONS_MODIFY: 'api.post.admin_iam_role_definitions_roleid_modify',
  IAM_ROLE_DEFINITION_MODIFY_REQUESTS_READ: 'api.get.admin_iam_role_definition_modify_requests',
  IAM_ROLE_DEFINITION_MODIFY_REQUEST_DETAIL_READ: 'api.get.admin_iam_role_definition_modify_requests_id',
  IAM_ACTION_BUCKETS_READ: 'api.get.admin_iam_action_buckets',

  // Approval Policy Management
  GOV_APPROVAL_POLICIES_READ: 'api.get.admin_governance_approval_policies',
  GOV_APPROVAL_POLICY_CHANGE_CREATE: 'api.post.admin_governance_approval_policies_actiontype_change_requests',
  GOV_APPROVAL_POLICY_CHANGE_REQUESTS_READ: 'api.get.admin_governance_approval_policies_change_requests',
  GOV_APPROVAL_POLICY_CHANGE_REQUEST_DETAIL_READ: 'api.get.admin_governance_approval_policies_change_requests_id',

  WALLETS_READ: 'api.get.wallets',
  WALLET_DETAIL_READ: 'api.get.wallets_id',
  // PAYINS_* / PAYOUTS_* / INTERNAL_FUNDS_* removed in Round 2 (C6) — merged into FUNDS_ORDERS_*.

  ASSETS_READ: 'api.get.assets',
  ASSETS_CREATE: 'api.post.assets',
  CUSTODIAN_WALLET_CREATE: 'api.post.admin_custodian_wallets',
  CUSTODIAN_WALLET_RETRY: 'api.post.admin_custodian_wallets_walletno_retry',
  DEPOSIT_TRANSACTIONS_READ: 'api.get.deposit_transactions',
  DEPOSIT_TRANSACTION_DETAIL_READ: 'api.get.deposit_transactions_id',
  WITHDRAW_TRANSACTIONS_READ: 'api.get.withdraw_transactions',
  WITHDRAW_TRANSACTION_DETAIL_READ: 'api.get.withdraw_transactions_id',
  // Unified funds-orders admin surface (Round 2 / C6) — replaces the legacy
  // payins / payouts / internal-funds read permissions.
  FUNDS_ORDERS_READ: 'api.get.admin_funds_orders',
  FUNDS_ORDER_DETAIL_READ: 'api.get.admin_funds_orders_fundsorderno',


  TB_ACCOUNTS_READ: 'api.get.admin_tb_accounts',
  TB_TRANSFERS_READ: 'api.get.admin_tb_transfers',
  TB_TRANSFER_DETAIL_READ: 'api.get.admin_tb_transfers_tbtransferid',
  TB_FLOWS_READ: 'api.get.admin_tb_account_flows',

  TRANSACTION_LIMIT_READ: 'api.get.admin_transaction_limit_rules',
  TRANSACTION_LIMIT_WRITE: 'api.post.admin_transaction_limit_rules',

  WITHDRAWAL_ADDRESSES_READ: 'api.get.admin_withdrawal_addresses',
  WITHDRAWAL_ADDRESS_DETAIL_READ: 'api.get.admin_withdrawal_addresses_addressno',
  WITHDRAWAL_ADDRESS_SUSPEND: 'api.post.admin_withdrawal_addresses_addressno_suspend',
  WITHDRAWAL_ADDRESS_SKIP_COOLING: 'api.post.admin_withdrawal_addresses_addressno_skip_cooling',
  WITHDRAWAL_FEE_LEVELS_READ: 'api.get.admin_withdrawal_fee_levels',
  SWAP_FEE_LEVELS_READ: 'api.get.admin_swap_fee_levels',
  WITHDRAW_QUOTES_READ: 'api.get.admin_swap_transactions_quotes',
  WITHDRAW_QUOTES_DETAIL_READ: 'api.get.admin_swap_transactions_quotes_id',
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
