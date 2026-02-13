import { IsString, IsBoolean, IsOptional, IsNumber, IsEnum, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateClearingLineTemplateDto {
  @IsNumber()
  lineNo!: number;

  @IsString()
  lineType!: string;

  @IsString()
  partyType!: string;

  @IsString()
  @IsOptional()
  partyIdSource?: string;

  @IsString()
  assetSource!: string;

  @IsString()
  amountSource!: string;

  @IsString()
  @IsOptional()
  refTypeConst?: string;

  @IsString()
  @IsOptional()
  refIdSource?: string;

  @IsString()
  @IsOptional()
  memoTemplate?: string;

  @IsBoolean()
  @IsOptional()
  isEnabled?: boolean;
}

export class CreateClearingTemplateDto {
  @IsString()
  code!: string;

  @IsString()
  clearingType!: string;

  @IsString()
  sourceType!: string;

  @IsBoolean()
  @IsOptional()
  isEnabled?: boolean;

  @IsString()
  description!: string;

  @IsString()
  @IsOptional()
  feeMethod?: string;

  @IsString()
  outAssetSource!: string;

  @IsString()
  outAmountSource!: string;

  @IsString()
  inAssetSource!: string;

  @IsString()
  inAmountSource!: string;

  @IsString()
  feeAssetSource!: string;

  @IsString()
  feeAmountSource!: string;

  @IsString()
  @IsOptional()
  outPayoutIdSource?: string;

  @IsString()
  @IsOptional()
  inPayinIdSource?: string;

  @IsString()
  @IsOptional()
  memoTemplate?: string;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CreateClearingLineTemplateDto)
  lineTemplates?: CreateClearingLineTemplateDto[];
}

export class UpdateClearingTemplateDto extends CreateClearingTemplateDto {}

export class QueryClearingTemplateDto {
  @IsString()
  @IsOptional()
  code?: string;

  @IsString()
  @IsOptional()
  status?: string;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  skip?: number;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  take?: number;
}

export class QueryClearingLineDto {
  @IsString()
  @IsOptional()
  clearingId?: string;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  skip?: number;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  take?: number;

  @IsString()
  @IsOptional()
  sortBy?: string;

  @IsString()
  @IsOptional()
  sortOrder?: 'asc' | 'desc';
}

export class QueryClearingDto {
  @IsString()
  @IsOptional()
  sourceId?: string;

  @IsString()
  @IsOptional()
  clearingStatus?: string;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  skip?: number;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  take?: number;

  @IsString()
  @IsOptional()
  sortBy?: string;

  @IsString()
  @IsOptional()
  sortOrder?: 'asc' | 'desc';
}
