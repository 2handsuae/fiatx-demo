import { CustomerAuthService } from './customer-auth.service';
export declare class CustomerAuthController {
    private customerAuthService;
    constructor(customerAuthService: CustomerAuthService);
    register(body: any): Promise<{
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
    }>;
    login(body: any): Promise<{
        access_token: string;
        user: {
            id: any;
            email: any;
            firstName: any;
            lastName: any;
        };
    }>;
}
