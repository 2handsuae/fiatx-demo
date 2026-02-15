import {
  IsString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum RateSourceType {
  API = 'API',
}

export enum LiquidityConfigStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export class CreateLiquidityConfigDto {
  @ApiProperty({ description: 'Liquidity Provider ID' })
  @IsString()
  lpId!: string;

  @ApiProperty({ description: 'From Asset ID' })
  @IsUUID()
  fromAssetId!: string;

  @ApiProperty({ description: 'To Asset ID' })
  @IsUUID()
  toAssetId!: string;

  @ApiProperty({ enum: RateSourceType })
  @IsEnum(RateSourceType)
  rateSourceType!: RateSourceType;

  @ApiProperty({
    default: 0,
    description: 'Fee percentage (e.g., 0.5 for 0.5%)',
  })
  @IsNumber()
  @Min(0)
  feePercent!: number;

  @ApiProperty({
    default: 0,
    description: 'Spread percentage on top of market rate (e.g., 1 for +1%)',
  })
  @IsNumber()
  @Min(0)
  spreadPercent!: number;

  @ApiProperty({ default: 0, description: 'Fixed fee amount' })
  @IsNumber()
  @Min(0)
  feeFixedAmount!: number;

  @ApiProperty({ required: false, description: 'Fee Asset ID' })
  @IsUUID()
  @IsOptional()
  feeAssetId?: string;

  @ApiProperty({ required: false, description: 'Minimum exchange amount' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  minFromAmount?: number;

  @ApiProperty({ required: false, description: 'Maximum exchange amount' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  maxFromAmount?: number;
}

export class UpdateLiquidityConfigDto {
  @ApiProperty({ required: false, enum: RateSourceType })
  @IsEnum(RateSourceType)
  @IsOptional()
  rateSourceType?: RateSourceType;

  @ApiProperty({ required: false })
  @IsNumber()
  @Min(0)
  @IsOptional()
  feePercent?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @Min(0)
  @IsOptional()
  spreadPercent?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @Min(0)
  @IsOptional()
  feeFixedAmount?: number;

  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  feeAssetId?: string;

  @ApiProperty({ required: false })
  @IsNumber()
  @Min(0)
  @IsOptional()
  minFromAmount?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @Min(0)
  @IsOptional()
  maxFromAmount?: number;
}

export class UpdateLiquidityConfigStatusDto {
  @ApiProperty({ enum: LiquidityConfigStatus })
  @IsEnum(LiquidityConfigStatus)
  status!: LiquidityConfigStatus;
}
