export type CustomerPublicStatus =
  | 'NONE'
  | 'PENDING_CDD'
  | 'REVIEW_CDD'
  | 'PENDING_EDD'
  | 'REVIEW_EDD'
  | 'FINAL_APPROVAL'
  | 'ACTIVE'
  | 'REJECTED'
  | 'WITHDRAWN';

export type CustomerOnboardingStatus =
  | 'NONE'
  | 'PENDING_CDD_INPUT'
  | 'CDD_UNDER_REVIEW'
  | 'PENDING_EDD_INPUT'
  | 'EDD_UNDER_REVIEW'
  | 'FINAL_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'WITHDRAWN';

export type CustomerOperatingStatus = 'INACTIVE' | 'ACTIVE';
export type CustomerRestrictionStatus = 'CLEAR' | 'RESTRICTED';
export type CustomerNextStepActionType =
  | 'START_CDD'
  | 'CREATE_CDD_SESSION'
  | 'COMPLETE_CDD'
  | 'START_EDD'
  | 'CREATE_EDD_SESSION'
  | 'COMPLETE_EDD'
  | 'WAIT_REVIEW'
  | 'WAIT_FINAL_APPROVAL'
  | 'REINITIATE_CDD'
  | 'NONE';
export type CustomerReviewStage = 'REVIEW_CDD' | 'REVIEW_EDD';

export interface CustomerCanonicalState {
  onboardingStatus: CustomerOnboardingStatus;
  operatingStatus: CustomerOperatingStatus;
  restrictionStatus: CustomerRestrictionStatus;
}

export interface CustomerStatusSource {
  onboardingStatus?: string | null;
  operatingStatus?: string | null;
  restrictionStatus?: string | null;
  eddRequired?: boolean | null;
  cddDocumentExpiresAt?: Date | string | null;
}

