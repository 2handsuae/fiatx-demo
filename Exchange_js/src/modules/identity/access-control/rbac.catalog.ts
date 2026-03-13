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
  | 'CUSTOMER_READ'
  | 'CUSTOMER_WRITE'
  | 'CUSTOMER_RATE_READ'
  | 'CUSTOMER_RATE_WRITE'
  | 'ONBOARDING_READ'
  | 'CDD_REVIEW_WRITE'
  | 'MLRO_REVIEW_WRITE'
  | 'FINAL_REVIEW_WRITE'
  | 'INVESTOR_OVERRIDE_WRITE'
  | 'SIMULATE_EXPIRED_WRITE'
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
  | 'AUDIT_EXPORT'
  | 'AUDIT_MANUAL_WRITE';

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
    code: 'IAM_ADMIN',
    name: 'IAM Administrator',
    description: 'Manage user-role bindings and view permission catalog.',
  },
  {
    code: 'APPROVER',
    name: 'Approver',
    description: 'Management-level final/exception approval role.',
  },
  {
    code: 'COMPLIANCE_OFFICER',
    name: 'Compliance Officer',
    description: 'Handle compliance operations and CDD decisions.',
  },
  {
    code: 'MLRO',
    name: 'MLRO',
    description: 'Own EDD/AML final review outcomes.',
  },
  {
    code: 'ALERT_ANALYST',
    name: 'Alert Analyst',
    description: 'Triage KYT/Travel Rule alerts and evidence.',
  },
  {
    code: 'CUSTOMER_OPS',
    name: 'Customer Operations',
    description: 'Customer lifecycle operations and customer rate config.',
  },
  {
    code: 'TRADING_OPS',
    name: 'Trading Operations',
    description: 'Run customer deposit/swap/withdraw workflows.',
  },
  {
    code: 'TREASURY_MAKER',
    name: 'Treasury Maker',
    description: 'Initiate treasury/internal transfer operations.',
  },
  {
    code: 'TREASURY_CHECKER',
    name: 'Treasury Checker',
    description: 'Review and approve/reject internal transfer requests.',
  },
  {
    code: 'ACCOUNTING_OPS',
    name: 'Accounting Operations',
    description: 'Operate accounting and ledger configurations.',
  },
  {
    code: 'SETTLEMENT_OPS',
    name: 'Settlement Operations',
    description: 'Operate clearing and settlement execution.',
  },
  {
    code: 'RECON_OPS',
    name: 'Reconciliation Operations',
    description: 'Operate reconciliation monitoring and follow-up.',
  },
  {
    code: 'CONFIG_ADMIN',
    name: 'Configuration Administrator',
    description: 'Manage asset/counterparty/system configurations.',
  },
  {
    code: 'AUDIT_OFFICER',
    name: 'Audit Officer',
    description: 'Read audit logs and export evidence packages.',
  },
  {
    code: 'DPO',
    name: 'Data Protection Officer',
    description: 'Data protection oversight via read/export access.',
  },
  {
    code: 'CISO',
    name: 'Chief Information Security Officer',
    description: 'Security governance with read-oriented platform oversight.',
  },
];

export const HARD_MUTEX_ROLE_PAIRS: Array<[string, string]> = [
  ['TREASURY_MAKER', 'TREASURY_CHECKER'],
];

export const SOFT_WARNING_ROLE_GROUPS: Array<{ codes: string[]; message: string }> = [
  {
    codes: ['TRADING_OPS', 'COMPLIANCE_OFFICER'],
    message:
      'Combining TRADING_OPS with COMPLIANCE_OFFICER increases conflict-of-interest risk.',
  },
  {
    codes: ['TRADING_OPS', 'MLRO'],
    message: 'Combining TRADING_OPS with MLRO increases conflict-of-interest risk.',
  },
  {
    codes: ['IAM_ADMIN', 'APPROVER'],
    message: 'Combining IAM_ADMIN with APPROVER reduces segregation of duties.',
  },
];

