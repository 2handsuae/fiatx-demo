import { OnboardingService } from './onboarding.service';
import { BootstrapCasesDto, CreateCaseSessionDto, MockCompleteSessionDto, ReinitiateEddDto, UpsertEntityDto } from './dto/onboarding.dto';
export declare class OnboardingCustomerController {
    private readonly onboardingService;
    constructor(onboardingService: OnboardingService);
    private ensureCustomer;
    getMyOnboarding(req: any): Promise<any>;
    listMyCases(req: any): Promise<{
        items: any[];
    }>;
    getNextStep(req: any): Promise<any>;
    upsertEntity(req: any, body: UpsertEntityDto): Promise<{
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
    bootstrapCddCases(req: any, body: BootstrapCasesDto): Promise<{
        journeyId: any;
        currentCddCaseId: string;
        session: {
            sessionId: string;
            providerSessionId: string;
            caseType: "CDD" | "EDD";
            caseId: string;
            qrCodeUrl: string;
            expiresAt: Date;
            status: string;
        };
        items: any;
    }>;
    reinitiateCddCases(req: any): Promise<{
        journeyId: any;
        currentCddCaseId: string;
        session: {
            sessionId: string;
            providerSessionId: string;
            caseType: "CDD" | "EDD";
            caseId: string;
            qrCodeUrl: string;
            expiresAt: Date;
            status: string;
        };
        items: any;
    }>;
    startEddCases(req: any): Promise<{
        currentEddCaseId: string;
        session: {
            sessionId: any;
            providerSessionId: any;
            caseType: "CDD" | "EDD";
            caseId: any;
            qrCodeUrl: any;
            expiresAt: any;
            status: any;
        };
    }>;
    reinitiateEddCases(req: any, body: ReinitiateEddDto): Promise<{
        journeyId: any;
        items: any;
        currentEddCaseId: string;
        session: {
            sessionId: string;
            providerSessionId: string;
            caseType: "CDD" | "EDD";
            caseId: string;
            qrCodeUrl: string;
            expiresAt: Date;
            status: string;
        };
    }>;
    createCaseSession(req: any, id: string, body: CreateCaseSessionDto): Promise<{
        sessionId: any;
        providerSessionId: any;
        caseType: "CDD" | "EDD";
        caseId: string;
        qrCodeUrl: any;
        expiresAt: any;
        status: any;
    }>;
    mockCompleteSession(req: any, sessionId: string, body: MockCompleteSessionDto): Promise<{
        sessionId: any;
        status: string;
        caseType: any;
        caseId: any;
    }>;
}
