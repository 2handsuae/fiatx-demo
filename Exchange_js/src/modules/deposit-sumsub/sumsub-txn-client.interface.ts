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
}

export const SUMSUB_TXN_CLIENT = Symbol('SUMSUB_TXN_CLIENT');

export interface SumsubTxnClient {
  submitTxn(input: SubmitTxnInput): Promise<{ txnId: string }>;
  getTxn(txnId: string): Promise<SumsubTxnDetail>;
  rescore(txnId: string): Promise<void>;
  reviewComplete(txnId: string, answer: 'GREEN' | 'RED'): Promise<void>; // 冒烟/officer 模拟用
  // L3 Post-Tx Archive (Task 7): archives the real crossing txHash onto an
  // already-submitted KYT txn for on-chain tracing.
  archiveTxHash(txnId: string, txHash: string): Promise<void>;
}
