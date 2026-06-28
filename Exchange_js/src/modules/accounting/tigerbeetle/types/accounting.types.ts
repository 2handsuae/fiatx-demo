export interface CreateTbAccountParams {
  code: number;
  ledger: number;
  ownerType: 'SYSTEM' | 'CUSTOMER' | 'LP';
  ownerUuid?: string;
  ownerNo?: string;
  assetCurrency: string;
  description?: string;
  flags?: number;
}

export interface EvidenceParams {
  sourceType: string;
  sourceNo: string;
  eventCode: string;
  traceId: string;
  debitCode: string;
  creditCode: string;
  assetCurrency: string;
  actorType: string;
  actorId: string;
  memo?: string;
  // Phase B per-physical-wallet reconciliation fields — all optional, backward compatible.
  //   debit/creditWalletRef → which physical wallet each leg sits on
  //   externalRef           → blockchain txHash / bank statement ref for legs that cross an external boundary
  //   isExternalCrossing    → true only for legs whose movement actually appears on an external statement
  debitWalletRef?: string | null;
  creditWalletRef?: string | null;
  externalRef?: string | null;
  isExternalCrossing?: boolean;
}

export interface ExecuteTransferParams {
  debitAccountId: bigint;
  creditAccountId: bigint;
  amount: bigint;
  ledger: number;
  code: number;
  evidence: EvidenceParams;
}

export interface TbBalanceResult {
  debitsPosted: bigint;
  creditsPosted: bigint;
  debitsPending: bigint;
  creditsPending: bigint;
}

export interface CustomerAvailableBalance {
  available: bigint;
  held: bigint;
  total: bigint;
}

export interface ExecutePendingTransferParams {
  debitAccountId: bigint;
  creditAccountId: bigint;
  amount: bigint;
  ledger: number;
  code: number;
  timeout: number;
  evidence: EvidenceParams;
  tx?: any;
  /**
   * 4th arg to deterministicTransferId, used to distinguish retries of the same
   * (sourceType, sourceNo, eventCode) — e.g. swap leg attempts. Defaults to 0
   * for callers that never retry (deposit/withdraw single-shot legs).
   */
  legIndex?: number;
}

export interface PostOrVoidPendingTransferParams {
  pendingTransferId: bigint;
  amount: bigint;
  evidence: EvidenceParams;
  tx?: any;
}
