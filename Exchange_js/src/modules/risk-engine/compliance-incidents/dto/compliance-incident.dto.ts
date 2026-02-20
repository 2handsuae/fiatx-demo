import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
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
  ownerUserId?: string;

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
  incidentNo?: string;

  @IsOptional()
  @IsString()
  alertNo?: string;
}

export class CreateIncidentFromAlertDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
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
  rootCauseCategory?: string;

  @IsOptional()
  @IsString()
  resolutionSummary?: string;

  @IsOptional()
  @IsString()
  containmentSummary?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(3)
  closureChecklist?: unknown[];
}

export interface ComplianceIncidentActorContext {
  actorType: string;
  actorId: string;
  actorNo?: string;
  actorRole?: string;
  sourcePlatform?: string;
}