const CANONICAL_ONBOARDING_STATUSES: CustomerOnboardingStatus[] = [
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

const CUSTOMER_OPERATING_STATUSES: CustomerOperatingStatus[] = ['INACTIVE', 'ACTIVE'];
const CUSTOMER_RESTRICTION_STATUSES: CustomerRestrictionStatus[] = ['CLEAR', 'RESTRICTED'];

export function normalizeCustomerOnboardingStatus(
  value?: string | null,
): CustomerOnboardingStatus | null {
  const current = String(value || '').trim().toUpperCase();
  if (CANONICAL_ONBOARDING_STATUSES.includes(current as CustomerOnboardingStatus)) {
    return current as CustomerOnboardingStatus;
  }
  return null;
}

export function normalizeCustomerOperatingStatus(
  value?: string | null,
): CustomerOperatingStatus | null {
  const current = String(value || '').trim().toUpperCase();
  if (CUSTOMER_OPERATING_STATUSES.includes(current as CustomerOperatingStatus)) {
    return current as CustomerOperatingStatus;
  }
  return null;
}

export function normalizeCustomerRestrictionStatus(
  value?: string | null,
): CustomerRestrictionStatus {
  const current = String(value || '').trim().toUpperCase();
  if (CUSTOMER_RESTRICTION_STATUSES.includes(current as CustomerRestrictionStatus)) {
    return current as CustomerRestrictionStatus;
  }
  return 'CLEAR';
}

export function getLegacyPublicStatusFromCanonical(
  value?: string | null,
): CustomerPublicStatus {
  switch (normalizeCustomerOnboardingStatus(value)) {
    case 'PENDING_CDD_INPUT':
      return 'PENDING_CDD';
    case 'CDD_UNDER_REVIEW':
      return 'REVIEW_CDD';
    case 'PENDING_EDD_INPUT':
      return 'PENDING_EDD';
    case 'EDD_UNDER_REVIEW':
      return 'REVIEW_EDD';
    case 'FINAL_APPROVAL':
      return 'FINAL_APPROVAL';
    case 'APPROVED':
      return 'ACTIVE';
    case 'REJECTED':
      return 'REJECTED';
    case 'WITHDRAWN':
      return 'WITHDRAWN';
    case 'NONE':
    default:
      return 'NONE';
  }
}

export function resolveCustomerCanonicalState(
  source: CustomerStatusSource,
): CustomerCanonicalState {
  const onboardingStatus = normalizeCustomerOnboardingStatus(source.onboardingStatus) ?? 'NONE';
  const operatingStatus =
    normalizeCustomerOperatingStatus(source.operatingStatus) ??
    (onboardingStatus === 'APPROVED' ? 'ACTIVE' : 'INACTIVE');
  const restrictionStatus = normalizeCustomerRestrictionStatus(source.restrictionStatus);

  return {
    onboardingStatus,
    operatingStatus,
    restrictionStatus,
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
    operatingStatus?: CustomerOperatingStatus;
    restrictionStatus?: CustomerRestrictionStatus;
    eddRequired?: boolean;
  },
): CustomerCanonicalState & {
  eddRequired: boolean;
} {
  const current = resolveCustomerCanonicalState(source);
  const resolved: CustomerCanonicalState = {
    onboardingStatus: next.onboardingStatus,
    operatingStatus: next.operatingStatus || current.operatingStatus,
    restrictionStatus: next.restrictionStatus || current.restrictionStatus,
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
  const canonical = resolveCustomerCanonicalState(source);

  switch (canonical.onboardingStatus) {
    case 'NONE':
      return ['START_CDD'];
    case 'PENDING_CDD_INPUT':
      return ['COMPLETE_CDD'];
    case 'CDD_UNDER_REVIEW':
    case 'EDD_UNDER_REVIEW':
      return ['WAIT_REVIEW'];
    case 'PENDING_EDD_INPUT':
      return ['COMPLETE_EDD'];
    case 'FINAL_APPROVAL':
      return ['WAIT_FINAL_APPROVAL'];
    case 'APPROVED':
      return ['NONE'];
    case 'REJECTED':
    case 'WITHDRAWN':
      return ['REINITIATE_CDD'];
    default:
      return ['START_CDD'];
  }
}

export function getCustomerBlockedReason(source: CustomerStatusSource): string | null {
  const canonical = resolveCustomerCanonicalState(source);

  switch (canonical.onboardingStatus) {
    case 'CDD_UNDER_REVIEW':
      return 'CDD evidence received and waiting compliance handling.';
    case 'EDD_UNDER_REVIEW':
      return 'EDD evidence received and waiting compliance handling.';
    case 'FINAL_APPROVAL':
      return 'Waiting final onboarding decision.';
    case 'REJECTED':
      return 'Onboarding is rejected. Re-initiate required.';
    case 'WITHDRAWN':
      return 'Onboarding is withdrawn.';
    case 'APPROVED':
      return canonical.operatingStatus === 'ACTIVE' ? 'Onboarding completed.' : null;
    default:
      return null;
  }
}

export function getExpectedReviewStageFromCustomerState(
  source: CustomerStatusSource,
): CustomerReviewStage | null {
  const canonical = resolveCustomerCanonicalState(source);

  if (canonical.onboardingStatus === 'CDD_UNDER_REVIEW') {
    return 'REVIEW_CDD';
  }
  if (canonical.onboardingStatus === 'EDD_UNDER_REVIEW') {
    return 'REVIEW_EDD';
  }
  return null;
}

export function canStartCdd(source: CustomerStatusSource): boolean {
  const canonical = resolveCustomerCanonicalState(source);

  return ![
    'CDD_UNDER_REVIEW',
    'EDD_UNDER_REVIEW',
    'FINAL_APPROVAL',
    'APPROVED',
  ].includes(canonical.onboardingStatus);
}

export function canReinitiateCdd(source: CustomerStatusSource): boolean {
  const canonical = resolveCustomerCanonicalState(source);

  return (
    canonical.onboardingStatus === 'REJECTED' ||
    canonical.onboardingStatus === 'WITHDRAWN' ||
    isExpiredCdd(source)
  );
}

export function canStartEdd(source: CustomerStatusSource): boolean {
  return resolveCustomerCanonicalState(source).onboardingStatus === 'PENDING_EDD_INPUT';
}

export function canReinitiateEdd(source: CustomerStatusSource): boolean {
  const canonical = resolveCustomerCanonicalState(source);

  return (
    Boolean(source.eddRequired) &&
    ['PENDING_EDD_INPUT', 'EDD_UNDER_REVIEW'].includes(canonical.onboardingStatus)
  );
}

export function canFinalReview(source: CustomerStatusSource): boolean {
  return resolveCustomerCanonicalState(source).onboardingStatus === 'FINAL_APPROVAL';
}

export function isCustomerApprovedAndActive(source: CustomerStatusSource): boolean {
  const canonical = resolveCustomerCanonicalState(source);

  return canonical.onboardingStatus === 'APPROVED' && canonical.operatingStatus === 'ACTIVE';
}
