import { IsOptional, IsString } from 'class-validator';

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
}

export class FinalizeCaseReportDto {
  @IsOptional()
  @IsString()
  note?: string;
}
