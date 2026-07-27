export type KytVerdict = 'approved' | 'rejected' | 'awaitUser' | 'onHold';

export interface SumsubTxnDetail {
  txnId: string;
  verdict: KytVerdict;                  // 从 review.reviewResult / scoringResult.action 归一
  reviewAnswer: 'GREEN' | 'RED' | null;
  typedTags: { label: string; type: 'system' | 'userDefined' }[];
}
