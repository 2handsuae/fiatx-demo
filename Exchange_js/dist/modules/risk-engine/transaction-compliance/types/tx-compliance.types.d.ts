export declare enum TxSourceType {
    DEPOSIT = "DEPOSIT",
    WITHDRAW = "WITHDRAW",
    PAYIN = "PAYIN",
    SWAP = "SWAP",
    PAYOUT = "PAYOUT"
}
export declare enum KytScreeningStage {
    PRE_TXN = "PRE_TXN",
    MAIN = "MAIN"
}
export type TxComplianceProviderMode = 'MOCK' | 'MANUAL';
export interface TxSourceContext {
    sourceType: TxSourceType;
    sourceId: string;
    ownerType: string;
    ownerId: string | null;
    assetId: string;
}
export interface UpsertKytCaseInput extends TxSourceContext {
    screeningStage: KytScreeningStage;
    provider?: string;
    providerCaseId?: string | null;
    status?: string;
    riskScore?: number | null;
    checkedAt?: Date | null;
    rawPayload?: unknown;
    normalizedPayload?: unknown;
}
export interface UpsertTravelRuleCaseInput extends TxSourceContext {
    provider?: string;
    providerTransferId?: string | null;
    required?: boolean;
    status?: string;
    counterpartyVasp?: string | null;
    checkedAt?: Date | null;
    rawPayload?: unknown;
    normalizedPayload?: unknown;
}
