import { MockBackfillDto, MockKytCaseCompleteDto, MockTravelRuleCaseCompleteDto, TxCaseListQueryDto } from './dto/tx-compliance.dto';
import { TransactionComplianceService } from './transaction-compliance.service';
export declare class TransactionComplianceAdminController {
    private readonly transactionComplianceService;
    constructor(transactionComplianceService: TransactionComplianceService);
    private ensureAdmin;
    mockCompleteKytCase(req: any, body: MockKytCaseCompleteDto): Promise<{
        case: {
            id: string;
            status: string;
            createdAt: Date;
            updatedAt: Date;
            riskScore: number | null;
            ownerType: string;
            assetId: string;
            ownerId: string | null;
            caseNo: string;
            provider: string;
            sourceType: string;
            sourceId: string;
            screeningStage: string;
            providerCaseId: string | null;
            checkedAt: Date | null;
            latestRawPayload: string | null;
            latestNormalizedPayload: string | null;
        };
        report: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            receivedAt: Date;
            provider: string;
            rawPayload: string | null;
            normalizedPayload: string | null;
            sourceType: string;
            sourceId: string;
            screeningStage: string;
            providerCaseId: string | null;
            kytCaseId: string;
        };
    }>;
    mockCompleteTravelRuleCase(req: any, body: MockTravelRuleCaseCompleteDto): Promise<{
        case: {
            id: string;
            status: string;
            createdAt: Date;
            updatedAt: Date;
            ownerType: string;
            counterpartyVasp: string | null;
            assetId: string;
            ownerId: string | null;
            caseNo: string;
            provider: string;
            required: boolean;
            sourceType: string;
            sourceId: string;
            providerTransferId: string | null;
            checkedAt: Date | null;
            latestRawPayload: string | null;
            latestNormalizedPayload: string | null;
        };
        report: {
            id: string;
            status: string;
            createdAt: Date;
            updatedAt: Date;
            counterpartyVasp: string | null;
            receivedAt: Date;
            provider: string;
            rawPayload: string | null;
            normalizedPayload: string | null;
            required: boolean;
            sourceType: string;
            sourceId: string;
            providerTransferId: string | null;
            travelRuleCaseId: string;
        };
    }>;
    mockBackfill(req: any, body: MockBackfillDto): Promise<{
        mode: import("./types/tx-compliance.types").TxComplianceProviderMode;
        dryRun: boolean;
        scanned: number;
        processed: number;
        summary: {
            deposit: {
                scanned: number;
                processed: number;
            };
            withdraw: {
                scanned: number;
                processed: number;
            };
        };
    }>;
    listKytCases(req: any, query: TxCaseListQueryDto): Promise<{
        items: {
            id: string;
            status: string;
            createdAt: Date;
            updatedAt: Date;
            riskScore: number | null;
            ownerType: string;
            assetId: string;
            ownerId: string | null;
            caseNo: string;
            provider: string;
            sourceType: string;
            sourceId: string;
            screeningStage: string;
            providerCaseId: string | null;
            checkedAt: Date | null;
            latestRawPayload: string | null;
            latestNormalizedPayload: string | null;
        }[];
        total: number;
    }>;
    listTravelRuleCases(req: any, query: TxCaseListQueryDto): Promise<{
        items: {
            id: string;
            status: string;
            createdAt: Date;
            updatedAt: Date;
            ownerType: string;
            counterpartyVasp: string | null;
            assetId: string;
            ownerId: string | null;
            caseNo: string;
            provider: string;
            required: boolean;
            sourceType: string;
            sourceId: string;
            providerTransferId: string | null;
            checkedAt: Date | null;
            latestRawPayload: string | null;
            latestNormalizedPayload: string | null;
        }[];
        total: number;
    }>;
}
