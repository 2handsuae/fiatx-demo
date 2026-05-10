export type CustomerOnboardingStatus =
  | 'NONE'
  | 'PENDING_VERIFICATION'
  | 'FINAL_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'WITHDRAWN';

export type CustomerAdminStatus = 'INACTIVE' | 'ACTIVE' | 'SUSPENDED' | 'OFFBOARDED';
export type CustomerComplianceStatus = 'CLEAR' | 'FROZEN';
export type CustomerNextStepActionType =
  | 'START_VERIFICATION'
  | 'CONTINUE_VERIFICATION'
  | 'WAIT_VERIFICATION'
  | 'WAIT_FINAL_APPROVAL'
  | 'REINITIATE_VERIFICATION'
  | 'NONE';
export type CustomerReviewStage = 'REVIEW_CDD' | 'REVIEW_EDD';

export interface CustomerCanonicalState {
  onboardingStatus: CustomerOnboardingStatus;
  adminStatus: CustomerAdminStatus;
  complianceStatus: CustomerComplianceStatus;
}

export interface CustomerStatusSource {
  onboardingStatus?: string | null;
  adminStatus?: string | null;
  complianceStatus?: string | null;
  verificationSubstatus?: string | null;
  verificationCustomerActionRequired?: boolean | null;
  verificationCanContinue?: boolean | null;
  eddRequired?: boolean | null;
  cddDocumentExpiresAt?: Date | string | null;
}

const CANONICAL_ONBOARDING_STATUSES: CustomerOnboardingStatus[] = [
  'NONE',
  'PENDING_VERIFICATION',
  'FINAL_APPROVAL',
  'APPROVED',
  'REJECTED',
  'WITHDRAWN',
];

const CUSTOMER_ADMIN_STATUSES: CustomerAdminStatus[] = ['INACTIVE', 'ACTIVE', 'SUSPENDED', 'OFFBOARDED'];
const CUSTOMER_COMPLIANCE_STATUSES: CustomerComplianceStatus[] = ['CLEAR', 'FROZEN'];
const LEGACY_PENDING_ONBOARDING_STATUSES = new Set([
  'PENDING_CDD_INPUT',
  'CDD_UNDER_REVIEW',
  'PENDING_EDD_INPUT',
  'EDD_UNDER_REVIEW',
]);

function normalizeRawOnboardingStatus(value?: string | null): string {
  return String(value || '').trim().toUpperCase();
}

function isLegacyPendingOnboardingStatus(value: string): boolean {
  return LEGACY_PENDING_ONBOARDING_STATUSES.has(value);
}

export function normalizeCustomerOnboardingStatus(
  value?: string | null,
): CustomerOnboardingStatus | null {
  const current = normalizeRawOnboardingStatus(value);
  if (CANONICAL_ONBOARDING_STATUSES.includes(current as CustomerOnboardingStatus)) {
    return current as CustomerOnboardingStatus;
  }
  if (isLegacyPendingOnboardingStatus(current)) {
    return 'PENDING_VERIFICATION';
  }
  return null;
}

export function normalizeCustomerAdminStatus(
  value?: string | null,
): CustomerAdminStatus | null {
  const current = String(value || '').trim().toUpperCase();
  if (CUSTOMER_ADMIN_STATUSES.includes(current as CustomerAdminStatus)) {
    return current as CustomerAdminStatus;
  }
  return null;
}

export function normalizeCustomerComplianceStatus(
  value?: string | null,
): CustomerComplianceStatus {
  const current = String(value || '').trim().toUpperCase();
  if (CUSTOMER_COMPLIANCE_STATUSES.includes(current as CustomerComplianceStatus)) {
    return current as CustomerComplianceStatus;
  }
  return 'CLEAR';
}

export function resolveCustomerCanonicalState(
  source: CustomerStatusSource,
): CustomerCanonicalState {
  const onboardingStatus = normalizeCustomerOnboardingStatus(source.onboardingStatus) ?? 'NONE';
  const adminStatus =
    normalizeCustomerAdminStatus(source.adminStatus) ??
    (onboardingStatus === 'APPROVED' ? 'ACTIVE' : 'INACTIVE');
  const complianceStatus = normalizeCustomerComplianceStatus(source.complianceStatus);

  return {
    onboardingStatus,
    adminStatus,
    complianceStatus,
  };
}

function isExpiredCdd(source: CustomerStatusSource): boolean {
  if (!source.cddDocumentExpiresAt) {
    return false;
  }

  const expiresAt =
    source.cddDocumentExpiresAt instanceof Date
      ? source.cddDocumentExpiresAt
      : new Date(source.cddDocumentExpiresAt);

  return !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() <= Date.now();
}

export function buildCustomerLifecyclePatch(
  source: CustomerStatusSource,
  next: {
    onboardingStatus: CustomerOnboardingStatus;
    adminStatus?: CustomerAdminStatus;
    complianceStatus?: CustomerComplianceStatus;
    eddRequired?: boolean;
  },
): CustomerCanonicalState & {
  eddRequired: boolean;
} {
  const current = resolveCustomerCanonicalState(source);
  const resolved: CustomerCanonicalState = {
    onboardingStatus: next.onboardingStatus,
    adminStatus: next.adminStatus || current.adminStatus,
    complianceStatus: next.complianceStatus || current.complianceStatus,
  };
  const eddRequired = next.eddRequired ?? Boolean(source.eddRequired);

  return {
    ...resolved,
    eddRequired,
  };
}

