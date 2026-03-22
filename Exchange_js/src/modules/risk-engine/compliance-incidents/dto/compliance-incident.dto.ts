import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  ComplianceCaseType,
  ComplianceIncidentAction,
  ComplianceIncidentSeverity,
  ComplianceIncidentStatus,
} from '../constants/compliance-incident-rules.constant';

export class ComplianceIncidentQueryDto {
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
  @IsEnum(ComplianceIncidentStatus)
  status?: ComplianceIncidentStatus;

  @IsOptional()
  @IsEnum(ComplianceIncidentSeverity)
  severity?: ComplianceIncidentSeverity;

  @IsOptional()
  @IsString()
  customerNo?: string;

  @IsOptional()
  @IsString()
  assigneeUserId?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.toLowerCase() === 'true';
    return false;
  })
  @IsBoolean()
  overdueOnly?: boolean;

  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsString()
  caseNo?: string;

  @IsOptional()
  @IsEnum(ComplianceCaseType)
  caseType?: ComplianceCaseType;

  @IsOptional()
  @IsString()
  alertNo?: string;
}

export class CreateIncidentFromAlertDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;

  @IsOptional()
  @IsString()
  decision?: string;

  @IsOptional()
  @IsString()
  dispositionCode?: string;

  @IsOptional()
  @IsString()
  dispositionReason?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.toLowerCase() === 'true';
    return false;
  })
  @IsBoolean()
  finalizeDisposition?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  linkedCaseIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  decisionRecordIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  recommendedActions?: string[];
}

export class LinkIncidentAlertDto {
  @IsString()
  @IsNotEmpty()
  alertId!: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class UpdateComplianceIncidentActionDto {
  @IsEnum(ComplianceIncidentAction)
  action!: ComplianceIncidentAction;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  assigneeUserId?: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  decision?: string;

  @IsOptional()
  @IsString()
  dispositionCode?: string;

  @IsOptional()
  @IsString()
  dispositionReason?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.toLowerCase() === 'true';
    return false;
  })
  @IsBoolean()
  finalizeDisposition?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  linkedCaseIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  decisionRecordIds?: string[];
}

export interface ComplianceIncidentActorContext {
  actorType: string;
  actorId: string;
  actorNo?: string;
  actorRole?: string;
  roleCodes?: string[];
  sourcePlatform?: string;
}
