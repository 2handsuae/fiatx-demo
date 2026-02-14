import { PrismaService } from '../../../core/prisma/prisma.service';
import { BootstrapCasesDto, CreateCaseSessionDto, FinalReviewCustomerDto, MockCompleteSessionDto, ReinitiateEddDto, ReviewCddCaseDto, ReviewEddCaseDto, UpdateInvestorClassificationDto, UpsertEntityDto } from './dto/onboarding.dto';
type TradeAction = 'SWAP' | 'WITHDRAW';
type CaseType = 'CDD' | 'EDD';
interface NextStepPayload {
    step: 'ENTITY_INFO' | 'CDD' | 'WAIT_REVIEW' | 'EDD' | 'REINITIATE' | 'COMPLETED';
    action: 'SAVE_ENTITY' | 'START_CDD' | 'COMPLETE_CDD' | 'COMPLETE_EDD' | 'WAIT' | 'REINITIATE_CDD' | 'REINITIATE_EDD' | 'NONE';
    blockedReason: string | null;
    activeCaseId: string | null;
    requiresEdd: boolean;
}
export declare class OnboardingService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    private writeAudit;
    private parseJsonSafely;
    private buildSeed;
    private pickFrom;
    private buildMockDetail;
    private extractInvestorClassification;
    private normalizeRiskTier;
    private computeNextReviewAt;
    private getCustomerType;
    private buildSubjectDescriptors;
    private buildSubjectDescriptorsSafe;
    private resolveJourneyId;
    private getLatestJourneyId;
    private updateUboCaseStatus;
    private indexLatestCaseBySubject;
    private determineCddStatus;
    private determineEddStatus;
    private computeComplianceStatus;
    private pickCurrentCddCaseId;
    private pickCurrentEddCaseId;
    private extractLatestRejectedReason;
    private isSameSnapshotValue;
    private buildSnapshotDiff;
    recomputeComplianceSnapshot(customerId: string, journeyId?: string, txClient?: any): Promise<Record<string, any>>;
    private enrichCasesWithSession;
    private buildSessionPayload;
    private ensurePendingSessionForCase;
    startCddCases(customerId: string, actorId: string, dto?: BootstrapCasesDto): Promise<{
        journeyId: any;
        currentCddCaseId: string;
        session: {
            sessionId: string;
            providerSessionId: string;
            caseType: CaseType;
            caseId: string;
            qrCodeUrl: string;
            expiresAt: Date;
            status: string;
        };
        items: any;
    }>;
    startEddCases(customerId: string, actorId: string): Promise<{
        currentEddCaseId: string;
        session: {
            sessionId: any;
            providerSessionId: any;
            caseType: CaseType;
            caseId: any;
            qrCodeUrl: any;
            expiresAt: any;
            status: any;
        };
    }>;
    getMyOnboarding(customerId: string): Promise<any>;
    listMyCases(customerId: string): Promise<{
        items: any[];
    }>;
    getNextStep(customerId: string): Promise<NextStepPayload>;
    assertTradingEligibility(customerId: string, action: TradeAction): Promise<void>;
    upsertEntity(customerId: string, actorId: string, dto: UpsertEntityDto): Promise<{
        id: string;
        email: string | null;
        lockedUntil: Date | null;
        lastLoginAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
        customerNo: string;
        phone: string | null;
        emailVerifiedAt: Date | null;
        phoneVerifiedAt: Date | null;
        firstName: string | null;
        lastName: string | null;
        companyName: string | null;
        passwordHash: string | null;
        passwordUpdatedAt: Date | null;
        riskScore: number | null;
        riskLevel: string | null;
        riskUpdatedAt: Date | null;
        failedLoginCount: number;
        lastLoginIp: string | null;
        locale: string | null;
        timezone: string | null;
        termsAcceptedAt: Date | null;
        customerType: string;
        cddStatus: string;
        amlRiskTier: string;
        eddRequired: boolean;
        eddStatus: string;
        complianceStatus: string;
        cddDocumentExpiresAt: Date | null;
        finalApprovalStatus: string;
        finalApprovalReason: string | null;
        finalApprovalReviewerId: string | null;
        finalApprovalReviewedAt: Date | null;
        nextReviewAt: Date | null;
        currentCddCaseId: string | null;
        currentEddCaseId: string | null;
        investorClassification: string;
        investorClassificationSource: string;
        investorClassificationUpdatedAt: Date | null;
    } | null>;
    bootstrapCddCases(customerId: string, actorId: string, dto?: BootstrapCasesDto): Promise<{
        journeyId: any;
        items: any;
    }>;
    bootstrapEddCases(customerId: string, actorId: string, dto?: BootstrapCasesDto): Promise<{
        journeyId: any;
        items: any;
        currentEddCaseId: string;
        session: {
            sessionId: string;
            providerSessionId: string;
            caseType: CaseType;
            caseId: string;
            qrCodeUrl: string;
            expiresAt: Date;
            status: string;
        };
    }>;
    createCaseSession(customerId: string, actorId: string, caseId: string, dto: CreateCaseSessionDto): Promise<{
        sessionId: any;
        providerSessionId: any;
        caseType: CaseType;
        caseId: string;
        qrCodeUrl: any;
        expiresAt: any;
        status: any;
    }>;
    mockCompleteSession(customerId: string, actorId: string, sessionId: string, dto?: MockCompleteSessionDto): Promise<{
        sessionId: any;
        status: string;
        caseType: any;
        caseId: any;
    }>;
    listCddCases(params: {
        status?: string;
        customerType?: string;
        customerIds?: string[];
        skip?: number;
        take?: number;
    }): Promise<{
        items: any[];
        total: any;
    }>;
    reviewCddCase(caseId: string, actorId: string, actorRole: string, dto: ReviewCddCaseDto): Promise<{
        id: string;
        status: any;
        complianceStatus: string | undefined;
    }>;
    listEddCases(params: {
        status?: string;
        customerIds?: string[];
        skip?: number;
        take?: number;
    }): Promise<{
        items: any[];
        total: any;
    }>;
    mlroReviewEddCase(caseId: string, actorId: string, actorRole: string, dto: ReviewEddCaseDto): Promise<{
        id: string;
        status: any;
        complianceStatus: string | undefined;
    }>;
    getCddCaseDetail(caseId: string): Promise<any>;
    getEddCaseDetail(caseId: string): Promise<any>;
    reinitiateCddCases(customerId: string, actorId: string): Promise<{
        journeyId: any;
        currentCddCaseId: string;
        session: {
            sessionId: string;
            providerSessionId: string;
            caseType: CaseType;
            caseId: string;
            qrCodeUrl: string;
            expiresAt: Date;
            status: string;
        };
        items: any;
    }>;
    reinitiateEddCases(customerId: string, actorId: string, dto?: ReinitiateEddDto): Promise<{
        journeyId: any;
        items: any;
        currentEddCaseId: string;
        session: {
            sessionId: string;
            providerSessionId: string;
            caseType: CaseType;
            caseId: string;
            qrCodeUrl: string;
            expiresAt: Date;
            status: string;
        };
    }>;
    reviewCustomerFinalDecision(customerId: string, actorId: string, actorRole: string, dto: FinalReviewCustomerDto): Promise<{
        complianceStatus: string;
        finalApprovalStatus: string;
    } | null>;
    simulateCustomerExpired(customerId: string, actorId: string, actorRole: string): Promise<{
        cddStatus: string;
        complianceStatus: string;
        cddDocumentExpiresAt: Date | null;
    } | null>;
    updateInvestorClassification(customerId: string, actorId: string, actorRole: string, dto: UpdateInvestorClassificationDto): Promise<{
        id: string;
        investorClassification: string;
        investorClassificationSource: string;
        investorClassificationUpdatedAt: Date | null;
    }>;
}
export {};