export function getCustomerNextStepActionTypes(
  source: CustomerStatusSource,
): CustomerNextStepActionType[] {
  const rawOnboardingStatus = normalizeRawOnboardingStatus(source.onboardingStatus);

  if (rawOnboardingStatus === 'PENDING_CDD_INPUT') {
    return ['COMPLETE_CDD' as unknown as CustomerNextStepActionType];
  }
  if (rawOnboardingStatus === 'CDD_UNDER_REVIEW' || rawOnboardingStatus === 'EDD_UNDER_REVIEW') {
    return ['WAIT_REVIEW' as unknown as CustomerNextStepActionType];
  }
  if (rawOnboardingStatus === 'PENDING_EDD_INPUT') {
    return ['COMPLETE_EDD' as unknown as CustomerNextStepActionType];
  }

  const canonical = resolveCustomerCanonicalState(source);

  switch (canonical.onboardingStatus) {
    case 'NONE':
      return ['START_VERIFICATION'];
    case 'PENDING_VERIFICATION':
      return source.verificationCanContinue ? ['CONTINUE_VERIFICATION'] : ['WAIT_VERIFICATION'];
    case 'FINAL_APPROVAL':
      return ['WAIT_FINAL_APPROVAL'];
    case 'APPROVED':
      return ['NONE'];
    case 'REJECTED':
    case 'WITHDRAWN':
      return ['REINITIATE_VERIFICATION'];
    default:
      return ['START_VERIFICATION'];
  }
}

export function getCustomerBlockedReason(source: CustomerStatusSource): string | null {
  const rawOnboardingStatus = normalizeRawOnboardingStatus(source.onboardingStatus);
  const canonical = resolveCustomerCanonicalState(source);

  if (rawOnboardingStatus === 'CDD_UNDER_REVIEW') {
    return 'CDD evidence received and waiting compliance handling.';
  }
  if (rawOnboardingStatus === 'EDD_UNDER_REVIEW') {
    return 'EDD evidence received and waiting compliance handling.';
  }

  switch (canonical.onboardingStatus) {
    case 'FINAL_APPROVAL':
      return 'Waiting final onboarding decision.';
    case 'REJECTED':
      return 'Onboarding is rejected. Re-initiate required.';
    case 'WITHDRAWN':
      return 'Onboarding is withdrawn.';
    case 'APPROVED':
      return canonical.adminStatus === 'ACTIVE' ? 'Onboarding completed.' : null;
    default:
      return null;
  }
}

export function canStartCdd(source: CustomerStatusSource): boolean {
  const rawOnboardingStatus = normalizeRawOnboardingStatus(source.onboardingStatus);

  if (rawOnboardingStatus === 'CDD_UNDER_REVIEW' || rawOnboardingStatus === 'EDD_UNDER_REVIEW') {
    return false;
  }
  if (rawOnboardingStatus === 'FINAL_APPROVAL' || rawOnboardingStatus === 'APPROVED') {
    return false;
  }
  if (rawOnboardingStatus === 'PENDING_VERIFICATION') {
    return false;
  }

  return (
    rawOnboardingStatus === 'NONE' ||
    rawOnboardingStatus === 'PENDING_CDD_INPUT' ||
    rawOnboardingStatus === 'PENDING_EDD_INPUT' ||
    rawOnboardingStatus === ''
  );
}

export function canReinitiateCdd(source: CustomerStatusSource): boolean {
  const rawOnboardingStatus = normalizeRawOnboardingStatus(source.onboardingStatus);
  const canonical = resolveCustomerCanonicalState(source);

  return (
    rawOnboardingStatus === 'REJECTED' ||
    rawOnboardingStatus === 'WITHDRAWN' ||
    canonical.onboardingStatus === 'REJECTED' ||
    canonical.onboardingStatus === 'WITHDRAWN' ||
    isExpiredCdd(source)
  );
}

export function canStartEdd(source: CustomerStatusSource): boolean {
  const rawOnboardingStatus = normalizeRawOnboardingStatus(source.onboardingStatus);

  return rawOnboardingStatus === 'PENDING_EDD_INPUT';
}

export function canReinitiateEdd(source: CustomerStatusSource): boolean {
  const rawOnboardingStatus = normalizeRawOnboardingStatus(source.onboardingStatus);

  return Boolean(source.eddRequired) && (rawOnboardingStatus === 'PENDING_EDD_INPUT' || rawOnboardingStatus === 'EDD_UNDER_REVIEW');
}

export function getExpectedReviewStageFromCustomerState(
  source: CustomerStatusSource,
): CustomerReviewStage | null {
  const rawOnboardingStatus = normalizeRawOnboardingStatus(source.onboardingStatus);

  if (rawOnboardingStatus === 'CDD_UNDER_REVIEW') {
    return 'REVIEW_CDD';
  }
  if (rawOnboardingStatus === 'EDD_UNDER_REVIEW') {
    return 'REVIEW_EDD';
  }

  return null;
}

export function canFinalReview(source: CustomerStatusSource): boolean {
  return resolveCustomerCanonicalState(source).onboardingStatus === 'FINAL_APPROVAL';
}

export function isCustomerApprovedAndActive(source: CustomerStatusSource): boolean {
  const canonical = resolveCustomerCanonicalState(source);

  return canonical.onboardingStatus === 'APPROVED' && canonical.adminStatus === 'ACTIVE';
}
