export type KytVerdict = 'approved' | 'rejected' | 'awaitUser' | 'onHold';

export interface SumsubTxnDetail {
  txnId: string;
  verdict: KytVerdict;                  // 从 review.reviewResult / scoringResult.action 归一
  reviewAnswer: 'GREEN' | 'RED' | null;
  riskScore: number | null;             // scoringResult.score(规则引擎风险分),缺省 null
  typedTags: { label: string; type: 'system' | 'userDefined' }[];
  /** scoringResult.applicantActions[] —— awaitUser 时 Sumsub 告诉我们要客户补什么 */
  applicantActions?: { applicantActionId: string; externalActionId: string }[];
  raw?: unknown;                        // getTxn 原始报文,存证用(乙口径落库)
}
