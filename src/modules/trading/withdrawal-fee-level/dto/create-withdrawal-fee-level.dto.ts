import { IsArray, IsBoolean, IsDateString, IsOptional, IsString } from 'class-validator';

export class CreateWithdrawalFeeLevelDto {
  @IsString()
  levelCode!: string;

  @IsString()
  name!: string;

  @IsString()
  assetId!: string;

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
