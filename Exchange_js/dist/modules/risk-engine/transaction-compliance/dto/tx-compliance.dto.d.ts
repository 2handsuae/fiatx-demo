import { KytScreeningStage, TxSourceType } from '../types/tx-compliance.types';
export declare class MockKytCaseCompleteDto {
    sourceType: TxSourceType;
    sourceId: string;
    screeningStage?: KytScreeningStage;
    status?: string;
    riskScore?: number;
    provider?: string;
    providerCaseId?: string;
    rawPayload?: unknown;
    normalizedPayload?: unknown;
    ownerType?: string;
    ownerId?: string;
    assetId?: string;
}
export declare class MockTravelRuleCaseCompleteDto {
    sourceType: TxSourceType;
    sourceId: string;
    required?: boolean;
    status?: string;
    provider?: string;
    providerTransferId?: string;
    counterpartyVasp?: string;
    rawPayload?: unknown;
    normalizedPayload?: unknown;
    ownerType?: string;
    ownerId?: string;
    assetId?: string;
}
export declare class MockBackfillDto {
    sourceType?: TxSourceType;
    sourceStatus?: string;
    dryRun?: boolean;
    limit?: number;
}
export declare class TxCaseListQueryDto {
    skip?: number;
    take?: number;
    sourceType?: TxSourceType;
    sourceId?: string;
    status?: string;
    provider?: string;
    screeningStage?: KytScreeningStage;
}
