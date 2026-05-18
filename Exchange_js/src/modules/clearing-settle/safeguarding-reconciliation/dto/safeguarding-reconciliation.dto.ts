import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';
import {
  FiatStatementImportStatuses,
  ReconciliationBreakStatuses,
  ReconciliationBreakTypes,
  ReconciliationWarningStatuses,
  ReconciliationWarningTypes,
  SafeguardingPoolRoles,
} from '../constants/safeguarding-reconciliation.constant';

const BUSINESS_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class GenerateSafeguardingDailyDiffDto {
  @IsString()
  @Matches(BUSINESS_DATE_RE, {
    message: 'businessDate must be in YYYY-MM-DD format',
  })
  businessDate!: string;
}

export class SafeguardingBreakQueryDto {
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
  @Matches(BUSINESS_DATE_RE, {
    message: 'businessDate must be in YYYY-MM-DD format',
  })
  businessDate?: string;

  @IsOptional()
  @IsUUID()
  assetId?: string;

  @IsOptional()
  @IsString()
  assetCurrency?: string;

  @IsOptional()
  @IsIn(Object.values(ReconciliationBreakStatuses))
  status?: string;

  @IsOptional()
  @IsIn(Object.values(ReconciliationBreakTypes))
  breakType?: string;
}

export class UpdateReconciliationBreakStatusDto {
  @IsString()
  @IsIn([
    ReconciliationBreakStatuses.UNDER_REVIEW,
    ReconciliationBreakStatuses.RESOLVED,
    ReconciliationBreakStatuses.ACCEPTED_DIFFERENCE,
  ])
  status!: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class SafeguardingWarningQueryDto {
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
  @Matches(BUSINESS_DATE_RE, {
    message: 'businessDate must be in YYYY-MM-DD format',
  })
  businessDate?: string;

  @IsOptional()
  @IsUUID()
  assetId?: string;

  @IsOptional()
  @IsString()
  assetCurrency?: string;

  @IsOptional()
  @IsIn(Object.values(SafeguardingPoolRoles))
  poolRole?: string;

  @IsOptional()
  @IsIn(Object.values(ReconciliationWarningTypes))
  warningType?: string;

  @IsOptional()
  @IsIn(Object.values(ReconciliationWarningStatuses))
  status?: string;
}

export class UpdateReconciliationWarningStatusDto {
  @IsString()
  @IsIn([
    ReconciliationWarningStatuses.ACKNOWLEDGED,
    ReconciliationWarningStatuses.RESOLVED,
    ReconciliationWarningStatuses.ACCEPTED,
  ])
  status!: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class SafeguardingRunQueryDto {
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
  @Matches(BUSINESS_DATE_RE, {
    message: 'businessDate must be in YYYY-MM-DD format',
  })
  businessDate?: string;
}

export class ImportFiatStatementDto {
  @IsString()
  @Matches(BUSINESS_DATE_RE, {
    message: 'businessDate must be in YYYY-MM-DD format',
  })
  businessDate!: string;

  @IsUUID()
  assetId!: string;

  @IsUUID()
  walletId!: string;
}

export class FiatStatementImportQueryDto {
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
  @Matches(BUSINESS_DATE_RE, {
    message: 'businessDate must be in YYYY-MM-DD format',
  })
  businessDate?: string;

  @IsOptional()
  @IsUUID()
  assetId?: string;

  @IsOptional()
  @IsUUID()
  walletId?: string;

  @IsOptional()
  @IsIn(Object.values(FiatStatementImportStatuses))
  status?: string;
}
