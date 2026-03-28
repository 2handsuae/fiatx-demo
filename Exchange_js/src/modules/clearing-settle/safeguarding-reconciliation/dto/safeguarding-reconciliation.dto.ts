import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import {
  ReconciliationBreakReasonCodes,
  ReconciliationBreakStatuses,
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
  @IsString()
  withdrawNo?: string;

  @IsOptional()
  @IsString()
  payoutNo?: string;

  @IsOptional()
  @IsIn(Object.values(ReconciliationBreakStatuses))
  status?: string;

  @IsOptional()
  @IsIn(Object.values(ReconciliationBreakReasonCodes))
  reasonCode?: string;
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
