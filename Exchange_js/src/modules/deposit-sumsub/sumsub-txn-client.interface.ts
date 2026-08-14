import { SumsubTxnDetail, KytVerdict } from './sumsub-txn.types';

export interface SubmitTxnInput {
  applicantId: string;
  clientTxnId: string;
  type: 'finance' | 'travelRule';
  direction: 'in' | 'out';
  amount: number;
  currencyCode: string;
  currencyType: 'fiat' | 'crypto';
  counterparty?: { fullName?: string; accountId?: string };
  orderId?: string; // 串多腿（兑换用 swapNo）
  props?: Record<string, string>; // 域判别器：{ txType: 'exchange' }
  infoType?: string; // info.type 分类串
}

/**
 * submitTxn 提交后 Sumsub 立即返回的规则评分快照(兑换域存作审计留痕;
 * 充值/提现走 webhook 拿终裁,不消费本字段)。
 */
export interface SumsubScoringResult {
  action: 'score' | 'onHold' | 'awaitUser' | 'reject';
  score?: number;
  matchedRuleNames: string[];
  applicantActions: { applicantActionId: string; externalActionId: string }[];
}

export const SUMSUB_TXN_CLIENT = Symbol('SUMSUB_TXN_CLIENT');

export interface SumsubTxnClient {
  submitTxn(input: SubmitTxnInput): Promise<{ txnId: string; scoringResult?: SumsubScoringResult }>;
  getTxn(txnId: string): Promise<SumsubTxnDetail>;
  rescore(txnId: string): Promise<void>;
  reviewComplete(txnId: string, answer: 'GREEN' | 'RED'): Promise<void>; // 冒烟/officer 模拟用
  // L3 Post-Tx Archive (Task 7): archives the real crossing txHash onto an
  // already-submitted KYT txn for on-chain tracing.
  archiveTxHash(txnId: string, txHash: string): Promise<void>;
}
