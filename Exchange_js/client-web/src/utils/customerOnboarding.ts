export type CanonicalOnboardingStatus =
  | 'NONE'
  | 'PENDING_VERIFICATION'
  | 'FINAL_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'WITHDRAWN';

export type CanonicalAdminStatus = 'INACTIVE' | 'ACTIVE';

export interface CustomerLifecycleSnapshot {
  onboardingStatus?: string | null;
  adminStatus?: string | null;
}

const CANONICAL_ONBOARDING_STATUSES: CanonicalOnboardingStatus[] = [
  'NONE',
  'PENDING_VERIFICATION',
  'FINAL_APPROVAL',
  'APPROVED',
  'REJECTED',
  'WITHDRAWN',
];

const CANONICAL_ADMIN_STATUSES: CanonicalAdminStatus[] = ['INACTIVE', 'ACTIVE'];
export const normalizeCanonicalOnboardingStatus = (
  value?: string | null,
): CanonicalOnboardingStatus | null => {
  const current = String(value || '').trim().toUpperCase();
  if (CANONICAL_ONBOARDING_STATUSES.includes(current as CanonicalOnboardingStatus)) {
    return current as CanonicalOnboardingStatus;
  }
  return null;
};

export const normalizeCanonicalAdminStatus = (
  value?: string | null,
): CanonicalAdminStatus | null => {
  const current = String(value || '').trim().toUpperCase();
  if (CANONICAL_ADMIN_STATUSES.includes(current as CanonicalAdminStatus)) {
    return current as CanonicalAdminStatus;
  }
  return null;
};

export const isCustomerApprovedForAccess = (source: CustomerLifecycleSnapshot): boolean => {
  const onboardingStatus = normalizeCanonicalOnboardingStatus(source.onboardingStatus);
  const adminStatus = normalizeCanonicalAdminStatus(source.adminStatus);
  return onboardingStatus === 'APPROVED' && adminStatus === 'ACTIVE';
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
    'PENDING_VERIFICATION',
    'FINAL_APPROVAL',
  ].includes(onboardingStatus);
};
