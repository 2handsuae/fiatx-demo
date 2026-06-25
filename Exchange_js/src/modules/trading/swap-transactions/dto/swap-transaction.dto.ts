import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';
import { InternalFundAction } from '../../../funds-layer/dto/internal-fund.dto';

export enum SwapTransactionStatus {
  PROCESSING = 'PROCESSING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  REVERSED = 'REVERSED',
}

export class CreateSwapTransactionDto {
  @ApiPropertyOptional({ description: 'Business transaction number' })
  @IsOptional()
  @IsString()
  swapNo?: string;

  @ApiProperty({ enum: ['CUSTOMER', 'LP'], description: 'Owner type' })
  @IsEnum(['CUSTOMER', 'LP'])
  ownerType!: string;

  @ApiProperty({ description: 'Owner ID' })
  @IsString()
  ownerId!: string;

  @ApiProperty({ description: 'Source asset ID' })
  @IsUUID()
  fromAssetId!: string;

  @ApiProperty({ description: 'Source amount' })
  @IsNumber()
  @Type(() => Number)
  fromAmount!: number;

  @ApiProperty({ description: 'Target asset ID' })
  @IsUUID()
  toAssetId!: string;

  @ApiProperty({ description: 'Target amount' })
  @IsNumber()
  @Type(() => Number)
  toAmount!: number;
}

export class AdvanceSwapLegDto {
  @ApiProperty({ enum: InternalFundAction, description: 'Action to apply to the swap settlement leg' })
  @IsEnum(InternalFundAction)
  action!: InternalFundAction;
}

export class SwapTransactionQueryDto {
  @ApiPropertyOptional({ description: 'Number of records to skip' })
  @IsOptional()
  @Type(() => Number)
  skip?: number;

  @ApiPropertyOptional({ description: 'Number of records to take' })
  @IsOptional()
  @Type(() => Number)
  take?: number;

  @ApiPropertyOptional({ description: 'Business transaction number' })
  @IsOptional()
  @IsString()
  swapNo?: string;

  @ApiPropertyOptional({ description: 'Owner ID' })
  @IsOptional()
  @IsString()
  ownerId?: string;

  @ApiPropertyOptional({ enum: ['CUSTOMER', 'LP'], description: 'Owner type' })
  @IsOptional()
  @IsEnum(['CUSTOMER', 'LP'])
  ownerType?: string;

  @ApiPropertyOptional({ description: 'Status' })
  @IsOptional()
  @IsEnum(SwapTransactionStatus)
  status?: SwapTransactionStatus;

  @ApiPropertyOptional({ description: 'Start date' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date' })
  @IsOptional()
  @IsString()
  endDate?: string;
}
