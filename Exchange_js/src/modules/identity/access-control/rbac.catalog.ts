import { buildPermissionCode } from './permission-code.util';

export interface RbacRoleDefinition {
  code: string;
  name: string;
  description: string;
}

export type PermissionGroup =
  | 'BASE_ACCESS'
  | 'IAM_READ'
  | 'IAM_MEMBER_READ'
  | 'IAM_ROLE_READ'
  | 'IAM_ASSIGN'
  | 'IAM_MEMBER_MANAGE'
  | 'IAM_ROLE_ASSIGN'
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
  | 'INTERNAL_FUND_READ'
  | 'RECON_OUTSTANDING_READ'
  | 'RECON_RUN_READ'
  | 'RECON_RUN_WRITE'
  | 'RECON_CASE_READ'
  | 'RECON_EXTERNAL_BALANCE_READ'
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
  | 'GOV_APPROVAL_READ'
  | 'GOV_APPROVAL_WRITE'
  | 'GOV_APPROVAL_DECIDE'
  | 'GOV_REGISTRY_READ'
  | 'GOV_REGISTRY_WRITE'
  | 'GOV_REGULATORY_GATE_READ'
  | 'GOV_REGULATORY_GATE_WRITE'
  | 'GOV_APPROVAL_POLICY_READ'
  | 'GOV_APPROVAL_POLICY_WRITE'
  | 'TRANSACTION_LIMIT_READ'
  | 'TRANSACTION_LIMIT_WRITE'
  | 'WITHDRAWAL_ADDRESS_READ'
  | 'WITHDRAWAL_ADDRESS_WRITE'
  | 'WITHDRAWAL_FEE_LEVEL_READ'
  | 'WITHDRAWAL_FEE_LEVEL_WRITE'
  | 'SWAP_FEE_LEVEL_READ'
  | 'SWAP_FEE_LEVEL_WRITE'
  | 'INTERNAL_TRANSFER_READ'
  | 'INTERNAL_TRANSFER_WRITE'
  | 'SETTLEMENT_READ'
  | 'SETTLEMENT_WRITE';

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
  route('GET', '/users', 'List users', ['IAM_READ', 'IAM_MEMBER_READ']),
  route('POST', '/users', 'Create admin user', ['IAM_ASSIGN', 'IAM_MEMBER_MANAGE']),
  route('POST', '/users/:id/invitations/resend', 'Resend admin invitation', ['IAM_ASSIGN', 'IAM_MEMBER_MANAGE']),
  route('POST', '/users/:id/suspend', 'Suspend admin user (C4)', ['IAM_ASSIGN', 'IAM_MEMBER_MANAGE']),
  route('POST', '/users/:id/reactivate', 'Reactivate admin user (C4b)', ['IAM_ASSIGN', 'IAM_MEMBER_MANAGE']),
  route('GET', '/admin/iam/roles', 'List role catalog', ['IAM_READ', 'IAM_ROLE_READ']),
  route('GET', '/admin/iam/permissions', 'List permission catalog', ['IAM_READ', 'IAM_ROLE_READ']),
  route('GET', '/admin/iam/users/:id/roles', 'Get user roles', ['IAM_READ', 'IAM_MEMBER_READ']),
  route('PUT', '/admin/iam/users/:id/roles', 'Replace user roles', ['IAM_ASSIGN', 'IAM_ROLE_ASSIGN']),
  route('POST', '/admin/iam/role-change-requests', 'Create role binding change request', ['IAM_ASSIGN', 'IAM_ROLE_ASSIGN']),
  route('GET', '/admin/iam/role-change-requests', 'List role binding change requests', ['IAM_READ', 'IAM_ROLE_READ']),
  route('GET', '/admin/iam/role-change-requests/:id', 'Get role binding change request', ['IAM_READ', 'IAM_ROLE_READ']),
  route('POST', '/admin/iam/users/:id/reset-mfa', 'Reset admin MFA binding', ['IAM_CREDENTIAL_RESET']),
  route('POST', '/users/:id/reset-password', 'Reset admin password (C5)', ['IAM_CREDENTIAL_RESET']),
  route('POST', '/admin/iam/role-definitions', 'Create role definition request', ['IAM_ROLE_DEFINE']),
  route('GET', '/admin/iam/role-definitions/permission-groups', 'List available permission groups', ['IAM_ROLE_DEFINE']),
  route('POST', '/admin/iam/role-definitions/:roleId/modify', 'Submit role definition modify request', ['IAM_ROLE_DEFINE']),
  route('GET', '/admin/iam/role-definition-modify-requests', 'List role definition modify requests', ['IAM_READ', 'IAM_ROLE_READ']),
  route('GET', '/admin/iam/role-definition-modify-requests/:id', 'Get role definition modify request detail', ['IAM_READ', 'IAM_ROLE_READ']),
  route('GET', '/admin/iam/action-buckets', 'List action bucket catalog', ['IAM_READ', 'IAM_ROLE_READ']),

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
  route('POST', '/admin/compliance/customers/:id/simulate-expired', 'Simulate customer expired', ['SIMULATE_EXPIRED_WRITE']),
  route('PATCH', '/admin/compliance/customers/:id/investor-classification', 'Override investor classification', ['INVESTOR_OVERRIDE_WRITE']),

  // Sumsub events
  route('GET', '/admin/sumsub-events', 'List Sumsub webhook events', ['RISK_DECISION_RECORD_READ']),
  route('GET', '/admin/sumsub-events/:id', 'Get Sumsub event detail', ['RISK_DECISION_RECORD_READ']),
  route('POST', '/admin/sumsub-events/simulate', 'Simulate Sumsub event', ['RISK_DECISION_RECORD_WRITE']),
  route('POST', '/admin/sumsub-events/:id/replay', 'Replay Sumsub event', ['RISK_DECISION_RECORD_WRITE']),

  // Risk assessments
  route('GET', '/admin/compliance/risk-assessments', 'List risk assessments', ['RISK_DECISION_RECORD_READ']),
  route('GET', '/admin/compliance/risk-assessments/:id', 'Get risk assessment detail', ['RISK_DECISION_RECORD_READ']),

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
  route('POST', '/admin/swap-transactions/:swapNo/legs/:legSeq/advance', 'Advance swap settlement leg', ['TRADING_SWAP_WRITE']),
  route('POST', '/admin/swap-transactions/:swapNo/legs/:legSeq/resume', 'Resume a stuck swap leg', ['TRADING_SWAP_WRITE']),

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

  // Custodian wallet workflow
  route('POST', '/admin/custodian-wallets', 'Create custodian wallet (approval workflow)', ['WALLET_WRITE']),
  route('POST', '/admin/custodian-wallets/:walletNo/retry', 'Retry failed custodian wallet creation', ['WALLET_WRITE']),

  // Reconciliation
  route('GET', '/admin/reconciliation/outstandings', 'List outstandings', ['RECON_OUTSTANDING_READ']),
  route('GET', '/admin/reconciliation/outstandings/:id', 'Get outstanding detail', ['RECON_OUTSTANDING_READ']),
  route('GET', '/admin/reconciliation/fee-accruals', 'List fee accruals', ['RECON_OUTSTANDING_READ']),
  route('GET', '/admin/reconciliation/fee-accruals/:id', 'Get fee accrual detail with siblings', ['RECON_OUTSTANDING_READ']),
  route('GET', '/admin/reconciliation/demo/compare', 'Demo compare: injected breaks vs detected line-items', ['RECON_RUN_READ']),
  route('GET', '/admin/reconciliation/runs', 'View Recon Runs', ['RECON_RUN_READ']),
  route('GET', '/admin/reconciliation/runs/:runNo', 'View Recon Run Detail', ['RECON_RUN_READ']),
  route('POST', '/admin/reconciliation/runs/wallet', 'Trigger per-wallet reconciliation run', ['RECON_RUN_WRITE']),
  route('GET', '/admin/reconciliation/cases', 'View Recon Cases', ['RECON_CASE_READ']),
  route('GET', '/admin/reconciliation/cases/:caseNo', 'View Recon Case Detail', ['RECON_CASE_READ']),
  route('GET', '/admin/reconciliation/external-balances', 'View External Balances', ['RECON_EXTERNAL_BALANCE_READ']),
  route('GET', '/admin/reconciliation/external-balances/:walletNo', 'View External Balance Detail', ['RECON_EXTERNAL_BALANCE_READ']),

  // TB Ledger
  route('GET', '/admin/tb/accounts', 'List TB account registry', ['ACCOUNTING_CONFIG_READ']),
  route('GET', '/admin/tb/accounts/:tbAccountId', 'Get TB account detail', ['ACCOUNTING_CONFIG_READ']),
  route('POST', '/admin/tb/accounts', 'Create manual TB account', ['ACCOUNTING_CONFIG_WRITE']),
  route('GET', '/admin/tb/transfers', 'List TB transfer evidence', ['ACCOUNTING_CONFIG_READ']),
  route('GET', '/admin/tb/transfers/:tbTransferId', 'Get TB transfer evidence detail', ['ACCOUNTING_CONFIG_READ']),

  // Assets
  route('POST', '/assets', 'Create asset', ['ASSET_CONFIG_WRITE']),
  route('GET', '/assets', 'List assets', ['ASSET_CONFIG_READ']),
  route('GET', '/assets/:id', 'Get asset detail', ['ASSET_CONFIG_READ']),
  route('PATCH', '/assets/:id/status', 'Update asset status', ['ASSET_CONFIG_WRITE']),
  route('POST', '/admin/assets/listing', 'Submit asset listing request', ['ASSET_CONFIG_WRITE']),
  route('PATCH', '/admin/assets/:assetNo', 'Update asset metadata', ['ASSET_CONFIG_WRITE']),
  route('POST', '/admin/assets/:assetNo/activate', 'Activate asset', ['ASSET_CONFIG_WRITE']),
  route('POST', '/admin/assets/:assetNo/suspend', 'Suspend asset', ['ASSET_CONFIG_WRITE']),
  route('POST', '/admin/assets/:assetNo/reactivate', 'Reactivate asset', ['ASSET_CONFIG_WRITE']),

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
  route('GET', '/admin/audit-logs', 'List audit logs', ['AUDIT_READ']),
  route('GET', '/admin/audit-logs/:id', 'Get audit log detail', ['AUDIT_READ']),
  route('POST', '/admin/audit/evidence-packages', 'Export audit evidence package', [
    'AUDIT_EXPORT_CREATE',
  ]),
  route('GET', '/admin/audit/evidence-packages', 'List evidence package exports', [
    'AUDIT_EXPORT_READ',
  ]),
  route('GET', '/admin/audit/evidence-packages/:id', 'Get evidence package detail', [
    'AUDIT_EXPORT_READ',
  ]),
  route('GET', '/admin/audit/evidence-packages/:id/download', 'Download evidence package content', [
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

  // Transaction Limit Policies
  route('GET', '/admin/transaction-limit-policies', 'List transaction limit policies', [
    'TRANSACTION_LIMIT_READ',
  ]),
  route('GET', '/admin/transaction-limit-policies/:policyNo', 'Get transaction limit policy detail', [
    'TRANSACTION_LIMIT_READ',
  ]),
  route('POST', '/admin/transaction-limit-policies', 'Create transaction limit policy', [
    'TRANSACTION_LIMIT_WRITE',
  ]),
  route('POST', '/admin/transaction-limit-policies/:policyNo/change', 'Submit transaction limit change request', [
    'TRANSACTION_LIMIT_WRITE',
  ]),

  // Withdrawal Addresses
  route('GET', '/admin/withdrawal-addresses', 'List withdrawal addresses', [
    'WITHDRAWAL_ADDRESS_READ',
  ]),
  route('GET', '/admin/withdrawal-addresses/:addressNo', 'Get withdrawal address detail', [
    'WITHDRAWAL_ADDRESS_READ',
  ]),
  route('POST', '/admin/withdrawal-addresses/:addressNo/suspend', 'Suspend withdrawal address', [
    'WITHDRAWAL_ADDRESS_WRITE',
  ]),
  route('POST', '/admin/withdrawal-addresses/:addressNo/skip-cooling', 'Skip withdrawal address cooling period', [
    'WITHDRAWAL_ADDRESS_WRITE',
  ]),

  // Withdrawal Fee Levels
  route('GET', '/admin/withdrawal-fee-levels', 'List withdrawal fee levels', [
    'WITHDRAWAL_FEE_LEVEL_READ',
  ]),
  route('GET', '/admin/withdrawal-fee-levels/:levelCode', 'Get withdrawal fee level detail', [
    'WITHDRAWAL_FEE_LEVEL_READ',
  ]),
  route('POST', '/admin/withdrawal-fee-levels', 'Create withdrawal fee level', [
    'WITHDRAWAL_FEE_LEVEL_WRITE',
  ]),
  route('POST', '/admin/withdrawal-fee-levels/:levelCode/change', 'Submit withdrawal fee level change request', [
    'WITHDRAWAL_FEE_LEVEL_WRITE',
  ]),
  route('GET', '/admin/withdrawal-fee-levels/:levelCode/bindings', 'List withdrawal fee level bindings', [
    'WITHDRAWAL_FEE_LEVEL_READ',
  ]),
  route('POST', '/admin/withdrawal-fee-levels/bindings', 'Bind customer to withdrawal fee level', [
    'WITHDRAWAL_FEE_LEVEL_WRITE',
  ]),
  route('DELETE', '/admin/withdrawal-fee-levels/bindings', 'Unbind customer from withdrawal fee level', [
    'WITHDRAWAL_FEE_LEVEL_WRITE',
  ]),

  // Swap Fee Levels
  route('GET', '/admin/swap-fee-levels', 'List swap fee levels', [
    'SWAP_FEE_LEVEL_READ',
  ]),
  route('GET', '/admin/swap-fee-levels/:levelCode', 'Get swap fee level detail', [
    'SWAP_FEE_LEVEL_READ',
  ]),
  route('POST', '/admin/swap-fee-levels', 'Create swap fee level', [
    'SWAP_FEE_LEVEL_WRITE',
  ]),
  route('POST', '/admin/swap-fee-levels/:levelCode/change', 'Submit swap fee level change request', [
    'SWAP_FEE_LEVEL_WRITE',
  ]),
  route('GET', '/admin/swap-fee-levels/:levelCode/bindings', 'List swap fee level bindings', [
    'SWAP_FEE_LEVEL_READ',
  ]),
  route('POST', '/admin/swap-fee-levels/bindings', 'Bind customer to swap fee level', [
    'SWAP_FEE_LEVEL_WRITE',
  ]),
  route('DELETE', '/admin/swap-fee-levels/bindings', 'Unbind customer from swap fee level', [
    'SWAP_FEE_LEVEL_WRITE',
  ]),

  // Withdrawal Quote Admin
  route('GET', '/admin/withdrawal-fee-levels/quotes', 'List withdrawal quotes', [
    'WITHDRAWAL_FEE_LEVEL_READ',
  ]),
  route('GET', '/admin/withdrawal-fee-levels/quotes/:id', 'Get withdrawal quote detail', [
    'WITHDRAWAL_FEE_LEVEL_READ',
  ]),

  // Funds Layer (V7)
  route('GET', '/admin/funds-layer/transfers', 'List internal transfers', ['INTERNAL_TRANSFER_READ']),
  route('GET', '/admin/funds-layer/transfers/:internalTxNo', 'Get internal transfer detail', ['INTERNAL_TRANSFER_READ']),
  route('POST', '/admin/funds-layer/transfers/:internalTxNo/simulate', 'Simulate funds flow step (DEV)', ['INTERNAL_TRANSFER_WRITE']),
  route('POST', '/admin/funds-layer/fund-return', 'Trigger FUND_RETURN repair', ['INTERNAL_TRANSFER_WRITE']),
  route('GET', '/admin/funds-layer/settlements', 'List settlement batches', ['SETTLEMENT_READ']),
  route('GET', '/admin/funds-layer/settlements/:batchNo', 'Get settlement batch detail', ['SETTLEMENT_READ']),
  route('POST', '/admin/funds-layer/settlements/run', 'Trigger EOD settlement run (DEV)', ['SETTLEMENT_WRITE']),
  route('POST', '/admin/funds-layer/settlements/settle', 'Trigger manual crypto settlement', ['SETTLEMENT_WRITE']),
  route('GET', '/admin/funds-layer/funds', 'List funds flows', ['INTERNAL_FUND_READ']),
  route('GET', '/admin/funds-layer/funds/:internalFundNo', 'Get funds flow detail', ['INTERNAL_FUND_READ']),

];

/* ═══════════════════════════════════════════════════════════════
   Action Bucket Catalog
   User-facing capability abstraction. Each "bucket" represents
   a functional capability users can understand (e.g. "View members & roles")
   mapped to one or more PermissionGroups.
   ═══════════════════════════════════════════════════════════════ */

export interface ActionBucket {
  key: string;
  label: string;
  description: string;
  groups: PermissionGroup[];
  forcedOn?: boolean;
  restricted?: boolean;
}

export interface ActionDomain {
  id: string;
  label: string;
  icon: string;
  buckets: ActionBucket[];
}

export const ACTION_BUCKET_CATALOG: ActionDomain[] = [
  // ─── Domain 0: Auth (forced on, non-toggleable) ─────
  {
    id: 'auth',
    label: 'Auth',
    icon: '🔑',
    buckets: [
      {
        key: 'auth.base_access',
        label: 'Base Access',
        description: 'Basic session access — required for all admin users to log in and use the platform',
        groups: ['BASE_ACCESS'],
        forcedOn: true,
      },
    ],
  },
  // ─── Domain 1: Identity & Access ─────────────────────
  {
    id: 'iam',
    label: 'Identity & Access',
    icon: '🔐',
    buckets: [
      {
        key: 'iam.view_members',
        label: 'View members',
        description: 'Browse member list, view member detail and role bindings',
        groups: ['IAM_MEMBER_READ'],
      },
      {
        key: 'iam.view_roles',
        label: 'View roles & catalog',
        description: 'Browse role catalog, permissions, action buckets, role change requests',
        groups: ['IAM_ROLE_READ'],
      },
      {
        key: 'iam.manage_members',
        label: 'Manage members',
        description: 'Invite members, resend invitations, suspend and reactivate accounts',
        groups: ['IAM_MEMBER_MANAGE'],
      },
      {
        key: 'iam.assign_roles',
        label: 'Assign roles',
        description: 'Change user role bindings, create role change requests',
        groups: ['IAM_ROLE_ASSIGN'],
      },
      {
        key: 'iam.manage_credentials',
        label: 'Manage credentials',
        description: 'Reset password, reset MFA',
        groups: ['IAM_CREDENTIAL_RESET'],
      },
      {
        key: 'iam.define_roles',
        label: 'Manage role definitions',
        description: 'Propose new role definitions or modify existing ones for approval',
        groups: ['IAM_ROLE_DEFINE'],
      },
    ],
  },
  // ─── Domain 2: Approval Center ───────────────────────
  {
    id: 'gov_approvals',
    label: 'Approval Center',
    icon: '🚦',
    buckets: [
      {
        key: 'gov_approvals.view',
        label: 'View approvals',
        description: 'Browse approval list, view approval detail and history',
        groups: ['GOV_APPROVAL_READ'],
      },
      {
        key: 'gov_approval_policies.view',
        label: 'View approval policies',
        description: 'Browse approval policy configurations',
        groups: ['GOV_APPROVAL_POLICY_READ'],
      },
      {
        key: 'gov_approval_policies.manage',
        label: 'Manage approval policies',
        description: 'Submit approval policy change requests — CISO only',
        groups: ['GOV_APPROVAL_POLICY_WRITE'],
        restricted: true,
      },
    ],
  },
  // ─── Domain 3: Audit Center ──────────────────────────
  {
    id: 'audit',
    label: 'Audit Center',
    icon: '📁',
    buckets: [
      {
        key: 'audit.view',
        label: 'View audit logs',
        description: 'Browse audit log events, filter, view detail',
        groups: ['AUDIT_READ'],
      },
      {
        key: 'audit.view_exports',
        label: 'View evidence packages',
        description: 'Browse and download audit evidence packages',
        groups: ['AUDIT_EXPORT_READ'],
      },
      {
        key: 'audit.create_exports',
        label: 'Create evidence packages',
        description: 'Create new audit evidence export packages',
        groups: ['AUDIT_EXPORT_CREATE'],
      },
    ],
  },
  // ─── Placeholder Domains (no buckets yet) ────────────
  { id: 'customer', label: 'Customer Management', icon: '👥', buckets: [] },
  { id: 'compliance', label: 'Compliance', icon: '🛡️', buckets: [] },
  { id: 'trading', label: 'Trading', icon: '📊', buckets: [] },
  {
    id: 'accounting',
    label: 'Accounting',
    icon: '📒',
    buckets: [
      {
        key: 'accounting.view_tb',
        label: 'View TB records',
        description: 'Browse TigerBeetle account registry and transfer evidence',
        groups: ['ACCOUNTING_CONFIG_READ'],
      },
      {
        key: 'accounting.manage_tb',
        label: 'Create TB accounts',
        description: 'Manually create TigerBeetle accounts for operational needs',
        groups: ['ACCOUNTING_CONFIG_WRITE'],
      },
    ],
  },
  {
    id: 'treasury',
    label: 'Treasury',
    icon: '📦',
    buckets: [
      {
        key: 'treasury.view_assets',
        label: 'View assets',
        description: 'Browse asset list and asset detail',
        groups: ['ASSET_CONFIG_READ'],
      },
      {
        key: 'treasury.manage_assets',
        label: 'Manage asset lifecycle',
        description: 'Submit asset listing, update metadata, activate, suspend, or reactivate assets',
        groups: ['ASSET_CONFIG_WRITE'],
      },
      {
        key: 'treasury.view_wallets',
        label: 'View wallets',
        description: 'Browse wallet list, wallet detail, and balance queries',
        groups: ['WALLET_READ'],
      },
      {
        key: 'treasury.manage_wallets',
        label: 'Manage wallets',
        description: 'Create custodian wallets, retry failed creations, update wallet status',
        groups: ['WALLET_WRITE'],
      },
      {
        key: 'treasury.view_addresses',
        label: 'View withdrawal addresses',
        description: 'Browse withdrawal address list and detail',
        groups: ['WITHDRAWAL_ADDRESS_READ'],
      },
      {
        key: 'treasury.manage_addresses',
        label: 'Manage withdrawal addresses',
        description: 'Suspend withdrawal addresses, skip cooling period',
        groups: ['WITHDRAWAL_ADDRESS_WRITE'],
      },
      {
        key: 'treasury.view_limits',
        label: 'View transaction limits',
        description: 'Browse transaction limit policy list and detail',
        groups: ['TRANSACTION_LIMIT_READ'],
      },
      {
        key: 'treasury.manage_limits',
        label: 'Manage transaction limits',
        description: 'Create transaction limit policies, submit limit change requests',
        groups: ['TRANSACTION_LIMIT_WRITE'],
      },
    ],
  },
  { id: 'recon', label: 'Reconciliation', icon: '🔍', buckets: [] },
  { id: 'pricing', label: 'Pricing', icon: '💰', buckets: [] },
  { id: 'config', label: 'Configuration', icon: '⚙️', buckets: [] },
  { id: 'gov_registry', label: 'Governance Registries', icon: '🏛️', buckets: [] },
  { id: 'counterparty', label: 'Counterparty', icon: '🤝', buckets: [] },
  { id: 'clearing', label: 'Clearing', icon: '📋', buckets: [] },
];

/**
 * Build a map from permission code → PermissionGroup[].
 * Used by the frontend to derive which groups a role holds
 * from its list of individual permission codes.
 */
export function buildPermCodeToGroups(): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const perm of RBAC_PERMISSION_DEFINITIONS) {
    map[perm.code] = [...perm.groups];
  }
  return map;
}

