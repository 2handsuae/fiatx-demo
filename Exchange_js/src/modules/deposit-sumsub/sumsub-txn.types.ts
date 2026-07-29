export type KytVerdict = 'approved' | 'rejected' | 'awaitUser' | 'onHold';

export interface SumsubTxnDetail {
  txnId: string;
  verdict: KytVerdict;                  // 从 review.reviewResult / scoringResult.action 归一
  reviewAnswer: 'GREEN' | 'RED' | null;
  riskScore: number | null;             // scoringResult.score(规则引擎风险分),缺省 null
  typedTags: { label: string; type: 'system' | 'userDefined' }[];
}

/**
 * 一笔 deposit 报给 Sumsub 的两笔 KYT 交易泳道。webhook 只带 kytTxnId,
 * 由 deposit 上的 sumsubFinanceTxnId / sumsubTravelRuleTxnId 反查落在哪条,
 * 决定裁决回写到 kytStatus 还是 travelRuleStatus。
 */
export type KytLane = 'FINANCE' | 'TRAVEL_RULE';
