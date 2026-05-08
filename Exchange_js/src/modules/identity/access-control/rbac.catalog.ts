import { buildPermissionCode } from './permission-code.util';

export interface RbacRoleDefinition {
  code: string;
  name: string;
  description: string;
}

export type PermissionGroup =
  | 'BASE_ACCESS'
  | 'IAM_READ'
  | 'IAM_ASSIGN'
  | 'IAM_CREDENTIAL_RESET'
  | 'IAM_ROLE_DEFINE'
  | 'CUSTOMER_READ'
  | 'CUSTOMER_WRITE'
  | 'CUSTOMER_RATE_READ'
  | 'CUSTOMER_RATE_WRITE'
  | 'ONBOARDING_READ'
  | 'CDD_REVIEW_WRITE'
  | 'MLRO_REVIEW_WRITE'
  | 'INVESTOR_OVERRIDE_WRITE'
  | 'SIMULATE_EXPIRED_WRITE'
  | 'RISK_DECISION_RECORD_READ'
  | 'RISK_DECISION_RECORD_WRITE'
  | 'ALERT_READ'
  | 'ALERT_WRITE'
  | 'CASE_READ'
  | 'CASE_WRITE'
  | 'CASE_EXPORT_READ'
  | 'CASE_EXPORT_WRITE'
  | 'TX_COMPLIANCE_READ'
  | 'TX_COMPLIANCE_WRITE'
  | 'TRADING_DEPOSIT_READ'
  | 'TRADING_DEPOSIT_WRITE'
  | 'TRADING_WITHDRAW_READ'
  | 'TRADING_WITHDRAW_WRITE'
  | 'TRADING_SWAP_READ'
  | 'TRADING_SWAP_WRITE'
  | 'PAYIN_READ'
  | 'PAYIN_WRITE'
  | 'PAYOUT_READ'
  | 'PAYOUT_WRITE'
  | 'WALLET_READ'
  | 'WALLET_WRITE'
  | 'INTERNAL_TX_READ'
  | 'INTERNAL_TX_SUBMIT'
  | 'INTERNAL_TX_REVIEW'
  | 'INTERNAL_FUND_READ'
  | 'INTERNAL_FUND_WRITE'
  | 'RECON_OUTSTANDING_READ'
  | 'RECON_BREAK_READ'
  | 'RECON_BREAK_WRITE'
  | 'SETTLEMENT_READ'
  | 'SETTLEMENT_WRITE'
  | 'CLEARING_READ'
  | 'CLEARING_WRITE'
  | 'JOURNAL_READ'
  | 'ACCOUNTING_CONFIG_READ'
  | 'ACCOUNTING_CONFIG_WRITE'
  | 'ASSET_CONFIG_READ'
  | 'ASSET_CONFIG_WRITE'
  | 'COUNTERPARTY_READ'
  | 'COUNTERPARTY_WRITE'
  | 'AUDIT_READ'
  | 'AUDIT_EXPORT_CREATE'
  | 'AUDIT_EXPORT_READ'
  | 'AUDIT_MANUAL_WRITE'
  | 'GOV_APPROVAL_READ'
  | 'GOV_APPROVAL_WRITE'
  | 'GOV_APPROVAL_DECIDE'
  | 'GOV_CHANGE_TICKET_READ'
  | 'GOV_CHANGE_TICKET_WRITE'
  | 'GOV_CHANGE_TICKET_GATE'
  | 'GOV_CHANGE_TICKET_CLOSE'
  | 'GOV_DELETE_REQUEST_READ'
  | 'GOV_DELETE_REQUEST_WRITE'
  | 'GOV_DELETE_REQUEST_CONSUME'
  | 'GOV_REGISTRY_READ'
  | 'GOV_REGISTRY_WRITE'
  | 'GOV_REGULATORY_GATE_READ'
  | 'GOV_REGULATORY_GATE_WRITE'
  | 'GOV_APPROVAL_POLICY_READ'
  | 'GOV_APPROVAL_POLICY_WRITE';

export interface RbacPermissionDefinition {
  code: string;
  name: string;
  description: string;
  method: string;
  path: string;
  groups: PermissionGroup[];
}

function route(
  method: string,
  path: string,
  name: string,
  groups: PermissionGroup[],
  description?: string,
): RbacPermissionDefinition {
  return {
    code: buildPermissionCode(method, path),
    name,
    description: description || name,
    method: method.toUpperCase(),
    path,
    groups,
  };
}

export const RBAC_ROLE_DEFINITIONS: RbacRoleDefinition[] = [
  {
    code: 'SUPER_ADMIN',
    name: 'Super Administrator',
    description: 'Emergency full access account, not for routine operations.',
  },
  {
    code: 'SENIOR_MANAGEMENT_OFFICER',
    name: 'Senior Management Officer',
    description: 'Senior management oversight, high-level approvals, and regulatory accountability.',
  },
  {
    code: 'CISO',
    name: 'Chief Information Security Officer',
    description: 'Security governance and IAM control owner. VARA Responsible Individual candidate.',
  },
  {
    code: 'MLRO',
    name: 'Money Laundering Reporting Officer',
    description: 'Own AML oversight, SAR filing, and independent regulatory reporting. VARA Responsible Individual candidate.',
  },
  {
    code: 'DPO',
    name: 'Data Protection Officer',
    description: 'Data protection oversight for sensitive export governance and privacy compliance.',
  },
  {
    code: 'COMPLIANCE_OFFICER',
    name: 'Compliance Officer',
    description: 'Daily compliance operations, audit export governance, and regulatory program management.',
  },
  {
    code: 'TECH_OFFICER',
    name: 'Tech Officer',
    description: 'Platform operations, technical governance workflows, and change management.',
  },
  {
    code: 'OPS_OFFICER',
    name: 'Operations Officer',
    description: 'Treasury operations, settlement, reconciliation, and accounting oversight.',
  },
];

export const ACTIVE_RBAC_ROLE_CODES = RBAC_ROLE_DEFINITIONS.map((item) => item.code);

