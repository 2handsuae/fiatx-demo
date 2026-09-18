import { IsArray, IsBoolean, IsDateString, IsOptional, IsString } from 'class-validator';

export class CreateSwapFeeLevelDto {
  @IsString()
  levelCode!: string;

  @IsString()
  name!: string;

  @IsString()
  fromAssetId!: string;

  @IsString()
  toAssetId!: string;

  @IsBoolean()
  isDefault!: boolean;

  @IsString()
  tiersJson!: string;

  @IsString()
  reason!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requiredTags?: string[];

  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @IsOptional()
  @IsDateString()
  validTo?: string;
}
