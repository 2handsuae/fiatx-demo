export type CanonicalOnboardingStatus =
  | 'NONE'
  | 'PENDING_CDD_INPUT'
  | 'CDD_UNDER_REVIEW'
  | 'PENDING_EDD_INPUT'
  | 'EDD_UNDER_REVIEW'
  | 'FINAL_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'WITHDRAWN';

export type CanonicalOperatingStatus = 'INACTIVE' | 'ACTIVE';

export interface CustomerLifecycleSnapshot {
  onboardingStatus?: string | null;
  operatingStatus?: string | null;
}

const CANONICAL_ONBOARDING_STATUSES: CanonicalOnboardingStatus[] = [
  'NONE',
  'PENDING_CDD_INPUT',
  'CDD_UNDER_REVIEW',
  'PENDING_EDD_INPUT',
  'EDD_UNDER_REVIEW',
  'FINAL_APPROVAL',
  'APPROVED',
  'REJECTED',
  'WITHDRAWN',
];

const CANONICAL_OPERATING_STATUSES: CanonicalOperatingStatus[] = ['INACTIVE', 'ACTIVE'];
export const normalizeCanonicalOnboardingStatus = (
  value?: string | null,
): CanonicalOnboardingStatus | null => {
  const current = String(value || '').trim().toUpperCase();
  if (CANONICAL_ONBOARDING_STATUSES.includes(current as CanonicalOnboardingStatus)) {
    return current as CanonicalOnboardingStatus;
  }
  return null;
};

export const normalizeCanonicalOperatingStatus = (
  value?: string | null,
): CanonicalOperatingStatus | null => {
  const current = String(value || '').trim().toUpperCase();
  if (CANONICAL_OPERATING_STATUSES.includes(current as CanonicalOperatingStatus)) {
    return current as CanonicalOperatingStatus;
  }
  return null;
};

export const isCustomerApprovedForAccess = (source: CustomerLifecycleSnapshot): boolean => {
  const onboardingStatus = normalizeCanonicalOnboardingStatus(source.onboardingStatus);
  const operatingStatus = normalizeCanonicalOperatingStatus(source.operatingStatus);
  return onboardingStatus === 'APPROVED' && operatingStatus === 'ACTIVE';
};

export const isCustomerRejected = (source: CustomerLifecycleSnapshot): boolean => {
  const onboardingStatus = normalizeCanonicalOnboardingStatus(source.onboardingStatus);
  return onboardingStatus === 'REJECTED';
};

export const isCustomerWithdrawn = (source: CustomerLifecycleSnapshot): boolean => {
  const onboardingStatus = normalizeCanonicalOnboardingStatus(source.onboardingStatus);
  return onboardingStatus === 'WITHDRAWN';
};

export const isCustomerFinalApprovalPending = (source: CustomerLifecycleSnapshot): boolean => {
  const onboardingStatus = normalizeCanonicalOnboardingStatus(source.onboardingStatus);
  return onboardingStatus === 'FINAL_APPROVAL';
};

export const isCustomerInProgress = (source: CustomerLifecycleSnapshot): boolean => {
  const onboardingStatus = normalizeCanonicalOnboardingStatus(source.onboardingStatus);
  if (!onboardingStatus) {
    return false;
  }

  return [
    'NONE',
    'PENDING_CDD_INPUT',
    'CDD_UNDER_REVIEW',
    'PENDING_EDD_INPUT',
    'EDD_UNDER_REVIEW',
    'FINAL_APPROVAL',
  ].includes(onboardingStatus);
};
