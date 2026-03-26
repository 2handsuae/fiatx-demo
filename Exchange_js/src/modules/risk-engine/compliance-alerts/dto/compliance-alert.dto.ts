import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
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

export enum AlertResolutionType {
  FALSE_POSITIVE = 'FALSE_POSITIVE',
  DIRECT_DISPOSITION = 'DIRECT_DISPOSITION',
  ESCALATE_TO_CASE = 'ESCALATE_TO_CASE',
}

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
  @IsString()
  stage?: string;

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

  /**
   * @deprecated Compatibility-only alert resolution payload.
   * Canonical alert detail flows should use POST /admin/compliance/alerts/:id/resolve.
   */
  @IsOptional()
  @IsString()
  note?: string;

  /**
   * @deprecated Compatibility-only alert resolution payload.
   * Canonical alert detail flows should use POST /admin/compliance/alerts/:id/resolve.
   */
  @IsOptional()
  @IsString()
  recommendation?: string;

  /**
   * @deprecated Compatibility-only alert resolution payload.
   * Canonical alert detail flows should use POST /admin/compliance/alerts/:id/resolve.
   */
  @IsOptional()
  @IsString()
  decision?: string;

  /**
   * @deprecated Compatibility-only alert resolution payload.
   * Canonical alert detail flows should use POST /admin/compliance/alerts/:id/resolve.
   */
  @IsOptional()
  @IsString()
  dispositionCode?: string;

  /**
   * @deprecated Compatibility-only alert resolution payload.
   * Canonical alert detail flows should use POST /admin/compliance/alerts/:id/resolve.
   */
  @IsOptional()
  @IsString()
  dispositionReason?: string;

  /**
   * @deprecated Compatibility-only alert resolution payload.
   * Canonical alert detail flows should use POST /admin/compliance/alerts/:id/resolve.
   */
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.toLowerCase() === 'true';
    return false;
  })
  @IsBoolean()
  finalizeDisposition?: boolean;

  /**
   * @deprecated Compatibility-only alert resolution payload.
   * Canonical alert detail flows should use POST /admin/compliance/alerts/:id/resolve.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  linkedCaseIds?: string[];

  /**
   * @deprecated Compatibility-only alert resolution payload.
   * Canonical alert detail flows should use POST /admin/compliance/alerts/:id/resolve.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  decisionRecordIds?: string[];
}

export class UpdateComplianceAlertWorkItemDto {
  @IsIn([ComplianceAlertAction.ASSIGN])
  action!: ComplianceAlertAction.ASSIGN;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  assigneeUserId?: string;
}

export class ResolveComplianceAlertDto {
  @IsEnum(AlertResolutionType)
  resolutionType!: AlertResolutionType;

  @IsOptional()
  @IsString()
  proposalCode?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export interface ComplianceAlertActorContext {
  actorType: string;
  actorId: string;
  actorNo?: string;
  actorRole?: string;
  sourcePlatform?: string;
}
