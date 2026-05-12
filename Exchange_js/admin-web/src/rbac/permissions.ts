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
  PRICING_POLICIES_READ: 'api.get.admin_pricing_policies',
  PRICING_SWAP_CONFIG_READ: 'api.get.admin_pricing_policies_swap',
  PRICING_WITHDRAW_CONFIG_READ: 'api.get.admin_pricing_policies_withdrawal',

  SWAP_QUOTES_READ: 'api.get.admin_swap_transactions_quotes',
  SWAP_QUOTES_DETAIL_READ: 'api.get.admin_swap_transactions_quotes_id',
  SWAP_TRANSACTIONS_READ: 'api.get.admin_swap_transactions',
  SWAP_TRANSACTION_DETAIL_READ: 'api.get.admin_swap_transactions_id',

  OUTSTANDING_SETTLEMENTS_READ: 'api.get.admin_reconciliation_outstanding_settlements',
  OUTSTANDING_SETTLEMENT_DETAIL_READ:
    'api.get.admin_reconciliation_outstanding_settlements_id',
  OUTSTANDINGS_READ: 'api.get.admin_reconciliation_outstandings',
  OUTSTANDING_DETAIL_READ: 'api.get.admin_reconciliation_outstandings_id',
  SAFEGUARDING_BREAKS_READ: 'api.get.admin_reconciliation_safeguarding_breaks',
  SAFEGUARDING_BREAK_DETAIL_READ:
    'api.get.admin_reconciliation_safeguarding_breaks_id',
  SAFEGUARDING_BREAKS_GENERATE:
    'api.post.admin_reconciliation_safeguarding_breaks_generate_daily_diff',
  SAFEGUARDING_BREAKS_WRITE:
    'api.patch.admin_reconciliation_safeguarding_breaks_id_status',
  SAFEGUARDING_WARNINGS_READ:
    'api.get.admin_reconciliation_safeguarding_warnings',
  SAFEGUARDING_WARNING_DETAIL_READ:
    'api.get.admin_reconciliation_safeguarding_warnings_id',
  SAFEGUARDING_WARNINGS_WRITE:
    'api.patch.admin_reconciliation_safeguarding_warnings_id_status',
  SAFEGUARDING_RUNS_READ: 'api.get.admin_reconciliation_safeguarding_runs',
  SAFEGUARDING_RUN_DETAIL_READ:
    'api.get.admin_reconciliation_safeguarding_runs_id',
  SAFEGUARDING_RUNS_EXPORT:
    'api.post.admin_reconciliation_safeguarding_runs_id_export_evidence_package',
  SAFEGUARDING_FIAT_IMPORTS_READ:
    'api.get.admin_reconciliation_safeguarding_fiat_statements_imports',
  SAFEGUARDING_FIAT_IMPORT_DETAIL_READ:
    'api.get.admin_reconciliation_safeguarding_fiat_statements_imports_id',
  SAFEGUARDING_FIAT_IMPORTS_WRITE:
    'api.post.admin_reconciliation_safeguarding_fiat_statements_imports',

  CDD_RESPONSES_READ: 'api.get.admin_compliance_cdd_responses',
  EDD_RESPONSES_READ: 'api.get.admin_compliance_edd_responses',
  ALERTS_READ: 'api.get.admin_compliance_alerts',
  // Canonical work-item permission for assign / reassign on alert detail.
  ALERTS_WRITE: 'api.patch.admin_compliance_alerts_id_action',
  // Canonical resolution permission for false positive / direct disposition / escalation.
  ALERTS_RESOLVE: 'api.post.admin_compliance_alerts_id_resolve',
  CASES_READ: 'api.get.admin_compliance_cases',
  CASES_WRITE: 'api.patch.admin_compliance_cases_id_action',
  CASE_MLRO_REVIEW_WRITE: 'api.post.admin_compliance_cases_id_mlro_review',
  CASE_EVIDENCE_EXPORTS_READ: 'api.get.admin_compliance_cases_evidence_packages',
  CASE_EVIDENCE_EXPORT_CREATE: 'api.post.admin_compliance_cases_export_evidence_package',
  CASE_EVIDENCE_EXPORT_DETAIL_READ:
    'api.get.admin_compliance_cases_evidence_packages_id',
  CASE_EVIDENCE_EXPORT_DOWNLOAD:
    'api.get.admin_compliance_cases_evidence_packages_id_download',
  TX_KYT_RESPONSES_READ: 'api.get.admin_compliance_tx_kyt_cases',
  TX_KYT_RESPONSE_DETAIL_READ: 'api.get.admin_compliance_tx_kyt_cases_id',
  TX_TRAVEL_RULE_RESPONSES_READ:
    'api.get.admin_compliance_tx_travel_rule_cases',
  TX_TRAVEL_RULE_RESPONSE_DETAIL_READ:
    'api.get.admin_compliance_tx_travel_rule_cases_id',
  TX_COMPLIANCE_BUNDLE_READ:
    'api.get.admin_compliance_tx_cases_sourcetype_sourceid',
  TX_COMPLIANCE_READ: 'api.get.admin_compliance_tx_kyt_cases',
  TX_COMPLIANCE_WRITE: 'api.post.admin_compliance_tx_kyt_cases_mock_complete',
  SUMSUB_EVENTS_READ: 'api.get.admin_sumsub_events',
  RISK_ASSESSMENTS_READ: 'api.get.admin_compliance_risk_assessments',
  RISK_DECISION_RECORDS_READ: 'api.get.admin_risk_decision_records',
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
  GOV_CHANGE_TICKETS_READ: 'api.get.admin_control_gates_change_tickets',
  GOV_CHANGE_TICKET_DETAIL_READ: 'api.get.admin_control_gates_change_tickets_id',
  GOV_CHANGE_TICKET_CREATE: 'api.post.admin_control_gates_change_tickets',
  GOV_CHANGE_TICKET_SUBMIT: 'api.post.admin_control_gates_change_tickets_id_submit',
  GOV_CHANGE_TICKET_CONSUME: 'api.post.admin_control_gates_change_tickets_id_consume',
  GOV_DELETE_REQUESTS_READ: 'api.get.admin_control_gates_delete_requests',
  GOV_DELETE_REQUEST_DETAIL_READ: 'api.get.admin_control_gates_delete_requests_id',
  GOV_DELETE_REQUEST_CREATE: 'api.post.admin_control_gates_delete_requests',
  GOV_DELETE_REQUEST_SUBMIT: 'api.post.admin_control_gates_delete_requests_id_submit',
  GOV_DELETE_REQUEST_CANCEL: 'api.post.admin_control_gates_delete_requests_id_cancel',
  GOV_DELETE_REQUEST_CONSUME: 'api.post.admin_control_gates_delete_requests_id_consume',
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
  POOL_SETTLEMENT_BATCH_READ: 'api.get.admin_pool_settlement_batches',
  POOL_SETTLEMENT_BATCH_DETAIL: 'api.get.admin_pool_settlement_batches_id',
  POOL_SETTLEMENT_BATCH_CREATE: 'api.post.admin_pool_settlement_batches',
  POOL_SETTLEMENT_BATCH_SUBMIT: 'api.post.admin_pool_settlement_batches_id_submit',
  FEE_OCCURRENCES_READ: 'api.get.admin_fee_occurrences',
  FEE_OCCURRENCE_DETAIL_READ: 'api.get.admin_fee_occurrences_id',
  FEE_OCCURRENCES_WRITE: 'api.post.admin_fee_occurrences',
  FEE_OCCURRENCES_CANCEL: 'api.patch.admin_fee_occurrences_id_cancel',
  REIMBURSEMENT_OBLIGATIONS_READ: 'api.get.admin_reimbursement_obligations',
  REIMBURSEMENT_OBLIGATION_DETAIL_READ:
    'api.get.admin_reimbursement_obligations_id',
  REIMBURSEMENT_OBLIGATIONS_WRITE:
    'api.patch.admin_reimbursement_obligations_id_status',
  INTERNAL_COLLECTIONS_RECONCILE:
    'api.post.admin_internal_transactions_collection_wallets_walletid_reconcile',

  LIQUIDITY_PROVIDERS_READ: 'api.get.liquidity_providers',
  LIQUIDITY_PROVIDERS_CREATE: 'api.post.liquidity_providers',
  LIQUIDITY_CONFIG_READ: 'api.get.liquidity_configurations',
  LIQUIDITY_CONFIG_CREATE: 'api.post.liquidity_configurations',
  LIQUIDITY_CONFIG_UPDATE: 'api.put.liquidity_configurations_id',
  ASSETS_READ: 'api.get.assets',
  ASSETS_CREATE: 'api.post.assets',
  ASSET_PROVISION_WALLETS: 'api.post.admin_assets_assetno_provision_wallets',
  ACCT_EVENTS_READ: 'api.get.acct_events',
  JOURNAL_HEADER_TEMPLATES_READ: 'api.get.journal_header_templates',
  JOURNAL_LINE_TEMPLATES_READ: 'api.get.journal_line_templates',
  CLEARING_TEMPLATES_READ: 'api.get.clearing_templates',

  DEPOSIT_TRANSACTIONS_READ: 'api.get.deposit_transactions',
  DEPOSIT_TRANSACTION_DETAIL_READ: 'api.get.deposit_transactions_id',
  WITHDRAW_TRANSACTIONS_READ: 'api.get.withdraw_transactions',
  WITHDRAW_TRANSACTION_DETAIL_READ: 'api.get.withdraw_transactions_id',
  INTERNAL_TRANSACTIONS_READ: 'api.get.admin_internal_transactions',
  INTERNAL_TRANSACTION_DETAIL_READ: 'api.get.admin_internal_transactions_id',

  COA_READ: 'api.get.coa',
  JOURNALS_READ: 'api.get.journals',
  JOURNAL_DETAIL_READ: 'api.get.journals_id',
  JOURNAL_LINES_READ: 'api.get.journal_lines',
  JOURNAL_LINE_DETAIL_READ: 'api.get.journal_lines_id',
  CUSTOMER_BALANCE_HISTORY_READ: 'api.get.journal_lines_customer_balance_history',

  CLEARINGS_READ: 'api.get.clearings',
  CLEARING_DETAIL_READ: 'api.get.clearings_id',
  CLEARING_LINES_READ: 'api.get.clearings_lines',
  CLEARING_LINE_DETAIL_READ: 'api.get.clearings_lines_id',

  TB_ACCOUNTS_READ: 'api.get.admin_tb_accounts',
  TB_TRANSFERS_READ: 'api.get.admin_tb_transfers',
  TB_BACKLOG_READ: 'api.get.admin_tb_backlog',
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
