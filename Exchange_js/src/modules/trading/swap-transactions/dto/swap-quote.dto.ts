import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export enum SwapQuoteStatus {
  ACTIVE = 'ACTIVE',
  USED = 'USED',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
}

export enum SwapSide {
  SELL_BASE = 'SELL_BASE',
  BUY_BASE = 'BUY_BASE',
}

export class CreateSwapQuoteDto {
  @ApiProperty({ description: 'Source asset ID' })
  @IsUUID()
  fromAssetId!: string;

  @ApiProperty({ description: 'Target asset ID' })
  @IsUUID()
  toAssetId!: string;

  @ApiProperty({ description: 'Source amount (EXACT_IN)' })
  @IsNumber()
  @Type(() => Number)
  @Min(0.00000001)
  fromAmount!: number;
}

export class CreateSwapFromQuoteDto {
  @ApiProperty({ description: 'Firm quote ID' })
  @IsUUID()
  quoteId!: string;
}

export class CancelSwapQuoteDto {
  @ApiPropertyOptional({ description: 'Reserved for future cancellation reason' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class AdminSwapQuoteQueryDto {
  @ApiPropertyOptional({ description: 'Number of records to skip' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  skip?: number;

  @ApiPropertyOptional({ description: 'Number of records to take' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  take?: number;

  @ApiPropertyOptional({ enum: SwapQuoteStatus, description: 'Quote status' })
  @IsOptional()
  @IsEnum(SwapQuoteStatus)
  status?: SwapQuoteStatus;

  @ApiPropertyOptional({ description: 'Quote owner ID' })
  @IsOptional()
  @IsString()
  ownerId?: string;

  @ApiPropertyOptional({ description: 'Quote business no' })
  @IsOptional()
  @IsString()
  quoteNo?: string;

  @ApiPropertyOptional({ description: 'Quote owner no' })
  @IsOptional()
  @IsString()
  ownerNo?: string;

  @ApiPropertyOptional({ description: 'Linked swap no' })
  @IsOptional()
  @IsString()
  swapNo?: string;

  @ApiPropertyOptional({ description: 'From asset ID' })
  @IsOptional()
  @IsUUID()
  fromAssetId?: string;

  @ApiPropertyOptional({ description: 'To asset ID' })
  @IsOptional()
  @IsUUID()
  toAssetId?: string;

  @ApiPropertyOptional({ description: 'Start date (ISO string)' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date (ISO string)' })
  @IsOptional()
  @IsString()
  endDate?: string;
}
