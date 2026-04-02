import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export enum FeeOccurrenceStatus {
  RECORDED = 'RECORDED',
  CANCELLED = 'CANCELLED',
}

export enum FeeType {
  NETWORK_GAS = 'NETWORK_GAS',
  BANK_TRANSFER_FEE = 'BANK_TRANSFER_FEE',
  INTERNAL_TRANSFER_GAS = 'INTERNAL_TRANSFER_GAS',
  INTERNAL_BANK_FEE = 'INTERNAL_BANK_FEE',
  CUSTODY_FEE = 'CUSTODY_FEE',
  BANK_MONTHLY_FEE = 'BANK_MONTHLY_FEE',
  RECONCILIATION_ADJUSTMENT_FEE = 'RECONCILIATION_ADJUSTMENT_FEE',
}

export class FeeOccurrenceQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  skip?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  take?: string;

  @ApiPropertyOptional({ enum: FeeOccurrenceStatus })
  @IsOptional()
  @IsEnum(FeeOccurrenceStatus)
  status?: FeeOccurrenceStatus;

  @ApiPropertyOptional({ enum: FeeType })
  @IsOptional()
  @IsEnum(FeeType)
  feeType?: FeeType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assetId?: string;
}

export class CreateFeeOccurrenceDto {
  @ApiProperty({ enum: FeeType })
  @IsEnum(FeeType)
  feeType!: FeeType;

  @ApiProperty()
  @IsUUID()
  assetId!: string;

  @ApiProperty({ description: 'Decimal amount string' })
  @IsString()
  amount!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourceEntityType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourceEntityId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourceEntityNo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sourceWalletId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourceAccountRef?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  relatedEntityType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  relatedEntityId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  relatedEntityNo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  poolRole?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  evidenceRef?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  traceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  metadata?: any;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  chargedToCustomer?: boolean;
}

export class CancelFeeOccurrenceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}
