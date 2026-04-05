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
  resolveCustomerCanonicalState,
} from './customer-status.util';

describe('customer-status.util', () => {
  it('should resolve canonical lifecycle state from canonical fields', () => {
    expect(
      resolveCustomerCanonicalState({
        onboardingStatus: 'APPROVED',
        operatingStatus: 'ACTIVE',
        restrictionStatus: 'CLEAR',
      }),
    ).toEqual({
      onboardingStatus: 'APPROVED',
      operatingStatus: 'ACTIVE',
      restrictionStatus: 'CLEAR',
    });
  });

  it('should recompute canonical lifecycle patch while preserving restriction state', () => {
    expect(
      buildCustomerLifecyclePatch(
        {
          onboardingStatus: 'APPROVED',
          operatingStatus: 'ACTIVE',
          restrictionStatus: 'RESTRICTED',
          eddRequired: true,
        },
        {
          onboardingStatus: 'REJECTED',
          operatingStatus: 'INACTIVE',
        },
      ),
    ).toEqual({
      onboardingStatus: 'REJECTED',
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'RESTRICTED',
      eddRequired: true,
    });
  });

  it('should derive FINAL_APPROVAL next-step action from canonical onboarding state', () => {
    expect(
      getCustomerNextStepActionTypes({
        onboardingStatus: 'FINAL_APPROVAL',
        operatingStatus: 'INACTIVE',
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
        operatingStatus: 'ACTIVE',
      }),
    ).toEqual(['NONE']);
  });

  it('should resolve unknown onboarding status to NONE and default operating state', () => {
    expect(
      resolveCustomerCanonicalState({
        onboardingStatus: 'legacy-value',
      }),
    ).toEqual({
      onboardingStatus: 'NONE',
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
    });
  });

  it('should map legacy raw onboarding states to pending verification and review stages', () => {
    expect(
      resolveCustomerCanonicalState({
        onboardingStatus: 'PENDING_CDD_INPUT',
      }),
    ).toEqual({
      onboardingStatus: 'PENDING_VERIFICATION',
      operatingStatus: 'INACTIVE',
      restrictionStatus: 'CLEAR',
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
        operatingStatus: 'ACTIVE',
      }),
    ).toBe(true);
    expect(
      getCustomerBlockedReason({
        onboardingStatus: 'APPROVED',
        operatingStatus: 'ACTIVE',
      }),
    ).toBe('Onboarding completed.');
    expect(
      getCustomerBlockedReason({
        onboardingStatus: 'REJECTED',
      }),
    ).toBe('Onboarding is rejected. Re-initiate required.');
  });
});
