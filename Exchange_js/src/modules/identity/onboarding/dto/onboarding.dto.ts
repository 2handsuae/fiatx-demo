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

export class BootstrapCasesDto {
  @IsOptional()
  @IsString()
  journeyId?: string;
}

export class CreateCaseSessionDto {
  @IsOptional()
  @IsString()
  @IsIn(['CDD', 'EDD'])
  caseType?: 'CDD' | 'EDD';

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

export class ReviewCddCaseDto {
  @IsString()
  @IsIn(['APPROVE', 'REJECT', 'UPGRADE_EDD'])
  decision!: 'APPROVE' | 'REJECT' | 'UPGRADE_EDD';

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

export class ReviewEddCaseDto {
  @IsString()
  @IsIn(['APPROVE', 'REJECT'])
  decision!: 'APPROVE' | 'REJECT';

  @IsOptional()
  @IsString()
  reason?: string;
}

export class ApplyOnboardingAlertDecisionDto {
  @IsString()
  @IsIn(['APPROVE', 'REJECT', 'REQUIRE_EDD'])
  decision!: 'APPROVE' | 'REJECT' | 'REQUIRE_EDD';

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

export class ReinitiateEddDto {
  @IsOptional()
  @IsString()
  journeyId?: string;
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
  subjectId?: string;

  @IsOptional()
  @IsString()
  policyVersion?: string;
}

export class UpdateInvestorClassificationDto {
  @IsString()
  @IsIn(['RETAIL', 'QUALIFIED', 'INSTITUTIONAL'])
  classification!: 'RETAIL' | 'QUALIFIED' | 'INSTITUTIONAL';

  @IsString()
  @MinLength(2)
  reason!: string;
}
