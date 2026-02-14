import { OnboardingService } from './onboarding.service';
import { FinalReviewCustomerDto, ReviewCddCaseDto, ReviewEddCaseDto, UpdateInvestorClassificationDto } from './dto/onboarding.dto';
export declare class OnboardingAdminController {
    private readonly onboardingService;
    constructor(onboardingService: OnboardingService);
    private getAdminActor;
    private parseCustomerIds;
    listCddCases(req: any, status?: string, customerType?: string, customerIds?: string, skip?: string, take?: string): Promise<{
        items: any[];
        total: any;
    }>;
    reviewCddCase(req: any, id: string, body: ReviewCddCaseDto): Promise<{
        id: string;
        status: any;
        complianceStatus: string | undefined;
    }>;
    getCddCaseDetail(req: any, id: string): Promise<any>;
    listEddCases(req: any, status?: string, customerIds?: string, skip?: string, take?: string): Promise<{
        items: any[];
        total: any;
    }>;
    mlroReview(req: any, id: string, body: ReviewEddCaseDto): Promise<{
        id: string;
        status: any;
        complianceStatus: string | undefined;
    }>;
    getEddCaseDetail(req: any, id: string): Promise<any>;
    finalReviewCustomer(req: any, id: string, body: FinalReviewCustomerDto): Promise<{
        complianceStatus: string;
        finalApprovalStatus: string;
    } | null>;
    simulateExpired(req: any, id: string): Promise<{
        cddStatus: string;
        complianceStatus: string;
        cddDocumentExpiresAt: Date | null;
    } | null>;
    updateInvestorClassification(req: any, id: string, body: UpdateInvestorClassificationDto): Promise<{
        id: string;
        investorClassification: string;
        investorClassificationSource: string;
        investorClassificationUpdatedAt: Date | null;
    }>;
}
