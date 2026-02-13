import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsInt,
  IsEnum,
  IsUUID,
  IsJSON,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum DrCr {
  DR = 'DR',
  CR = 'CR',
}

export enum AmountSource {
  AMOUNT = 'AMOUNT',
  FEE_AMOUNT = 'FEE_AMOUNT',
  FROM_AMOUNT = 'FROM_AMOUNT',
  TO_AMOUNT = 'TO_AMOUNT',
}

export enum AssetSource {
  ASSET_ID = 'ASSET_ID',
  FEE_ASSET_ID = 'FEE_ASSET_ID',
  FROM_ASSET_ID = 'FROM_ASSET_ID',
  TO_ASSET_ID = 'TO_ASSET_ID',
}

export class CreateJournalLineTemplateDto {
  @ApiProperty()
  @IsUUID()
  @IsNotEmpty()
  templateId!: string;

  @ApiProperty()
  @IsInt()
  @IsNotEmpty()
  lineNo!: number;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  accountCode!: string;

  @ApiProperty({ enum: DrCr })
  @IsEnum(DrCr)
  @IsNotEmpty()
  drCr!: DrCr;

  @ApiProperty({ enum: AmountSource })
  @IsEnum(AmountSource)
  @IsNotEmpty()
  amountSource!: AmountSource;

  @ApiProperty({ enum: AssetSource })
  @IsEnum(AssetSource)
  @IsNotEmpty()
  assetSource!: AssetSource;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ownerTypeSource?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ownerIdSource?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fxRateSource?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  referenceSource?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsJSON()
  dimensionsRule?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  conditionExpr?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateJournalLineTemplateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  accountCode?: string;

  @ApiPropertyOptional({ enum: DrCr })
  @IsOptional()
  @IsEnum(DrCr)
  drCr?: DrCr;

  @ApiPropertyOptional({ enum: AmountSource })
  @IsOptional()
  @IsEnum(AmountSource)
  amountSource?: AmountSource;

  @ApiPropertyOptional({ enum: AssetSource })
  @IsOptional()
  @IsEnum(AssetSource)
  assetSource?: AssetSource;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ownerTypeSource?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ownerIdSource?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fxRateSource?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  referenceSource?: string;

  @ApiPropertyOptional()
  @IsOptional()
  dimensionsRule?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  conditionExpr?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}

export class JournalLineTemplateQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  templateId?: string;
}