export const RBAC_ROLE_GROUP_BINDINGS: Record<string, PermissionGroup[]> = {
  SUPER_ADMIN: [],
  SENIOR_MANAGEMENT_OFFICER: [
    'BASE_ACCESS',
    'IAM_READ',
    'AUDIT_READ',
    'RISK_DECISION_RECORD_READ',
    'GOV_APPROVAL_READ',
    'GOV_APPROVAL_DECIDE',
    'GOV_REGISTRY_READ',
    'GOV_REGULATORY_GATE_READ',
    'GOV_APPROVAL_POLICY_READ',
    'TRANSACTION_LIMIT_READ',
    'ASSET_CONFIG_READ',
    'WALLET_READ',
    'ACCOUNTING_CONFIG_READ',
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
    'GOV_APPROVAL_READ',
    'GOV_APPROVAL_DECIDE',
    'GOV_REGISTRY_READ',
    'GOV_REGISTRY_WRITE',
    'GOV_REGULATORY_GATE_READ',
    'GOV_REGULATORY_GATE_WRITE',
    'GOV_APPROVAL_POLICY_READ',
    'GOV_APPROVAL_POLICY_WRITE',
    'TRANSACTION_LIMIT_READ',
    'TRANSACTION_LIMIT_WRITE',
    'ASSET_CONFIG_READ',
    'ASSET_CONFIG_WRITE',
    'ACCOUNTING_CONFIG_READ',
    'ACCOUNTING_CONFIG_WRITE',
    'WALLET_READ',
    'WALLET_WRITE',
    'WITHDRAWAL_ADDRESS_READ',
    'WITHDRAWAL_ADDRESS_WRITE',
  ],
  OPS_OFFICER: [
    'BASE_ACCESS',
    'IAM_READ',
    'AUDIT_READ',
    'GOV_APPROVAL_READ',
    'GOV_APPROVAL_DECIDE',
    'GOV_REGISTRY_READ',
    'GOV_REGULATORY_GATE_READ',
    'ASSET_CONFIG_READ',
    'WALLET_READ',
    'WALLET_WRITE',
    'ACCOUNTING_CONFIG_READ',
    'TRANSACTION_LIMIT_READ',
    'TRANSACTION_LIMIT_WRITE',
    'WITHDRAWAL_FEE_LEVEL_READ',
    'WITHDRAWAL_FEE_LEVEL_WRITE',
    'SWAP_FEE_LEVEL_READ',
    'SWAP_FEE_LEVEL_WRITE',
    'WITHDRAWAL_ADDRESS_READ',
  ],
  COMPLIANCE_OFFICER: [
    'BASE_ACCESS',
    'IAM_READ',
    'AUDIT_READ',
    'AUDIT_EXPORT_CREATE',
    'AUDIT_EXPORT_READ',
    'RISK_DECISION_RECORD_READ',
    'RISK_DECISION_RECORD_WRITE',
    'GOV_APPROVAL_READ',
    'GOV_APPROVAL_WRITE',
    'GOV_REGISTRY_READ',
    'GOV_REGISTRY_WRITE',
    'GOV_REGULATORY_GATE_READ',
    'GOV_REGULATORY_GATE_WRITE',
    'GOV_APPROVAL_POLICY_READ',
    'GOV_APPROVAL_POLICY_WRITE',
    'TRANSACTION_LIMIT_READ',
    'TRANSACTION_LIMIT_WRITE',
    'ASSET_CONFIG_READ',
    'WALLET_READ',
    'WITHDRAWAL_ADDRESS_READ',
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
    'GOV_APPROVAL_READ',
    'GOV_APPROVAL_WRITE',
    'GOV_APPROVAL_DECIDE',
    'GOV_REGISTRY_READ',
    'GOV_APPROVAL_POLICY_READ',
    'TRANSACTION_LIMIT_READ',
    'TRANSACTION_LIMIT_WRITE',

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
    'GOV_APPROVAL_READ',
    'GOV_APPROVAL_DECIDE',
    'GOV_REGISTRY_READ',
    'GOV_REGISTRY_WRITE',
    'GOV_REGULATORY_GATE_READ',
    'GOV_REGULATORY_GATE_WRITE',
    'GOV_APPROVAL_POLICY_READ',
    'GOV_APPROVAL_POLICY_WRITE',
    'TRANSACTION_LIMIT_READ',

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
