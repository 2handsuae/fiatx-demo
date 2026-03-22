import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

export class UpsertCaseReportDraftDto {
  @IsOptional()
  @IsString()
  factsSummary?: string;

  @IsOptional()
  @IsString()
  investigationScope?: string;

  @IsOptional()
  @IsString()
  evidenceSummary?: string;

  @IsOptional()
  @IsString()
  containmentSummary?: string;

  @IsOptional()
  @IsString()
  analystConclusion?: string;

  @IsOptional()
  @IsString()
  recommendedActions?: string;

  @IsOptional()
  @IsString()
  finalDispositionCode?: string;

  @IsOptional()
  @IsString()
  finalDispositionReason?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  filingRequired?: boolean;

  @IsOptional()
  @IsString()
  filingType?: string;

  @IsOptional()
  @IsString()
  filingAuthority?: string;
}

export class FinalizeCaseReportDto {
  @IsOptional()
  @IsString()
  note?: string;
}

export class SubmitCaseToMlroDto {
  @IsOptional()
  @IsString()
  note?: string;
}

export class ReviewCaseByMlroDto {
  @IsString()
  @IsIn(['RETURN_FOR_INVESTIGATION', 'APPROVE_FINAL_DISPOSITION'])
  decision!: 'RETURN_FOR_INVESTIGATION' | 'APPROVE_FINAL_DISPOSITION';

  @IsOptional()
  @IsString()
  note?: string;
}

export class SubmitCaseExternalFilingDto {
  @IsOptional()
  @IsString()
  externalRefNo?: string;

  @IsOptional()
  @IsString()
  submittedAt?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class RecordCaseExternalFilingFeedbackDto {
  @IsString()
  @IsIn(['ACKNOWLEDGED', 'RETURNED'])
  status!: 'ACKNOWLEDGED' | 'RETURNED';

  @IsOptional()
  @IsString()
  externalRefNo?: string;

  @IsString()
  feedback!: string;

  @IsOptional()
  @IsString()
  feedbackAt?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class CloseCaseExternalFilingDto {
  @IsOptional()
  @IsString()
  note?: string;
}