export const RBAC_PERMISSION_DEFINITIONS: RbacPermissionDefinition[] = [
  // Session / IAM
  route('GET', '/auth/me', 'Get current admin session', ['BASE_ACCESS']),
  route('GET', '/users', 'List users', ['IAM_READ']),
  route('POST', '/users', 'Create admin user', ['IAM_ASSIGN']),
  route('POST', '/users/:id/invitations/resend', 'Resend admin invitation', ['IAM_ASSIGN']),
  route('GET', '/admin/iam/roles', 'List role catalog', ['IAM_READ']),
  route('GET', '/admin/iam/permissions', 'List permission catalog', ['IAM_READ']),
  route('GET', '/admin/iam/users/:id/roles', 'Get user roles', ['IAM_READ']),
  route('PUT', '/admin/iam/users/:id/roles', 'Replace user roles', ['IAM_ASSIGN']),

  // Customer domain
  route('POST', '/customers', 'Create customer', ['CUSTOMER_WRITE']),
  route('GET', '/customers', 'List customers', ['CUSTOMER_READ']),
  route('GET', '/customers/:id', 'Get customer detail', ['CUSTOMER_READ']),
  route('PATCH', '/customers/:id', 'Update customer', ['CUSTOMER_WRITE']),
  route('POST', '/customers/:id/status', 'Change customer status (deprecated)', ['CUSTOMER_WRITE']),
  route('POST', '/customers/:id/freeze', 'Freeze customer account', ['CUSTOMER_WRITE']),
  route('POST', '/customers/:id/unfreeze', 'Unfreeze customer account', ['CUSTOMER_WRITE']),
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
  route('PUT', '/admin/pricing/policies/swap', 'Update swap pricing policy', ['CUSTOMER_RATE_WRITE']),
  route('PUT', '/admin/pricing/policies/withdrawal', 'Update withdrawal pricing policy', ['CUSTOMER_RATE_WRITE']),
  route('POST', '/admin/pricing/simulator/swap', 'Simulate swap pricing', ['CUSTOMER_RATE_WRITE']),
  route('POST', '/withdraw-transactions/quotes', 'Create withdrawal pricing quote', ['TRADING_WITHDRAW_WRITE']),

  // Onboarding compliance
  route('GET', '/admin/compliance/cdd-cases', 'List CDD cases', ['ONBOARDING_READ']),
  route('POST', '/admin/compliance/cdd-cases/:id/review', 'Review CDD case', ['CDD_REVIEW_WRITE']),
  route('GET', '/admin/compliance/cdd-cases/:id', 'Get CDD case detail', ['ONBOARDING_READ']),
  route('GET', '/admin/compliance/edd-cases', 'List EDD cases', ['ONBOARDING_READ']),
  route('POST', '/admin/compliance/edd-cases/:id/mlro-review', 'MLRO review EDD case', ['MLRO_REVIEW_WRITE']),
  route('GET', '/admin/compliance/edd-cases/:id', 'Get EDD case detail', ['ONBOARDING_READ']),
  route('POST', '/admin/compliance/customers/:id/final-review', 'Final review customer', ['FINAL_REVIEW_WRITE']),
  route('POST', '/admin/compliance/customers/:id/simulate-expired', 'Simulate customer expired', ['SIMULATE_EXPIRED_WRITE']),
  route('PATCH', '/admin/compliance/customers/:id/investor-classification', 'Override investor classification', ['INVESTOR_OVERRIDE_WRITE']),

  // Transaction compliance
  route('POST', '/admin/compliance/tx-kyt-cases/mock-complete', 'Mock complete KYT case', ['TX_COMPLIANCE_WRITE']),
  route('POST', '/admin/compliance/tx-travel-rule-cases/mock-complete', 'Mock complete travel-rule case', ['TX_COMPLIANCE_WRITE']),
  route('POST', '/admin/compliance/tx-cases/mock-backfill', 'Mock backfill tx cases', ['TX_COMPLIANCE_WRITE']),
  route('GET', '/admin/compliance/tx-kyt-cases', 'List KYT cases', ['TX_COMPLIANCE_READ']),
  route('GET', '/admin/compliance/tx-travel-rule-cases', 'List travel-rule cases', ['TX_COMPLIANCE_READ']),

  // Deposit
  route('GET', '/deposit-transactions', 'List deposit transactions', ['TRADING_DEPOSIT_READ']),
  route('GET', '/deposit-transactions/:id', 'Get deposit transaction detail', ['TRADING_DEPOSIT_READ']),
  route('POST', '/deposit-transactions', 'Create deposit transaction', ['TRADING_DEPOSIT_WRITE']),
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
  route('POST', '/treasury/payins/simulate', 'Simulate payin', ['PAYIN_WRITE']),
  route('GET', '/treasury/payins', 'List payins', ['PAYIN_READ']),
  route('GET', '/treasury/payins/:id', 'Get payin detail', ['PAYIN_READ']),
  route('PATCH', '/treasury/payins/:id/status', 'Update payin status', ['PAYIN_WRITE']),

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
  route('PATCH', '/admin/internal-transactions/:id/review', 'Review manual internal transaction', ['INTERNAL_TX_REVIEW']),

  route('GET', '/admin/internal-funds', 'List internal funds', ['INTERNAL_FUND_READ']),
  route('GET', '/admin/internal-funds/:id', 'Get internal fund detail', ['INTERNAL_FUND_READ']),
  route('PATCH', '/admin/internal-funds/:id/status', 'Update internal fund status', ['INTERNAL_FUND_WRITE']),
  route('POST', '/admin/internal-funds/mock', 'Mock internal fund transition', ['INTERNAL_FUND_WRITE']),

  // Reconciliation
  route('GET', '/admin/reconciliation/outstandings', 'List outstandings', ['RECON_OUTSTANDING_READ']),
  route('GET', '/admin/reconciliation/outstandings/:id', 'Get outstanding detail', ['RECON_OUTSTANDING_READ']),

  route('POST', '/admin/reconciliation/outstanding-settlements', 'Create outstanding settlement', ['SETTLEMENT_WRITE']),
  route('GET', '/admin/reconciliation/outstanding-settlements', 'List outstanding settlements', ['SETTLEMENT_READ']),
  route('GET', '/admin/reconciliation/outstanding-settlements/:id', 'Get outstanding settlement detail', ['SETTLEMENT_READ']),
  route('POST', '/admin/reconciliation/outstanding-settlements/:id/sync', 'Sync outstanding settlement', ['SETTLEMENT_WRITE']),

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
  route('POST', '/coa', 'Create COA item', ['ACCOUNTING_CONFIG_WRITE']),
  route('GET', '/coa', 'List COA items', ['ACCOUNTING_CONFIG_READ']),
  route('GET', '/coa/:id', 'Get COA detail', ['ACCOUNTING_CONFIG_READ']),
  route('PATCH', '/coa/:id', 'Update COA item', ['ACCOUNTING_CONFIG_WRITE']),
  route('DELETE', '/coa/:id', 'Delete COA item', ['ACCOUNTING_CONFIG_WRITE']),

  route('POST', '/acct-events/sync-defaults', 'Sync default account events', ['ACCOUNTING_CONFIG_WRITE']),
  route('POST', '/acct-events', 'Create account event', ['ACCOUNTING_CONFIG_WRITE']),
  route('GET', '/acct-events', 'List account events', ['ACCOUNTING_CONFIG_READ']),
  route('GET', '/acct-events/:eventCode', 'Get account event detail', ['ACCOUNTING_CONFIG_READ']),
  route('PATCH', '/acct-events/:eventCode', 'Update account event', ['ACCOUNTING_CONFIG_WRITE']),
  route('DELETE', '/acct-events/:eventCode', 'Delete account event', ['ACCOUNTING_CONFIG_WRITE']),

  route('POST', '/journal-header-templates', 'Create journal header template', ['ACCOUNTING_CONFIG_WRITE']),
  route('GET', '/journal-header-templates', 'List journal header templates', ['ACCOUNTING_CONFIG_READ']),
  route('GET', '/journal-header-templates/:id', 'Get journal header template detail', ['ACCOUNTING_CONFIG_READ']),
  route('PATCH', '/journal-header-templates/:id', 'Update journal header template', ['ACCOUNTING_CONFIG_WRITE']),
  route('DELETE', '/journal-header-templates/:id', 'Delete journal header template', ['ACCOUNTING_CONFIG_WRITE']),

  route('POST', '/journal-line-templates', 'Create journal line template', ['ACCOUNTING_CONFIG_WRITE']),
  route('GET', '/journal-line-templates', 'List journal line templates', ['ACCOUNTING_CONFIG_READ']),
  route('GET', '/journal-line-templates/:id', 'Get journal line template detail', ['ACCOUNTING_CONFIG_READ']),
  route('PATCH', '/journal-line-templates/:id', 'Update journal line template', ['ACCOUNTING_CONFIG_WRITE']),
  route('DELETE', '/journal-line-templates/:id', 'Delete journal line template', ['ACCOUNTING_CONFIG_WRITE']),

  route('POST', '/clearing-templates', 'Create clearing template', ['ACCOUNTING_CONFIG_WRITE']),
  route('GET', '/clearing-templates', 'List clearing templates', ['ACCOUNTING_CONFIG_READ']),
  route('GET', '/clearing-templates/:id', 'Get clearing template detail', ['ACCOUNTING_CONFIG_READ']),
  route('PATCH', '/clearing-templates/:id', 'Update clearing template', ['ACCOUNTING_CONFIG_WRITE']),
  route('DELETE', '/clearing-templates/:id', 'Delete clearing template', ['ACCOUNTING_CONFIG_WRITE']),

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
  route('POST', '/admin/audit-logs/export/evidence-package', 'Export audit evidence package', ['AUDIT_EXPORT']),
];

