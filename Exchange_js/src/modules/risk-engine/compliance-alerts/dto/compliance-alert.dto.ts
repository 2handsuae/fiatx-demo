import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  ComplianceAlertAction,
  ComplianceAlertSeverity,
  ComplianceAlertStatus,
} from '../constants/compliance-alert-rules.constant';

export class ComplianceAlertQueryDto {
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
  @IsEnum(ComplianceAlertStatus)
  status?: ComplianceAlertStatus;

  @IsOptional()
  @IsEnum(ComplianceAlertSeverity)
  severity?: ComplianceAlertSeverity;

  @IsOptional()
  @IsString()
  ruleCode?: string;

  @IsOptional()
  @IsString()
  sourceType?: string;

  @IsOptional()
  @IsString()
  sourceId?: string;

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
}

export class UpdateComplianceAlertActionDto {
  @IsEnum(ComplianceAlertAction)
  action!: ComplianceAlertAction;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  assigneeUserId?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export interface ComplianceAlertActorContext {
  actorType: string;
  actorId: string;
  actorNo?: string;
  actorRole?: string;
  sourcePlatform?: string;
}
