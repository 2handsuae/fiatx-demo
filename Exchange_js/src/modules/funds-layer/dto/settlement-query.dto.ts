import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { SETTLEMENT_TYPES, SettlementType } from '../constants/settlement-type.constant';

/**
 * V7 admin query DTO for the funds-layer settlement-batch monitor.
 *
 * Mirrors the InternalTransferQueryDto shape. `SettlementBatchService.findForAdmin`
 * reads `status` / `settlementType` / `batchNo` (and optional date range) off the query.
 */
export class SettlementQueryDto {
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

  @ApiPropertyOptional({ enum: SETTLEMENT_TYPES })
  @IsOptional()
  @IsIn(SETTLEMENT_TYPES)
  settlementType?: SettlementType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  batchNo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  endDate?: string;
}