export const PRIMARY_ROLE_PRIORITY = [
  'SUPER_ADMIN',
  'CISO',
  'DPO',
  'MLRO',
  'COMPLIANCE_OFFICER',
  'SENIOR_MANAGEMENT_OFFICER',
  'TECH_OFFICER',
  'OPS_OFFICER',
] as const;

export function getPrimaryRoleCode(roleCodes: string[]): string | null {
  const normalized = Array.from(
    new Set(
      (roleCodes || [])
        .map((item) => String(item || '').trim().toUpperCase())
        .filter(Boolean),
    ),
  );

  for (const roleCode of PRIMARY_ROLE_PRIORITY) {
    if (normalized.includes(roleCode)) {
      return roleCode;
    }
  }

  return normalized[0] || null;
}

export const HARD_MUTEX_ROLE_PAIRS: Array<[string, string]> = [
  ['CISO', 'MLRO'],
  ['MLRO', 'OPS_OFFICER'],
  ['CISO', 'OPS_OFFICER'],
];

export const SOFT_WARNING_ROLE_GROUPS: Array<{ codes: string[]; message: string }> = [];

export const RBAC_PERMISSION_DEFINITIONS: RbacPermissionDefinition[] = [
  // Session / IAM
  route('GET', '/auth/me', 'Get current admin session', ['BASE_ACCESS']),
  route('GET', '/users', 'List users', ['IAM_READ']),
  route('POST', '/users', 'Create admin user', ['IAM_ASSIGN']),
  route('POST', '/users/:id/invitations/resend', 'Resend admin invitation', ['IAM_ASSIGN']),
  route('POST', '/users/:id/suspend', 'Suspend admin user (C4)', ['IAM_ASSIGN']),
  route('POST', '/users/:id/reactivate', 'Reactivate admin user (C4b)', ['IAM_ASSIGN']),
  route('GET', '/admin/iam/roles', 'List role catalog', ['IAM_READ']),
  route('GET', '/admin/iam/permissions', 'List permission catalog', ['IAM_READ']),
  route('GET', '/admin/iam/users/:id/roles', 'Get user roles', ['IAM_READ']),
  route('PUT', '/admin/iam/users/:id/roles', 'Replace user roles', ['IAM_ASSIGN']),
  route('POST', '/admin/iam/role-change-requests', 'Create role binding change request', ['IAM_ASSIGN']),
  route('GET', '/admin/iam/role-change-requests', 'List role binding change requests', ['IAM_READ']),
  route('GET', '/admin/iam/role-change-requests/:id', 'Get role binding change request', ['IAM_READ']),
  route('POST', '/admin/iam/users/:id/reset-mfa', 'Reset admin MFA binding', ['IAM_CREDENTIAL_RESET']),
  route('POST', '/users/:id/reset-password', 'Reset admin password (C5)', ['IAM_CREDENTIAL_RESET']),
  route('POST', '/admin/iam/role-definitions', 'Create role definition request', ['IAM_ROLE_DEFINE']),
  route('GET', '/admin/iam/role-definitions/permission-groups', 'List available permission groups', ['IAM_ROLE_DEFINE']),

  // Customer domain
  route('POST', '/customers', 'Create customer', ['CUSTOMER_WRITE']),
  route('GET', '/customers', 'List customers', ['CUSTOMER_READ']),
  route('GET', '/customers/:id', 'Get customer detail', ['CUSTOMER_READ']),
  route('PATCH', '/customers/:id', 'Update customer', ['CUSTOMER_WRITE']),
  route('DELETE', '/customers/:id', 'Delete customer', ['CUSTOMER_WRITE']),

  // Pricing center
  route('GET', '/admin/pricing/policies', 'List pricing policies', ['CUSTOMER_RATE_READ']),
  route('GET', '/admin/pricing/policies/swap', 'Get swap pricing policy', ['CUSTOMER_RATE_READ']),
  route('GET', '/admin/pricing/policies/withdrawal', 'Get withdrawal pricing policy', ['CUSTOMER_RATE_READ']),
  route(
    'GET',
    '/admin/pricing/policies/swap/pairs/:pairId/market-source',
    'Get swap pair market source',
    ['CUSTOMER_RATE_READ'],
  ),
  route('POST', '/admin/pricing/simulator/swap', 'Simulate swap pricing', ['CUSTOMER_RATE_READ']),
  route('POST', '/withdraw-transactions/quotes', 'Create withdrawal pricing quote', ['TRADING_WITHDRAW_WRITE']),

  // Onboarding compliance
  route('GET', '/admin/compliance/cdd-responses', 'List CDD responses', ['ONBOARDING_READ']),
  route('POST', '/admin/compliance/cdd-responses/:id/review', 'Review CDD response', ['CDD_REVIEW_WRITE']),
  route('GET', '/admin/compliance/cdd-responses/:id', 'Get CDD response detail', ['ONBOARDING_READ']),
  route('GET', '/admin/compliance/edd-responses', 'List EDD responses', ['ONBOARDING_READ']),
  route('POST', '/admin/compliance/edd-responses/:id/mlro-review', 'MLRO review EDD response', ['MLRO_REVIEW_WRITE']),
  route('GET', '/admin/compliance/edd-responses/:id', 'Get EDD response detail', ['ONBOARDING_READ']),
  route('POST', '/admin/compliance/customers/:id/simulate-expired', 'Simulate customer expired', ['SIMULATE_EXPIRED_WRITE']),
  route('PATCH', '/admin/compliance/customers/:id/investor-classification', 'Override investor classification', ['INVESTOR_OVERRIDE_WRITE']),

  // Risk decision records
  route('GET', '/admin/risk/decision-records', 'List risk decision records', ['RISK_DECISION_RECORD_READ']),
  route('GET', '/admin/risk/decision-records/:id', 'Get risk decision record detail', ['RISK_DECISION_RECORD_READ']),
  route('POST', '/admin/risk/decision-records/:id/simulate', 'Simulate risk decision record', ['RISK_DECISION_RECORD_WRITE']),

  // Alert triage center
  route('GET', '/admin/compliance/alerts', 'List compliance alerts', ['ALERT_READ']),
  route('GET', '/admin/compliance/alerts/:id', 'Get compliance alert detail', ['ALERT_READ']),
  route('PATCH', '/admin/compliance/alerts/:id/action', 'Apply compliance alert action', ['ALERT_WRITE']),
  route('POST', '/admin/compliance/alerts/:id/resolve', 'Resolve compliance alert', ['ALERT_WRITE']),
  route('POST', '/admin/compliance/alerts/simulate', 'Simulate compliance alerts', ['ALERT_WRITE']),
  route('GET', '/admin/compliance/cases', 'List compliance cases', ['CASE_READ']),
  route('GET', '/admin/compliance/cases/:id', 'Get compliance case detail', ['CASE_READ']),
  route(
    'POST',
    '/admin/compliance/cases/from-alert/:alertId',
    'Create compliance case from alert',
    ['CASE_WRITE'],
  ),
  route(
    'PATCH',
    '/admin/compliance/cases/:id/action',
    'Apply compliance case action',
    ['CASE_WRITE'],
  ),
  route(
    'POST',
    '/admin/compliance/cases/:id/alerts',
    'Link alert into compliance case',
    ['CASE_WRITE'],
  ),
  route(
    'POST',
    '/admin/compliance/cases/:id/onboarding-decision',
    'Apply onboarding decision from case',
    ['CASE_WRITE'],
  ),
  route(
    'POST',
    '/admin/compliance/cases/:id/periodic-review-decision',
    'Apply periodic review decision from case',
    ['CASE_WRITE'],
  ),
  route(
    'POST',
    '/admin/compliance/cases/:id/report/submit-to-mlro',
    'Submit case to MLRO review',
    ['CASE_WRITE'],
  ),
  route(
    'POST',
    '/admin/compliance/cases/:id/filing/submit',
    'Submit external filing for case',
    ['CASE_WRITE'],
  ),
  route(
    'POST',
    '/admin/compliance/cases/:id/filing/feedback',
    'Record external filing feedback for case',
    ['CASE_WRITE'],
  ),
  route(
    'POST',
    '/admin/compliance/cases/:id/filing/close',
    'Close case external filing follow-up',
    ['CASE_WRITE'],
  ),
  route(
    'POST',
    '/admin/compliance/cases/:id/mlro-review',
    'Review case final disposition as MLRO',
    ['MLRO_REVIEW_WRITE'],
  ),
  route(
    'POST',
    '/admin/compliance/cases/export/evidence-package',
    'Create case evidence export request',
    ['CASE_EXPORT_WRITE'],
  ),
  route(
    'GET',
    '/admin/compliance/cases/evidence-packages',
    'List case evidence package exports',
    ['CASE_EXPORT_READ'],
  ),
  route(
    'GET',
    '/admin/compliance/cases/evidence-packages/:id',
    'Get case evidence package detail',
    ['CASE_EXPORT_READ'],
  ),
  route(
    'GET',
    '/admin/compliance/cases/evidence-packages/:id/download',
    'Download case evidence package content',
    ['CASE_EXPORT_READ'],
  ),
  // Transaction compliance
  route('POST', '/admin/compliance/tx-kyt-cases/mock-complete', 'Mock complete KYT case', ['TX_COMPLIANCE_WRITE']),
  route('POST', '/admin/compliance/tx-travel-rule-cases/mock-complete', 'Mock complete travel-rule case', ['TX_COMPLIANCE_WRITE']),
  route('GET', '/admin/compliance/tx-kyt-cases', 'List KYT cases', ['TX_COMPLIANCE_READ']),
  route('GET', '/admin/compliance/tx-kyt-cases/:id', 'Get KYT case detail', ['TX_COMPLIANCE_READ']),
  route('GET', '/admin/compliance/tx-travel-rule-cases', 'List travel-rule cases', ['TX_COMPLIANCE_READ']),
  route('GET', '/admin/compliance/tx-travel-rule-cases/:id', 'Get travel-rule case detail', ['TX_COMPLIANCE_READ']),
  route('GET', '/admin/compliance/tx-cases/:sourceType/:sourceId', 'Get tx evidence bundle', ['TX_COMPLIANCE_READ']),

  // Deposit
  route('GET', '/deposit-transactions', 'List deposit transactions', ['TRADING_DEPOSIT_READ']),
  route('GET', '/deposit-transactions/:id', 'Get deposit transaction detail', ['TRADING_DEPOSIT_READ']),
  route(
    'GET',
    '/deposit-transactions/my/inbound-signals',
    'List customer inbound transfer signals',
    ['TRADING_DEPOSIT_READ'],
  ),
  route(
    'POST',
    '/deposit-transactions/my/inbound-signals',
    'Create customer inbound transfer signal',
    ['TRADING_DEPOSIT_WRITE'],
  ),
  route(
    'POST',
    '/deposit-transactions/my/inbound-signals/scan',
    'Scan customer inbound transfer signals',
    ['TRADING_DEPOSIT_WRITE'],
  ),
  route('PATCH', '/deposit-transactions/:id/status', 'Update deposit transaction status', ['TRADING_DEPOSIT_WRITE']),
  route('GET', '/deposit-transactions/export', 'Export deposit transactions', ['TRADING_DEPOSIT_READ']),

  // Withdraw
  route('GET', '/withdraw-transactions', 'List withdraw transactions', ['TRADING_WITHDRAW_READ']),
  route('GET', '/withdraw-transactions/:id', 'Get withdraw transaction detail', ['TRADING_WITHDRAW_READ']),
  route('POST', '/withdraw-transactions', 'Create withdraw transaction', ['TRADING_WITHDRAW_WRITE']),
  route('POST', '/withdraw-transactions/mock', 'Mock withdraw transaction', ['TRADING_WITHDRAW_WRITE']),
  route('PATCH', '/withdraw-transactions/:id/status', 'Update withdraw transaction status', ['TRADING_WITHDRAW_WRITE']),

  // Swap admin
  route('POST', '/admin/swap-transactions', 'Create admin swap transaction', ['TRADING_SWAP_WRITE']),
  route('GET', '/admin/swap-transactions', 'List swap transactions', ['TRADING_SWAP_READ']),
  route('GET', '/admin/swap-transactions/quotes', 'List swap quotes', ['TRADING_SWAP_READ']),
  route('GET', '/admin/swap-transactions/quotes/:id', 'Get swap quote detail', ['TRADING_SWAP_READ']),
  route('GET', '/admin/swap-transactions/:id', 'Get swap transaction detail', ['TRADING_SWAP_READ']),
  route('PATCH', '/admin/swap-transactions/:id/status', 'Update swap transaction status', ['TRADING_SWAP_WRITE']),

  // Payins
  route('GET', '/treasury/payins', 'List payins', ['PAYIN_READ']),
  route('GET', '/treasury/payins/:id', 'Get payin detail', ['PAYIN_READ']),
  route('PATCH', '/treasury/payins/:id/status', 'Update payin status', ['PAYIN_WRITE']),
  route(
    'POST',
    '/admin/treasury/payins/:id/mock-event',
    'Apply payin simulation event',
    ['PAYIN_WRITE'],
  ),

  // Payouts
  route('GET', '/payouts', 'List payouts', ['PAYOUT_READ']),
  route('POST', '/payouts', 'Create payout', ['PAYOUT_WRITE']),
  route('POST', '/payouts/mock', 'Mock payout', ['PAYOUT_WRITE']),
  route('GET', '/payouts/:id', 'Get payout detail', ['PAYOUT_READ']),
  route('PATCH', '/payouts/:id/status', 'Update payout status', ['PAYOUT_WRITE']),

  // Wallet / treasury
  route('POST', '/wallets', 'Create wallet', ['WALLET_WRITE']),
  route('GET', '/wallets', 'List wallets', ['WALLET_READ']),
  route('GET', '/wallets/:id', 'Get wallet detail', ['WALLET_READ']),
  route('GET', '/wallets/:id/balance', 'Get wallet balance', ['WALLET_READ']),
  route('PATCH', '/wallets/:id/status', 'Update wallet status', ['WALLET_WRITE']),
  route('GET', '/treasury/customer/:customerId/assets', 'Get customer treasury assets', ['WALLET_READ']),

  // Internal transaction / fund
  route('GET', '/admin/internal-transactions', 'List internal transactions', ['INTERNAL_TX_READ']),
  route('GET', '/admin/internal-transactions/:id', 'Get internal transaction detail', ['INTERNAL_TX_READ']),
  route('POST', '/admin/internal-transactions', 'Create manual internal transaction', ['INTERNAL_TX_SUBMIT']),
  route(
    'GET',
    '/admin/internal-transactions/collection-wallets',
    'List deposit wallets eligible for collection',
    ['INTERNAL_TX_SUBMIT'],
  ),
  route(
    'POST',
    '/admin/internal-transactions/collection-wallets/:walletId/reconcile',
    'Run wallet-driven collection for a deposit wallet',
    ['INTERNAL_TX_SUBMIT'],
  ),
  route(
    'POST',
    '/admin/internal-transactions/reconcile-collections',
    'Replay internal collection transactions (legacy)',
    ['INTERNAL_TX_SUBMIT'],
  ),
  route('PATCH', '/admin/internal-transactions/:id/review', 'Review manual internal transaction', ['INTERNAL_TX_REVIEW']),

  route('GET', '/admin/internal-funds', 'List internal funds', ['INTERNAL_FUND_READ']),
  route('GET', '/admin/internal-funds/:id', 'Get internal fund detail', ['INTERNAL_FUND_READ']),
  route('PATCH', '/admin/internal-funds/:id/status', 'Update internal fund status', ['INTERNAL_FUND_WRITE']),
  route('POST', '/admin/internal-funds/mock', 'Mock internal fund transition', ['INTERNAL_FUND_WRITE']),
  route('GET', '/admin/fee-occurrences', 'List fee occurrences', ['INTERNAL_FUND_READ']),
  route('GET', '/admin/fee-occurrences/:id', 'Get fee occurrence detail', ['INTERNAL_FUND_READ']),
  route('POST', '/admin/fee-occurrences', 'Record fee occurrence', ['INTERNAL_FUND_WRITE']),
  route('PATCH', '/admin/fee-occurrences/:id/cancel', 'Cancel fee occurrence', ['INTERNAL_FUND_WRITE']),
  route(
    'GET',
    '/admin/reimbursement-obligations',
    'List reimbursement obligations',
    ['INTERNAL_FUND_READ'],
  ),
  route(
    'GET',
    '/admin/reimbursement-obligations/:id',
    'Get reimbursement obligation detail',
    ['INTERNAL_FUND_READ'],
  ),
  route(
    'PATCH',
    '/admin/reimbursement-obligations/:id/status',
    'Update reimbursement obligation status',
    ['INTERNAL_FUND_WRITE'],
  ),

  // Reconciliation
  route('GET', '/admin/reconciliation/outstandings', 'List outstandings', ['RECON_OUTSTANDING_READ']),
  route('GET', '/admin/reconciliation/outstandings/:id', 'Get outstanding detail', ['RECON_OUTSTANDING_READ']),
  route(
    'GET',
    '/admin/reconciliation/safeguarding-breaks',
    'List safeguarding reconciliation breaks',
    ['RECON_BREAK_READ'],
  ),
  route(
    'GET',
    '/admin/reconciliation/safeguarding-breaks/:id',
    'Get safeguarding reconciliation break detail',
    ['RECON_BREAK_READ'],
  ),
  route(
    'POST',
    '/admin/reconciliation/safeguarding-breaks/generate-daily-diff',
    'Run full safeguarding reconciliation',
    ['RECON_BREAK_WRITE'],
  ),
  route(
    'PATCH',
    '/admin/reconciliation/safeguarding-breaks/:id/status',
    'Update safeguarding reconciliation break status',
    ['RECON_BREAK_WRITE'],
  ),
  route(
    'GET',
    '/admin/reconciliation/safeguarding-warnings',
    'List safeguarding reconciliation warnings',
    ['RECON_BREAK_READ'],
  ),
  route(
    'GET',
    '/admin/reconciliation/safeguarding-warnings/:id',
    'Get safeguarding reconciliation warning detail',
    ['RECON_BREAK_READ'],
  ),
  route(
    'PATCH',
    '/admin/reconciliation/safeguarding-warnings/:id/status',
    'Update safeguarding reconciliation warning status',
    ['RECON_BREAK_WRITE'],
  ),
  route(
    'GET',
    '/admin/reconciliation/safeguarding-runs',
    'List safeguarding reconciliation runs',
    ['RECON_BREAK_READ'],
  ),
  route(
    'GET',
    '/admin/reconciliation/safeguarding-runs/:id',
    'Get safeguarding reconciliation run detail',
    ['RECON_BREAK_READ'],
  ),
  route(
    'POST',
    '/admin/reconciliation/safeguarding-runs/:id/export-evidence-package',
    'Export safeguarding reconciliation evidence package',
    ['RECON_BREAK_WRITE'],
  ),
  route(
    'POST',
    '/admin/reconciliation/safeguarding-fiat-statements/imports',
    'Import safeguarding fiat statement',
    ['RECON_BREAK_WRITE'],
  ),
  route(
    'GET',
    '/admin/reconciliation/safeguarding-fiat-statements/imports',
    'List safeguarding fiat statement imports',
    ['RECON_BREAK_READ'],
  ),
  route(
    'GET',
    '/admin/reconciliation/safeguarding-fiat-statements/imports/:id',
    'Get safeguarding fiat statement import detail',
    ['RECON_BREAK_READ'],
  ),

  route('POST', '/admin/reconciliation/outstanding-settlements', 'Create outstanding settlement', ['SETTLEMENT_WRITE']),
  route('GET', '/admin/reconciliation/outstanding-settlements', 'List outstanding settlements', ['SETTLEMENT_READ']),
  route('GET', '/admin/reconciliation/outstanding-settlements/:id', 'Get outstanding settlement detail', ['SETTLEMENT_READ']),
  route('POST', '/admin/reconciliation/outstanding-settlements/:id/sync', 'Sync outstanding settlement', ['SETTLEMENT_WRITE']),
  route('GET', '/admin/pool-settlement-batches', 'List pool settlement batches', ['SETTLEMENT_READ']),
  route('GET', '/admin/pool-settlement-batches/:id', 'Get pool settlement batch detail', ['SETTLEMENT_READ']),
  route('POST', '/admin/pool-settlement-batches', 'Create pool settlement batch', ['SETTLEMENT_WRITE']),
  route('POST', '/admin/pool-settlement-batches/:id/submit', 'Submit pool settlement batch', ['SETTLEMENT_WRITE']),

  // Clearing
  route('GET', '/clearings', 'List clearings', ['CLEARING_READ']),
  route('GET', '/clearings/lines', 'List clearing lines', ['CLEARING_READ']),
  route('GET', '/clearings/lines/:id', 'Get clearing line detail', ['CLEARING_READ']),
  route('GET', '/clearings/:id', 'Get clearing detail', ['CLEARING_READ']),
  route('POST', '/clearings/:id/re-clear', 'Re-clear clearing', ['CLEARING_WRITE']),

  // Journals
  route('GET', '/journals', 'List journals', ['JOURNAL_READ']),
  route('GET', '/journals/:id', 'Get journal detail', ['JOURNAL_READ']),
  route('GET', '/journal-lines', 'List journal lines', ['JOURNAL_READ']),
  route('GET', '/journal-lines/customer-balance-history', 'Get customer balance history', ['JOURNAL_READ']),
  route('GET', '/journal-lines/:id', 'Get journal line detail', ['JOURNAL_READ']),

  // Accounting config
  route('GET', '/coa', 'List COA items', ['ACCOUNTING_CONFIG_READ']),
  route('GET', '/coa/:id', 'Get COA detail', ['ACCOUNTING_CONFIG_READ']),

  route('GET', '/acct-events', 'List account events', ['ACCOUNTING_CONFIG_READ']),
  route('GET', '/acct-events/:eventCode', 'Get account event detail', ['ACCOUNTING_CONFIG_READ']),

  route('GET', '/journal-header-templates', 'List journal header templates', ['ACCOUNTING_CONFIG_READ']),
  route('GET', '/journal-header-templates/:id', 'Get journal header template detail', ['ACCOUNTING_CONFIG_READ']),

  route('GET', '/journal-line-templates', 'List journal line templates', ['ACCOUNTING_CONFIG_READ']),
  route('GET', '/journal-line-templates/:id', 'Get journal line template detail', ['ACCOUNTING_CONFIG_READ']),

  route('GET', '/clearing-templates', 'List clearing templates', ['ACCOUNTING_CONFIG_READ']),
  route('GET', '/clearing-templates/:id', 'Get clearing template detail', ['ACCOUNTING_CONFIG_READ']),

  // Assets
  route('POST', '/assets', 'Create asset', ['ASSET_CONFIG_WRITE']),
  route('GET', '/assets', 'List assets', ['ASSET_CONFIG_READ']),
  route('GET', '/assets/:id', 'Get asset detail', ['ASSET_CONFIG_READ']),
  route('PATCH', '/assets/:id/status', 'Update asset status', ['ASSET_CONFIG_WRITE']),

  // Counterparty
  route('POST', '/liquidity-providers', 'Create liquidity provider', ['COUNTERPARTY_WRITE']),
  route('GET', '/liquidity-providers', 'List liquidity providers', ['COUNTERPARTY_READ']),
  route('GET', '/liquidity-providers/:id', 'Get liquidity provider detail', ['COUNTERPARTY_READ']),
  route('PATCH', '/liquidity-providers/:id/status', 'Update liquidity provider status', ['COUNTERPARTY_WRITE']),

  route('POST', '/liquidity-configurations', 'Create liquidity configuration', ['COUNTERPARTY_WRITE']),
  route('GET', '/liquidity-configurations', 'List liquidity configurations', ['COUNTERPARTY_READ']),
  route('GET', '/liquidity-configurations/available', 'List available liquidity configurations', ['COUNTERPARTY_READ']),
  route('GET', '/liquidity-configurations/lp/:lpId', 'List liquidity configurations by LP', ['COUNTERPARTY_READ']),
  route('GET', '/liquidity-configurations/:id', 'Get liquidity configuration detail', ['COUNTERPARTY_READ']),
  route('PUT', '/liquidity-configurations/:id', 'Update liquidity configuration', ['COUNTERPARTY_WRITE']),
  route('DELETE', '/liquidity-configurations/:id', 'Delete liquidity configuration', ['COUNTERPARTY_WRITE']),
  route('PATCH', '/liquidity-configurations/:id/status', 'Update liquidity configuration status', ['COUNTERPARTY_WRITE']),

  // Audit logs
  route('POST', '/admin/audit-logs', 'Create manual audit log event', ['AUDIT_MANUAL_WRITE']),
  route('GET', '/admin/audit-logs', 'List audit logs', ['AUDIT_READ']),
  route('GET', '/admin/audit-logs/:id', 'Get audit log detail', ['AUDIT_READ']),
  route('POST', '/admin/audit-logs/export/evidence-package', 'Export audit evidence package', [
    'AUDIT_EXPORT_CREATE',
  ]),
  route('GET', '/admin/audit-logs/evidence-packages', 'List evidence package exports', [
    'AUDIT_EXPORT_READ',
  ]),
  route('GET', '/admin/audit-logs/evidence-packages/:id', 'Get evidence package detail', [
    'AUDIT_EXPORT_READ',
  ]),
  route('GET', '/admin/audit-logs/evidence-packages/:id/download', 'Download evidence package content', [
    'AUDIT_EXPORT_READ',
  ]),

  // Governance approvals
  route('POST', '/admin/control-gates/approvals', 'Create approval case', ['GOV_APPROVAL_WRITE']),
  route('POST', '/admin/control-gates/approvals/:id/submit', 'Submit approval case', ['GOV_APPROVAL_WRITE']),
  route('POST', '/admin/control-gates/approvals/:id/approve', 'Approve approval case', ['GOV_APPROVAL_DECIDE']),
  route('POST', '/admin/control-gates/approvals/:id/reject', 'Reject approval case', ['GOV_APPROVAL_DECIDE']),
  route('POST', '/admin/control-gates/approvals/:id/cancel', 'Cancel approval case', ['GOV_APPROVAL_WRITE']),
  route('GET', '/admin/control-gates/approvals/:id', 'Get approval case detail', ['GOV_APPROVAL_READ']),
  route('GET', '/admin/control-gates/approvals', 'List approval cases', ['GOV_APPROVAL_READ']),

  // Governance change tickets
  route('POST', '/admin/control-gates/change-tickets', 'Create change ticket', ['GOV_CHANGE_TICKET_WRITE']),
  route('GET', '/admin/control-gates/change-tickets', 'List change tickets', ['GOV_CHANGE_TICKET_READ']),
  route('GET', '/admin/control-gates/change-tickets/:id', 'Get change ticket detail', ['GOV_CHANGE_TICKET_READ']),
  route('POST', '/admin/control-gates/change-tickets/:id/submit', 'Submit change ticket', ['GOV_CHANGE_TICKET_WRITE']),
  route('POST', '/admin/control-gates/change-tickets/:id/consume', 'Consume change ticket', [
    'GOV_CHANGE_TICKET_WRITE',
  ]),

  // Governance delete requests
  route('POST', '/admin/control-gates/delete-requests', 'Create delete request', [
    'GOV_DELETE_REQUEST_WRITE',
  ]),
  route('GET', '/admin/control-gates/delete-requests', 'List delete requests', [
    'GOV_DELETE_REQUEST_READ',
  ]),
  route('GET', '/admin/control-gates/delete-requests/:id', 'Get delete request detail', [
    'GOV_DELETE_REQUEST_READ',
  ]),
  route('POST', '/admin/control-gates/delete-requests/:id/submit', 'Submit delete request', [
    'GOV_DELETE_REQUEST_WRITE',
  ]),
  route('POST', '/admin/control-gates/delete-requests/:id/cancel', 'Cancel delete request', [
    'GOV_DELETE_REQUEST_WRITE',
  ]),
  route('POST', '/admin/control-gates/delete-requests/:id/consume', 'Consume delete request', [
    'GOV_DELETE_REQUEST_CONSUME',
  ]),

  // Governance registries
  route('GET', '/admin/governance/registries/shareholding-versions', 'List shareholding registry versions', [
    'GOV_REGISTRY_READ',
  ]),
  route('GET', '/admin/governance/registries/shareholding-versions/:id', 'Get shareholding registry version detail', [
    'GOV_REGISTRY_READ',
  ]),
  route('POST', '/admin/governance/registries/shareholding-versions', 'Create shareholding registry version', [
    'GOV_REGISTRY_WRITE',
  ]),
  route('PATCH', '/admin/governance/registries/shareholding-versions/:id', 'Update shareholding registry version', [
    'GOV_REGISTRY_WRITE',
  ]),
  route('GET', '/admin/governance/registries/appointments', 'List appointment records', [
    'GOV_REGISTRY_READ',
  ]),
  route('GET', '/admin/governance/registries/appointments/:id', 'Get appointment record detail', [
    'GOV_REGISTRY_READ',
  ]),
  route('POST', '/admin/governance/registries/appointments', 'Create appointment record', [
    'GOV_REGISTRY_WRITE',
  ]),
  route('PATCH', '/admin/governance/registries/appointments/:id', 'Update appointment record', [
    'GOV_REGISTRY_WRITE',
  ]),
  route('GET', '/admin/governance/registries/trainings', 'List training records', [
    'GOV_REGISTRY_READ',
  ]),
  route('GET', '/admin/governance/registries/trainings/:id', 'Get training record detail', [
    'GOV_REGISTRY_READ',
  ]),
  route('POST', '/admin/governance/registries/trainings', 'Create training record', [
    'GOV_REGISTRY_WRITE',
  ]),
  route('PATCH', '/admin/governance/registries/trainings/:id', 'Update training record', [
    'GOV_REGISTRY_WRITE',
  ]),
  route('GET', '/admin/governance/registries/conflicts', 'List conflict disclosures', [
    'GOV_REGISTRY_READ',
  ]),
  route('GET', '/admin/governance/registries/conflicts/:id', 'Get conflict disclosure detail', [
    'GOV_REGISTRY_READ',
  ]),
  route('POST', '/admin/governance/registries/conflicts', 'Create conflict disclosure', [
    'GOV_REGISTRY_WRITE',
  ]),
  route('PATCH', '/admin/governance/registries/conflicts/:id', 'Update conflict disclosure', [
    'GOV_REGISTRY_WRITE',
  ]),
  route('GET', '/admin/governance/registries/wind-down-materials', 'List wind-down material records', [
    'GOV_REGISTRY_READ',
  ]),
  route('GET', '/admin/governance/registries/wind-down-materials/:id', 'Get wind-down material record detail', [
    'GOV_REGISTRY_READ',
  ]),
  route('POST', '/admin/governance/registries/wind-down-materials', 'Create wind-down material record', [
    'GOV_REGISTRY_WRITE',
  ]),
  route('PATCH', '/admin/governance/registries/wind-down-materials/:id', 'Update wind-down material record', [
    'GOV_REGISTRY_WRITE',
  ]),
  route('GET', '/admin/governance/regulatory-gates', 'List regulatory gate items', [
    'GOV_REGULATORY_GATE_READ',
  ]),
  route('GET', '/admin/governance/regulatory-gates/:id', 'Get regulatory gate detail', [
    'GOV_REGULATORY_GATE_READ',
  ]),
  route('POST', '/admin/governance/regulatory-gates', 'Create regulatory gate item', [
    'GOV_REGULATORY_GATE_WRITE',
  ]),
  route('PATCH', '/admin/governance/regulatory-gates/:id', 'Update regulatory gate item', [
    'GOV_REGULATORY_GATE_WRITE',
  ]),
  route('POST', '/admin/governance/regulatory-gates/:id/submit', 'Submit regulatory gate filing', [
    'GOV_REGULATORY_GATE_WRITE',
  ]),
  route(
    'POST',
    '/admin/governance/regulatory-gates/:id/record-feedback',
    'Record regulatory gate filing feedback',
    ['GOV_REGULATORY_GATE_WRITE'],
  ),
  route(
    'POST',
    '/admin/governance/regulatory-gates/:id/bind-receipt',
    'Bind regulatory gate receipt',
    ['GOV_REGULATORY_GATE_WRITE'],
  ),
  route(
    'POST',
    '/admin/governance/regulatory-gates/:id/mark-effective',
    'Mark regulatory gate effective',
    ['GOV_REGULATORY_GATE_WRITE'],
  ),
  route('POST', '/admin/governance/regulatory-gates/:id/revoke', 'Revoke regulatory gate', [
    'GOV_REGULATORY_GATE_WRITE',
  ]),

  // Approval Policy Management
  route('GET', '/admin/governance/approval-policies', 'List approval policies', [
    'GOV_APPROVAL_POLICY_READ',
  ]),
  route('POST', '/admin/governance/approval-policies/:actionType/change-requests', 'Create approval policy change request', [
    'GOV_APPROVAL_POLICY_WRITE',
  ]),
  route('GET', '/admin/governance/approval-policies/change-requests', 'List approval policy change requests', [
    'GOV_APPROVAL_POLICY_READ',
  ]),
  route('GET', '/admin/governance/approval-policies/change-requests/:id', 'Get approval policy change request detail', [
    'GOV_APPROVAL_POLICY_READ',
  ]),

];

