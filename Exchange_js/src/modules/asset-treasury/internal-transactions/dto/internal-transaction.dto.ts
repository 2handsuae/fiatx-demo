import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export enum InternalTransactionType {
  DEP_TO_MASTER = 'DEP_TO_MASTER',
  MASTER_TO_PAYOUT = 'MASTER_TO_PAYOUT',
  MASTER_TO_LIQ = 'MASTER_TO_LIQ',
  LIQ_TO_PAYOUT = 'LIQ_TO_PAYOUT',
  CLIENT_BANK_TO_LIQ_BANK = 'CLIENT_BANK_TO_LIQ_BANK',
  LIQ_BANK_TO_CLIENT_BANK = 'LIQ_BANK_TO_CLIENT_BANK',
}

export enum InternalTransactionStatus {
  INTERNAL_FUNDS_PENDING = 'INTERNAL_FUNDS_PENDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export class InternalTransactionQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  skip?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  take?: number;

  @ApiPropertyOptional({ enum: InternalTransactionStatus })
  @IsOptional()
  @IsEnum(InternalTransactionStatus)
  status?: InternalTransactionStatus;

  @ApiPropertyOptional({ enum: InternalTransactionType })
  @IsOptional()
  @IsEnum(InternalTransactionType)
  type?: InternalTransactionType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourceType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourceNo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ownerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ownerNo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  assetId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  internalTxNo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  endDate?: string;
}
