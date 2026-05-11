import {
  IsString,
  IsEnum,
  IsInt,
  IsOptional,
  IsBoolean,
  IsNumber,
  Min,
  Max,
  MaxLength,
  ValidateIf,
  IsNotEmpty,
} from 'class-validator';
import { AssetType } from './asset.dto';

export { AssetType };

export class SubmitAssetListingDto {
  @IsString()
  @MaxLength(16)
  code!: string;

  @IsEnum(AssetType)
  type!: AssetType;

  @ValidateIf((o) => o.type === AssetType.CRYPTO)
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  network?: string;

  @IsInt()
  @Min(0)
  @Max(18)
  decimals!: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  contractAddress?: string;

  @IsNumber()
  @Min(0)
  minDepositAmount!: number;

  @IsNumber()
  @Min(0)
  maxDepositAmount!: number;

  @IsNumber()
  @Min(0)
  minWithdrawAmount!: number;

  @IsNumber()
  @Min(0)
  maxWithdrawAmount!: number;

  @IsBoolean()
  depositEnabled!: boolean;

  @IsBoolean()
  withdrawalEnabled!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  description?: string;
}