export const RBAC_ROLE_GROUP_BINDINGS: Record<string, PermissionGroup[]> = {
  SUPER_ADMIN: [],
  SENIOR_MANAGEMENT_OFFICER: [
    'BASE_ACCESS',
    'IAM_READ',
    'AUDIT_READ',
    'RISK_DECISION_RECORD_READ',
    'ALERT_READ',
    'CASE_READ',
    'CASE_EXPORT_READ',
    'RECON_BREAK_READ',
    'GOV_APPROVAL_READ',
    'GOV_APPROVAL_DECIDE',
    'GOV_CHANGE_TICKET_READ',
    'GOV_DELETE_REQUEST_READ',
    'GOV_REGISTRY_READ',
    'GOV_REGULATORY_GATE_READ',
    'GOV_APPROVAL_POLICY_READ',

  ],
  TECH_OFFICER: [
    'BASE_ACCESS',
    'IAM_READ',
    'IAM_ASSIGN',
    'IAM_CREDENTIAL_RESET',
    'IAM_ROLE_DEFINE',
    'AUDIT_READ',
    'AUDIT_EXPORT_READ',
    'RISK_DECISION_RECORD_READ',
    'RISK_DECISION_RECORD_WRITE',
    'RECON_BREAK_READ',
    'RECON_BREAK_WRITE',
    'GOV_APPROVAL_READ',
    'GOV_APPROVAL_DECIDE',
    'GOV_CHANGE_TICKET_READ',
    'GOV_CHANGE_TICKET_WRITE',
    'GOV_CHANGE_TICKET_GATE',
    'GOV_CHANGE_TICKET_CLOSE',
    'GOV_DELETE_REQUEST_READ',
    'GOV_DELETE_REQUEST_WRITE',
    'GOV_DELETE_REQUEST_CONSUME',
    'GOV_REGISTRY_READ',
    'GOV_REGISTRY_WRITE',
    'GOV_REGULATORY_GATE_READ',
    'GOV_REGULATORY_GATE_WRITE',
    'GOV_APPROVAL_POLICY_READ',
    'GOV_APPROVAL_POLICY_WRITE',

  ],
  OPS_OFFICER: [
    'BASE_ACCESS',
    'IAM_READ',
    'AUDIT_READ',
    'RECON_BREAK_READ',
    'RECON_BREAK_WRITE',
    'GOV_APPROVAL_READ',
    'GOV_CHANGE_TICKET_READ',
    'GOV_CHANGE_TICKET_WRITE',
    'GOV_DELETE_REQUEST_READ',
    'GOV_DELETE_REQUEST_WRITE',
    'GOV_REGISTRY_READ',
    'GOV_REGULATORY_GATE_READ',
  ],
  COMPLIANCE_OFFICER: [
    'BASE_ACCESS',
    'IAM_READ',
    'AUDIT_READ',
    'AUDIT_EXPORT_CREATE',
    'AUDIT_EXPORT_READ',
    'RISK_DECISION_RECORD_READ',
    'RISK_DECISION_RECORD_WRITE',
    'ALERT_READ',
    'ALERT_WRITE',
    'CASE_READ',
    'CASE_WRITE',
    'CASE_EXPORT_READ',
    'CASE_EXPORT_WRITE',
    'RECON_BREAK_READ',
    'RECON_BREAK_WRITE',
    'GOV_APPROVAL_READ',
    'GOV_APPROVAL_WRITE',
    'GOV_CHANGE_TICKET_READ',
    'GOV_CHANGE_TICKET_WRITE',
    'GOV_DELETE_REQUEST_READ',
    'GOV_DELETE_REQUEST_WRITE',
    'GOV_REGISTRY_READ',
    'GOV_REGISTRY_WRITE',
    'GOV_REGULATORY_GATE_READ',
    'GOV_REGULATORY_GATE_WRITE',
    'GOV_APPROVAL_POLICY_READ',
    'GOV_APPROVAL_POLICY_WRITE',

  ],
  MLRO: [
    'BASE_ACCESS',
    'IAM_READ',
    'AUDIT_READ',
    'AUDIT_EXPORT_CREATE',
    'AUDIT_EXPORT_READ',
    'RISK_DECISION_RECORD_READ',
    'RISK_DECISION_RECORD_WRITE',
    'MLRO_REVIEW_WRITE',
    'ALERT_READ',
    'ALERT_WRITE',
    'CASE_READ',
    'CASE_WRITE',
    'CASE_EXPORT_READ',
    'CASE_EXPORT_WRITE',
    'RECON_BREAK_READ',
    'RECON_BREAK_WRITE',
    'GOV_APPROVAL_READ',
    'GOV_APPROVAL_WRITE',
    'GOV_APPROVAL_DECIDE',
    'GOV_CHANGE_TICKET_READ',
    'GOV_DELETE_REQUEST_READ',
    'GOV_REGISTRY_READ',
    'GOV_APPROVAL_POLICY_READ',

  ],
  DPO: [
    'BASE_ACCESS',
    'IAM_READ',
    'AUDIT_READ',
    'AUDIT_EXPORT_CREATE',
    'AUDIT_EXPORT_READ',
    'GOV_APPROVAL_READ',
    'GOV_APPROVAL_WRITE',
    'GOV_APPROVAL_DECIDE',
    'GOV_CHANGE_TICKET_READ',
    'GOV_DELETE_REQUEST_READ',
    'GOV_DELETE_REQUEST_WRITE',
    'GOV_DELETE_REQUEST_CONSUME',
    'GOV_REGISTRY_READ',
    'GOV_REGISTRY_WRITE',
    'GOV_REGULATORY_GATE_READ',
    'GOV_REGULATORY_GATE_WRITE',
    'GOV_APPROVAL_POLICY_READ',
    'GOV_APPROVAL_POLICY_WRITE',

  ],
  CISO: [
    'BASE_ACCESS',
    'IAM_READ',
    'IAM_ASSIGN',
    'IAM_CREDENTIAL_RESET',
    'IAM_ROLE_DEFINE',
    'AUDIT_READ',
    'RISK_DECISION_RECORD_READ',
    'ALERT_READ',
    'CASE_READ',
    'CASE_EXPORT_READ',
    'RECON_BREAK_READ',
    'GOV_APPROVAL_READ',
    'GOV_APPROVAL_DECIDE',
    'GOV_CHANGE_TICKET_READ',
    'GOV_CHANGE_TICKET_GATE',
    'GOV_DELETE_REQUEST_READ',
    'GOV_REGISTRY_READ',
    'GOV_REGISTRY_WRITE',
    'GOV_REGULATORY_GATE_READ',
    'GOV_REGULATORY_GATE_WRITE',
    'GOV_APPROVAL_POLICY_READ',
    'GOV_APPROVAL_POLICY_WRITE',

  ],
};

export function buildRolePermissionCodeMap(): Record<string, string[]> {
  const allPermissionCodes = RBAC_PERMISSION_DEFINITIONS.map((item) => item.code);

  const result: Record<string, string[]> = {};
  for (const role of RBAC_ROLE_DEFINITIONS) {
    if (role.code === 'SUPER_ADMIN') {
      result[role.code] = [...allPermissionCodes];
      continue;
    }

    const groups = RBAC_ROLE_GROUP_BINDINGS[role.code] || [];
    const codes = RBAC_PERMISSION_DEFINITIONS.filter((item) =>
      item.groups.some((group) => groups.includes(group)),
    ).map((item) => item.code);

    result[role.code] = Array.from(new Set(codes)).sort();
  }

  return result;
}

export const RBAC_PERMISSION_CODE_SET = new Set(
  RBAC_PERMISSION_DEFINITIONS.map((item) => item.code),
);
