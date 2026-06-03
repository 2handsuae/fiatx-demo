import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class SwapSimulatorDto {
  @ApiProperty({ description: 'From asset id' })
  @IsUUID()
  fromAssetId!: string;

  @ApiProperty({ description: 'To asset id' })
  @IsUUID()
  toAssetId!: string;

  @ApiProperty({ description: 'Swap amount' })
  @IsNumber()
  @Type(() => Number)
  @Min(0.00000001)
  amount!: number;
}

export class WithdrawalSimulatorDto {
  @ApiProperty({ description: 'Asset id' })
  @IsUUID()
  assetId!: string;

  @ApiProperty({ description: 'Withdraw amount' })
  @IsNumber()
  @Type(() => Number)
  @Min(0.00000001)
  amount!: number;
}

export class CreateWithdrawPricingQuoteDto extends WithdrawalSimulatorDto {
  @ApiPropertyOptional({ description: 'Optional operator note for quote creation' })
  @IsOptional()
  @IsString()
  overrideReason?: string;
}

export enum PricingQuoteBusiness {
  SWAP = 'SWAP',
  WITHDRAWAL = 'WITHDRAWAL',
}

export class AdminPricingQuoteQueryDto {
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

  @ApiPropertyOptional({ enum: PricingQuoteBusiness, description: 'Quote business' })
  @IsOptional()
  @IsEnum(PricingQuoteBusiness)
  business?: PricingQuoteBusiness;

  @ApiPropertyOptional({ description: 'Quote status' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Quote owner ID' })
  @IsOptional()
  @IsString()
  ownerId?: string;

  @ApiPropertyOptional({ description: 'Quote owner no' })
  @IsOptional()
  @IsString()
  ownerNo?: string;

  @ApiPropertyOptional({ description: 'Quote business no' })
  @IsOptional()
  @IsString()
  quoteNo?: string;

  @ApiPropertyOptional({
    description: 'Compatibility-only filter for linked swap no on SWAP quotes',
  })
  @IsOptional()
  @IsString()
  swapNo?: string;

  @ApiPropertyOptional({
    description: 'Compatibility-only filter for from asset on SWAP quotes',
  })
  @IsOptional()
  @IsUUID()
  fromAssetId?: string;

  @ApiPropertyOptional({
    description: 'Compatibility-only filter for to asset on SWAP quotes',
  })
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
