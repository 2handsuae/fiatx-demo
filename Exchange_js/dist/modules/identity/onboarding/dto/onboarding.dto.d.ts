export declare class CorporateProfileDto {
    companyName: string;
    registrationNo: string;
    incorporationCountry: string;
    registeredAddress?: string;
    licenseType?: string;
    licenseNumber?: string;
    authorizedSignatoryName?: string;
    authorizedSignatoryTitle?: string;
    documents?: string[];
}
export declare class UboProfileDto {
    fullName: string;
    ownershipPercent?: number;
    nationality?: string;
    idNumber?: string;
    pepFlag?: boolean;
    documents?: string[];
}
export declare class UpsertEntityDto {
    customerType: 'INDIVIDUAL' | 'CORPORATE';
    corporateProfile?: CorporateProfileDto;
    ubos?: UboProfileDto[];
}
export declare class BootstrapCasesDto {
    journeyId?: string;
}
export declare class CreateCaseSessionDto {
    caseType?: 'CDD' | 'EDD';
    provider?: string;
}
export declare class MockCompleteSessionDto {
    result?: 'PASS' | 'FAIL';
}
export declare class ReviewCddCaseDto {
    decision: 'APPROVE' | 'REJECT' | 'UPGRADE_EDD';
    reason?: string;
    requiresEdd?: boolean;
    riskScore?: number;
}
export declare class ReviewEddCaseDto {
    decision: 'APPROVE' | 'REJECT';
    reason?: string;
}
export declare class FinalReviewCustomerDto {
    decision: 'APPROVE' | 'REJECT';
    reason?: string;
}
export declare class ReinitiateEddDto {
    journeyId?: string;
}
export declare class UpdateInvestorClassificationDto {
    classification: 'RETAIL' | 'QUALIFIED' | 'INSTITUTIONAL';
    reason: string;
}