export const RBAC_ROLE_GROUP_BINDINGS: Record<string, PermissionGroup[]> = {
  SUPER_ADMIN: [],
  IAM_ADMIN: ['BASE_ACCESS', 'IAM_READ', 'IAM_ASSIGN', 'AUDIT_READ'],
  APPROVER: [
    'BASE_ACCESS',
    'ONBOARDING_READ',
    'FINAL_REVIEW_WRITE',
    'INTERNAL_TX_READ',
    'INTERNAL_TX_REVIEW',
    'SETTLEMENT_READ',
    'SETTLEMENT_WRITE',
    'AUDIT_READ',
  ],
  COMPLIANCE_OFFICER: [
    'BASE_ACCESS',
    'ONBOARDING_READ',
    'CDD_REVIEW_WRITE',
    'INVESTOR_OVERRIDE_WRITE',
    'SIMULATE_EXPIRED_WRITE',
    'TX_COMPLIANCE_READ',
    'TX_COMPLIANCE_WRITE',
    'AUDIT_READ',
  ],
  MLRO: ['BASE_ACCESS', 'ONBOARDING_READ', 'MLRO_REVIEW_WRITE', 'TX_COMPLIANCE_READ', 'AUDIT_READ'],
  ALERT_ANALYST: ['BASE_ACCESS', 'TX_COMPLIANCE_READ', 'AUDIT_READ'],
  CUSTOMER_OPS: [
    'BASE_ACCESS',
    'CUSTOMER_READ',
    'CUSTOMER_WRITE',
    'CUSTOMER_RATE_READ',
    'CUSTOMER_RATE_WRITE',
    'ONBOARDING_READ',
  ],
  TRADING_OPS: [
    'BASE_ACCESS',
    'TRADING_DEPOSIT_READ',
    'TRADING_DEPOSIT_WRITE',
    'TRADING_WITHDRAW_READ',
    'TRADING_WITHDRAW_WRITE',
    'TRADING_SWAP_READ',
    'TRADING_SWAP_WRITE',
  ],
  TREASURY_MAKER: [
    'BASE_ACCESS',
    'WALLET_READ',
    'WALLET_WRITE',
    'PAYIN_READ',
    'PAYIN_WRITE',
    'PAYOUT_READ',
    'PAYOUT_WRITE',
    'INTERNAL_TX_READ',
    'INTERNAL_TX_SUBMIT',
    'INTERNAL_FUND_READ',
    'INTERNAL_FUND_WRITE',
  ],
  TREASURY_CHECKER: ['BASE_ACCESS', 'INTERNAL_TX_READ', 'INTERNAL_TX_REVIEW', 'INTERNAL_FUND_READ', 'AUDIT_READ'],
  ACCOUNTING_OPS: ['BASE_ACCESS', 'JOURNAL_READ', 'ACCOUNTING_CONFIG_READ', 'ACCOUNTING_CONFIG_WRITE'],
  SETTLEMENT_OPS: ['BASE_ACCESS', 'CLEARING_READ', 'CLEARING_WRITE', 'SETTLEMENT_READ', 'SETTLEMENT_WRITE'],
  RECON_OPS: ['BASE_ACCESS', 'RECON_OUTSTANDING_READ', 'SETTLEMENT_READ', 'CLEARING_READ'],
  CONFIG_ADMIN: [
    'BASE_ACCESS',
    'ASSET_CONFIG_READ',
    'ASSET_CONFIG_WRITE',
    'COUNTERPARTY_READ',
    'COUNTERPARTY_WRITE',
    'ACCOUNTING_CONFIG_READ',
  ],
  AUDIT_OFFICER: ['BASE_ACCESS', 'AUDIT_READ', 'AUDIT_EXPORT'],
  DPO: ['BASE_ACCESS', 'CUSTOMER_READ', 'JOURNAL_READ', 'AUDIT_READ', 'AUDIT_EXPORT'],
  CISO: [
    'BASE_ACCESS',
    'IAM_READ',
    'AUDIT_READ',
    'ASSET_CONFIG_READ',
    'COUNTERPARTY_READ',
    'ACCOUNTING_CONFIG_READ',
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
