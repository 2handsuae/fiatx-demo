import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, IsUUID, Min } from 'class-validator';

export enum CustomerSwapRateStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export class CreateCustomerSwapRateDto {
  @ApiProperty({ description: 'From asset ID' })
  @IsUUID()
  fromAssetId!: string;

  @ApiProperty({ description: 'To asset ID' })
  @IsUUID()
  toAssetId!: string;

  @ApiProperty({ description: 'Spread percentage on top of market rate', default: 0 })
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  spreadPercent!: number;
}

export class UpdateCustomerSwapRateDto {
  @ApiPropertyOptional({ description: 'Spread percentage on top of market rate' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  spreadPercent?: number;
}

export class UpdateCustomerSwapRateStatusDto {
  @ApiProperty({ enum: CustomerSwapRateStatus })
  @IsEnum(CustomerSwapRateStatus)
  status!: CustomerSwapRateStatus;
}
