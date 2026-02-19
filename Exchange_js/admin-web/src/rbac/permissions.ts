export const PERMISSIONS = {
  BASE_ACCESS: 'api.get.auth_me',

  USERS_READ: 'api.get.users',
  USERS_CREATE: 'api.post.users',
  IAM_ROLES_READ: 'api.get.admin_iam_roles',
  IAM_PERMISSIONS_READ: 'api.get.admin_iam_permissions',
  IAM_USER_ROLES_READ: 'api.get.admin_iam_users_id_roles',
  IAM_USER_ROLES_WRITE: 'api.put.admin_iam_users_id_roles',

  CUSTOMERS_READ: 'api.get.customers',
  CUSTOMERS_DETAIL_READ: 'api.get.customers_id',
  CUSTOMER_SWAP_RATES_READ: 'api.get.customers_swap_rates',
  CUSTOMER_SWAP_RATES_WRITE: 'api.post.customers_swap_rates',
  CUSTOMER_SWAP_RATES_EDIT: 'api.put.customers_swap_rates_id',

  SWAP_QUOTES_READ: 'api.get.admin_swap_transactions_quotes',
  SWAP_QUOTES_DETAIL_READ: 'api.get.admin_swap_transactions_quotes_id',
  SWAP_TRANSACTIONS_READ: 'api.get.admin_swap_transactions',
  SWAP_TRANSACTION_DETAIL_READ: 'api.get.admin_swap_transactions_id',

  OUTSTANDING_SETTLEMENTS_READ: 'api.get.admin_reconciliation_outstanding_settlements',
  OUTSTANDING_SETTLEMENT_DETAIL_READ:
    'api.get.admin_reconciliation_outstanding_settlements_id',
  OUTSTANDINGS_READ: 'api.get.admin_reconciliation_outstandings',
  OUTSTANDING_DETAIL_READ: 'api.get.admin_reconciliation_outstandings_id',

  CDD_CASES_READ: 'api.get.admin_compliance_cdd_cases',
  EDD_CASES_READ: 'api.get.admin_compliance_edd_cases',
  AUDIT_LOGS_READ: 'api.get.admin_audit_logs',

  WALLETS_READ: 'api.get.wallets',
  WALLET_DETAIL_READ: 'api.get.wallets_id',
  PAYINS_READ: 'api.get.treasury_payins',
  PAYIN_DETAIL_READ: 'api.get.treasury_payins_id',
  PAYOUTS_READ: 'api.get.payouts',
  PAYOUT_DETAIL_READ: 'api.get.payouts_id',
  INTERNAL_FUNDS_READ: 'api.get.admin_internal_funds',
  INTERNAL_FUND_DETAIL_READ: 'api.get.admin_internal_funds_id',

  LIQUIDITY_PROVIDERS_READ: 'api.get.liquidity_providers',
  LIQUIDITY_PROVIDERS_CREATE: 'api.post.liquidity_providers',
  LIQUIDITY_CONFIG_READ: 'api.get.liquidity_configurations',
  LIQUIDITY_CONFIG_CREATE: 'api.post.liquidity_configurations',
  LIQUIDITY_CONFIG_UPDATE: 'api.put.liquidity_configurations_id',
  ASSETS_READ: 'api.get.assets',
  ASSETS_CREATE: 'api.post.assets',
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
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
