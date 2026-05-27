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
}

export interface PostOrVoidPendingTransferParams {
  pendingTransferId: bigint;
  evidence: EvidenceParams;
  tx?: any;
}
