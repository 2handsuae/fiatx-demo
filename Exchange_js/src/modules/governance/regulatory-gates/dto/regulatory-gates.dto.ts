import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  REGULATORY_GATE_AUTHORITY_VALUES,
  REGULATORY_GATE_EFFECTIVENESS_STATUS_VALUES,
  REGULATORY_GATE_FILING_STATUS_VALUES,
  REGULATORY_GATE_RECEIPT_STATUS_VALUES,
  REGULATORY_GATE_RECEIPT_TYPE_VALUES,
  REGULATORY_GATE_RESULT_VALUES,
  REGULATORY_GATE_SUBJECT_TYPE_VALUES,
  REGULATORY_GATE_TYPE_VALUES,
} from '../constants/regulatory-gates.constants';

export class RegulatoryGateQueryDto {
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
  keyword?: string;

  @ApiPropertyOptional({ enum: REGULATORY_GATE_TYPE_VALUES })
  @IsOptional()
  @IsIn(REGULATORY_GATE_TYPE_VALUES)
  gateType?: string;

  @ApiPropertyOptional({ enum: REGULATORY_GATE_SUBJECT_TYPE_VALUES })
  @IsOptional()
  @IsIn(REGULATORY_GATE_SUBJECT_TYPE_VALUES)
  subjectType?: string;

  @IsOptional()
  @IsString()
  subjectNo?: string;

  @ApiPropertyOptional({ enum: REGULATORY_GATE_RESULT_VALUES })
  @IsOptional()
  @IsIn(REGULATORY_GATE_RESULT_VALUES)
  gateResult?: string;

  @ApiPropertyOptional({ enum: REGULATORY_GATE_FILING_STATUS_VALUES })
  @IsOptional()
  @IsIn(REGULATORY_GATE_FILING_STATUS_VALUES)
  filingStatus?: string;

  @ApiPropertyOptional({ enum: REGULATORY_GATE_RECEIPT_STATUS_VALUES })
  @IsOptional()
  @IsIn(REGULATORY_GATE_RECEIPT_STATUS_VALUES)
  receiptStatus?: string;

  @ApiPropertyOptional({ enum: REGULATORY_GATE_EFFECTIVENESS_STATUS_VALUES })
  @IsOptional()
  @IsIn(REGULATORY_GATE_EFFECTIVENESS_STATUS_VALUES)
  effectivenessStatus?: string;
}

export class CreateRegulatoryGateDto {
  @ApiPropertyOptional({ enum: REGULATORY_GATE_TYPE_VALUES })
  @IsIn(REGULATORY_GATE_TYPE_VALUES)
  gateType!: string;

  @ApiPropertyOptional({ enum: REGULATORY_GATE_AUTHORITY_VALUES })
  @IsOptional()
  @IsIn(REGULATORY_GATE_AUTHORITY_VALUES)
  authority?: string;

  @IsOptional()
  @IsString()
  scopeSummary?: string;

  @IsOptional()
  @IsString()
  shareholdingRegistryVersionId?: string;

  @IsOptional()
  @IsString()
  appointmentRecordId?: string;

  @IsOptional()
  @IsString()
  walletId?: string;

  @IsOptional()
  @IsString()
  linkedApprovalId?: string;

  @IsOptional()
  @IsDateString()
  proposedEffectiveAt?: string;

  @IsOptional()
  metadataJson?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  traceId?: string;
}

export class UpdateRegulatoryGateDto {
  @ApiPropertyOptional({ enum: REGULATORY_GATE_AUTHORITY_VALUES })
  @IsOptional()
  @IsIn(REGULATORY_GATE_AUTHORITY_VALUES)
  authority?: string;

  @IsOptional()
  @IsString()
  scopeSummary?: string;

  @IsOptional()
  @IsString()
  linkedApprovalId?: string;

  @IsOptional()
  @IsDateString()
  proposedEffectiveAt?: string;

  @IsOptional()
  metadataJson?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  traceId?: string;
}

export class SubmitRegulatoryGateDto {
  @IsOptional()
  @IsString()
  filingRefNo?: string;

  @IsOptional()
  @IsDateString()
  filingSubmittedAt?: string;

  @IsOptional()
  @IsString()
  traceId?: string;
}

export class RecordRegulatoryGateFeedbackDto {
  @ApiPropertyOptional({
    enum: [
      'ACCEPTED',
      'RETURNED',
      'REJECTED',
    ],
  })
  @IsIn(['ACCEPTED', 'RETURNED', 'REJECTED'])
  filingStatus!: string;

  @IsOptional()
  @IsString()
  latestFeedback?: string;

  @IsOptional()
  @IsDateString()
  latestFeedbackAt?: string;

  @IsOptional()
  @IsString()
  traceId?: string;
}

export class BindRegulatoryGateReceiptDto {
  @ApiPropertyOptional({ enum: REGULATORY_GATE_RECEIPT_TYPE_VALUES })
  @IsIn(REGULATORY_GATE_RECEIPT_TYPE_VALUES)
  receiptType!: string;

  @IsString()
  receiptRefNo!: string;

  @IsOptional()
  @IsDateString()
  receiptBoundAt?: string;

  @IsOptional()
  @IsString()
  traceId?: string;
}

export class MarkRegulatoryGateEffectiveDto {
  @IsOptional()
  @IsDateString()
  effectiveAt?: string;

  @IsOptional()
  @IsString()
  traceId?: string;
}

export class RevokeRegulatoryGateDto {
  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsDateString()
  revokedAt?: string;

  @IsOptional()
  @IsString()
  traceId?: string;
}
