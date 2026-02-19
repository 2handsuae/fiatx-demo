import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { KytScreeningStage, TxSourceType } from '../types/tx-compliance.types';

export class MockKytCaseCompleteDto {
  @IsEnum(TxSourceType)
  sourceType!: TxSourceType;

  @IsString()
  sourceId!: string;

  @IsOptional()
  @IsEnum(KytScreeningStage)
  screeningStage?: KytScreeningStage;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  riskScore?: number;

  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsString()
  providerCaseId?: string;

  @IsOptional()
  rawPayload?: unknown;

  @IsOptional()
  normalizedPayload?: unknown;

  @IsOptional()
  @IsString()
  ownerType?: string;

  @IsOptional()
  @IsString()
  ownerId?: string;

  @IsOptional()
  @IsString()
  assetId?: string;
}

export class MockTravelRuleCaseCompleteDto {
  @IsEnum(TxSourceType)
  sourceType!: TxSourceType;

  @IsString()
  sourceId!: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsString()
  providerTransferId?: string;

  @IsOptional()
  @IsString()
  counterpartyVasp?: string;

  @IsOptional()
  rawPayload?: unknown;

  @IsOptional()
  normalizedPayload?: unknown;

  @IsOptional()
  @IsString()
  ownerType?: string;

  @IsOptional()
  @IsString()
  ownerId?: string;

  @IsOptional()
  @IsString()
  assetId?: string;
}

export class MockBackfillDto {
  @IsOptional()
  @IsEnum(TxSourceType)
  sourceType?: TxSourceType;

  @IsOptional()
  @IsString()
  sourceStatus?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  dryRun?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;
}

export class TxCaseListQueryDto {
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
  @IsEnum(TxSourceType)
  sourceType?: TxSourceType;

  @IsOptional()
  @IsString()
  sourceId?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsEnum(KytScreeningStage)
  screeningStage?: KytScreeningStage;
}

export class TxKytCaseCallbackDto {
  @IsEnum(TxSourceType)
  sourceType!: TxSourceType;

  @IsString()
  sourceId!: string;

  @IsOptional()
  @IsEnum(KytScreeningStage)
  screeningStage?: KytScreeningStage;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  riskScore?: number;

  @IsOptional()
  @IsString()
  provider?: string;

  @IsString()
  providerCaseId!: string;

  @IsOptional()
  @IsDateString()
  checkedAt?: string;

  @IsOptional()
  rawPayload?: unknown;

  @IsOptional()
  normalizedPayload?: unknown;

  @IsOptional()
  @IsString()
  ownerType?: string;

  @IsOptional()
  @IsString()
  ownerId?: string;

  @IsOptional()
  @IsString()
  assetId?: string;
}

export class TxTravelRuleCaseCallbackDto {
  @IsEnum(TxSourceType)
  sourceType!: TxSourceType;

  @IsString()
  sourceId!: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  provider?: string;

  @IsString()
  providerTransferId!: string;

  @IsOptional()
  @IsString()
  counterpartyVasp?: string;

  @IsOptional()
  @IsDateString()
  checkedAt?: string;

  @IsOptional()
  rawPayload?: unknown;

  @IsOptional()
  normalizedPayload?: unknown;

  @IsOptional()
  @IsString()
  ownerType?: string;

  @IsOptional()
  @IsString()
  ownerId?: string;

  @IsOptional()
  @IsString()
  assetId?: string;
}
