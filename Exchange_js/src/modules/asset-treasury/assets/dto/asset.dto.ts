import {
  IsString,
  IsInt,
  IsEnum,
  IsOptional,
  MaxLength,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum AssetType {
  FIAT = 'FIAT',
  CRYPTO = 'CRYPTO',
}

export enum AssetStatus {
  PROVISIONING = 'PROVISIONING',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
}

export class CreateAssetDto {
  @ApiProperty({ enum: AssetType })
  @IsEnum(AssetType)
  type!: AssetType;

  @ApiProperty()
  @IsString()
  @MaxLength(16)
  currency!: string;

  @ApiProperty({ required: false })
  @IsString()
  @MaxLength(32)
  @IsOptional()
  network?: string;

  @ApiProperty()
  @IsInt()
  @Min(0)
  @Max(18)
  decimals!: number;

  @ApiProperty({ required: false })
  @IsString()
  @MaxLength(64)
  @IsOptional()
  description?: string;
}

export class UpdateAssetStatusDto {
  @ApiProperty({ enum: AssetStatus })
  @IsEnum(AssetStatus)
  status!: AssetStatus;
}
