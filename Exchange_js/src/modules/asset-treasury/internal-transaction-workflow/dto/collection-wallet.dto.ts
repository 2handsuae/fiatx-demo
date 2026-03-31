import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CollectionWalletQueryDto {
  @IsOptional()
  @Type(() => Number)
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(200)
  take?: number;

  @IsOptional()
  @IsString()
  assetId?: string;
}

export class ReconcileCollectionWalletDto {
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  dryRun?: boolean;
}
