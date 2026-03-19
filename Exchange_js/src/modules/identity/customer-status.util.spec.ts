import {
  buildCustomerLifecyclePatch,
  canFinalReview,
  canReinitiateCdd,
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

  it('should derive review stage from canonical onboarding state', () => {
    expect(
      getExpectedReviewStageFromCustomerState({
        onboardingStatus: 'CDD_UNDER_REVIEW',
      }),
    ).toBe('REVIEW_CDD');
  });

  it('should gate start CDD and start EDD by canonical onboarding state', () => {
    expect(
      canStartCdd({
        onboardingStatus: 'APPROVED',
        operatingStatus: 'ACTIVE',
      }),
    ).toBe(false);
    expect(
      canStartEdd({
        onboardingStatus: 'PENDING_EDD_INPUT',
      }),
    ).toBe(true);
  });

  it('should allow CDD reinitiation for expired CDD snapshot and final review only in FINAL_APPROVAL', () => {
    expect(
      canReinitiateCdd({
        onboardingStatus: 'PENDING_CDD_INPUT',
        cddDocumentExpiresAt: new Date(Date.now() - 60 * 1000),
      }),
    ).toBe(true);
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
  });
});
