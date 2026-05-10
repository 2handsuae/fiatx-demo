import {
  buildCustomerLifecyclePatch,
  canFinalReview,
  canReinitiateCdd,
  canReinitiateEdd,
  canStartCdd,
  canStartEdd,
  getCustomerBlockedReason,
  getCustomerNextStepActionTypes,
  getExpectedReviewStageFromCustomerState,
  isCustomerApprovedAndActive,
  normalizeCustomerAdminStatus,
  normalizeCustomerComplianceStatus,
  resolveCustomerCanonicalState,
} from './customer-status.util';

describe('customer-status.util', () => {
  it('should resolve canonical lifecycle state from canonical fields', () => {
    expect(
      resolveCustomerCanonicalState({
        onboardingStatus: 'APPROVED',
        adminStatus: 'ACTIVE',
        complianceStatus: 'CLEAR',
      }),
    ).toEqual({
      onboardingStatus: 'APPROVED',
      adminStatus: 'ACTIVE',
      complianceStatus: 'CLEAR',
    });
  });

  it('should recompute canonical lifecycle patch while preserving compliance state', () => {
    expect(
      buildCustomerLifecyclePatch(
        {
          onboardingStatus: 'APPROVED',
          adminStatus: 'ACTIVE',
          complianceStatus: 'FROZEN',
          eddRequired: true,
        },
        {
          onboardingStatus: 'REJECTED',
          adminStatus: 'INACTIVE',
        },
      ),
    ).toEqual({
      onboardingStatus: 'REJECTED',
      adminStatus: 'INACTIVE',
      complianceStatus: 'FROZEN',
      eddRequired: true,
    });
  });

  it('should derive FINAL_APPROVAL next-step action from canonical onboarding state', () => {
    expect(
      getCustomerNextStepActionTypes({
        onboardingStatus: 'FINAL_APPROVAL',
        adminStatus: 'INACTIVE',
      }),
    ).toEqual(['WAIT_FINAL_APPROVAL']);
  });

  it('returns REINITIATE_VERIFICATION for rejected and withdrawn customers', () => {
    expect(
      getCustomerNextStepActionTypes({
        onboardingStatus: 'REJECTED',
      }),
    ).toEqual(['REINITIATE_VERIFICATION']);

    expect(
      getCustomerNextStepActionTypes({
        onboardingStatus: 'WITHDRAWN',
      }),
    ).toEqual(['REINITIATE_VERIFICATION']);
  });

  it('returns CONTINUE_VERIFICATION while onboarding is pending and provider says customer can continue', () => {
    expect(
      getCustomerNextStepActionTypes({
        onboardingStatus: 'PENDING_VERIFICATION',
        verificationSubstatus: 'NEXT_LEVEL_REQUIRED',
        verificationCustomerActionRequired: true,
        verificationCanContinue: true,
      }),
    ).toEqual(['CONTINUE_VERIFICATION']);
  });

  it('returns WAIT_VERIFICATION while Sumsub is still processing without customer action', () => {
    expect(
      getCustomerNextStepActionTypes({
        onboardingStatus: 'PENDING_VERIFICATION',
        verificationSubstatus: 'UNDER_REVIEW',
        verificationCustomerActionRequired: false,
        verificationCanContinue: false,
      }),
    ).toEqual(['WAIT_VERIFICATION']);
  });

  it('keeps FINAL_APPROVAL and APPROVED behavior unchanged', () => {
    expect(
      getCustomerNextStepActionTypes({
        onboardingStatus: 'FINAL_APPROVAL',
      }),
    ).toEqual(['WAIT_FINAL_APPROVAL']);

    expect(
      getCustomerNextStepActionTypes({
        onboardingStatus: 'APPROVED',
        adminStatus: 'ACTIVE',
      }),
    ).toEqual(['NONE']);
  });

  it('should resolve unknown onboarding status to NONE and default admin state', () => {
    expect(
      resolveCustomerCanonicalState({
        onboardingStatus: 'legacy-value',
      }),
    ).toEqual({
      onboardingStatus: 'NONE',
      adminStatus: 'INACTIVE',
      complianceStatus: 'CLEAR',
    });
  });

  it('should map legacy raw onboarding states to pending verification and review stages', () => {
    expect(
      resolveCustomerCanonicalState({
        onboardingStatus: 'PENDING_CDD_INPUT',
      }),
    ).toEqual({
      onboardingStatus: 'PENDING_VERIFICATION',
      adminStatus: 'INACTIVE',
      complianceStatus: 'CLEAR',
    });

    expect(
      getExpectedReviewStageFromCustomerState({
        onboardingStatus: 'CDD_UNDER_REVIEW',
      }),
    ).toBe('REVIEW_CDD');
  });

  it('should keep legacy CDD and EDD helper entry points working for raw statuses', () => {
    expect(
      canStartCdd({
        onboardingStatus: 'PENDING_CDD_INPUT',
      }),
    ).toBe(true);
    expect(
      canReinitiateCdd({
        onboardingStatus: 'PENDING_CDD_INPUT',
        cddDocumentExpiresAt: new Date(Date.now() - 1000),
      }),
    ).toBe(true);
    expect(
      canStartEdd({
        onboardingStatus: 'PENDING_EDD_INPUT',
      }),
    ).toBe(true);
    expect(
      canReinitiateEdd({
        onboardingStatus: 'EDD_UNDER_REVIEW',
        eddRequired: true,
      }),
    ).toBe(true);
  });

  it('should allow final review only in FINAL_APPROVAL', () => {
    expect(
      canFinalReview({
        onboardingStatus: 'FINAL_APPROVAL',
      }),
    ).toBe(true);
  });

  it('should report approved-and-active completion from canonical state', () => {
    expect(
      isCustomerApprovedAndActive({
        onboardingStatus: 'APPROVED',
        adminStatus: 'ACTIVE',
      }),
    ).toBe(true);
    expect(
      getCustomerBlockedReason({
        onboardingStatus: 'APPROVED',
        adminStatus: 'ACTIVE',
      }),
    ).toBe('Onboarding completed.');
    expect(
      getCustomerBlockedReason({
        onboardingStatus: 'REJECTED',
      }),
    ).toBe('Onboarding is rejected. Re-initiate required.');
  });

  describe('normalizeCustomerAdminStatus', () => {
    it('should normalize valid admin statuses', () => {
      expect(normalizeCustomerAdminStatus('ACTIVE')).toBe('ACTIVE');
      expect(normalizeCustomerAdminStatus('INACTIVE')).toBe('INACTIVE');
      expect(normalizeCustomerAdminStatus('SUSPENDED')).toBe('SUSPENDED');
      expect(normalizeCustomerAdminStatus('OFFBOARDED')).toBe('OFFBOARDED');
    });

    it('should handle case-insensitive input', () => {
      expect(normalizeCustomerAdminStatus('active')).toBe('ACTIVE');
      expect(normalizeCustomerAdminStatus('suspended')).toBe('SUSPENDED');
      expect(normalizeCustomerAdminStatus('offboarded')).toBe('OFFBOARDED');
    });

    it('should return null for unknown values', () => {
      expect(normalizeCustomerAdminStatus('UNKNOWN')).toBeNull();
      expect(normalizeCustomerAdminStatus('')).toBeNull();
      expect(normalizeCustomerAdminStatus(null)).toBeNull();
      expect(normalizeCustomerAdminStatus(undefined)).toBeNull();
    });
  });

  describe('normalizeCustomerComplianceStatus', () => {
    it('should normalize valid compliance statuses', () => {
      expect(normalizeCustomerComplianceStatus('CLEAR')).toBe('CLEAR');
      expect(normalizeCustomerComplianceStatus('FROZEN')).toBe('FROZEN');
    });

    it('should handle case-insensitive input', () => {
      expect(normalizeCustomerComplianceStatus('clear')).toBe('CLEAR');
      expect(normalizeCustomerComplianceStatus('frozen')).toBe('FROZEN');
    });

    it('should default to CLEAR for unknown values', () => {
      expect(normalizeCustomerComplianceStatus('UNKNOWN')).toBe('CLEAR');
      expect(normalizeCustomerComplianceStatus('')).toBe('CLEAR');
      expect(normalizeCustomerComplianceStatus(null)).toBe('CLEAR');
      expect(normalizeCustomerComplianceStatus(undefined)).toBe('CLEAR');
    });
  });
});
