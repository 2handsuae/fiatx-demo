export interface CreateTbAccountParams {
  code: number;
  ledger: number;
  ownerType: 'SYSTEM' | 'CUSTOMER' | 'LP' | 'WALLET';
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
  // externalRef：区块链 txHash / 银行流水号，对账用。钱包归属不再靠凭证带标签——
  // 现金户一钱包一户，投影器按注册表（WALLET 归属）派生 account_flows.walletRef。
  externalRef?: string | null;
  // 平账推单回填口：不传=写入当天；仅资金单推单链路（deposit STEP_1/2 + withdraw FEE_FIRM）传入（YYYY-MM-DD）
  effectiveDate?: string;
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
