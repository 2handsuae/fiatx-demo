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
  PRICING_SWAP_CONFIG_READ: 'api.get.admin_pricing_policies_swap',

  SWAP_QUOTES_READ: 'api.get.admin_swap_transactions_quotes',
  SWAP_QUOTES_DETAIL_READ: 'api.get.admin_swap_transactions_quotes_id',
  SWAP_TRANSACTIONS_READ: 'api.get.admin_swap_transactions',
  SWAP_TRANSACTION_DETAIL_READ: 'api.get.admin_swap_transactions_id',

  OUTSTANDINGS_READ: 'api.get.admin_reconciliation_outstandings',
  OUTSTANDING_DETAIL_READ: 'api.get.admin_reconciliation_outstandings_id',
  FEE_ACCRUALS_READ: 'api.get.admin_reconciliation_fee_accruals',
  FEE_ACCRUAL_DETAIL_READ: 'api.get.admin_reconciliation_fee_accruals_id',
  RECON_RUN_READ: 'api.get.admin_reconciliation_runs',
  RECON_RUN_DETAIL_READ: 'api.get.admin_reconciliation_runs_runno',
  RECON_CASE_READ: 'api.get.admin_reconciliation_cases',
  RECON_CASE_DETAIL_READ: 'api.get.admin_reconciliation_cases_caseno',
  RECON_EXTERNAL_BALANCE_READ: 'api.get.admin_reconciliation_external_balances',

  SUMSUB_EVENTS_READ: 'api.get.admin_sumsub_events',
  RISK_ASSESSMENTS_READ: 'api.get.admin_compliance_risk_assessments',
  RISK_DECISION_RECORD_DETAIL_READ: 'api.get.admin_risk_decision_records_id',
  AUDIT_LOGS_READ: 'api.get.admin_audit_logs',
  AUDIT_EXPORT_CREATE: 'api.post.admin_audit_evidence_packages',
  AUDIT_EVIDENCE_EXPORTS_READ: 'api.get.admin_audit_evidence_packages',
  AUDIT_EVIDENCE_EXPORT_DETAIL_READ: 'api.get.admin_audit_evidence_packages_id',
  AUDIT_EVIDENCE_EXPORT_DOWNLOAD:
    'api.get.admin_audit_evidence_packages_id_download',
  GOV_APPROVALS_READ: 'api.get.admin_control_gates_approvals',
  GOV_APPROVAL_DETAIL_READ: 'api.get.admin_control_gates_approvals_id',
  GOV_APPROVAL_CREATE: 'api.post.admin_control_gates_approvals',
  GOV_APPROVAL_SUBMIT: 'api.post.admin_control_gates_approvals_id_submit',
  GOV_APPROVAL_APPROVE: 'api.post.admin_control_gates_approvals_id_approve',
  GOV_APPROVAL_REJECT: 'api.post.admin_control_gates_approvals_id_reject',
  GOV_APPROVAL_CANCEL: 'api.post.admin_control_gates_approvals_id_cancel',
  GOV_SHAREHOLDING_REGISTRY_READ:
    'api.get.admin_governance_registries_shareholding_versions',
  GOV_SHAREHOLDING_REGISTRY_DETAIL_READ:
    'api.get.admin_governance_registries_shareholding_versions_id',
  GOV_SHAREHOLDING_REGISTRY_CREATE:
    'api.post.admin_governance_registries_shareholding_versions',
  GOV_SHAREHOLDING_REGISTRY_UPDATE:
    'api.patch.admin_governance_registries_shareholding_versions_id',
  GOV_APPOINTMENTS_READ: 'api.get.admin_governance_registries_appointments',
  GOV_APPOINTMENT_DETAIL_READ:
    'api.get.admin_governance_registries_appointments_id',
  GOV_APPOINTMENT_CREATE: 'api.post.admin_governance_registries_appointments',
  GOV_APPOINTMENT_UPDATE: 'api.patch.admin_governance_registries_appointments_id',
  GOV_TRAININGS_READ: 'api.get.admin_governance_registries_trainings',
  GOV_TRAINING_DETAIL_READ: 'api.get.admin_governance_registries_trainings_id',
  GOV_TRAINING_CREATE: 'api.post.admin_governance_registries_trainings',
  GOV_TRAINING_UPDATE: 'api.patch.admin_governance_registries_trainings_id',
  GOV_CONFLICTS_READ: 'api.get.admin_governance_registries_conflicts',
  GOV_CONFLICT_DETAIL_READ: 'api.get.admin_governance_registries_conflicts_id',
  GOV_CONFLICT_CREATE: 'api.post.admin_governance_registries_conflicts',
  GOV_CONFLICT_UPDATE: 'api.patch.admin_governance_registries_conflicts_id',
  GOV_WIND_DOWN_MATERIALS_READ:
    'api.get.admin_governance_registries_wind_down_materials',
  GOV_WIND_DOWN_MATERIAL_DETAIL_READ:
    'api.get.admin_governance_registries_wind_down_materials_id',
  GOV_WIND_DOWN_MATERIAL_CREATE:
    'api.post.admin_governance_registries_wind_down_materials',
  GOV_WIND_DOWN_MATERIAL_UPDATE:
    'api.patch.admin_governance_registries_wind_down_materials_id',
  GOV_REGULATORY_GATES_READ: 'api.get.admin_governance_regulatory_gates',
  GOV_REGULATORY_GATE_DETAIL_READ:
    'api.get.admin_governance_regulatory_gates_id',
  GOV_REGULATORY_GATE_CREATE: 'api.post.admin_governance_regulatory_gates',
  GOV_REGULATORY_GATE_SUBMIT:
    'api.post.admin_governance_regulatory_gates_id_submit',
  GOV_REGULATORY_GATE_RECORD_FEEDBACK:
    'api.post.admin_governance_regulatory_gates_id_record_feedback',
  GOV_REGULATORY_GATE_BIND_RECEIPT:
    'api.post.admin_governance_regulatory_gates_id_bind_receipt',
  GOV_REGULATORY_GATE_MARK_EFFECTIVE:
    'api.post.admin_governance_regulatory_gates_id_mark_effective',
  GOV_REGULATORY_GATE_REVOKE:
    'api.post.admin_governance_regulatory_gates_id_revoke',

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
  PAYINS_READ: 'api.get.treasury_payins',
  PAYIN_DETAIL_READ: 'api.get.treasury_payins_id',
  PAYOUTS_READ: 'api.get.payouts',
  PAYOUT_DETAIL_READ: 'api.get.payouts_id',
  INTERNAL_FUNDS_READ: 'api.get.admin_internal_funds',
  INTERNAL_FUND_DETAIL_READ: 'api.get.admin_internal_funds_id',
  REIMBURSEMENT_OBLIGATIONS_READ: 'api.get.admin_reimbursement_obligations',
  INTERNAL_COLLECTIONS_RECONCILE:
    'api.post.admin_internal_transactions_collection_wallets_walletid_reconcile',

  LIQUIDITY_PROVIDERS_READ: 'api.get.liquidity_providers',
  LIQUIDITY_PROVIDERS_CREATE: 'api.post.liquidity_providers',
  LIQUIDITY_CONFIG_READ: 'api.get.liquidity_configurations',
  LIQUIDITY_CONFIG_CREATE: 'api.post.liquidity_configurations',
  LIQUIDITY_CONFIG_UPDATE: 'api.put.liquidity_configurations_id',
  ASSETS_READ: 'api.get.assets',
  ASSETS_CREATE: 'api.post.assets',
  CUSTODIAN_WALLET_CREATE: 'api.post.admin_custodian_wallets',
  CUSTODIAN_WALLET_RETRY: 'api.post.admin_custodian_wallets_walletno_retry',
  DEPOSIT_TRANSACTIONS_READ: 'api.get.deposit_transactions',
  DEPOSIT_TRANSACTION_DETAIL_READ: 'api.get.deposit_transactions_id',
  WITHDRAW_TRANSACTIONS_READ: 'api.get.withdraw_transactions',
  WITHDRAW_TRANSACTION_DETAIL_READ: 'api.get.withdraw_transactions_id',
  INTERNAL_TRANSACTIONS_READ: 'api.get.admin_internal_transactions',
  INTERNAL_TRANSACTION_DETAIL_READ: 'api.get.admin_internal_transactions_id',
  FUNDS_LAYER_TRANSFERS_READ: 'api.get.admin_funds_layer_transfers',
  FUNDS_LAYER_TRANSFER_DETAIL_READ:
    'api.get.admin_funds_layer_transfers_internaltxno',
  FUNDS_LAYER_TRANSFER_SIMULATE:
    'api.post.admin_funds_layer_transfers_internaltxno_simulate',
  FUNDS_LAYER_SETTLEMENTS_READ: 'api.get.admin_funds_layer_settlements',
  FUNDS_LAYER_SETTLEMENT_DETAIL_READ:
    'api.get.admin_funds_layer_settlements_batchno',
  FUNDS_LAYER_SETTLEMENT_RUN:
    'api.post.admin_funds_layer_settlements_run',
  FUNDS_LAYER_FUNDS_READ: 'api.get.admin_funds_layer_funds',
  FUNDS_LAYER_FUND_DETAIL_READ:
    'api.get.admin_funds_layer_funds_internalfundno',


  TB_ACCOUNTS_READ: 'api.get.admin_tb_accounts',
  TB_TRANSFERS_READ: 'api.get.admin_tb_transfers',
  TB_TRANSFER_DETAIL_READ: 'api.get.admin_tb_transfers_tbtransferid',

  TRANSACTION_LIMIT_POLICIES_READ: 'api.get.admin_transaction_limit_policies',
  TRANSACTION_LIMIT_POLICIES_WRITE: 'api.post.admin_transaction_limit_policies',

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
