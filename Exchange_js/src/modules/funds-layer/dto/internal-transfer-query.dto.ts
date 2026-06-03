import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString } from 'class-validator';

/**
 * V7 admin query DTO for the funds-layer internal-transfer monitor.
 *
 * Mirrors the asset-treasury InternalTransactionQueryDto shape but filters by
 * the V7 `pathLabel` (whitelisted transfer path) instead of the legacy
 * type/purpose enums. `InternalTransferService.findAllForAdmin` reads
 * `pathLabel` off the query.
 */
export class InternalTransferQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  skip?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  take?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pathLabel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourceNo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ownerNo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  assetId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  internalTxNo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  endDate?: string;
}
