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
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

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
  @IsIn(['INDIVIDUAL', 'CORPORATE'])
  customerType!: 'INDIVIDUAL' | 'CORPORATE';

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

export class SaveCddCaseDto {
  @IsOptional()
  @IsString()
  caseId?: string;

  // Flexible payload for CDD/KYB input
  @IsOptional()
  inputData?: Record<string, any>;
}

export class SubmitCaseDto {
  @IsOptional()
  @IsString()
  note?: string;
}

export class SaveEddCaseDto {
  @IsOptional()
  @IsString()
  caseId?: string;

  @IsOptional()
  @IsString()
  sourceOfFunds?: string;

  @IsOptional()
  @IsString()
  sourceOfWealth?: string;

  // Flexible payload for EDD evidence
  @IsOptional()
  inputData?: Record<string, any>;
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
}

export class ReviewCddCaseDto {
  @IsString()
  @IsIn(['APPROVE', 'REJECT', 'NEED_INFO'])
  decision!: 'APPROVE' | 'REJECT' | 'NEED_INFO';

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
  @IsIn(['APPROVE', 'REJECT', 'NEED_INFO'])
  decision!: 'APPROVE' | 'REJECT' | 'NEED_INFO';

  @IsOptional()
  @IsString()
  reason?: string;
}

export class RejectCustomerDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
