import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type {
  CustomerOnboardingStatus,
  CustomerAdminStatus,
  CustomerComplianceStatus,
} from '../../customer-status.util';

export const ONBOARDING_MOCK_DATA_TYPES = [
  'LOW_RISK',
  'MEDIUM_RISK',
  'HIGH_RISK_OR_PEP',
  'SANCTION_AND_OTHER',
] as const;

export type OnboardingMockDataType = (typeof ONBOARDING_MOCK_DATA_TYPES)[number];

export class CorporateProfileDto {
  @IsString()
  @IsNotEmpty()
  companyName!: string;

  @IsString()
  @IsNotEmpty()
  registrationNo!: string;

  @IsString()
  @IsNotEmpty()
  incorporationCountry!: string;

  @IsOptional()
  @IsString()
  registeredAddress?: string;

  @IsOptional()
  @IsString()
  licenseType?: string;

  @IsOptional()
  @IsString()
  licenseNumber?: string;

  @IsOptional()
  @IsString()
  authorizedSignatoryName?: string;

  @IsOptional()
  @IsString()
  authorizedSignatoryTitle?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  documents?: string[];
}

export class UboProfileDto {
  @IsString()
  @IsNotEmpty()
  fullName!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  ownershipPercent?: number;

  @IsOptional()
  @IsString()
  nationality?: string;

  @IsOptional()
  @IsString()
  idNumber?: string;

  @IsOptional()
  @IsBoolean()
  pepFlag?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  documents?: string[];
}

export class UpsertEntityDto {
  @IsString()
  @IsIn(['INDIVIDUAL'])
  customerType!: 'INDIVIDUAL';

  @IsOptional()
  @ValidateNested()
  @Type(() => CorporateProfileDto)
  corporateProfile?: CorporateProfileDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UboProfileDto)
  ubos?: UboProfileDto[];
}

export class BootstrapResponsesDto {
  @IsOptional()
  @IsString()
  journeyId?: string;
}

export class CreateResponseSessionDto {
  @IsOptional()
  @IsString()
  @IsIn(['CDD', 'EDD'])
  responseType?: 'CDD' | 'EDD';

  @IsOptional()
  @IsString()
  provider?: string;
}

export class MockCompleteSessionDto {
  @IsOptional()
  @IsString()
  @IsIn(['PASS', 'FAIL'])
  result?: 'PASS' | 'FAIL';

  @IsOptional()
  @IsString()
  @IsIn(ONBOARDING_MOCK_DATA_TYPES)
  mockDataType?: OnboardingMockDataType;
}

export class ReviewCddResponseDto {
  @IsString()
  @IsIn(['CLEAR', 'REJECT', 'REQUIRE_EDD'])
  decision!: 'CLEAR' | 'REJECT' | 'REQUIRE_EDD';

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsBoolean()
  requiresEdd?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  riskScore?: number;
}

export class ReviewEddResponseDto {
  @IsString()
  @IsIn(['CLEAR', 'REJECT'])
  decision!: 'CLEAR' | 'REJECT';

  @IsOptional()
  @IsString()
  reason?: string;
}

export class FinalReviewCustomerDto {
  @IsString()
  @IsIn(['APPROVE', 'REJECT'])
  decision!: 'APPROVE' | 'REJECT';

  @IsOptional()
  @IsString()
  reason?: string;
}

export class SubmitFinalApprovalDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

export class VerificationProjectionDto {
  provider!: string | null;
  applicantId!: string | null;
  currentLevelName!: string | null;
  latestReviewId!: string | null;
  latestAttemptId!: string | null;
  substatus!: string | null;
  customerActionRequired!: boolean;
  canContinue!: boolean;
  latestEventType!: string | null;
  latestEventAt!: Date | string | null;
  experiencedLevel2!: boolean;
}

export class StartVerificationResponseDto extends VerificationProjectionDto {
  sdkToken!: string;
}

export interface StartVerificationCustomerSnapshotDto {
  onboardingStatus: CustomerOnboardingStatus;
  adminStatus: CustomerAdminStatus;
  complianceStatus: CustomerComplianceStatus;
}

export interface StartVerificationNextStepDto {
  actions: Array<{ type: string; payload?: Record<string, unknown> }>;
  blockedReason: string | null;
  activeCaseId: string | null;
  requiresEdd: boolean;
  verification: VerificationProjectionDto;
}

export interface StartVerificationSnapshotDto {
  customer: StartVerificationCustomerSnapshotDto;
  nextStep: StartVerificationNextStepDto;
  verification: StartVerificationResponseDto;
}

export class ReinitiateEddDto {
  @IsOptional()
  @IsString()
  journeyId?: string;
}

export class SimulateOnboardingSumsubEventDto {
  @IsString()
  @IsNotEmpty()
  eventType!: string;

  @IsOptional()
  @IsString()
  levelName?: string;

  @IsOptional()
  @IsString()
  reviewAnswer?: string;

  @IsOptional()
  @IsString()
  reviewRejectType?: string;
}

export class DecisionRecordQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  take?: number;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  contextType?: string;

  @IsOptional()
  @IsString()
  outputDecision?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  ownerId?: string;

  @IsOptional()
  @IsString()
  subjectId?: string;

  @IsOptional()
  @IsString()
  policyVersion?: string;
}

export class UpdateInvestorTierDto {
  @IsString()
  @IsIn(['RETAIL', 'QUALIFIED', 'INSTITUTIONAL'])
  classification!: 'RETAIL' | 'QUALIFIED' | 'INSTITUTIONAL';

  @IsString()
  @MinLength(2)
  reason!: string;
}
