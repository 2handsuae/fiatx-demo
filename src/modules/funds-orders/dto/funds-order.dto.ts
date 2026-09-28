export enum FundsOrderStatus {
  CREATED = 'CREATED',
  SUBMITTED = 'SUBMITTED',
  CONFIRMING = 'CONFIRMING',
  CONFIRMED = 'CONFIRMED',
  CLEARED = 'CLEARED',
  FAILED = 'FAILED',
  TIMEOUT = 'TIMEOUT',
}

export enum FundsOrderAction {
  SUBMIT = 'SUBMIT',
  OBSERVE_CONFIRMING = 'OBSERVE_CONFIRMING',
  CONFIRM = 'CONFIRM',
  CLEAR = 'CLEAR',
  FAIL = 'FAIL',
  TIMEOUT = 'TIMEOUT',
}

export type FundsOrderDirection = 'IN' | 'OUT' | 'INTERNAL';
export type FundsOrderAssetType = 'CRYPTO' | 'FIAT';

export interface CreateFundsOrderInput {
  // 五者恰好一个非空
  depositTransactionId?: string;
  withdrawTransactionId?: string;
  swapTransactionId?: string;
  internalTransferId?: string;
  lpExchangeId?: string; // 战役乙波一 T4：LP 兑换单第五父键
  legSeq?: number; // 默认 1
  attempt?: number; // 默认 1
  assetId: string;
  amount: string;
  feeAmount?: string;
  netAmount?: string;
  fromWalletId?: string | null;
  fromAddress?: string | null;
  fromIban?: string | null;
  toWalletId?: string | null;
  toAddress?: string | null;
  toIban?: string | null;
  txHash?: string | null;
  referenceNo?: string | null;
  providerTxnId?: string | null;
  initialStatus?: FundsOrderStatus; // 默认 CREATED
  traceId?: string;
  effectiveDate?: string; // 平账 B 批：事后补的单记到案子业务日；只随事件走，不落表
}
