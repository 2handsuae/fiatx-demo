import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class ReconcileCollectionsDto {
  @IsOptional()
  @IsString()
  depositId?: string;

  @IsOptional()
  @IsString()
  depositNo?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  onlyMissing?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  dryRun?: boolean;
}
