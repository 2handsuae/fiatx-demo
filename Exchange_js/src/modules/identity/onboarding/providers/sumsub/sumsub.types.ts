export type SumsubVerificationSubstatus =
  | 'NOT_STARTED'
  | 'CREATED'
  | 'SUBMITTED'
  | 'PROCESSING'
  | 'UNDER_REVIEW'
  | 'RESUBMIT_REQUIRED'
  | 'NEXT_LEVEL_REQUIRED'
  | 'CUSTOMER_ACTION_REQUIRED'
  | 'ACTION_UNDER_REVIEW'
  | 'COMPLETED'
  | 'FAILED';

export type SumsubReviewStatus =
  | 'init'
  | 'pending'
  | 'prechecked'
  | 'queued'
  | 'completed'
  | 'onHold'
  | 'awaitingService'
  | 'awaitingUser';

export interface SumsubCreateApplicantInput {
  externalUserId: string;
  levelName: string;
}

export interface SumsubCreateSdkTokenInput {
  externalUserId: string;
  levelName: string;
}

export interface SumsubApplicantResponse {
  id: string;
}

export interface SumsubSdkTokenResponse {
  token: string;
}

export interface SumsubApplicantReviewStatusResponse {
  reviewStatus: SumsubReviewStatus;
}
