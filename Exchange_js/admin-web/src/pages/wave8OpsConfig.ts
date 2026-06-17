export type TreasuryResourceType =
  | 'fee-occurrences'
  | 'reimbursement-obligations';

export type ReconciliationResourceType =
  | 'warnings'
  | 'runs'
  | 'fiat-statements';

export const TREASURY_RESOURCE_CONFIGS = {
  'fee-occurrences': {
    type: 'fee-occurrences',
    endpoint: '/admin/fee-occurrences',
    listPath: '/dashboard/treasury/fee-occurrences',
    detailPath: (id: string) => `/dashboard/treasury/fee-occurrences/${id}`,
    title: 'Treasury Center - Fee Occurrences',
    detailTitle: 'Fee Occurrence Detail',
    description:
      'Track platform-borne operational costs separately from customer-facing service fees.',
  },
  'reimbursement-obligations': {
    type: 'reimbursement-obligations',
    endpoint: '/admin/reimbursement-obligations',
    listPath: '/dashboard/treasury/reimbursement-obligations',
    detailPath: (id: string) =>
      `/dashboard/treasury/reimbursement-obligations/${id}`,
    title: 'Treasury Center - Reimbursement Obligations',
    detailTitle: 'Reimbursement Obligation Detail',
    description:
      'Review and close platform reimbursement obligations created when customer pool balances were touched.',
  },
} as const;

export const RECONCILIATION_RESOURCE_CONFIGS = {
  warnings: {
    type: 'warnings',
    endpoint: '/admin/reconciliation/safeguarding-warnings',
    listPath: '/admin/reconciliation/safeguarding-warnings',
    detailPath: (id: string) =>
      `/admin/reconciliation/safeguarding-warnings/${id}`,
    title: 'Reconciliation Center - Safeguarding Warnings',
    detailTitle: 'Safeguarding Warning Detail',
    description:
      'Track placement and threshold warnings that do not rise to a formal safeguarding break.',
  },
  runs: {
    type: 'runs',
    endpoint: '/admin/reconciliation/safeguarding-runs',
    listPath: '/admin/reconciliation/safeguarding-runs',
    detailPath: (id: string) =>
      `/admin/reconciliation/safeguarding-runs/${id}`,
    title: 'Reconciliation Center - Safeguarding Runs',
    detailTitle: 'Safeguarding Run Detail',
    description:
      'Inspect full safeguarding runs, their snapshots, and exported evidence packages.',
  },
  'fiat-statements': {
    type: 'fiat-statements',
    endpoint: '/admin/reconciliation/safeguarding-fiat-statements/imports',
    listPath: '/admin/reconciliation/safeguarding-fiat-statements',
    detailPath: (id: string) =>
      `/admin/reconciliation/safeguarding-fiat-statements/${id}`,
    title: 'Reconciliation Center - Fiat Statement Imports',
    detailTitle: 'Fiat Statement Import Detail',
    description:
      'Upload and inspect fiat statement imports used as Layer 3 evidence for safeguarding.',
  },
} as const;

export const getTreasuryResourceConfig = (type: TreasuryResourceType) =>
  TREASURY_RESOURCE_CONFIGS[type];

export const getReconciliationResourceConfig = (
  type: ReconciliationResourceType,
) => RECONCILIATION_RESOURCE_CONFIGS[type];
